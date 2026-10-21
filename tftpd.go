package main

import (
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/pin/tftp/v3"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Built-in TFTP server for firmware upgrades and config backups. It serves
// one folder; paths can't leave it, and uploads (device -> PC) are only
// accepted when allowed.

type tftpState struct {
	mu  sync.Mutex
	srv *tftp.Server
}

// TFTPInfo is shown in the TFTP dialog.
type TFTPInfo struct {
	Running bool     `json:"running"`
	Root    string   `json:"root"`
	Port    int      `json:"port"`
	Write   bool     `json:"write"`
	IPs     []string `json:"ips"`
	Error   string   `json:"error,omitempty"`
}

// tftpEvent reports one finished transfer to the UI.
type tftpEvent struct {
	Time  string `json:"time"`
	Dir   string `json:"dir"` // "get" (device downloads) | "put" (device uploads)
	File  string `json:"file"`
	Peer  string `json:"peer"`
	Bytes int64  `json:"bytes"`
	Error string `json:"error,omitempty"`
}

func defaultTFTPRoot() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Documents", "Hopline", "tftp")
}

func localIPv4s() []string {
	var out []string
	ifaces, _ := net.Interfaces()
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok && ipn.IP.To4() != nil && !ipn.IP.IsLinkLocalUnicast() {
				out = append(out, ipn.IP.String())
			}
		}
	}
	// LAN addresses first: they are what devices on the bench can usually reach.
	sort.SliceStable(out, func(i, j int) bool {
		return net.ParseIP(out[i]).IsPrivate() && !net.ParseIP(out[j]).IsPrivate()
	})
	return out
}

func (a *App) GetTFTPInfo() TFTPInfo {
	st := a.store.Settings()
	info := TFTPInfo{Root: st.TFTPRoot, Port: st.TFTPPort, Write: st.TFTPWrite, IPs: localIPv4s()}
	if info.Root == "" {
		info.Root = defaultTFTPRoot()
	}
	if info.Port == 0 {
		info.Port = 69
	}
	a.tftp.mu.Lock()
	info.Running = a.tftp.srv != nil
	a.tftp.mu.Unlock()
	return info
}

// tftpPath maps a requested name into the root folder, refusing escapes.
func tftpPath(root, name string) (string, error) {
	name = strings.TrimLeft(strings.ReplaceAll(name, "\\", "/"), "/")
	p := filepath.Join(root, filepath.FromSlash(name))
	rel, err := filepath.Rel(root, p)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		return "", errors.New("access violation")
	}
	return p, nil
}

type countWriter struct {
	w io.Writer
	n int64
}

func (c *countWriter) Write(p []byte) (int, error) {
	n, err := c.w.Write(p)
	c.n += int64(n)
	return n, err
}

// StartTFTP saves the options and starts serving.
func (a *App) StartTFTP(root string, port int, write bool) (TFTPInfo, error) {
	if root == "" {
		root = defaultTFTPRoot()
	}
	if port <= 0 {
		port = 69
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return a.GetTFTPInfo(), err
	}
	st := a.store.Settings()
	st.TFTPRoot, st.TFTPPort, st.TFTPWrite = root, port, write
	_ = a.store.PutSettings(st)
	a.StopTFTP()

	emit := func(ev tftpEvent) {
		ev.Time = time.Now().Format("15:04:05")
		a.emit("tftp:transfer", ev)
	}
	read := func(name string, rf io.ReaderFrom) error {
		peer := ""
		if ot, ok := rf.(tftp.OutgoingTransfer); ok {
			ra := ot.RemoteAddr()
			peer = ra.IP.String()
		}
		p, err := tftpPath(root, name)
		if err == nil {
			var f *os.File
			if f, err = os.Open(p); err == nil {
				defer f.Close()
				var n int64
				n, err = rf.ReadFrom(f)
				emit(tftpEvent{Dir: "get", File: name, Peer: peer, Bytes: n, Error: errString(err)})
				return err
			}
		}
		emit(tftpEvent{Dir: "get", File: name, Peer: peer, Error: err.Error()})
		return err
	}
	writeH := func(name string, wt io.WriterTo) error {
		peer := ""
		if it, ok := wt.(tftp.IncomingTransfer); ok {
			ra := it.RemoteAddr()
			peer = ra.IP.String()
		}
		if !write {
			err := errors.New("uploads are disabled")
			emit(tftpEvent{Dir: "put", File: name, Peer: peer, Error: err.Error()})
			return err
		}
		p, err := tftpPath(root, name)
		if err != nil {
			emit(tftpEvent{Dir: "put", File: name, Peer: peer, Error: err.Error()})
			return err
		}
		_ = os.MkdirAll(filepath.Dir(p), 0o755)
		tmp := p + ".part"
		f, err := os.Create(tmp)
		if err != nil {
			emit(tftpEvent{Dir: "put", File: name, Peer: peer, Error: err.Error()})
			return err
		}
		cw := &countWriter{w: f}
		_, err = wt.WriteTo(cw)
		f.Close()
		if err == nil {
			err = os.Rename(tmp, p)
		} else {
			_ = os.Remove(tmp)
		}
		emit(tftpEvent{Dir: "put", File: name, Peer: peer, Bytes: cw.n, Error: errString(err)})
		return err
	}
	srv := tftp.NewServer(read, writeH)
	srv.SetTimeout(5 * time.Second)
	conn, err := net.ListenUDP("udp", &net.UDPAddr{Port: port})
	if err != nil {
		info := a.GetTFTPInfo()
		info.Error = fmt.Sprintf(T("err.tftpPort"), port, err)
		return info, errors.New(info.Error)
	}
	a.tftp.mu.Lock()
	a.tftp.srv = srv
	a.tftp.mu.Unlock()
	go func() { _ = srv.Serve(conn) }()
	a.emit("tftp:state", true)
	return a.GetTFTPInfo(), nil
}

func (a *App) StopTFTP() {
	a.tftp.mu.Lock()
	srv := a.tftp.srv
	a.tftp.srv = nil
	a.tftp.mu.Unlock()
	if srv != nil {
		srv.Shutdown()
		a.emit("tftp:state", false)
	}
}

// OpenTFTPFolder shows the served folder in Explorer.
func (a *App) OpenTFTPFolder() {
	root := a.GetTFTPInfo().Root
	_ = os.MkdirAll(root, 0o755)
	runtime.BrowserOpenURL(a.ctx, "file:///"+filepath.ToSlash(root))
}

// PickTFTPFolder lets the user choose the folder to serve.
func (a *App) PickTFTPFolder() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: T("dlg.tftpRoot"), DefaultDirectory: a.GetTFTPInfo().Root})
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// emit sends a UI event; tests run without a Wails context and set noEvents.
func (a *App) emit(name string, data ...any) {
	if !a.noEvents {
		runtime.EventsEmit(a.ctx, name, data...)
	}
}
