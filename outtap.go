package main

import (
	"bytes"
	"strings"
	"sync"
)

const ringMax = 512 << 10

// outTap keeps a connection's recent output for read_output and fans new
// output out to active MCP captures.
type outTap struct {
	mu   sync.Mutex
	ring []byte
	caps map[*capture]struct{}
}

type capture struct {
	mu     sync.Mutex
	buf    bytes.Buffer
	notify chan struct{}
}

func (t *outTap) write(p []byte) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.ring = append(t.ring, p...)
	if over := len(t.ring) - ringMax; over > 0 {
		t.ring = append(t.ring[:0:0], t.ring[over:]...)
	}
	for c := range t.caps {
		c.mu.Lock()
		c.buf.Write(p)
		c.mu.Unlock()
		select {
		case c.notify <- struct{}{}:
		default:
		}
	}
}

func (t *outTap) startCapture() *capture {
	c := &capture{notify: make(chan struct{}, 1)}
	t.mu.Lock()
	if t.caps == nil {
		t.caps = map[*capture]struct{}{}
	}
	t.caps[c] = struct{}{}
	t.mu.Unlock()
	return c
}

func (t *outTap) stopCapture(c *capture) {
	t.mu.Lock()
	delete(t.caps, c)
	t.mu.Unlock()
}

// tail returns the last n lines of recent output as plain text.
func (t *outTap) tail(n int) string {
	t.mu.Lock()
	raw := string(t.ring)
	t.mu.Unlock()
	lines := strings.Split(plain(raw), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

func (c *capture) text() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return plain(c.buf.String())
}

func (c *capture) reset() {
	c.mu.Lock()
	c.buf.Reset()
	c.mu.Unlock()
}

func (c *capture) size() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.buf.Len()
}

// plain strips terminal escapes and applies backspaces so the text reads like
// what the user sees.
func plain(s string) string {
	// A bare \r returns to column 0 (pagers use it to erase "--More--"):
	// keep only what was written after the last one on each line.
	s = strings.ReplaceAll(s, "\r\n", "\n")
	if strings.ContainsRune(s, '\r') {
		lines := strings.Split(s, "\n")
		for i, ln := range lines {
			if j := strings.LastIndexByte(strings.TrimRight(ln, "\r"), '\r'); j >= 0 {
				lines[i] = ln[j+1:]
			}
		}
		s = strings.Join(lines, "\n")
	}
	s = ansiRe.ReplaceAllString(s, "")
	if !strings.ContainsRune(s, '\b') {
		return s
	}
	out := make([]rune, 0, len(s))
	for _, r := range s {
		if r == '\b' {
			if len(out) > 0 && out[len(out)-1] != '\n' {
				out = out[:len(out)-1]
			}
			continue
		}
		out = append(out, r)
	}
	return string(out)
}
