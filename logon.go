package main

import (
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const logonStepTimeout = 30 * time.Second

func hasLogon(s Session) bool {
	return s.AutoLogon && (s.LogonCR || len(s.LogonSteps) > 0)
}

// logonEvent tells the UI how the logon actions of a tab went.
type logonEvent struct {
	Step   int    `json:"step"` // 1-based step that failed (0 when done)
	Total  int    `json:"total"`
	Expect string `json:"expect,omitempty"`
	Error  string `json:"error,omitempty"` // "timeout" | "closed" | "decrypt" | "write"
}

// runLogon works through the session's expect/send steps on a fresh connection.
// c has captured output since the connection started.
func (a *App) runLogon(lc *liveConn, s Session, c *capture) {
	defer close(lc.logonDone)
	defer lc.out.stopCapture(c)
	total := len(s.LogonSteps)
	fail := func(i int, st LogonStep, code string) {
		runtime.EventsEmit(a.ctx, "logon:"+lc.id, logonEvent{Step: i + 1, Total: total, Expect: st.Expect, Error: code})
	}
	send := func(text string) bool {
		c.reset() // the next Expect only looks at what the device prints after this
		_, err := lc.c.Write([]byte(text + "\r"))
		return err == nil
	}
	if s.LogonCR {
		time.Sleep(300 * time.Millisecond)
		if !send("") {
			fail(-1, LogonStep{}, "write")
			return
		}
	}
	for i, st := range s.LogonSteps {
		if st.Expect != "" {
			if code := a.waitText(lc, c, st.Expect); code != "" {
				fail(i, st, code)
				return
			}
		}
		text := st.Send
		if st.Hide {
			pw, err := decryptString(st.Secret)
			if err != nil {
				fail(i, st, "decrypt")
				return
			}
			text = pw
		}
		if !send(text) {
			fail(i, st, "write")
			return
		}
	}
	runtime.EventsEmit(a.ctx, "logon:"+lc.id, logonEvent{Total: total})
}

// waitText waits until want appears in the captured output; returns an error code or "".
func (a *App) waitText(lc *liveConn, c *capture, want string) string {
	deadline := time.Now().Add(logonStepTimeout)
	for {
		if strings.Contains(c.text(), want) {
			return ""
		}
		if a.get(lc.id) != lc {
			return "closed"
		}
		if time.Now().After(deadline) {
			return "timeout"
		}
		select {
		case <-c.notify:
		case <-time.After(250 * time.Millisecond):
		}
	}
}
