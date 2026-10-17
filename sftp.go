package main

import (
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/pkg/sftp"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type FileEntry struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	Mode    string `json:"mode"`
	ModTime int64  `json:"modTime"`
	IsDir   bool   `json:"isDir"`
	IsLink  bool   `json:"isLink"`
}

type DirListing struct {
	Path    string      `json:"path"`
	Entries []FileEntry `json:"entries"`
}

type transferProgress struct {
	ConnID string `json:"connId"`
	Name   string `json:"name"`
	Done   int64  `json:"done"`
	Total  int64  `json:"total"`
	Finish bool   `json:"finish"`
	Error  string `json:"error,omitempty"`
}

func (a *App) sftpFor(connID string) (*sftp.Client, error) {
	lc := a.get(connID)
	if lc == nil {
		return nil, errors.New("연결되지 않음")
	}
	if lc.ssh == nil {
		return nil, errors.New("SSH 세션이 아닙니다")
	}
	return lc.ssh.sftpClient()
}

// SftpList lists a remote directory; an empty path means the login directory.
func (a *App) SftpList(connID, dir string) (DirListing, error) {
	cl, err := a.sftpFor(connID)
	if err != nil {
		return DirListing{}, err
	}
	if dir == "" {
		if dir, err = cl.Getwd(); err != nil {
			dir = "/"
		}
	}
	if real, err := cl.RealPath(dir); err == nil {
		dir = real
	}
	infos, err := cl.ReadDir(dir)
	if err != nil {
		return DirListing{}, err
	}
	out := DirListing{Path: dir, Entries: make([]FileEntry, 0, len(infos))}
	for _, fi := range infos {
		e := FileEntry{Name: fi.Name(), Size: fi.Size(), Mode: fi.Mode().String(), ModTime: fi.ModTime().Unix(), IsDir: fi.IsDir()}
		if fi.Mode()&os.ModeSymlink != 0 {
			e.IsLink = true
			if st, err := cl.Stat(path.Join(dir, fi.Name())); err == nil {
				e.IsDir = st.IsDir()
			}
		}
		out.Entries = append(out.Entries, e)
	}
	sort.Slice(out.Entries, func(i, j int) bool {
		x, y := out.Entries[i], out.Entries[j]
		if x.IsDir != y.IsDir {
			return x.IsDir
		}
		return strings.ToLower(x.Name) < strings.ToLower(y.Name)
	})
	return out, nil
}

func (a *App) SftpMkdir(connID, p string) error {
	cl, err := a.sftpFor(connID)
	if err != nil {
		return err
	}
	return cl.Mkdir(p)
}

func (a *App) SftpRename(connID, from, to string) error {
	cl, err := a.sftpFor(connID)
	if err != nil {
		return err
	}
	return cl.Rename(from, to)
}

// SftpRemove deletes a file or an empty directory (no recursive delete by design).
func (a *App) SftpRemove(connID, p string, isDir bool) error {
	cl, err := a.sftpFor(connID)
	if err != nil {
		return err
	}
	if isDir {
		return cl.RemoveDirectory(p)
	}
	return cl.Remove(p)
}

// SftpDownload asks where to save, then copies the remote file in the background.
func (a *App) SftpDownload(connID, remote string) error {
	cl, err := a.sftpFor(connID)
	if err != nil {
		return err
	}
	local, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "다운로드 위치",
		DefaultFilename: path.Base(remote),
	})
	if err != nil || local == "" {
		return err
	}
	go func() {
		name := path.Base(remote)
		err := a.download(cl, connID, remote, local)
		a.progress(transferProgress{ConnID: connID, Name: name, Finish: true, Error: errStr(err)})
	}()
	return nil
}

func (a *App) download(cl *sftp.Client, connID, remote, local string) error {
	src, err := cl.Open(remote)
	if err != nil {
		return err
	}
	defer src.Close()
	st, _ := src.Stat()
	dst, err := os.Create(local)
	if err != nil {
		return err
	}
	defer dst.Close()
	var total int64
	if st != nil {
		total = st.Size()
	}
	_, err = io.Copy(dst, &progressReader{r: src, fn: func(n int64) {
		a.progress(transferProgress{ConnID: connID, Name: path.Base(remote), Done: n, Total: total})
	}})
	return err
}

// SftpUploadDialog picks local files and uploads them into remoteDir.
func (a *App) SftpUploadDialog(connID, remoteDir string) error {
	files, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{Title: "업로드할 파일"})
	if err != nil || len(files) == 0 {
		return err
	}
	return a.SftpUploadPaths(connID, remoteDir, files)
}

// SftpUploadPaths uploads local files/folders (e.g. dropped from Explorer).
func (a *App) SftpUploadPaths(connID, remoteDir string, locals []string) error {
	cl, err := a.sftpFor(connID)
	if err != nil {
		return err
	}
	go func() {
		for _, l := range locals {
			base := filepath.Base(l)
			err := filepath.Walk(l, func(p string, fi os.FileInfo, err error) error {
				if err != nil {
					return err
				}
				rel, _ := filepath.Rel(filepath.Dir(l), p)
				target := path.Join(remoteDir, filepath.ToSlash(rel))
				if fi.IsDir() {
					if err := cl.MkdirAll(target); err != nil {
						return err
					}
					return nil
				}
				return a.upload(cl, connID, p, target, fi.Size())
			})
			a.progress(transferProgress{ConnID: connID, Name: base, Finish: true, Error: errStr(err)})
		}
	}()
	return nil
}

func (a *App) upload(cl *sftp.Client, connID, local, remote string, size int64) error {
	src, err := os.Open(local)
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := cl.Create(remote)
	if err != nil {
		return err
	}
	defer dst.Close()
	_, err = io.Copy(dst, &progressReader{r: src, fn: func(n int64) {
		a.progress(transferProgress{ConnID: connID, Name: filepath.Base(local), Done: n, Total: size})
	}})
	return err
}

func (a *App) progress(p transferProgress) { runtime.EventsEmit(a.ctx, "sftp:progress", p) }

func errStr(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// progressReader reports cumulative bytes, throttled to ~every 256KB.
type progressReader struct {
	r       io.Reader
	n, last int64
	fn      func(int64)
}

func (p *progressReader) Read(b []byte) (int, error) {
	n, err := p.r.Read(b)
	p.n += int64(n)
	if p.n-p.last >= 256<<10 || err == io.EOF {
		p.last = p.n
		p.fn(p.n)
	}
	return n, err
}
