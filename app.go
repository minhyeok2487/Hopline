package main

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"fyne.io/systray"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// conn is one live terminal backend (SSH shell or serial port).
type conn interface {
	Write(p []byte) (int, error)
	Resize(cols, rows int) error
	Close() error
}

type liveConn struct {
	id        string
	name      string // tab title (session name, or what the user renamed it to)
	sessionID string // "" for quick-connect tabs
	kind      string // ssh | serial | telnet
	target    string // user@host:port or COM port, for list_tabs
	c         conn
	ssh       *sshConn // nil for serial

	logMu sync.Mutex
	log   *os.File

	out outTap // recent output + MCP captures

	logonDone chan struct{} // closed when logon actions finish; nil if the session has none
}

// App is bound to the frontend; exported methods are callable from JS.
type App struct {
	ctx   context.Context
	store *Store

	mu        sync.Mutex
	conns     map[string]*liveConn
	activeTab string // tab the user is looking at (reported by the UI)
	dialing   map[string]context.CancelFunc

	mcp mcpState

	tray     trayState
	quitting atomic.Bool

	tftp     tftpState
	noEvents bool // tests: no Wails runtime to send events to

	updMu       sync.Mutex
	update      UpdateInfo
	justUpdated bool
}

func NewApp() *App {
	return &App{store: NewStore(), conns: map[string]*liveConn{}, dialing: map[string]context.CancelFunc{}}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if a.store.Settings().MCPEnabled {
		if err := a.startMCP(); err != nil {
			println("MCP start failed:", err.Error())
		}
	}
	a.startTray()
	go updateSkill()
	go a.watchUpdates()
}

func (a *App) shutdown(ctx context.Context) {
	systray.Quit()
	a.StopTFTP()
	a.stopMCP()
	a.mu.Lock()
	all := make([]*liveConn, 0, len(a.conns))
	for _, lc := range a.conns {
		all = append(all, lc)
	}
	a.mu.Unlock()
	for _, lc := range all {
		a.closeConn(lc, "")
	}
}

// ---------- sessions / macros ----------

func (a *App) ListSessions() []Session { return forUI(a.store.Sessions()) }

func (a *App) SaveSession(s Session, password string, savePassword bool) (Session, error) {
	if s.Kind == "" {
		s.Kind = "ssh"
	}
	if s.Kind == "telnet" && s.Port == 0 {
		s.Port = 23
	}
	if s.Kind == "ssh" && s.Port == 0 {
		s.Port = 22
	}
	s.Folder = cleanFolder(s.Folder)
	if s.Name == "" {
		if s.Kind == "serial" {
			s.Name = s.ComPort
		} else {
			s.Name = s.Host
		}
	}
	saved, err := a.store.Put(s, password, savePassword)
	if err != nil {
		return saved, err
	}
	return forUI([]Session{saved})[0], nil
}

// SetSessionPassword stores a password for an existing session (used after a prompt).
func (a *App) SetSessionPassword(id, password string) error {
	s, ok := a.store.Get(id)
	if !ok {
		return errors.New("session not found")
	}
	_, err := a.store.Put(s, password, true)
	return err
}

func (a *App) DeleteSession(id string) error { return a.store.Delete(id) }

func (a *App) ListMacros() []Macro              { return a.store.Macros() }
func (a *App) SaveMacro(m Macro) (Macro, error) { return a.store.PutMacro(m) }
func (a *App) DeleteMacro(id string) error      { return a.store.DeleteMacro(id) }
func (a *App) PickKeyFile() (string, error) {
	home, _ := os.UserHomeDir()
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:            T("dlg.pickKey"),
		DefaultDirectory: filepath.Join(home, ".ssh"),
	})
}

// ---------- connect ----------

// ErrNeedPassword tells the UI to prompt for a password and retry.
const ErrNeedPassword = "NEED_PASSWORD"

// Connect opens a saved session. The UI picks connID and subscribes to
// "data:<connID>" / "closed:<connID>" before calling, so no output is lost.
func (a *App) Connect(connID, sessionID, password string, cols, rows int) error {
	s, ok := a.store.Get(sessionID)
	if !ok {
		return errors.New(T("err.sessionNotFound"))
	}
	if password == "" && s.HasPassword {
		pw, err := a.store.Password(sessionID)
		if err != nil {
			return fmt.Errorf(T("err.decrypt"), err)
		}
		password = pw
	}
	return a.connect(connID, s, password, cols, rows)
}

// ConnectAdhoc opens an unsaved session (quick connect).
func (a *App) ConnectAdhoc(connID string, s Session, password string, cols, rows int) error {
	if s.Kind == "" {
		s.Kind = "ssh"
	}
	if s.Port == 0 && s.Kind == "telnet" {
		s.Port = 23
	} else if s.Port == 0 {
		s.Port = 22
	}
	return a.connect(connID, s, password, cols, rows)
}

func (a *App) connect(connID string, s Session, password string, cols, rows int) error {
	// Reserve the id up front so a second caller (e.g. another window) can't
	// dial the same connection in parallel.
	a.mu.Lock()
	if _, busy := a.conns[connID]; busy || a.dialing[connID] != nil {
		a.mu.Unlock()
		return errors.New(T("err.alreadyConnected"))
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.dialing[connID] = cancel
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		delete(a.dialing, connID)
		a.mu.Unlock()
		cancel()
	}()

	lc := &liveConn{id: connID, name: s.Name, sessionID: s.ID, target: targetOf(s), kind: s.Kind}
	out := &emitter{a: a, lc: lc}
	// Capture from the first byte so a prompt printed right after connecting isn't missed.
	var logonCap *capture
	if hasLogon(s) {
		logonCap = lc.out.startCapture()
		lc.logonDone = make(chan struct{})
	}
	var wait func() string
	switch s.Kind {
	case "serial":
		c, err := openSerial(s, out)
		if err != nil {
			return err
		}
		lc.c, wait = c, c.wait
	case "telnet":
		c, err := dialTelnet(ctx, s, cols, rows, out)
		if err != nil {
			if ctx.Err() != nil {
				return errors.New("CANCELED")
			}
			return err
		}
		lc.c, wait = c, c.wait
	default:
		if s.KeyPath == "" && password == "" {
			return errors.New(ErrNeedPassword)
		}
		c, err := dialSSH(ctx, s, password, cols, rows, out, a.store.dir)
		if err != nil {
			if ctx.Err() != nil {
				return errors.New("CANCELED")
			}
			if strings.Contains(err.Error(), "unable to authenticate") {
				return errors.New("AUTH_FAILED")
			}
			return err
		}
		lc.c, lc.ssh, wait = c, c, c.wait
	}
	// Register before waiting so an instant exit still emits "closed".
	a.mu.Lock()
	a.conns[connID] = lc
	a.mu.Unlock()
	go func() { a.closeConn(lc, wait()) }()
	if logonCap != nil {
		go a.runLogon(lc, s, logonCap, password)
	}
	return nil
}

// CancelConnect aborts a connection attempt that is still dialing or handshaking.
func (a *App) CancelConnect(connID string) {
	a.mu.Lock()
	cancel := a.dialing[connID]
	a.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// GetUIPrefs / SaveUIPrefs persist the UI's preferences as an opaque JSON string.
func (a *App) GetUIPrefs() string { return a.store.Settings().UIPrefs }

func (a *App) SaveUIPrefs(prefs string) error {
	st := a.store.Settings()
	st.UIPrefs = prefs
	return a.store.PutSettings(st)
}

// SetActiveTab is called by the UI whenever the visible tab changes ("" when none).
func (a *App) SetActiveTab(connID string) {
	a.mu.Lock()
	a.activeTab = connID
	a.mu.Unlock()
}

// SetTabTitle keeps the backend's tab name in sync when the user renames a tab.
func (a *App) SetTabTitle(connID, title string) {
	a.mu.Lock()
	if lc := a.conns[connID]; lc != nil && strings.TrimSpace(title) != "" {
		lc.name = strings.TrimSpace(title)
	}
	a.mu.Unlock()
}

func targetOf(s Session) string {
	if s.Kind == "serial" {
		return fmt.Sprintf("%s %d", s.ComPort, s.Baud)
	}
	if s.Kind == "telnet" {
		port := s.Port
		if port == 0 {
			port = 23
		}
		return fmt.Sprintf("telnet %s:%d", s.Host, port)
	}
	t := s.Host
	if s.User != "" {
		t = s.User + "@" + t
	}
	if s.Port != 0 && s.Port != 22 {
		t = fmt.Sprintf("%s:%d", t, s.Port)
	}
	return t
}

func (a *App) get(connID string) *liveConn {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.conns[connID]
}

func (a *App) closeConn(lc *liveConn, reason string) {
	a.mu.Lock()
	cur, ok := a.conns[lc.id]
	if ok && cur == lc {
		delete(a.conns, lc.id)
	}
	a.mu.Unlock()
	if !ok || cur != lc {
		return
	}
	_ = lc.c.Close()
	lc.logMu.Lock()
	if lc.log != nil {
		_ = lc.log.Close()
		lc.log = nil
	}
	lc.logMu.Unlock()
	runtime.EventsEmit(a.ctx, "closed:"+lc.id, reason)
}

// ---------- terminal I/O ----------

func (a *App) Write(connID, data string) error {
	lc := a.get(connID)
	if lc == nil {
		return errors.New(T("err.notConnected"))
	}
	_, err := lc.c.Write([]byte(data))
	return err
}

// WriteMulti sends the same input to several connections (multi-exec).
func (a *App) WriteMulti(connIDs []string, data string) {
	for _, id := range connIDs {
		_ = a.Write(id, data)
	}
}

func (a *App) Resize(connID string, cols, rows int) {
	if lc := a.get(connID); lc != nil {
		_ = lc.c.Resize(cols, rows)
	}
}

func (a *App) Disconnect(connID string) {
	if lc := a.get(connID); lc != nil {
		a.closeConn(lc, T("msg.userDisconnected"))
	}
}

// RunMacro sends each non-empty line followed by Enter to every target.
func (a *App) RunMacro(connIDs []string, body string, delayMs int) {
	lines := strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n")
	go func() {
		for i, ln := range lines {
			if strings.TrimSpace(ln) == "" && i == len(lines)-1 {
				continue
			}
			a.WriteMulti(connIDs, ln+"\r")
			if delayMs > 0 {
				time.Sleep(time.Duration(delayMs) * time.Millisecond)
			}
		}
	}()
}

// ---------- logging ----------

var ansiRe = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][0-9A-Za-z]|\x1b[=>78]|\x07|\r`)

// SetLogging toggles a plain-text session log and returns the log path.
func (a *App) SetLogging(connID string, on bool) (string, error) {
	lc := a.get(connID)
	if lc == nil {
		return "", errors.New(T("err.notConnected"))
	}
	lc.logMu.Lock()
	defer lc.logMu.Unlock()
	if !on {
		if lc.log != nil {
			_ = lc.log.Close()
			lc.log = nil
		}
		return "", nil
	}
	if lc.log != nil {
		return lc.log.Name(), nil
	}
	dir := logsDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	safe := strings.Map(func(r rune) rune {
		if strings.ContainsRune(`\/:*?"<>| `, r) {
			return '_'
		}
		return r
	}, lc.name)
	p := filepath.Join(dir, fmt.Sprintf("%s_%s.log", safe, time.Now().Format("20060102_150405")))
	f, err := os.Create(p)
	if err != nil {
		return "", err
	}
	lc.log = f
	return p, nil
}

func (a *App) OpenLogFolder() {
	dir := logsDir()
	_ = os.MkdirAll(dir, 0o755)
	runtime.BrowserOpenURL(a.ctx, "file:///"+filepath.ToSlash(dir))
}

// emitter forwards backend output to the UI (base64 keeps raw bytes intact)
// and to the session log if enabled.
type emitter struct {
	a  *App
	lc *liveConn
}

func (e *emitter) Write(p []byte) (int, error) {
	runtime.EventsEmit(e.a.ctx, "data:"+e.lc.id, base64.StdEncoding.EncodeToString(p))
	e.lc.out.write(p)
	e.lc.logMu.Lock()
	if e.lc.log != nil {
		_, _ = e.lc.log.Write(ansiRe.ReplaceAll(p, nil))
	}
	e.lc.logMu.Unlock()
	return len(p), nil
}

var _ io.Writer = (*emitter)(nil)
