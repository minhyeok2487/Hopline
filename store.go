package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"
)

// Session is a saved connection profile.
type Session struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Folder string `json:"folder"`
	Kind   string `json:"kind"` // "ssh" | "serial"

	// SSH
	Host        string `json:"host"`
	Port        int    `json:"port"`
	User        string `json:"user"`
	KeyPath     string `json:"keyPath"`
	Legacy      bool   `json:"legacy"` // allow old kex/ciphers for network gear
	Password    string `json:"-"`      // DPAPI-encrypted, base64; never sent to the UI
	HasPassword bool   `json:"hasPassword"`

	// Serial
	ComPort  string `json:"comPort"`
	Baud     int    `json:"baud"`
	DataBits int    `json:"dataBits"`
	Parity   string `json:"parity"`   // N | E | O
	StopBits string `json:"stopBits"` // 1 | 2
}

// Macro is a named list of commands sent line by line.
type Macro struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Body    string `json:"body"`
	DelayMs int    `json:"delayMs"`
}

type storedSession struct {
	Session
	EncPassword string `json:"encPassword,omitempty"`
}

// Settings holds app-wide options.
type Settings struct {
	MCPEnabled bool   `json:"mcpEnabled"`
	MCPPort    int    `json:"mcpPort"`
	MCPToken   string `json:"mcpToken"`
	UIPrefs    string `json:"uiPrefs,omitempty"`
}

type storeFile struct {
	Sessions []storedSession `json:"sessions"`
	Macros   []Macro         `json:"macros"`
	Settings Settings        `json:"settings"`
}

// Store persists sessions and macros to %APPDATA%\Hopline\data.json.
type Store struct {
	mu       sync.Mutex
	dir      string
	sessions []Session
	macros   []Macro
	settings Settings
}

func appDir() string {
	base, err := os.UserConfigDir()
	if err != nil {
		base = "."
	}
	dir := filepath.Join(base, "Hopline")
	_ = os.MkdirAll(dir, 0o700)
	return dir
}

// logsDir is Documents\Hopline\logs.
func logsDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Documents", "Hopline", "logs")
}

func NewStore() *Store {
	s := &Store{dir: appDir()}
	s.load()
	return s
}

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *Store) path() string { return filepath.Join(s.dir, "data.json") }

func (s *Store) load() {
	raw, err := os.ReadFile(s.path())
	if err != nil {
		return
	}
	var f storeFile
	if json.Unmarshal(raw, &f) != nil {
		return
	}
	for _, ss := range f.Sessions {
		ss.Session.Password = ss.EncPassword
		ss.Session.HasPassword = ss.EncPassword != ""
		s.sessions = append(s.sessions, ss.Session)
	}
	s.macros = f.Macros
	s.settings = f.Settings
}

// saveLocked writes atomically; caller holds s.mu.
func (s *Store) saveLocked() error {
	f := storeFile{Macros: s.macros, Settings: s.settings}
	for _, ss := range s.sessions {
		f.Sessions = append(f.Sessions, storedSession{Session: ss, EncPassword: ss.Password})
	}
	raw, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path() + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path())
}

func (s *Store) Sessions() []Session {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Session, len(s.sessions))
	copy(out, s.sessions)
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Folder != out[j].Folder {
			return out[i].Folder < out[j].Folder
		}
		return out[i].Name < out[j].Name
	})
	return out
}

func (s *Store) Get(id string) (Session, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, ss := range s.sessions {
		if ss.ID == id {
			return ss, true
		}
	}
	return Session{}, false
}

// Put inserts or updates a session. password: "" keeps the stored one when
// savePassword is true; savePassword=false clears it.
func (s *Store) Put(in Session, password string, savePassword bool) (Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	idx := -1
	for i, ss := range s.sessions {
		if in.ID != "" && ss.ID == in.ID {
			idx = i
		}
	}
	if idx >= 0 {
		in.Password = s.sessions[idx].Password
	} else {
		in.ID = newID()
		in.Password = ""
	}
	if !savePassword {
		in.Password = ""
	} else if password != "" {
		enc, err := protect([]byte(password))
		if err != nil {
			return Session{}, err
		}
		in.Password = base64.StdEncoding.EncodeToString(enc)
	}
	in.HasPassword = in.Password != ""
	if idx >= 0 {
		s.sessions[idx] = in
	} else {
		s.sessions = append(s.sessions, in)
	}
	return in, s.saveLocked()
}

func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, ss := range s.sessions {
		if ss.ID == id {
			s.sessions = append(s.sessions[:i], s.sessions[i+1:]...)
			return s.saveLocked()
		}
	}
	return errors.New("session not found")
}

// Password returns the decrypted stored password ("" if none).
func (s *Store) Password(id string) (string, error) {
	ss, ok := s.Get(id)
	if !ok || ss.Password == "" {
		return "", nil
	}
	enc, err := base64.StdEncoding.DecodeString(ss.Password)
	if err != nil {
		return "", err
	}
	pw, err := unprotect(enc)
	return string(pw), err
}

func (s *Store) Macros() []Macro {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Macro, len(s.macros))
	copy(out, s.macros)
	return out
}

func (s *Store) PutMacro(m Macro) (Macro, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if m.ID == "" {
		m.ID = newID()
		s.macros = append(s.macros, m)
	} else {
		found := false
		for i := range s.macros {
			if s.macros[i].ID == m.ID {
				s.macros[i] = m
				found = true
			}
		}
		if !found {
			s.macros = append(s.macros, m)
		}
	}
	return m, s.saveLocked()
}

func (s *Store) DeleteMacro(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, m := range s.macros {
		if m.ID == id {
			s.macros = append(s.macros[:i], s.macros[i+1:]...)
			return s.saveLocked()
		}
	}
	return nil
}

func (s *Store) Settings() Settings {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.settings
}

func (s *Store) PutSettings(v Settings) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.settings = v
	return s.saveLocked()
}
