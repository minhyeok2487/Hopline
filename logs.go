package main

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"syscall"
	"time"
	"unicode/utf8"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Session logs live in <log dir>\<session name>\<yyyy-mm-dd_hhmmss>.log as
// plain text: escape sequences stripped, backspaces applied and (by default)
// every line prefixed with the time it arrived.

// sessionLog turns the raw terminal stream into clean lines.
type sessionLog struct {
	f       *os.File
	path    string
	stamps  bool
	pend    []byte // an escape sequence cut off at the end of the last chunk
	line    []byte
	lineAt  time.Time
	written int64
}

const maxLogLine = 64 << 10

func (l *sessionLog) write(p []byte) {
	data := append(l.pend, p...)
	l.pend = nil
	// Hold back an unfinished escape sequence so it isn't logged as text.
	if i := bytes.LastIndexByte(data, 0x1b); i >= 0 && len(data)-i < 512 {
		if loc := ansiRe.FindIndex(data[i:]); loc == nil || loc[0] != 0 {
			l.pend = append([]byte(nil), data[i:]...)
			data = data[:i]
		}
	}
	for _, b := range ansiRe.ReplaceAll(data, nil) {
		switch {
		case b == '\n':
			l.flush()
		case b == '\b':
			if len(l.line) > 0 {
				_, n := utf8.DecodeLastRune(l.line)
				l.line = l.line[:len(l.line)-n]
			}
		case b < 0x20 && b != '\t', b == 0x7f:
		default:
			if len(l.line) == 0 {
				l.lineAt = time.Now()
			}
			l.line = append(l.line, b)
			if len(l.line) >= maxLogLine {
				l.flush()
			}
		}
	}
}

func (l *sessionLog) flush() {
	var buf []byte
	if l.stamps {
		at := l.lineAt
		if at.IsZero() || len(l.line) == 0 {
			at = time.Now()
		}
		buf = append(buf, at.Format("[2006-01-02 15:04:05] ")...)
	}
	buf = append(append(buf, l.line...), '\n')
	n, _ := l.f.Write(buf)
	l.written += int64(n)
	l.line = l.line[:0]
	l.lineAt = time.Time{}
}

func (l *sessionLog) close() {
	if len(l.line) > 0 {
		l.flush()
	}
	_ = l.f.Close()
}

// ---------- settings ----------

type LogSettings struct {
	Auto       bool   `json:"auto"`
	Dir        string `json:"dir"`
	Stamps     bool   `json:"stamps"`
	DefaultDir string `json:"defaultDir"`
}

func (a *App) logDir() string {
	if d := a.store.Settings().LogDir; d != "" {
		return d
	}
	return logsDir()
}

func (a *App) GetLogSettings() LogSettings {
	st := a.store.Settings()
	return LogSettings{Auto: st.LogAuto, Dir: a.logDir(), Stamps: st.LogStamps == nil || *st.LogStamps, DefaultDir: logsDir()}
}

func (a *App) SetLogSettings(in LogSettings) error {
	st := a.store.Settings()
	st.LogAuto = in.Auto
	st.LogStamps = &in.Stamps
	st.LogDir = ""
	if d := strings.TrimSpace(in.Dir); d != "" && !strings.EqualFold(filepath.Clean(d), filepath.Clean(logsDir())) {
		if !filepath.IsAbs(d) {
			return errors.New(T("log.err.dir"))
		}
		st.LogDir = filepath.Clean(d)
	}
	return a.store.PutSettings(st)
}

func (a *App) PickLogDir() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: T("log.pickDir"), DefaultDirectory: a.logDir()})
}

// wantsLog reports whether a new connection to s should start recording.
func (a *App) wantsLog(s Session) bool {
	switch s.Log {
	case "on":
		return true
	case "off":
		return false
	}
	return a.store.Settings().LogAuto
}

// ---------- recording ----------

func safeName(s string) string {
	s = strings.TrimSpace(strings.Map(func(r rune) rune {
		if strings.ContainsRune(`\/:*?"<>|`, r) || r < 0x20 {
			return '_'
		}
		return r
	}, s))
	s = strings.TrimRight(s, ". ")
	if s == "" {
		s = "session"
	}
	return s
}

// startLog opens a new log file for the connection (caller must not hold logMu).
func (a *App) startLog(lc *liveConn) (string, error) {
	lc.logMu.Lock()
	defer lc.logMu.Unlock()
	if lc.log != nil {
		return lc.log.path, nil
	}
	dir := filepath.Join(a.logDir(), safeName(lc.name))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	p := filepath.Join(dir, time.Now().Format("2006-01-02_150405")+".log")
	if _, err := os.Stat(p); err == nil {
		p = strings.TrimSuffix(p, ".log") + fmt.Sprintf("_%d.log", time.Now().UnixMilli()%1000)
	}
	f, err := os.Create(p)
	if err != nil {
		return "", err
	}
	st := a.store.Settings()
	lc.log = &sessionLog{f: f, path: p, stamps: st.LogStamps == nil || *st.LogStamps}
	fmt.Fprintf(f, "# Hopline log · %s · %s · %s\n", lc.name, lc.target, time.Now().Format("2006-01-02 15:04:05"))
	return p, nil
}

// SetLogging toggles recording for a tab and returns the log path.
func (a *App) SetLogging(connID string, on bool) (string, error) {
	lc := a.get(connID)
	if lc == nil {
		return "", errors.New(T("err.notConnected"))
	}
	if on {
		return a.startLog(lc)
	}
	lc.logMu.Lock()
	defer lc.logMu.Unlock()
	if lc.log != nil {
		lc.log.close()
		lc.log = nil
	}
	return "", nil
}

// LogPath is the file a tab is recording to ("" when it isn't).
func (a *App) LogPath(connID string) string {
	lc := a.get(connID)
	if lc == nil {
		return ""
	}
	lc.logMu.Lock()
	defer lc.logMu.Unlock()
	if lc.log == nil {
		return ""
	}
	return a.relLog(lc.log.path)
}

func (a *App) activeLogs() map[string]*liveConn {
	out := map[string]*liveConn{}
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, lc := range a.conns {
		lc.logMu.Lock()
		if lc.log != nil {
			out[strings.ToLower(lc.log.path)] = lc
		}
		lc.logMu.Unlock()
	}
	return out
}

// ---------- browsing ----------

type LogFile struct {
	Rel     string `json:"rel"` // path relative to the log folder, with "/"
	Session string `json:"session"`
	Time    int64  `json:"time"` // unix ms the log started
	Size    int64  `json:"size"`
	Active  bool   `json:"active"`  // still being recorded
	Summary bool   `json:"summary"` // an AI summary sits next to it
}

var oldLogRe = regexp.MustCompile(`^(.*)_(\d{8}_\d{6})\.log$`)
var newLogRe = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2}_\d{6})`)

func (a *App) relLog(p string) string {
	r, err := filepath.Rel(a.logDir(), p)
	if err != nil {
		return filepath.ToSlash(p)
	}
	return filepath.ToSlash(r)
}

// logAbs resolves a path from the UI and keeps it inside the log folder.
func (a *App) logAbs(rel string) (string, error) {
	root := filepath.Clean(a.logDir())
	p := filepath.Clean(filepath.Join(root, filepath.FromSlash(rel)))
	if !strings.HasPrefix(strings.ToLower(p), strings.ToLower(root)+string(filepath.Separator)) {
		return "", errors.New("path outside the log folder")
	}
	return p, nil
}

// ListLogs returns every session log, newest first. Logs from before 0.9
// (flat "name_yyyymmdd_hhmmss.log" files) are listed too.
func (a *App) ListLogs() []LogFile {
	root := a.logDir()
	active := a.activeLogs()
	var out []LogFile
	_ = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(root, p)
		if d.IsDir() {
			if p != root && (strings.Count(rel, string(filepath.Separator)) >= 1 || strings.HasPrefix(d.Name(), "_")) {
				return filepath.SkipDir // only <root>\<session>\*.log; "_checks" has its own view
			}
			return nil
		}
		if !strings.EqualFold(filepath.Ext(p), ".log") {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		lf := LogFile{Rel: filepath.ToSlash(rel), Size: info.Size(), Time: info.ModTime().UnixMilli()}
		name := d.Name()
		if dir := filepath.Dir(rel); dir != "." {
			lf.Session = dir
			if m := newLogRe.FindStringSubmatch(name); m != nil {
				if t, err := time.ParseInLocation("2006-01-02_150405", m[1], time.Local); err == nil {
					lf.Time = t.UnixMilli()
				}
			}
		} else if m := oldLogRe.FindStringSubmatch(name); m != nil {
			lf.Session = m[1]
			if t, err := time.ParseInLocation("20060102_150405", m[2], time.Local); err == nil {
				lf.Time = t.UnixMilli()
			}
		} else {
			lf.Session = strings.TrimSuffix(name, filepath.Ext(name))
		}
		_, lf.Active = active[strings.ToLower(p)]
		if _, err := os.Stat(summaryPath(p)); err == nil {
			lf.Summary = true
		}
		out = append(out, lf)
		return nil
	})
	sort.Slice(out, func(i, j int) bool { return out[i].Time > out[j].Time })
	return out
}

func summaryPath(logPath string) string {
	return strings.TrimSuffix(logPath, filepath.Ext(logPath)) + ".summary.md"
}

type LogText struct {
	Text      string `json:"text"`
	Truncated bool   `json:"truncated"` // only the end of a large file is included
	Summary   string `json:"summary"`   // saved AI summary, if any
}

const maxLogView = 4 << 20

func readTail(p string, max int64) (string, bool, error) {
	f, err := os.Open(p)
	if err != nil {
		return "", false, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return "", false, err
	}
	trunc := false
	if info.Size() > max {
		trunc = true
		_, _ = f.Seek(-max, io.SeekEnd)
	}
	b, err := io.ReadAll(f)
	if trunc {
		if i := bytes.IndexByte(b, '\n'); i >= 0 {
			b = b[i+1:]
		}
	}
	return string(b), trunc, err
}

func (a *App) ReadLog(rel string) (LogText, error) {
	p, err := a.logAbs(rel)
	if err != nil {
		return LogText{}, err
	}
	a.flushLog(p)
	text, trunc, err := readTail(p, maxLogView)
	out := LogText{Text: text, Truncated: trunc}
	if b, err := os.ReadFile(summaryPath(p)); err == nil {
		out.Summary = string(b)
	}
	return out, err
}

// flushLog writes out the half-finished line of a log that is still recording.
func (a *App) flushLog(p string) {
	if lc := a.activeLogs()[strings.ToLower(p)]; lc != nil {
		lc.logMu.Lock()
		if lc.log != nil && len(lc.log.line) > 0 {
			lc.log.flush()
		}
		lc.logMu.Unlock()
	}
}

type LogHit struct {
	Rel     string `json:"rel"`
	Session string `json:"session"`
	Time    int64  `json:"time"`
	Line    int    `json:"line"`
	Text    string `json:"text"`
}

// SearchLogs finds lines containing q (case-insensitive) across all logs.
func (a *App) SearchLogs(q string) ([]LogHit, error) {
	q = strings.ToLower(strings.TrimSpace(q))
	if q == "" {
		return nil, nil
	}
	var hits []LogHit
	for _, lf := range a.ListLogs() {
		p, err := a.logAbs(lf.Rel)
		if err != nil {
			continue
		}
		f, err := os.Open(p)
		if err != nil {
			continue
		}
		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 64<<10), maxLogLine*2)
		n := 0
		for sc.Scan() {
			n++
			if strings.Contains(strings.ToLower(sc.Text()), q) {
				t := sc.Text()
				if len(t) > 300 {
					t = t[:300]
				}
				hits = append(hits, LogHit{Rel: lf.Rel, Session: lf.Session, Time: lf.Time, Line: n, Text: t})
				if len(hits) >= 500 {
					f.Close()
					return hits, nil
				}
			}
		}
		f.Close()
	}
	return hits, nil
}

// RevealLog shows the file selected in Explorer ("" = the log folder).
func (a *App) RevealLog(rel string) error {
	if rel == "" {
		dir := a.logDir()
		_ = os.MkdirAll(dir, 0o755)
		runtime.BrowserOpenURL(a.ctx, "file:///"+filepath.ToSlash(dir))
		return nil
	}
	p, err := a.logAbs(rel)
	if err != nil {
		return err
	}
	cmd := exec.Command("explorer.exe")
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: `explorer.exe /select,"` + p + `"`}
	return cmd.Start()
}

func (a *App) OpenLogFolder() { _ = a.RevealLog("") }

// DeleteLog removes a finished log and its summary.
func (a *App) DeleteLog(rel string) error {
	p, err := a.logAbs(rel)
	if err != nil {
		return err
	}
	if _, busy := a.activeLogs()[strings.ToLower(p)]; busy {
		return errors.New(T("log.err.busy"))
	}
	_ = os.Remove(summaryPath(p))
	if err := os.Remove(p); err != nil {
		return err
	}
	if dir := filepath.Dir(p); !strings.EqualFold(dir, filepath.Clean(a.logDir())) {
		_ = os.Remove(dir) // drop the session folder once it's empty
	}
	return nil
}
