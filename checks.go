package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Scheduled checks: at set times Hopline connects to saved sessions in the
// background (no tab), runs read-only commands, saves the output under
// <log dir>\_checks\<check>\<run>\ and optionally asks the AI to compare it
// with the previous run.

type Check struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Sessions []string `json:"sessions"` // saved session ids
	Commands string   `json:"commands"` // one per line
	Mode     string   `json:"mode"`     // daily | interval | manual
	Times    string   `json:"times"`    // daily: "08:30, 18:00"
	EveryMin int      `json:"everyMin"` // interval
	Enabled  bool     `json:"enabled"`
	AI       bool     `json:"ai"` // AI report comparing with the previous run

	LastRun    int64  `json:"lastRun,omitempty"`
	LastStatus string `json:"lastStatus,omitempty"` // ok | warn | fail
	LastRel    string `json:"lastRel,omitempty"`    // run folder, relative to the log folder
	LastNote   string `json:"lastNote,omitempty"`
}

func (s *Store) Checks() []Check {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Check, len(s.checks))
	copy(out, s.checks)
	return out
}

func (s *Store) PutCheck(c Check) (Check, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if c.ID == "" {
		c.ID = newID()
	}
	for i := range s.checks {
		if s.checks[i].ID == c.ID {
			// The runner owns the last-run fields.
			c.LastRun, c.LastStatus, c.LastRel, c.LastNote = s.checks[i].LastRun, s.checks[i].LastStatus, s.checks[i].LastRel, s.checks[i].LastNote
			s.checks[i] = c
			return c, s.saveLocked()
		}
	}
	s.checks = append(s.checks, c)
	return c, s.saveLocked()
}

func (s *Store) DeleteCheck(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.checks {
		if s.checks[i].ID == id {
			s.checks = append(s.checks[:i], s.checks[i+1:]...)
			return s.saveLocked()
		}
	}
	return nil
}

func (s *Store) finishCheck(id string, at int64, status, rel, note string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.checks {
		if s.checks[i].ID == id {
			s.checks[i].LastRun, s.checks[i].LastStatus, s.checks[i].LastRel, s.checks[i].LastNote = at, status, rel, note
			_ = s.saveLocked()
		}
	}
}

// ---------- bindings ----------

var checkRunning sync.Map // check id -> true

type CheckView struct {
	Check
	Running bool  `json:"running"`
	Next    int64 `json:"next"` // unix ms of the next scheduled run, 0 = none
}

func (a *App) ListChecks() []CheckView {
	now := time.Now()
	var out []CheckView
	for _, c := range a.store.Checks() {
		_, run := checkRunning.Load(c.ID)
		v := CheckView{Check: c, Running: run}
		if c.Enabled {
			if t := nextRun(c, now); !t.IsZero() {
				v.Next = t.UnixMilli()
			}
		}
		out = append(out, v)
	}
	return out
}

func (a *App) SaveCheck(c Check) (Check, error) {
	c.Name = strings.TrimSpace(c.Name)
	if c.Name == "" {
		return c, errors.New(T("chk.err.name"))
	}
	if len(c.Sessions) == 0 {
		return c, errors.New(T("chk.err.sessions"))
	}
	if strings.TrimSpace(c.Commands) == "" {
		return c, errors.New(T("chk.err.commands"))
	}
	switch c.Mode {
	case "daily":
		if len(parseTimes(c.Times)) == 0 {
			return c, errors.New(T("chk.err.times"))
		}
	case "interval":
		if c.EveryMin < 5 {
			c.EveryMin = 5
		}
	default:
		c.Mode = "manual"
	}
	return a.store.PutCheck(c)
}

func (a *App) DeleteCheck(id string) error { return a.store.DeleteCheck(id) }

func (a *App) RunCheckNow(id string) error {
	for _, c := range a.store.Checks() {
		if c.ID == id {
			if _, busy := checkRunning.Load(id); busy {
				return errors.New(T("chk.err.running"))
			}
			go a.runCheck(c)
			return nil
		}
	}
	return errors.New("check not found")
}

// ---------- schedule ----------

var hhmmRe = regexp.MustCompile(`^(\d{1,2}):(\d{2})$`)

func parseTimes(s string) [][2]int {
	var out [][2]int
	for _, f := range strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == ' ' || r == ';' }) {
		m := hhmmRe.FindStringSubmatch(f)
		if m == nil {
			continue
		}
		h, _ := strconv.Atoi(m[1])
		mi, _ := strconv.Atoi(m[2])
		if h < 24 && mi < 60 {
			out = append(out, [2]int{h, mi})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i][0]*60+out[i][1] < out[j][0]*60+out[j][1] })
	return out
}

// dueAt returns the scheduled time that makes c due now (zero if not due).
// A daily run missed while Hopline was closed is caught up within two hours.
func dueAt(c Check, now time.Time) time.Time {
	if !c.Enabled {
		return time.Time{}
	}
	last := time.UnixMilli(c.LastRun)
	switch c.Mode {
	case "interval":
		if c.EveryMin > 0 && (c.LastRun == 0 || now.Sub(last) >= time.Duration(c.EveryMin)*time.Minute) {
			return now
		}
	case "daily":
		for _, hm := range parseTimes(c.Times) {
			at := time.Date(now.Year(), now.Month(), now.Day(), hm[0], hm[1], 0, 0, now.Location())
			if !now.Before(at) && now.Sub(at) < 2*time.Hour && last.Before(at) {
				return at
			}
		}
	}
	return time.Time{}
}

func nextRun(c Check, now time.Time) time.Time {
	switch c.Mode {
	case "interval":
		if c.EveryMin <= 0 {
			return time.Time{}
		}
		if c.LastRun == 0 {
			return now
		}
		return time.UnixMilli(c.LastRun).Add(time.Duration(c.EveryMin) * time.Minute)
	case "daily":
		for d := 0; d < 2; d++ {
			for _, hm := range parseTimes(c.Times) {
				at := time.Date(now.Year(), now.Month(), now.Day()+d, hm[0], hm[1], 0, 0, now.Location())
				if at.After(now) {
					return at
				}
			}
		}
	}
	return time.Time{}
}

func (a *App) watchChecks() {
	time.Sleep(20 * time.Second)
	for {
		now := time.Now()
		for _, c := range a.store.Checks() {
			if _, busy := checkRunning.Load(c.ID); !busy && !dueAt(c, now).IsZero() {
				go a.runCheck(c)
			}
		}
		time.Sleep(30 * time.Second)
	}
}

// ---------- running ----------

type checkResult struct {
	name   string
	file   string
	output string
	err    error
}

// checkSession connects in the background, runs the commands and disconnects.
func (a *App) checkSession(ctx context.Context, sessionID string, commands []string) checkResult {
	s, ok := a.store.Get(sessionID)
	if !ok {
		return checkResult{name: sessionID, err: errors.New(T("err.sessionNotFound"))}
	}
	res := checkResult{name: s.Name, file: safeName(s.Name) + ".txt"}
	pw := ""
	if s.HasPassword {
		var err error
		if pw, err = a.store.Password(s.ID); err != nil {
			res.err = err
			return res
		}
	}
	if s.Kind != "serial" && s.Kind != "telnet" && pw == "" && s.KeyPath == "" {
		res.err = errors.New(T("chk.err.noPassword"))
		return res
	}
	connID := "k" + newID()
	if err := a.dial(connID, s, pw, 200, 50, true); err != nil {
		res.err = err
		if strings.HasPrefix(err.Error(), hostKeyChangedPrefix) {
			res.err = errors.New(T("chk.err.hostKey"))
		}
		return res
	}
	lc := a.get(connID)
	if lc == nil {
		res.err = errors.New(T("err.notConnected"))
		return res
	}
	defer a.closeConn(lc, "")
	if lc.logonDone != nil {
		select {
		case <-lc.logonDone:
		case <-time.After(3 * time.Minute):
		case <-ctx.Done():
		}
	}
	time.Sleep(1500 * time.Millisecond)
	var b strings.Builder
	for _, cmd := range commands {
		out, err := a.runCommand(ctx, lc, runIn{Command: cmd, TimeoutSec: 120})
		fmt.Fprintf(&b, "===== %s =====\n%s\n", cmd, strings.TrimRight(out, "\n"))
		if err != nil {
			fmt.Fprintf(&b, "[error: %v]\n", err)
		}
		if a.get(connID) == nil {
			b.WriteString("[connection closed]\n")
			break
		}
		b.WriteString("\n")
	}
	res.output = b.String()
	return res
}

var statusLineRe = regexp.MustCompile(`(?im)^\s*STATUS:\s*(OK|WARN|FAIL)\b.*$`)

func (a *App) runCheck(c Check) {
	if _, busy := checkRunning.LoadOrStore(c.ID, true); busy {
		return
	}
	defer checkRunning.Delete(c.ID)
	started := time.Now()
	a.emit("check:state", map[string]any{"id": c.ID, "running": true})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	var commands []string
	for _, ln := range strings.Split(strings.ReplaceAll(c.Commands, "\r\n", "\n"), "\n") {
		if ln = strings.TrimSpace(ln); ln != "" {
			commands = append(commands, ln)
		}
	}
	results := make([]checkResult, len(c.Sessions))
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for i, id := range c.Sessions {
		wg.Add(1)
		go func(i int, id string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			results[i] = a.checkSession(ctx, id, commands)
		}(i, id)
	}
	wg.Wait()

	rel := filepath.ToSlash(filepath.Join("_checks", safeName(c.Name), started.Format("2006-01-02_150405")))
	dir := filepath.Join(a.logDir(), filepath.FromSlash(rel))
	_ = os.MkdirAll(dir, 0o755)
	failed := 0
	var report strings.Builder
	fmt.Fprintf(&report, "# %s · %s\n\n", c.Name, started.Format("2006-01-02 15:04"))
	for _, r := range results {
		if r.err != nil {
			failed++
			fmt.Fprintf(&report, "- ❌ **%s**: %v\n", r.name, r.err)
			continue
		}
		_ = os.WriteFile(filepath.Join(dir, r.file), []byte(r.output), 0o644)
		fmt.Fprintf(&report, "- ✅ **%s**\n", r.name)
	}
	status := "ok"
	if failed > 0 {
		status = "fail"
		if failed < len(results) {
			status = "warn"
		}
	}
	note := ""
	if failed > 0 {
		note = fmt.Sprintf(T("chk.note.failed"), failed, len(results))
	}

	if c.AI && failed < len(results) {
		ai, err := a.checkAI(ctx, c, results, rel)
		if err != nil {
			fmt.Fprintf(&report, "\n> AI: %v\n", err)
		} else {
			if m := statusLineRe.FindStringSubmatch(ai); m != nil {
				if s := strings.ToLower(m[1]); s == "fail" || (s == "warn" && status == "ok") {
					status = s
				}
				ai = strings.TrimSpace(statusLineRe.ReplaceAllString(ai, ""))
			}
			report.WriteString("\n" + ai + "\n")
			if n := checkNote(ai); n != "" && note == "" {
				note = n
			}
		}
	}
	_ = os.WriteFile(filepath.Join(dir, "report.md"), []byte(fmt.Sprintf("<!-- status: %s -->\n", status)+report.String()), 0o644)
	if len([]rune(note)) > 140 {
		note = string([]rune(note)[:140]) + "…"
	}
	a.store.finishCheck(c.ID, started.UnixMilli(), status, rel, note)
	a.emit("check:done", map[string]any{"id": c.ID, "name": c.Name, "status": status, "rel": rel, "note": note})
}

var attentionRe = regexp.MustCompile(`(?i)확인 필요|needs attention`)

// checkNote picks one line for the check list: the first item under "Needs
// attention" if there is one, otherwise the first line that isn't a heading.
func checkNote(ai string) string {
	first, inAttention := "", false
	for _, ln := range strings.Split(ai, "\n") {
		ln = strings.TrimSpace(ln)
		if strings.HasPrefix(ln, "#") {
			inAttention = attentionRe.MatchString(ln)
			continue
		}
		ln = strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(strings.TrimLeft(ln, "->*•")), "**", ""), "`", "")
		if ln == "" {
			continue
		}
		if inAttention {
			return ln
		}
		if first == "" {
			first = ln
		}
	}
	return first
}

const checkSystem = `You review scheduled health checks of network devices and servers for Hopline. Reply in %s, in Markdown.
The very first line must be exactly one of: "STATUS: OK", "STATUS: WARN", "STATUS: FAIL" (FAIL = something is down or broken, WARN = worth a look).
Then: "## 결과 / Result" with one bullet per device (state in a few words), "## 이전과 달라진 점 / Changes since last run" (only real differences: links up/down, routes, neighbors, cluster state, versions, errors and counters that grew; "없음/None" if nothing changed or there's no previous run), and "## 확인 필요 / Needs attention" only if something does.
Use the section names in the reply language only. Quote exact names and values from the output. Never invent output.`

func (a *App) checkAI(ctx context.Context, c Check, results []checkResult, rel string) (string, error) {
	var b strings.Builder
	fmt.Fprintf(&b, "Check: %s\nCommands:\n%s\n\n", c.Name, c.Commands)
	budget := maxSummaryInput / 2 / max(1, len(results))
	for _, r := range results {
		if r.err != nil {
			fmt.Fprintf(&b, "<device name=%q>connection failed: %v</device>\n", r.name, r.err)
			continue
		}
		fmt.Fprintf(&b, "<device name=%q>\n%s\n</device>\n", r.name, clip(r.output, budget))
	}
	if c.LastRel != "" && c.LastRel != rel {
		prev := filepath.Join(a.logDir(), filepath.FromSlash(c.LastRel))
		b.WriteString("\nPrevious run (" + c.LastRel + "):\n")
		for _, r := range results {
			if old, err := os.ReadFile(filepath.Join(prev, r.file)); err == nil {
				fmt.Fprintf(&b, "<previous name=%q>\n%s\n</previous>\n", r.name, clip(string(old), budget))
			}
		}
	}
	return a.runClaude(ctx, fmt.Sprintf(checkSystem, aiLang()), b.String(), func(string) {})
}

func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + fmt.Sprintf("\n[... %d bytes cut ...]", len(s)-n)
}

// ---------- results ----------

type CheckRun struct {
	Rel    string `json:"rel"`
	Time   int64  `json:"time"`
	Status string `json:"status"`
}

var runStatusRe = regexp.MustCompile(`^<!-- status: (\w+) -->`)

func (a *App) CheckRuns(checkID string) []CheckRun {
	var name string
	for _, c := range a.store.Checks() {
		if c.ID == checkID {
			name = c.Name
		}
	}
	if name == "" {
		return nil
	}
	base := filepath.Join(a.logDir(), "_checks", safeName(name))
	ents, _ := os.ReadDir(base)
	var out []CheckRun
	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		t, err := time.ParseInLocation("2006-01-02_150405", e.Name(), time.Local)
		if err != nil {
			continue
		}
		run := CheckRun{Rel: filepath.ToSlash(filepath.Join("_checks", safeName(name), e.Name())), Time: t.UnixMilli()}
		if head, err := os.ReadFile(filepath.Join(base, e.Name(), "report.md")); err == nil {
			if m := runStatusRe.FindSubmatch(head); m != nil {
				run.Status = string(m[1])
			}
		}
		out = append(out, run)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Time > out[j].Time })
	return out
}

type RunFile struct {
	Name string `json:"name"`
	Text string `json:"text"`
}

type CheckRunView struct {
	Report string    `json:"report"`
	Files  []RunFile `json:"files"`
}

func (a *App) ReadCheckRun(rel string) (CheckRunView, error) {
	dir, err := a.logAbs(rel)
	if err != nil {
		return CheckRunView{}, err
	}
	var v CheckRunView
	if b, err := os.ReadFile(filepath.Join(dir, "report.md")); err == nil {
		v.Report = runStatusRe.ReplaceAllString(string(b), "")
	}
	ents, err := os.ReadDir(dir)
	if err != nil {
		return v, err
	}
	for _, e := range ents {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".txt") {
			continue
		}
		text, _, _ := readTail(filepath.Join(dir, e.Name()), maxLogView)
		v.Files = append(v.Files, RunFile{Name: strings.TrimSuffix(e.Name(), ".txt"), Text: text})
	}
	return v, nil
}
