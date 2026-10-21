package main

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"time"
)

// Telnet (RFC 854) for older switches, console servers and labs. Option
// negotiation is kept minimal: the server may echo and suppress go-ahead, and
// we offer a terminal type and window size (NAWS).

const (
	tnIAC  = 255
	tnDONT = 254
	tnDO   = 253
	tnWONT = 252
	tnWILL = 251
	tnSB   = 250
	tnSE   = 240

	optEcho  = 1
	optSGA   = 3
	optTType = 24
	optNAWS  = 31
)

type telnetConn struct {
	conn net.Conn
	out  io.Writer
	done chan string

	mu         sync.Mutex
	naws       bool // server agreed to receive window sizes
	cols, rows int
}

func dialTelnet(ctx context.Context, s Session, cols, rows int, out io.Writer) (*telnetConn, error) {
	port := s.Port
	if port == 0 {
		port = 23
	}
	addr := net.JoinHostPort(s.Host, fmt.Sprint(port))
	fmt.Fprintf(out, "\x1b[90m"+T("ssh.connecting")+"\x1b[0m\r\n", addr)
	d := net.Dialer{Timeout: 15 * time.Second}
	nc, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, err
	}
	c := &telnetConn{conn: nc, out: out, done: make(chan string, 1), cols: cols, rows: rows}
	go c.readLoop()
	return c, nil
}

func (c *telnetConn) send(b ...byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, _ = c.conn.Write(b)
}

func (c *telnetConn) sendNAWS() {
	c.mu.Lock()
	w, h := c.cols, c.rows
	c.mu.Unlock()
	b := []byte{tnIAC, tnSB, optNAWS}
	for _, v := range []int{w, h} {
		hi, lo := byte(v>>8), byte(v)
		b = append(b, hi)
		if hi == tnIAC {
			b = append(b, tnIAC)
		}
		b = append(b, lo)
		if lo == tnIAC {
			b = append(b, tnIAC)
		}
	}
	c.send(append(b, tnIAC, tnSE)...)
}

func (c *telnetConn) readLoop() {
	r := bufio.NewReaderSize(c.conn, 32<<10)
	data := make([]byte, 0, 4096)
	flush := func() {
		if len(data) > 0 {
			_, _ = c.out.Write(data)
			data = data[:0]
		}
	}
	for {
		b, err := r.ReadByte()
		if err != nil {
			flush()
			c.done <- T("ssh.shellExit")
			return
		}
		if b != tnIAC {
			data = append(data, b)
			if r.Buffered() == 0 || len(data) == cap(data) {
				flush()
			}
			continue
		}
		cmd, err := r.ReadByte()
		if err != nil {
			continue
		}
		switch cmd {
		case tnIAC:
			data = append(data, tnIAC)
		case tnWILL, tnWONT, tnDO, tnDONT:
			opt, _ := r.ReadByte()
			c.negotiate(cmd, opt)
		case tnSB:
			var sub []byte
			for {
				x, err := r.ReadByte()
				if err != nil {
					break
				}
				if x == tnIAC {
					if y, _ := r.ReadByte(); y == tnSE {
						break
					} else if y == tnIAC {
						sub = append(sub, tnIAC)
					}
					continue
				}
				sub = append(sub, x)
			}
			if len(sub) >= 2 && sub[0] == optTType && sub[1] == 1 { // SEND
				c.send(append(append([]byte{tnIAC, tnSB, optTType, 0}, "XTERM-256COLOR"...), tnIAC, tnSE)...)
			}
		}
		if r.Buffered() == 0 {
			flush()
		}
	}
}

func (c *telnetConn) negotiate(cmd, opt byte) {
	switch cmd {
	case tnWILL: // the server offers to do something
		if opt == optEcho || opt == optSGA {
			c.send(tnIAC, tnDO, opt)
		} else {
			c.send(tnIAC, tnDONT, opt)
		}
	case tnDO: // the server asks us to do something
		switch opt {
		case optTType, optSGA:
			c.send(tnIAC, tnWILL, opt)
		case optNAWS:
			c.mu.Lock()
			c.naws = true
			c.mu.Unlock()
			c.send(tnIAC, tnWILL, opt)
			c.sendNAWS()
		default:
			c.send(tnIAC, tnWONT, opt)
		}
	}
}

// Write sends keyboard input. 0xFF is escaped, and Enter goes out as CR LF
// (the Telnet newline, like PuTTY's default).
func (c *telnetConn) Write(p []byte) (int, error) {
	buf := make([]byte, 0, len(p)+4)
	for _, b := range p {
		switch b {
		case tnIAC:
			buf = append(buf, tnIAC, tnIAC)
		case '\r':
			buf = append(buf, '\r', '\n')
		default:
			buf = append(buf, b)
		}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, err := c.conn.Write(buf); err != nil {
		return 0, err
	}
	return len(p), nil
}

func (c *telnetConn) Resize(cols, rows int) error {
	c.mu.Lock()
	c.cols, c.rows = cols, rows
	naws := c.naws
	c.mu.Unlock()
	if naws {
		c.sendNAWS()
	}
	return nil
}

func (c *telnetConn) Close() error { return c.conn.Close() }

func (c *telnetConn) wait() string { return <-c.done }

// telnetPrompt matches login prompts at the end of the screen.
var (
	loginPromptRe = `(?i)(user ?name|login)\s*:\s*$`
	passPromptRe  = `(?i)pass(word|code)?\s*:\s*$`
)

func trimTail(s string) string { return strings.TrimRight(s, " \t") }
