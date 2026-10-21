package main

import (
	"errors"
	"sort"
	"strings"
)

// Session folders are paths like "HQ/Server room" stored in Session.Folder.
// Store.folders keeps folders that exist even while they hold no sessions.

// cleanFolder normalises a folder path: trimmed segments joined by "/".
func cleanFolder(p string) string {
	var parts []string
	for _, s := range strings.Split(strings.ReplaceAll(p, "\\", "/"), "/") {
		if s = strings.TrimSpace(s); s != "" {
			parts = append(parts, s)
		}
	}
	return strings.Join(parts, "/")
}

// inFolder reports whether path is dir or below it.
func inFolder(path, dir string) bool {
	return path == dir || strings.HasPrefix(path, dir+"/")
}

func parentFolder(p string) string {
	if i := strings.LastIndex(p, "/"); i >= 0 {
		return p[:i]
	}
	return ""
}

// Folders lists every folder path, including the parents of nested folders.
func (s *Store) Folders() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	set := map[string]bool{}
	add := func(p string) {
		for p = cleanFolder(p); p != ""; p = parentFolder(p) {
			set[p] = true
		}
	}
	for _, f := range s.folders {
		add(f)
	}
	for _, ss := range s.sessions {
		add(ss.Folder)
	}
	out := make([]string, 0, len(set))
	for p := range set {
		out = append(out, p)
	}
	sort.Strings(out)
	return out
}

// keepFolderLocked remembers a folder so it stays after its last session or
// subfolder moves out. Caller holds s.mu.
func (s *Store) keepFolderLocked(p string) {
	if p = cleanFolder(p); p == "" {
		return
	}
	for _, f := range s.folders {
		if f == p {
			return
		}
	}
	s.folders = append(s.folders, p)
}

func (s *Store) AddFolder(p string) error {
	p = cleanFolder(p)
	if p == "" {
		return errors.New("empty folder name")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, f := range s.folders {
		if f == p {
			return nil
		}
	}
	s.folders = append(s.folders, p)
	return s.saveLocked()
}

// RenameFolder moves a folder (and everything below it) to a new path.
func (s *Store) RenameFolder(from, to string) error {
	from, to = cleanFolder(from), cleanFolder(to)
	if from == "" || to == "" {
		return errors.New("empty folder name")
	}
	if inFolder(to, from) {
		return errors.New("a folder can't be moved into itself")
	}
	move := func(p string) string {
		if inFolder(p, from) {
			return to + p[len(from):]
		}
		return p
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.keepFolderLocked(parentFolder(from))
	for i := range s.sessions {
		s.sessions[i].Folder = move(cleanFolder(s.sessions[i].Folder))
	}
	for i := range s.folders {
		s.folders[i] = move(s.folders[i])
	}
	s.folders = append(s.folders, to) // keep it even if it holds no sessions
	return s.saveLocked()
}

// DeleteFolder removes a folder; its sessions and subfolders move up one level.
func (s *Store) DeleteFolder(p string) error {
	p = cleanFolder(p)
	if p == "" {
		return errors.New("empty folder name")
	}
	up := parentFolder(p)
	lift := func(f string) string {
		if !inFolder(f, p) {
			return f
		}
		rest := strings.TrimPrefix(f[len(p):], "/")
		return cleanFolder(up + "/" + rest)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.sessions {
		s.sessions[i].Folder = lift(cleanFolder(s.sessions[i].Folder))
	}
	kept := s.folders[:0]
	for _, f := range s.folders {
		if f == p {
			continue
		}
		if f = lift(f); f != "" {
			kept = append(kept, f)
		}
	}
	s.folders = kept
	return s.saveLocked()
}

func (s *Store) MoveSession(id, folder string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.sessions {
		if s.sessions[i].ID == id {
			s.keepFolderLocked(s.sessions[i].Folder)
			s.sessions[i].Folder = cleanFolder(folder)
			return s.saveLocked()
		}
	}
	return errors.New("session not found")
}

// ---------- bound to the UI ----------

func (a *App) ListFolders() []string              { return a.store.Folders() }
func (a *App) CreateFolder(path string) error     { return a.store.AddFolder(path) }
func (a *App) RenameFolder(from, to string) error { return a.store.RenameFolder(from, to) }
func (a *App) DeleteFolder(path string) error     { return a.store.DeleteFolder(path) }
func (a *App) MoveSession(id, folder string) error {
	return a.store.MoveSession(id, folder)
}
