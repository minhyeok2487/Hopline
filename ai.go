package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

// The AI helper runs the user's own Claude Code CLI in print mode (no tools,
// no MCP servers), so it needs no API key: it uses whatever account the CLI
// is signed in with. Output streams to the UI as "ai:delta:<id>" events.

type AIInfo struct {
	CLI   bool   `json:"cli"`
	Path  string `json:"path"`
	Model string `json:"model"`
}

type AIMsg struct {
	Role string `json:"role"` // user | assistant
	Text string `json:"text"`
}

type AIRequest struct {
	Kind     string  `json:"kind"` // ask | explain
	Question string  `json:"question"`
	Context  string  `json:"context"` // recent terminal text or the selection
	Session  string  `json:"session"`
	Target   string  `json:"target"`
	History  []AIMsg `json:"history"`
}

type AIResult struct {
	Text  string `json:"text"`
	Error string `json:"error,omitempty"` // NO_CLI, AI_AUTH, CANCELED or a message
}

var aiJobs sync.Map // request id -> context.CancelFunc

func claudeExe() string {
	if p := os.Getenv("HOPLINE_CLAUDE"); p != "" { // tests point this at a stub
		return p
	}
	return findClaude()
}

func (a *App) AIStatus() AIInfo {
	p := claudeExe()
	return AIInfo{CLI: p != "", Path: p, Model: a.store.Settings().AIModel}
}

func (a *App) SetAIModel(model string) error {
	st := a.store.Settings()
	st.AIModel = strings.TrimSpace(model)
	return a.store.PutSettings(st)
}

func aiLang() string {
	if lang, _ := curLang.Load().(string); lang == "ko" {
		return "Korean"
	}
	return "English"
}

const aiBase = `You are the assistant built into Hopline, a terminal app network engineers use to work on switches, routers, firewalls (Cisco, Juniper, Arista, Fortinet, Palo Alto, Check Point Gaia) and Linux servers over SSH, Telnet and serial consoles.
Reply in %s. Be brief and practical: short paragraphs or bullets, no filler.
Put every command the user could run in its own fenced code block tagged "cli", one command per line, exactly as it should be typed on that device (no prompts, no comments inside the block).
Prefer read-only commands (show, display, get, diagnose, ping, traceroute). If a step changes configuration or could interrupt traffic (configure, set, delete, reload, clear, shutdown, write, commit), say so plainly in a line starting with "⚠" right above that block.
Work out the platform from the prompt and output in the terminal text. If something is unclear, say what you'd check instead of guessing.`

func aiSystem(kind string) string {
	s := fmt.Sprintf(aiBase, aiLang())
	switch kind {
	case "explain":
		s += "\nThe user selected part of the terminal output. Explain what it means, point out anything abnormal (errors, down links, drops, high counters, failovers) and suggest the next command to check."
	case "summary":
		s = fmt.Sprintf(`You write work reports from Hopline terminal session logs. Reply in %s, in Markdown.
Sections: "## 요약 / Summary" (2-4 lines: device, what was done, outcome), "## 실행한 명령 / Commands" (the meaningful ones, grouped), "## 변경 사항 / Changes" (configuration that was changed, or "없음/None"), "## 이상 징후 / Issues" (errors, down interfaces, alarms seen in the output, or "없음/None"), "## 후속 조치 / Follow-up" (only if something needs attention).
Use the section names in the reply language only. Quote exact values (interface names, IPs, versions) from the log. Never invent output that is not in the log.`, aiLang())
	}
	return s
}

func aiPrompt(r AIRequest) string {
	var b strings.Builder
	if r.Session != "" || r.Target != "" {
		fmt.Fprintf(&b, "Device/session: %s (%s)\n\n", r.Session, r.Target)
	}
	if strings.TrimSpace(r.Context) != "" {
		label := "Recent terminal output"
		if r.Kind == "explain" {
			label = "Selected terminal text"
		}
		fmt.Fprintf(&b, "%s:\n<terminal>\n%s\n</terminal>\n\n", label, strings.TrimRight(r.Context, "\n "))
	}
	if len(r.History) > 0 {
		b.WriteString("Conversation so far:\n")
		for _, m := range r.History {
			fmt.Fprintf(&b, "[%s] %s\n", m.Role, m.Text)
		}
		b.WriteString("\n")
	}
	q := strings.TrimSpace(r.Question)
	if q == "" && r.Kind == "explain" {
		q = "Explain this output."
	}
	b.WriteString("User: " + q)
	return b.String()
}

var aiTemp struct {
	once sync.Once
	dir  string
}

// aiWorkDir is an empty folder so the CLI doesn't pick up a project's CLAUDE.md.
func aiWorkDir() string {
	aiTemp.once.Do(func() {
		aiTemp.dir = filepath.Join(os.TempDir(), "hopline-ai")
		_ = os.MkdirAll(aiTemp.dir, 0o755)
	})
	return aiTemp.dir
}

const aiShortSystem = "You are the assistant built into the Hopline terminal app. Follow the <instructions> block at the start of the user message exactly."

// runClaude streams one answer. onDelta gets text as it arrives.
func (a *App) runClaude(ctx context.Context, system, prompt string, onDelta func(string)) (string, error) {
	exe := claudeExe()
	if exe == "" {
		return "", errors.New("NO_CLI")
	}
	args := []string{"-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
		"--strict-mcp-config", "--tools", "", "--disable-slash-commands", "--system-prompt", aiShortSystem}
	if m := a.store.Settings().AIModel; m != "" {
		args = append(args, "--model", m)
	}
	cmd := exec.CommandContext(ctx, exe, args...)
	cmd.Dir = aiWorkDir()
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	// The real instructions travel on stdin: npm installs run claude.cmd through
	// cmd.exe, which mangles multi-line arguments.
	cmd.Stdin = strings.NewReader("<instructions>\n" + system + "\n</instructions>\n\n" + prompt)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	out, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	if err := cmd.Start(); err != nil {
		return "", err
	}
	var text strings.Builder
	final, failure := "", ""
	sc := bufio.NewScanner(out)
	sc.Buffer(make([]byte, 1<<20), 16<<20)
	for sc.Scan() {
		var ev struct {
			Type    string `json:"type"`
			Subtype string `json:"subtype"`
			Error   string `json:"error"`
			Result  string `json:"result"`
			IsError bool   `json:"is_error"`
			Event   struct {
				Type  string `json:"type"`
				Delta struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"delta"`
			} `json:"event"`
		}
		if json.Unmarshal(sc.Bytes(), &ev) != nil {
			continue
		}
		switch ev.Type {
		case "stream_event":
			if ev.Event.Type == "content_block_delta" && ev.Event.Delta.Type == "text_delta" {
				text.WriteString(ev.Event.Delta.Text)
				onDelta(ev.Event.Delta.Text)
			}
		case "assistant":
			if ev.Error != "" {
				failure = ev.Error
			}
		case "result":
			final = ev.Result
			if ev.IsError && failure == "" {
				failure = ev.Result
			}
		}
	}
	werr := cmd.Wait()
	if ctx.Err() != nil {
		return text.String(), errors.New("CANCELED")
	}
	if failure != "" {
		if strings.Contains(failure, "authentication") || strings.Contains(final, "401") || strings.Contains(final, "/login") {
			return "", errors.New("AI_AUTH")
		}
		return "", errors.New(firstLine(final, failure))
	}
	if final == "" {
		final = text.String()
	}
	if final == "" && werr != nil {
		return "", errors.New(firstLine(strings.TrimSpace(stderr.String()), werr.Error()))
	}
	return final, nil
}

func firstLine(s, fallback string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return fallback
	}
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return s
}

// startAI runs job in the background and reports through ai:delta/ai:done events.
func (a *App) startAI(reqID string, timeout time.Duration, job func(ctx context.Context, delta func(string)) (string, error)) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	aiJobs.Store(reqID, cancel)
	go func() {
		defer func() {
			aiJobs.Delete(reqID)
			cancel()
		}()
		text, err := job(ctx, func(d string) { a.emit("ai:delta:"+reqID, d) })
		res := AIResult{Text: text}
		if err != nil {
			res.Error = err.Error()
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				res.Error = "timeout"
			}
		}
		a.emit("ai:done:"+reqID, res)
	}()
}

// AIAsk answers a question about the terminal (ask) or a selection (explain).
func (a *App) AIAsk(reqID string, req AIRequest) {
	a.startAI(reqID, 3*time.Minute, func(ctx context.Context, delta func(string)) (string, error) {
		return a.runClaude(ctx, aiSystem(req.Kind), aiPrompt(req), delta)
	})
}

func (a *App) AICancel(reqID string) {
	if c, ok := aiJobs.Load(reqID); ok {
		c.(context.CancelFunc)()
	}
}

const maxSummaryInput = 180 << 10

// logForAI keeps the start and the end of a long log.
func logForAI(text string) string {
	if len(text) <= maxSummaryInput {
		return text
	}
	head := text[:maxSummaryInput/3]
	tail := text[len(text)-maxSummaryInput*2/3:]
	return head + fmt.Sprintf("\n\n[... %d bytes omitted ...]\n\n", len(text)-len(head)-len(tail)) + tail
}

// AISummarizeLog writes a work report for a saved log and keeps it next to
// the log as <name>.summary.md.
func (a *App) AISummarizeLog(reqID, rel string) {
	a.startAI(reqID, 5*time.Minute, func(ctx context.Context, delta func(string)) (string, error) {
		p, err := a.logAbs(rel)
		if err != nil {
			return "", err
		}
		a.flushLog(p)
		text, _, err := readTail(p, 16<<20)
		if err != nil {
			return "", err
		}
		if strings.TrimSpace(text) == "" {
			return "", errors.New(T("ai.emptyLog"))
		}
		prompt := "Session log (" + filepath.ToSlash(rel) + "):\n<log>\n" + logForAI(text) + "\n</log>\n\nWrite the work report."
		out, err := a.runClaude(ctx, aiSystem("summary"), prompt, delta)
		if err == nil && strings.TrimSpace(out) != "" {
			_ = os.WriteFile(summaryPath(p), []byte(out), 0o644)
		}
		return out, err
	})
}

// AISummarizeText reports on a tab that isn't being logged (its scrollback).
func (a *App) AISummarizeText(reqID, name, text string) {
	a.startAI(reqID, 5*time.Minute, func(ctx context.Context, delta func(string)) (string, error) {
		if strings.TrimSpace(text) == "" {
			return "", errors.New(T("ai.emptyLog"))
		}
		prompt := "Terminal scrollback of " + name + ":\n<log>\n" + logForAI(text) + "\n</log>\n\nWrite the work report."
		return a.runClaude(ctx, aiSystem("summary"), prompt, delta)
	})
}
