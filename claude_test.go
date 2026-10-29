package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDesktopClaude(t *testing.T) {
	dir := t.TempDir()
	if p := desktopClaude(dir); p != "" {
		t.Fatalf("empty folder: %q", p)
	}
	mk := func(ver, build string) string {
		p := filepath.Join(dir, "Claude-Data", "claude_pzs8sxrjxfjjc", "claude-code", ver, build, "claude.exe")
		_ = os.MkdirAll(filepath.Dir(p), 0o755)
		_ = os.WriteFile(p, []byte("MZ"), 0o755)
		return p
	}
	mk("2.1.9", "aaa")
	want := mk("2.1.10", "bbb")
	mk("2.0.99", "ccc")
	if got := desktopClaude(dir); got != want {
		t.Fatalf("got %q, want the newest %q", got, want)
	}
	if desktopClaude("") != "" {
		t.Fatal("no LOCALAPPDATA should find nothing")
	}
}
