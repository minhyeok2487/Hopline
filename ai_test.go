package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// stubClaude writes a .cmd that prints the given stream-json lines.
func stubClaude(t *testing.T, lines ...string) {
	t.Helper()
	var b strings.Builder
	b.WriteString("@echo off\r\n")
	for _, ln := range lines {
		b.WriteString("echo " + ln + "\r\n")
	}
	p := filepath.Join(t.TempDir(), "claude.cmd")
	if err := os.WriteFile(p, []byte(b.String()), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOPLINE_CLAUDE", p)
}

func TestRunClaudeStreams(t *testing.T) {
	stubClaude(t,
		`{"type":"system","subtype":"init"}`,
		`{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Gi0/2 "}}}`,
		`{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"is down"}}}`,
		`{"type":"result","subtype":"success","is_error":false,"result":"Gi0/2 is down"}`)
	a := &App{store: &Store{dir: t.TempDir()}, noEvents: true}
	var got strings.Builder
	out, err := a.runClaude(context.Background(), "sys", "q", func(d string) { got.WriteString(d) })
	if err != nil || out != "Gi0/2 is down" || got.String() != "Gi0/2 is down" {
		t.Fatalf("out=%q deltas=%q err=%v", out, got.String(), err)
	}
}

func TestRunClaudeAuthError(t *testing.T) {
	stubClaude(t,
		`{"type":"assistant","error":"authentication_failed","message":{"content":[]}}`,
		`{"type":"result","subtype":"success","is_error":true,"result":"Failed to authenticate. API Error: 401"}`)
	a := &App{store: &Store{dir: t.TempDir()}, noEvents: true}
	if _, err := a.runClaude(context.Background(), "s", "q", func(string) {}); err == nil || err.Error() != "AI_AUTH" {
		t.Fatalf("err=%v", err)
	}
}
