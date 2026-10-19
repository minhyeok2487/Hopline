package main

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/pkg/sftp"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// The MCP server lets an AI client (e.g. Claude Code) drive Hopline: open
// saved sessions as visible tabs, run commands, read output and move files.
// It listens on 127.0.0.1 only and requires a bearer token.

const defaultMCPPort = 7781

type mcpState struct {
	mu      sync.Mutex
	srv     *http.Server
	pending sync.Map // connID -> chan string (open_session result)
}

// MCPInfo is shown in the settings dialog.
type MCPInfo struct {
	Enabled bool   `json:"enabled"`
	Running bool   `json:"running"`
	Port    int    `json:"port"`
	URL     string `json:"url"`
	Token   string `json:"token"`
	Command string `json:"command"`
	Error   string `json:"error,omitempty"`
}

func (a *App) GetMCPInfo() MCPInfo {
	st := a.store.Settings()
	port := st.MCPPort
	if port == 0 {
		port = defaultMCPPort
	}
	url := fmt.Sprintf("http://127.0.0.1:%d/mcp", port)
	a.mcp.mu.Lock()
	running := a.mcp.srv != nil
	a.mcp.mu.Unlock()
	info := MCPInfo{Enabled: st.MCPEnabled, Running: running, Port: port, URL: url, Token: st.MCPToken}
	if st.MCPToken != "" {
		info.Command = fmt.Sprintf(`claude mcp add --scope user --transport http hopline %s --header "Authorization: Bearer %s"`, url, st.MCPToken)
	}
	return info
}

func (a *App) SetMCPEnabled(on bool, port int) (MCPInfo, error) {
	st := a.store.Settings()
	if port > 0 {
		st.MCPPort = port
	}
	if st.MCPPort == 0 {
		st.MCPPort = defaultMCPPort
	}
	if st.MCPToken == "" {
		st.MCPToken = newID() + newID()
	}
	st.MCPEnabled = on
	if err := a.store.PutSettings(st); err != nil {
		return a.GetMCPInfo(), err
	}
	a.stopMCP()
	if on {
		if err := a.startMCP(); err != nil {
			info := a.GetMCPInfo()
			info.Error = err.Error()
			return info, err
		}
	}
	return a.GetMCPInfo(), nil
}

// RegenerateMCPToken invalidates the old token.
func (a *App) RegenerateMCPToken() (MCPInfo, error) {
	st := a.store.Settings()
	st.MCPToken = newID() + newID()
	if err := a.store.PutSettings(st); err != nil {
		return a.GetMCPInfo(), err
	}
	return a.GetMCPInfo(), nil
}

func (a *App) startMCP() error {
	st := a.store.Settings()
	port := st.MCPPort
	if port == 0 {
		port = defaultMCPPort
	}
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return fmt.Errorf(T("err.port"), port, err)
	}
	server := a.newMCPServer()
	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, nil)
	auth := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		want := "Bearer " + a.store.Settings().MCPToken
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte(want)) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		handler.ServeHTTP(w, r)
	})
	mux := http.NewServeMux()
	mux.Handle("/mcp", auth)
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	a.mcp.mu.Lock()
	a.mcp.srv = srv
	a.mcp.mu.Unlock()
	go func() { _ = srv.Serve(ln) }()
	return nil
}

func (a *App) stopMCP() {
	a.mcp.mu.Lock()
	srv := a.mcp.srv
	a.mcp.srv = nil
	a.mcp.mu.Unlock()
	if srv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}
}

// ReportOpenResult is called by the UI when a tab opened via MCP finishes
// connecting ("" = success) or fails.
func (a *App) ReportOpenResult(connID, errMsg string) {
	if errMsg != "" && a.get(connID) != nil {
		errMsg = "" // already connected (e.g. a second window raced and failed)
	}
	if ch, ok := a.mcp.pending.Load(connID); ok {
		select {
		case ch.(chan string) <- errMsg:
		default:
		}
	}
}

func (a *App) activity(connID, msg string) {
	runtime.EventsEmit(a.ctx, "mcp:activity", map[string]string{"connId": connID, "msg": msg})
}

// ---------- tool inputs ----------

type tabIn struct {
	Tab string `json:"tab" jsonschema:"tab id from list_tabs, the tab name, or \"active\" for the tab the user is looking at"`
}

type openIn struct {
	Session string `json:"session" jsonschema:"saved session name or id (see list_sessions)"`
	New     bool   `json:"new,omitempty" jsonschema:"open another tab even if this session already has a connected tab (default false: reuse it)"`
}

type runIn struct {
	Tab        string `json:"tab" jsonschema:"tab id from list_tabs, the tab name, or \"active\" for the tab the user is looking at"`
	Command    string `json:"command" jsonschema:"command line to send; Enter is appended"`
	TimeoutSec int    `json:"timeout_sec,omitempty" jsonschema:"max seconds to wait (default 30, max 600)"`
	IdleMs     int    `json:"idle_ms,omitempty" jsonschema:"finish after this many ms without new output (default 1500)"`
	Expect     string `json:"expect,omitempty" jsonschema:"optional regex; finish as soon as the output matches (use for slow commands)"`
	NoAutoMore bool   `json:"no_auto_more,omitempty" jsonschema:"set true to NOT answer --More-- pager prompts with space automatically"`
}

type keysIn struct {
	Tab    string `json:"tab" jsonschema:"tab id from list_tabs, the tab name, or \"active\" for the tab the user is looking at"`
	Text   string `json:"text" jsonschema:"raw text to type; use JSON escapes for control keys, e.g. \u0003 = Ctrl+C, \t = Tab, \u001b = Esc"`
	Enter  bool   `json:"enter,omitempty" jsonschema:"append Enter after the text"`
	WaitMs int    `json:"wait_ms,omitempty" jsonschema:"ms to collect output afterwards (default 1000)"`
}

type readIn struct {
	Tab   string `json:"tab" jsonschema:"tab id from list_tabs, the tab name, or \"active\" for the tab the user is looking at"`
	Lines int    `json:"lines,omitempty" jsonschema:"number of recent lines (default 100)"`
}

type sftpPathIn struct {
	Tab  string `json:"tab" jsonschema:"tab id or name of a connected SSH tab, or \"active\""`
	Path string `json:"path,omitempty" jsonschema:"remote path; empty = login directory"`
}

type sftpReadIn struct {
	Tab      string `json:"tab" jsonschema:"tab id or name of a connected SSH tab, or \"active\""`
	Path     string `json:"path" jsonschema:"remote file path"`
	MaxBytes int    `json:"max_bytes,omitempty" jsonschema:"read at most this many bytes (default 262144)"`
}

type sftpWriteIn struct {
	Tab     string `json:"tab" jsonschema:"tab id or name of a connected SSH tab, or \"active\""`
	Path    string `json:"path" jsonschema:"remote file path (overwritten)"`
	Content string `json:"content" jsonschema:"text content to write"`
}

type sftpXferIn struct {
	Tab    string `json:"tab" jsonschema:"tab id or name of a connected SSH tab, or \"active\""`
	Remote string `json:"remote" jsonschema:"remote file path"`
	Local  string `json:"local" jsonschema:"absolute local Windows path"`
}

func text(s string) *mcp.CallToolResult {
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: s}}}
}

func (a *App) newMCPServer() *mcp.Server {
	s := mcp.NewServer(&mcp.Implementation{Name: "hopline", Title: "Hopline", Version: "0.1.2"}, &mcp.ServerOptions{
		Instructions: "Hopline is the user's terminal app. Sessions open as visible tabs the user can watch. " +
			"Start with list_tabs: if the user already has a connected tab for the device, use it (pass tab=\"active\" for the tab the user is looking at). " +
			"Only call open_session when no suitable tab is open; it reuses an existing tab of the same session unless new=true. " +
			"Network devices: --More-- pagers are answered automatically. " +
			"Never change device configuration unless the user explicitly asked for it.",
	})

	mcp.AddTool(s, &mcp.Tool{Name: "list_sessions", Description: "List saved Hopline sessions (SSH and serial). Passwords are never exposed."},
		func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
			var b strings.Builder
			for _, x := range a.store.Sessions() {
				target := fmt.Sprintf("%s@%s:%d", x.User, x.Host, x.Port)
				if x.Kind == "serial" {
					target = fmt.Sprintf("%s %d", x.ComPort, x.Baud)
				}
				fmt.Fprintf(&b, "- %s | id=%s | %s | folder=%s | %s | password_saved=%v\n", x.Name, x.ID, x.Kind, x.Folder, target, x.HasPassword || x.KeyPath != "")
			}
			if b.Len() == 0 {
				return text("No saved sessions."), nil, nil
			}
			return text(b.String()), nil, nil
		})

	mcp.AddTool(s, &mcp.Tool{Name: "list_tabs", Description: "List connected tabs, including ones the user opened: id, name, kind, target. The tab the user is currently looking at is marked (active)."},
		func(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
			a.mu.Lock()
			defer a.mu.Unlock()
			var b strings.Builder
			ids := make([]string, 0, len(a.conns))
			for id := range a.conns {
				ids = append(ids, id)
			}
			sort.Strings(ids)
			for _, id := range ids {
				lc := a.conns[id]
				kind := "serial"
				if lc.ssh != nil {
					kind = "ssh"
				}
				mark := ""
				if id == a.activeTab {
					mark = " | (active)"
				}
				fmt.Fprintf(&b, "- tab=%s | %s | %s | %s%s\n", id, lc.name, kind, lc.target, mark)
			}
			if b.Len() == 0 {
				return text("No connected tabs. Use open_session to open one."), nil, nil
			}
			return text(b.String()), nil, nil
		})

	mcp.AddTool(s, &mcp.Tool{Name: "open_session", Description: "Get a connected tab for a saved session. If the user already has one open it is reused and brought to the front; otherwise a new visible tab is opened and connected (set new=true to always open another). If no password is saved, the user is prompted in the app (wait up to 2 minutes). Returns the tab id and recent output."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in openIn) (*mcp.CallToolResult, any, error) {
			sess, err := a.findSession(in.Session)
			if err != nil {
				return nil, nil, err
			}
			if !in.New {
				if lc := a.tabForSession(sess.ID); lc != nil {
					runtime.EventsEmit(a.ctx, "mcp:focus", lc.id)
					return text(fmt.Sprintf("tab=%s (%s) already open, reusing it\n---\n%s", lc.id, lc.name, lc.out.tail(30))), nil, nil
				}
			}
			connID := "m" + newID()
			ch := make(chan string, 1)
			a.mcp.pending.Store(connID, ch)
			defer a.mcp.pending.Delete(connID)
			runtime.EventsEmit(a.ctx, "mcp:open", map[string]string{"connId": connID, "sessionId": sess.ID})
			select {
			case msg := <-ch:
				if msg != "" {
					return nil, nil, fmt.Errorf("%s: connection failed: %s", sess.Name, msg)
				}
			case <-time.After(2 * time.Minute):
				return nil, nil, errors.New("timed out waiting for the connection (the user may not have entered the password)")
			case <-ctx.Done():
				return nil, nil, ctx.Err()
			}
			lc := a.get(connID)
			if lc == nil {
				return nil, nil, errors.New("the connection closed right after opening")
			}
			time.Sleep(1500 * time.Millisecond)
			return text(fmt.Sprintf("tab=%s (%s) connected\n---\n%s", connID, sess.Name, lc.out.tail(30))), nil, nil
		})

	mcp.AddTool(s, &mcp.Tool{Name: "run_command", Description: "Send a command line to a tab and return its output. Finishes when output goes idle, a shell/CLI prompt appears, `expect` matches, or the timeout hits. For long-running commands pass `expect` (e.g. the prompt) and a larger timeout_sec."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in runIn) (*mcp.CallToolResult, any, error) {
			lc, err := a.resolveTab(in.Tab)
			if err != nil {
				return nil, nil, err
			}
			out, err := a.runCommand(ctx, lc, in)
			if err != nil {
				return nil, nil, err
			}
			return text(out), nil, nil
		})

	mcp.AddTool(s, &mcp.Tool{Name: "send_keys", Description: "Type raw text/control keys into a tab (interactive prompts, Ctrl+C, answering y/n) and return the output that follows."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in keysIn) (*mcp.CallToolResult, any, error) {
			lc, err := a.resolveTab(in.Tab)
			if err != nil {
				return nil, nil, err
			}
			wait := in.WaitMs
			if wait <= 0 {
				wait = 1000
			}
			c := lc.out.startCapture()
			defer lc.out.stopCapture(c)
			data := in.Text
			if in.Enter {
				data += "\r"
			}
			a.activity(lc.id, "send_keys")
			if _, err := lc.c.Write([]byte(data)); err != nil {
				return nil, nil, err
			}
			select {
			case <-time.After(time.Duration(wait) * time.Millisecond):
			case <-ctx.Done():
			}
			return text(c.text()), nil, nil
		})

	mcp.AddTool(s, &mcp.Tool{Name: "read_output", Description: "Read the most recent output lines of a tab (what the user sees), without sending anything."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in readIn) (*mcp.CallToolResult, any, error) {
			lc, err := a.resolveTab(in.Tab)
			if err != nil {
				return nil, nil, err
			}
			n := in.Lines
			if n <= 0 {
				n = 100
			}
			return text(lc.out.tail(n)), nil, nil
		})

	mcp.AddTool(s, &mcp.Tool{Name: "close_tab", Description: "Disconnect and close a tab."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in tabIn) (*mcp.CallToolResult, any, error) {
			lc, err := a.resolveTab(in.Tab)
			if err != nil {
				return nil, nil, err
			}
			a.closeConn(lc, T("msg.mcpDisconnected"))
			runtime.EventsEmit(a.ctx, "mcp:close", lc.id)
			return text("closed " + lc.id), nil, nil
		})

	mcp.AddTool(s, &mcp.Tool{Name: "sftp_list", Description: "List a remote directory over SFTP on an SSH tab."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in sftpPathIn) (*mcp.CallToolResult, any, error) {
			lc, err := a.resolveTab(in.Tab)
			if err != nil {
				return nil, nil, err
			}
			l, err := a.SftpList(lc.id, in.Path)
			if err != nil {
				return nil, nil, err
			}
			var b strings.Builder
			fmt.Fprintf(&b, "%s\n", l.Path)
			for _, e := range l.Entries {
				kind := "f"
				if e.IsDir {
					kind = "d"
				}
				fmt.Fprintf(&b, "%s %s %10d %s %s\n", kind, e.Mode, e.Size, time.Unix(e.ModTime, 0).Format("2006-01-02 15:04"), e.Name)
			}
			return text(b.String()), nil, nil
		})

	mcp.AddTool(s, &mcp.Tool{Name: "sftp_read_file", Description: "Read a remote text file over SFTP."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in sftpReadIn) (*mcp.CallToolResult, any, error) {
			cl, err := a.sftpForTab(in.Tab)
			if err != nil {
				return nil, nil, err
			}
			max := in.MaxBytes
			if max <= 0 {
				max = 256 << 10
			}
			f, err := cl.Open(in.Path)
			if err != nil {
				return nil, nil, err
			}
			defer f.Close()
			data, err := io.ReadAll(io.LimitReader(f, int64(max)+1))
			if err != nil {
				return nil, nil, err
			}
			note := ""
			if len(data) > max {
				data, note = data[:max], fmt.Sprintf("\n[... truncated at %d bytes]", max)
			}
			return text(string(data) + note), nil, nil
		})

	mcp.AddTool(s, &mcp.Tool{Name: "sftp_write_file", Description: "Write (overwrite) a remote text file over SFTP. Only use when the user asked to change files."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in sftpWriteIn) (*mcp.CallToolResult, any, error) {
			cl, err := a.sftpForTab(in.Tab)
			if err != nil {
				return nil, nil, err
			}
			f, err := cl.Create(in.Path)
			if err != nil {
				return nil, nil, err
			}
			defer f.Close()
			n, err := f.Write([]byte(in.Content))
			if err != nil {
				return nil, nil, err
			}
			return text(fmt.Sprintf("%s: wrote %d bytes", in.Path, n)), nil, nil
		})

	mcp.AddTool(s, &mcp.Tool{Name: "sftp_download", Description: "Download a remote file to a local Windows path."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in sftpXferIn) (*mcp.CallToolResult, any, error) {
			lc, err := a.resolveTab(in.Tab)
			if err != nil {
				return nil, nil, err
			}
			cl, err := a.sftpFor(lc.id)
			if err != nil {
				return nil, nil, err
			}
			if err := a.download(cl, lc.id, in.Remote, in.Local); err != nil {
				return nil, nil, err
			}
			a.progress(transferProgress{ConnID: lc.id, Name: path.Base(in.Remote), Finish: true})
			st, _ := os.Stat(in.Local)
			size := int64(0)
			if st != nil {
				size = st.Size()
			}
			return text(fmt.Sprintf("%s -> %s (%d bytes)", in.Remote, in.Local, size)), nil, nil
		})

	mcp.AddTool(s, &mcp.Tool{Name: "sftp_upload", Description: "Upload a local Windows file to a remote path."},
		func(ctx context.Context, _ *mcp.CallToolRequest, in sftpXferIn) (*mcp.CallToolResult, any, error) {
			lc, err := a.resolveTab(in.Tab)
			if err != nil {
				return nil, nil, err
			}
			cl, err := a.sftpFor(lc.id)
			if err != nil {
				return nil, nil, err
			}
			st, err := os.Stat(in.Local)
			if err != nil {
				return nil, nil, err
			}
			if st.IsDir() {
				return nil, nil, errors.New("folders are not supported (files only)")
			}
			if err := a.upload(cl, lc.id, in.Local, in.Remote, st.Size()); err != nil {
				return nil, nil, err
			}
			a.progress(transferProgress{ConnID: lc.id, Name: path.Base(in.Remote), Finish: true})
			return text(fmt.Sprintf("%s -> %s (%d bytes)", in.Local, in.Remote, st.Size())), nil, nil
		})

	return s
}

func (a *App) findSession(q string) (Session, error) {
	q = strings.TrimSpace(q)
	var hits []Session
	for _, s := range a.store.Sessions() {
		if s.ID == q {
			return s, nil
		}
		if strings.EqualFold(s.Name, q) {
			hits = append(hits, s)
		}
	}
	if len(hits) == 1 {
		return hits[0], nil
	}
	if len(hits) > 1 {
		return Session{}, fmt.Errorf("%d sessions share that name; use the id", len(hits))
	}
	return Session{}, fmt.Errorf("no session %q (see list_sessions)", q)
}

// tabForSession returns a connected tab of the saved session, preferring the active one.
func (a *App) tabForSession(sessionID string) *liveConn {
	a.mu.Lock()
	defer a.mu.Unlock()
	if lc := a.conns[a.activeTab]; lc != nil && lc.sessionID == sessionID {
		return lc
	}
	var best *liveConn
	for _, lc := range a.conns {
		if lc.sessionID == sessionID && (best == nil || lc.id < best.id) {
			best = lc
		}
	}
	return best
}

func (a *App) resolveTab(q string) (*liveConn, error) {
	q = strings.TrimSpace(q)
	a.mu.Lock()
	defer a.mu.Unlock()
	if strings.EqualFold(q, "active") || strings.EqualFold(q, "current") {
		if lc := a.conns[a.activeTab]; lc != nil {
			return lc, nil
		}
		return nil, errors.New("the user is not looking at a connected tab (see list_tabs)")
	}
	if lc, ok := a.conns[q]; ok {
		return lc, nil
	}
	var hits []*liveConn
	for _, lc := range a.conns {
		if strings.EqualFold(lc.name, q) {
			hits = append(hits, lc)
		}
	}
	if len(hits) > 1 { // same name twice: prefer the tab the user is looking at
		for _, lc := range hits {
			if lc.id == a.activeTab {
				return lc, nil
			}
		}
	}
	switch len(hits) {
	case 1:
		return hits[0], nil
	case 0:
		return nil, fmt.Errorf("no connected tab %q (see list_tabs)", q)
	default:
		return nil, fmt.Errorf("%d tabs are named %q; use the tab id", len(hits), q)
	}
}

func (a *App) sftpForTab(q string) (*sftp.Client, error) {
	lc, err := a.resolveTab(q)
	if err != nil {
		return nil, err
	}
	return a.sftpFor(lc.id)
}

var (
	moreRe   = regexp.MustCompile(`(?i)(--+ ?more ?--+|<--- more --->|-- more --|\(more\)|press any key to continue)`)
	promptRe = regexp.MustCompile(`(?m)(^|\n)[^\n]{0,80}[>#$%\]]\s?$`)
)

const maxCmdOutput = 200 << 10

func (a *App) runCommand(ctx context.Context, lc *liveConn, in runIn) (string, error) {
	timeout := in.TimeoutSec
	if timeout <= 0 {
		timeout = 30
	}
	if timeout > 600 {
		timeout = 600
	}
	idle := time.Duration(in.IdleMs) * time.Millisecond
	if idle <= 0 {
		idle = 1500 * time.Millisecond
	}
	var expect *regexp.Regexp
	if in.Expect != "" {
		re, err := regexp.Compile(in.Expect)
		if err != nil {
			return "", fmt.Errorf("invalid expect regex: %w", err)
		}
		expect = re
	}

	c := lc.out.startCapture()
	defer lc.out.stopCapture(c)
	a.activity(lc.id, in.Command)
	if _, err := lc.c.Write([]byte(in.Command + "\r")); err != nil {
		return "", err
	}

	deadline := time.NewTimer(time.Duration(timeout) * time.Second)
	defer deadline.Stop()
	lastData := time.Now()
	moreAt := 0
	status := ""
loop:
	for {
		select {
		case <-ctx.Done():
			status = "[canceled]"
			break loop
		case <-deadline.C:
			status = fmt.Sprintf("[timed out after %ds - the command may still be running; check with read_output or send Ctrl+C (\\u0003) with send_keys]", timeout)
			break loop
		case <-c.notify:
			lastData = time.Now()
			out := c.text()
			if !in.NoAutoMore && c.size() > moreAt {
				tailStart := len(out) - 200
				if tailStart < 0 {
					tailStart = 0
				}
				if moreRe.MatchString(out[tailStart:]) {
					moreAt = c.size()
					_, _ = lc.c.Write([]byte(" "))
					continue
				}
			}
			if expect != nil && expect.MatchString(out) {
				break loop
			}
		case <-time.After(150 * time.Millisecond):
			if a.get(lc.id) == nil {
				status = "[connection closed]"
				break loop
			}
			quiet := time.Since(lastData)
			if expect != nil || c.size() == 0 {
				continue
			}
			out := strings.TrimRight(c.text(), " ")
			// A prompt right after output usually means the command finished.
			if quiet >= 400*time.Millisecond && promptRe.MatchString(out) && strings.Count(out, "\n") >= 1 {
				break loop
			}
			if quiet >= idle {
				break loop
			}
		}
	}
	out := moreRe.ReplaceAllString(c.text(), "")
	out = strings.ReplaceAll(out, "\r", "")
	// Drop the echoed command line.
	if i := strings.IndexByte(out, '\n'); i >= 0 && strings.Contains(out[:i], strings.TrimSpace(in.Command)) {
		out = out[i+1:]
	}
	if len(out) > maxCmdOutput {
		out = fmt.Sprintf("[first %d bytes omitted]\n", len(out)-maxCmdOutput) + out[len(out)-maxCmdOutput:]
	}
	if status != "" {
		out += "\n" + status
	}
	return out, nil
}
