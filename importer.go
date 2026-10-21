package main

import (
	"bufio"
	"bytes"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/sys/windows/registry"
)

// Import saved sessions from other terminals. Passwords are never imported:
// every tool encrypts them its own way.

type ImportSource struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Path  string `json:"path"`
	Count int    `json:"count"`
}

type ImportResult struct {
	Added   int `json:"added"`
	Skipped int `json:"skipped"` // already in Hopline
}

type importer struct {
	id, name string
	find     func() (path string, sessions []Session)
}

func importers() []importer {
	home, _ := os.UserHomeDir()
	appdata := os.Getenv("APPDATA")
	docs := filepath.Join(home, "Documents")
	return []importer{
		{"mobaxterm", "MobaXterm", func() (string, []Session) {
			for _, p := range []string{
				filepath.Join(appdata, "MobaXterm", "MobaXterm.ini"),
				filepath.Join(docs, "MobaXterm", "MobaXterm.ini"),
			} {
				if ss := readMobaFile(p); len(ss) > 0 {
					return p, ss
				}
			}
			return "", nil
		}},
		{"putty", "PuTTY", func() (string, []Session) {
			return `HKCU\Software\SimonTatham\PuTTY\Sessions`, readPuTTY(`Software\SimonTatham\PuTTY\Sessions`)
		}},
		{"securecrt", "SecureCRT", func() (string, []Session) {
			p := filepath.Join(appdata, "VanDyke", "Config", "Sessions")
			return p, readSecureCRT(p)
		}},
		{"xshell", "Xshell", func() (string, []Session) {
			matches, _ := filepath.Glob(filepath.Join(docs, "NetSarang Computer", "*", "Xshell", "Sessions"))
			sort.Sort(sort.Reverse(sort.StringSlice(matches))) // newest version first
			for _, p := range matches {
				if ss := readXshell(p); len(ss) > 0 {
					return p, ss
				}
			}
			return "", nil
		}},
	}
}

// ScanImports lists the terminals found on this PC and how many sessions each has.
func (a *App) ScanImports() []ImportSource {
	var out []ImportSource
	for _, im := range importers() {
		if p, ss := im.find(); len(ss) > 0 {
			out = append(out, ImportSource{ID: im.id, Name: im.name, Path: p, Count: len(ss)})
		}
	}
	return out
}

// ImportFrom adds the sessions of one detected source under a folder named after it.
func (a *App) ImportFrom(id string) (ImportResult, error) {
	for _, im := range importers() {
		if im.id == id {
			_, ss := im.find()
			return a.addImported(im.name, ss)
		}
	}
	return ImportResult{}, errors.New("unknown source")
}

// ImportFile imports a MobaXterm export (.mxtsessions/.ini), a SecureCRT .ini or an Xshell .xsh.
func (a *App) ImportFile() (ImportResult, error) {
	p, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: T("dlg.importFile"),
		Filters: []runtime.FileFilter{{
			DisplayName: "MobaXterm, SecureCRT, Xshell (*.mxtsessions;*.ini;*.xsh)",
			Pattern:     "*.mxtsessions;*.ini;*.xsh",
		}},
	})
	if err != nil || p == "" {
		return ImportResult{}, err
	}
	var ss []Session
	name := "MobaXterm"
	switch strings.ToLower(filepath.Ext(p)) {
	case ".xsh":
		name = "Xshell"
		if s, ok := parseXsh(p); ok {
			ss = append(ss, s)
		}
	default:
		if ss = readMobaFile(p); len(ss) == 0 {
			name = "SecureCRT"
			if s, ok := parseCRT(p); ok {
				ss = append(ss, s)
			}
		}
	}
	if len(ss) == 0 {
		return ImportResult{}, errors.New(T("err.importNone"))
	}
	return a.addImported(name, ss)
}

func sameTarget(a, b Session) bool {
	if a.Kind != b.Kind {
		return false
	}
	if a.Kind == "serial" {
		return strings.EqualFold(a.ComPort, b.ComPort)
	}
	return strings.EqualFold(a.Host, b.Host) && a.Port == b.Port && a.User == b.User
}

func (a *App) addImported(source string, ss []Session) (ImportResult, error) {
	var res ImportResult
	existing := a.store.Sessions()
	for _, s := range ss {
		dup := false
		for _, e := range existing {
			if sameTarget(e, s) {
				dup = true
				break
			}
		}
		if dup {
			res.Skipped++
			continue
		}
		s.Folder = cleanFolder(source + "/" + s.Folder)
		saved, err := a.SaveSession(s, "", false)
		if err != nil {
			return res, err
		}
		existing = append(existing, saved)
		res.Added++
	}
	return res, nil
}

// ---------- MobaXterm: MobaXterm.ini or an exported .mxtsessions ----------

var comRe = regexp.MustCompile(`(?i)\bCOM\d+\b`)

func readMobaFile(p string) []Session {
	raw, err := os.ReadFile(p)
	if err != nil {
		return nil
	}
	var out []Session
	inBookmarks, folder := false, ""
	sc := bufio.NewScanner(bytes.NewReader(raw))
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		line := strings.TrimRight(sc.Text(), "\r")
		if strings.HasPrefix(line, "[") {
			inBookmarks = strings.HasPrefix(line, "[Bookmarks")
			folder = ""
			continue
		}
		if !inBookmarks {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		if key == "SubRep" {
			folder = strings.ReplaceAll(val, `\`, "/")
			continue
		}
		val = strings.TrimSpace(val)
		if !strings.HasPrefix(val, "#") {
			continue
		}
		parts := strings.Split(val, "#") // "", type, "kind%host%port%user%..."
		if len(parts) < 3 {
			continue
		}
		f := strings.Split(parts[2], "%")
		at := func(i int) string {
			if i < len(f) {
				return strings.TrimSpace(f[i])
			}
			return ""
		}
		s := Session{Name: strings.TrimSpace(key), Folder: folder}
		switch parts[1] {
		case "109": // SSH
			s.Kind, s.Host, s.User = "ssh", at(1), at(3)
			s.Port, _ = strconv.Atoi(at(2))
		case "98": // Telnet
			s.Kind, s.Host, s.User = "telnet", at(1), at(3)
			s.Port, _ = strconv.Atoi(at(2))
		case "131": // Serial
			s.Kind, s.ComPort = "serial", comRe.FindString(parts[2])
			s.Baud, _ = strconv.Atoi(at(2))
			if s.ComPort == "" {
				continue
			}
		default:
			continue // RDP, VNC, FTP… are not supported
		}
		if s.Kind != "serial" && s.Host == "" {
			continue
		}
		out = append(out, s)
	}
	return out
}

// ---------- PuTTY: registry ----------

func readPuTTY(key string) []Session {
	k, err := registry.OpenKey(registry.CURRENT_USER, key, registry.ENUMERATE_SUB_KEYS)
	if err != nil {
		return nil
	}
	defer k.Close()
	names, _ := k.ReadSubKeyNames(-1)
	var out []Session
	for _, n := range names {
		sk, err := registry.OpenKey(k, n, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		str := func(v string) string { s, _, _ := sk.GetStringValue(v); return s }
		num := func(v string) int { d, _, _ := sk.GetIntegerValue(v); return int(d) }
		name, _ := url.PathUnescape(n)
		s := Session{Name: name}
		switch str("Protocol") {
		case "ssh", "":
			s.Kind = "ssh"
		case "telnet":
			s.Kind = "telnet"
		case "serial":
			s.Kind, s.ComPort, s.Baud = "serial", str("SerialLine"), num("SerialSpeed")
		default:
			sk.Close()
			continue
		}
		if s.Kind != "serial" {
			s.Host, s.Port, s.User = str("HostName"), num("PortNumber"), str("UserName")
			if s.Host == "" {
				sk.Close()
				continue
			}
		} else if s.ComPort == "" {
			sk.Close()
			continue
		}
		sk.Close()
		out = append(out, s)
	}
	return out
}

// ---------- SecureCRT: one .ini per session, folders are directories ----------

func readSecureCRT(root string) []Session {
	var out []Session
	_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.EqualFold(filepath.Ext(p), ".ini") {
			return nil
		}
		base := filepath.Base(p)
		if strings.HasPrefix(base, "__") || strings.EqualFold(base, "Default.ini") {
			return nil
		}
		if s, ok := parseCRT(p); ok {
			if rel, err := filepath.Rel(root, filepath.Dir(p)); err == nil && rel != "." {
				s.Folder = filepath.ToSlash(rel)
			}
			out = append(out, s)
		}
		return nil
	})
	return out
}

// crtLine matches lines like S:"Hostname"=10.0.0.1 or D:"[SSH2] Port"=00000016.
var crtLine = regexp.MustCompile(`^([SD]):"([^"]+)"=(.*)$`)

func parseCRT(p string) (Session, bool) {
	vals := map[string]string{}
	for _, line := range strings.Split(readText(p), "\n") {
		if m := crtLine.FindStringSubmatch(strings.TrimSpace(line)); m != nil {
			v := strings.TrimSpace(m[3])
			if m[1] == "D" { // DWORDs are hex
				if n, err := strconv.ParseUint(v, 16, 32); err == nil {
					v = strconv.FormatUint(n, 10)
				}
			}
			vals[m[2]] = v
		}
	}
	s := Session{Name: strings.TrimSuffix(filepath.Base(p), filepath.Ext(p))}
	num := func(k string) int { n, _ := strconv.Atoi(vals[k]); return n }
	switch strings.ToLower(vals["Protocol Name"]) {
	case "ssh2", "ssh1":
		s.Kind, s.Port = "ssh", num("[SSH2] Port")
	case "telnet":
		s.Kind, s.Port = "telnet", num("Port")
	case "serial":
		s.Kind, s.ComPort, s.Baud = "serial", vals["Com Port"], num("Baud Rate")
		return s, s.ComPort != ""
	default:
		return s, false
	}
	s.Host, s.User = vals["Hostname"], vals["Username"]
	return s, s.Host != ""
}

// ---------- Xshell: one .xsh (ini, often UTF-16) per session ----------

func readXshell(root string) []Session {
	var out []Session
	_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.EqualFold(filepath.Ext(p), ".xsh") {
			return nil
		}
		if s, ok := parseXsh(p); ok {
			if rel, err := filepath.Rel(root, filepath.Dir(p)); err == nil && rel != "." {
				s.Folder = filepath.ToSlash(rel)
			}
			out = append(out, s)
		}
		return nil
	})
	return out
}

func parseXsh(p string) (Session, bool) {
	sec, vals := "", map[string]string{}
	for _, line := range strings.Split(readText(p), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			sec = strings.ToUpper(line[1 : len(line)-1])
			continue
		}
		if k, v, ok := strings.Cut(line, "="); ok {
			vals[sec+"."+k] = v
		}
	}
	s := Session{Name: strings.TrimSuffix(filepath.Base(p), filepath.Ext(p))}
	switch strings.ToUpper(vals["CONNECTION.Protocol"]) {
	case "SSH", "":
		s.Kind = "ssh"
	case "TELNET":
		s.Kind = "telnet"
	default:
		return s, false
	}
	s.Host = vals["CONNECTION.Host"]
	s.Port, _ = strconv.Atoi(vals["CONNECTION.Port"])
	s.User = vals["CONNECTION:AUTHENTICATION.UserName"]
	return s, s.Host != ""
}

// readText decodes UTF-8 (with or without BOM) or UTF-16LE files.
func readText(p string) string {
	raw, err := os.ReadFile(p)
	if err != nil {
		return ""
	}
	if len(raw) >= 2 && raw[0] == 0xFF && raw[1] == 0xFE {
		u := make([]uint16, (len(raw)-2)/2)
		for i := range u {
			u[i] = uint16(raw[2+2*i]) | uint16(raw[3+2*i])<<8
		}
		return strings.ReplaceAll(string(utf16.Decode(u)), "\r", "")
	}
	return strings.ReplaceAll(strings.TrimPrefix(string(raw), "\xef\xbb\xbf"), "\r", "")
}
