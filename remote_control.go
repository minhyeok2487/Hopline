package main

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// Remote control: Hopline runs `claude remote-control` in the background so
// the user can talk to Claude Code from claude.ai/code or the Claude mobile
// app. That session has the hopline MCP server like any other Claude Code
// session, so it can read and run commands in Hopline's tabs (each tool use
// asks for approval on the phone: permission mode "default").
//
// Claude Code only serves trusted folders and never trusts the home folder,
// so it runs in its own folder, trusted once by running `claude` there.

type RCInfo struct {
	CLI     bool   `json:"cli"`
	Running bool   `json:"running"`
	URL     string `json:"url"`
	Dir     string `json:"dir"`
	Error   string `json:"error,omitempty"` // UNTRUSTED, NO_CLI or a message
}

var rc struct {
	mu   sync.Mutex
	cmd  *exec.Cmd
	url  string
	err  string
	done chan struct{}
}

// The server prints https://claude.ai/code?environment=… (single-session
// mode: …/code/session_…); session links inside terminal hyperlinks are
// stripped with the escape codes.
var rcURLRe = regexp.MustCompile(`https://claude\.ai/code[A-Za-z0-9_\-/?=&.]*`)

func rcDir() string {
	if d := os.Getenv("HOPLINE_RC_DIR"); d != "" { // an already-trusted project folder
		return d
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Hopline Remote")
}

func (a *App) RemoteControlInfo() RCInfo {
	rc.mu.Lock()
	defer rc.mu.Unlock()
	return RCInfo{CLI: findClaude() != "", Running: rc.cmd != nil, URL: rc.url, Dir: rcDir(), Error: rc.err}
}

// StartRemoteControl starts the server and waits (up to 40 s) for its session link.
func (a *App) StartRemoteControl() (RCInfo, error) {
	rc.mu.Lock()
	if rc.cmd != nil {
		rc.mu.Unlock()
		return a.RemoteControlInfo(), nil
	}
	exe := findClaude()
	if exe == "" {
		rc.mu.Unlock()
		return a.RemoteControlInfo(), errors.New("NO_CLI")
	}
	dir := rcDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		rc.mu.Unlock()
		return a.RemoteControlInfo(), err
	}
	host, _ := os.Hostname()
	cmd := exec.Command(exe, "remote-control", "--name", "Hopline · "+host, "--permission-mode", "default")
	cmd.Dir = dir
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	out, err := cmd.StdoutPipe()
	if err != nil {
		rc.mu.Unlock()
		return a.RemoteControlInfo(), err
	}
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		rc.mu.Unlock()
		return a.RemoteControlInfo(), err
	}
	done := make(chan struct{})
	rc.cmd, rc.url, rc.err, rc.done = cmd, "", "", done
	rc.mu.Unlock()

	ready := make(chan struct{}, 1)
	go func() {
		sc := bufio.NewScanner(out)
		sc.Buffer(make([]byte, 64<<10), 1<<20)
		sc.Split(splitCRLF)
		for sc.Scan() {
			line := strings.TrimSpace(ansiRe.ReplaceAllString(sc.Text(), ""))
			rc.mu.Lock()
			switch {
			case strings.Contains(line, "Workspace not trusted"):
				rc.err = "UNTRUSTED"
			case rc.url == "" && rcURLRe.MatchString(line):
				rc.url = rcURLRe.FindString(line)
				select {
				case ready <- struct{}{}:
				default:
				}
			case strings.HasPrefix(line, "Error:") && rc.err == "":
				rc.err = strings.TrimPrefix(line, "Error: ")
			}
			rc.mu.Unlock()
		}
		_ = cmd.Wait()
		rc.mu.Lock()
		if rc.cmd == cmd {
			rc.cmd, rc.url = nil, ""
		}
		rc.mu.Unlock()
		close(done)
		a.emit("rc:changed", a.RemoteControlInfo())
	}()

	select {
	case <-ready:
	case <-done:
	case <-time.After(40 * time.Second):
	}
	info := a.RemoteControlInfo()
	a.emit("rc:changed", info)
	if !info.Running && info.Error != "" {
		return info, errors.New(info.Error)
	}
	if info.URL == "" {
		return info, errors.New("remote control did not report a session link in time")
	}
	return info, nil
}

// StopRemoteControl ends the server and the sessions it started.
func (a *App) StopRemoteControl() error {
	rc.mu.Lock()
	cmd, done := rc.cmd, rc.done
	rc.mu.Unlock()
	if cmd == nil {
		return nil
	}
	kill := exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(cmd.Process.Pid))
	kill.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	_ = kill.Run()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
	}
	return nil
}

// TrustRemoteFolder opens a console running `claude` in the remote control
// folder, so the user can accept Claude Code's trust question once.
func (a *App) TrustRemoteFolder() error {
	exe := findClaude()
	if exe == "" {
		return errors.New("NO_CLI")
	}
	dir := rcDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	cmd := exec.Command("cmd.exe")
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CmdLine: fmt.Sprintf(`cmd.exe /c start "Claude Code" /D "%s" "%s"`, dir, exe),
	}
	return cmd.Start()
}

// splitCRLF splits on \r or \n: the remote-control status line is redrawn with \r.
func splitCRLF(data []byte, atEOF bool) (int, []byte, error) {
	if i := bytes.IndexAny(data, "\r\n"); i >= 0 {
		return i + 1, data[:i], nil
	}
	if atEOF && len(data) > 0 {
		return len(data), data, nil
	}
	return 0, nil, nil
}
