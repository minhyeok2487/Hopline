package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSessionLogCleansStream(t *testing.T) {
	p := filepath.Join(t.TempDir(), "a.log")
	f, _ := os.Create(p)
	l := &sessionLog{f: f, path: p}
	// Colour codes split across chunks, a --More-- erased with backspaces, CRLF.
	for _, chunk := range []string{"sw1#show ver\r\n\x1b[3", "2mCisco IOS\x1b[0m\r\n --More-- ", "\b\b\b\b\b\b\b\b\b\b          \b\b\b\b\b\b\b\b\b\bUptime 3d\r\nsw1#"} {
		l.write([]byte(chunk))
	}
	l.close()
	b, _ := os.ReadFile(p)
	want := "sw1#show ver\nCisco IOS\nUptime 3d\nsw1#\n"
	if string(b) != want {
		t.Fatalf("got %q want %q", b, want)
	}
}

func TestSessionLogStamps(t *testing.T) {
	p := filepath.Join(t.TempDir(), "a.log")
	f, _ := os.Create(p)
	l := &sessionLog{f: f, path: p, stamps: true}
	l.write([]byte("one\r\ntwo\r\n"))
	l.close()
	b, _ := os.ReadFile(p)
	lines := strings.Split(strings.TrimSpace(string(b)), "\n")
	if len(lines) != 2 || !strings.HasPrefix(lines[0], "[20") || !strings.HasSuffix(lines[1], "] two") {
		t.Fatalf("got %q", b)
	}
}

func TestListLogsAndConfine(t *testing.T) {
	a := &App{store: &Store{dir: t.TempDir()}, conns: map[string]*liveConn{}, noEvents: true}
	root := t.TempDir()
	a.store.settings.LogDir = root
	_ = os.MkdirAll(filepath.Join(root, "core-sw"), 0o755)
	_ = os.WriteFile(filepath.Join(root, "core-sw", "2026-10-25_101500.log"), []byte("x\n"), 0o644)
	_ = os.WriteFile(filepath.Join(root, "old_box_20250101_090000.log"), []byte("y\n"), 0o644)
	_ = os.MkdirAll(filepath.Join(root, "_checks", "daily"), 0o755)
	_ = os.WriteFile(filepath.Join(root, "_checks", "daily", "x.log"), []byte("z\n"), 0o644)
	logs := a.ListLogs()
	if len(logs) != 2 || logs[0].Session != "core-sw" || logs[1].Session != "old_box" {
		t.Fatalf("got %+v", logs)
	}
	if _, err := a.logAbs("../secret.txt"); err == nil {
		t.Fatal("escaped the log folder")
	}
	hits, _ := a.SearchLogs("Y")
	if len(hits) != 1 || hits[0].Session != "old_box" {
		t.Fatalf("hits %+v", hits)
	}
}

func TestCheckNote(t *testing.T) {
	ai := "## 결과\n- **sw1**: 정상\n## 확인 필요\n- sw1 `Gi0/2` 상태 확인"
	if n := checkNote(ai); n != "sw1 Gi0/2 상태 확인" {
		t.Fatalf("got %q", n)
	}
	if n := checkNote("## Result\n- **sw1**: fine"); n != "sw1: fine" {
		t.Fatalf("got %q", n)
	}
}

func TestCheckSchedule(t *testing.T) {
	loc := time.Local
	now := time.Date(2026, 10, 25, 8, 31, 0, 0, loc)
	c := Check{Enabled: true, Mode: "daily", Times: "18:00, 8:30"}
	if dueAt(c, now).IsZero() {
		t.Fatal("08:30 run should be due")
	}
	c.LastRun = time.Date(2026, 10, 25, 8, 30, 5, 0, loc).UnixMilli()
	if !dueAt(c, now).IsZero() {
		t.Fatal("already ran")
	}
	if n := nextRun(c, now); n.Hour() != 18 {
		t.Fatalf("next %v", n)
	}
	late := time.Date(2026, 10, 25, 11, 0, 0, 0, loc)
	c.LastRun = 0
	if !dueAt(c, late).IsZero() {
		t.Fatal("more than two hours late: skip")
	}
	iv := Check{Enabled: true, Mode: "interval", EveryMin: 30, LastRun: now.Add(-29 * time.Minute).UnixMilli()}
	if !dueAt(iv, now).IsZero() || dueAt(iv, now.Add(time.Minute)).IsZero() {
		t.Fatal("interval")
	}
}
