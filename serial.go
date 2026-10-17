package main

import (
	"fmt"
	"io"
	"sort"

	"go.bug.st/serial"
	"go.bug.st/serial/enumerator"
)

type serialConn struct {
	port serial.Port
	done chan string
}

// SerialPortInfo is shown in the session editor's port dropdown.
type SerialPortInfo struct {
	Name  string `json:"name"`
	Label string `json:"label"`
}

func (a *App) ListSerialPorts() []SerialPortInfo {
	var out []SerialPortInfo
	if det, err := enumerator.GetDetailedPortsList(); err == nil && len(det) > 0 {
		for _, p := range det {
			label := p.Name
			if p.Product != "" {
				label += " — " + p.Product
			}
			out = append(out, SerialPortInfo{Name: p.Name, Label: label})
		}
	} else if names, err := serial.GetPortsList(); err == nil {
		for _, n := range names {
			out = append(out, SerialPortInfo{Name: n, Label: n})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

func openSerial(s Session, out io.Writer) (*serialConn, error) {
	mode := &serial.Mode{BaudRate: s.Baud, DataBits: s.DataBits}
	if mode.BaudRate == 0 {
		mode.BaudRate = 9600
	}
	if mode.DataBits == 0 {
		mode.DataBits = 8
	}
	switch s.Parity {
	case "E":
		mode.Parity = serial.EvenParity
	case "O":
		mode.Parity = serial.OddParity
	default:
		mode.Parity = serial.NoParity
	}
	if s.StopBits == "2" {
		mode.StopBits = serial.TwoStopBits
	} else {
		mode.StopBits = serial.OneStopBit
	}
	p, err := serial.Open(s.ComPort, mode)
	if err != nil {
		return nil, fmt.Errorf(T("serial.openFail"), s.ComPort, err)
	}
	fmt.Fprintf(out, "\x1b[90m"+T("serial.connected")+"\x1b[0m\r\n", s.ComPort, mode.BaudRate, mode.DataBits, orDefault(s.Parity, "N"), orDefault(s.StopBits, "1"))
	c := &serialConn{port: p, done: make(chan string, 1)}
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := p.Read(buf)
			if n > 0 {
				_, _ = out.Write(buf[:n])
			}
			if err != nil {
				c.done <- err.Error()
				return
			}
			if n == 0 { // port closed / device removed
				c.done <- T("serial.closed")
				return
			}
		}
	}()
	return c, nil
}

func orDefault(s, d string) string {
	if s == "" {
		return d
	}
	return s
}

func (c *serialConn) wait() string                { return <-c.done }
func (c *serialConn) Write(p []byte) (int, error) { return c.port.Write(p) }
func (c *serialConn) Resize(int, int) error       { return nil }
func (c *serialConn) Close() error                { return c.port.Close() }
