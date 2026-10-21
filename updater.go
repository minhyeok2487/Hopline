package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/sys/windows"
)

// appVersion is bumped with every release (and can be overridden with
// -ldflags "-X main.appVersion=..." for testing the updater).
var appVersion = "0.7.0"

const releasesAPI = "https://api.github.com/repos/minhyeok2487/Hopline/releases/latest"

// UpdateInfo describes the latest release compared with this build.
type UpdateInfo struct {
	Available bool   `json:"available"`
	Current   string `json:"current"`
	Latest    string `json:"latest"`
	Page      string `json:"page"`              // release page
	Size      int64  `json:"size"`              // bytes of the executable
	Notes     string `json:"notes"`             // release notes (markdown)
	Managed   string `json:"managed,omitempty"` // "scoop" when Scoop owns the install

	url    string
	sha256 string
}

var assetRe = regexp.MustCompile(`(?i)^Hopline(-[\w.]+)?\.exe$`)
var hashRe = regexp.MustCompile(`\b[0-9a-f]{64}\b`)

// newer reports whether version a (like "v1.2.3") is higher than b.
func newer(a, b string) bool {
	pa, pb := versionParts(a), versionParts(b)
	for i := 0; i < 3; i++ {
		if pa[i] != pb[i] {
			return pa[i] > pb[i]
		}
	}
	return false
}

func versionParts(v string) [3]int {
	var out [3]int
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	if i := strings.IndexAny(v, "-+ "); i >= 0 {
		v = v[:i]
	}
	for i, p := range strings.SplitN(v, ".", 3) {
		out[i], _ = strconv.Atoi(p)
	}
	return out
}

func (a *App) GetVersion() string { return appVersion }

// CheckUpdate asks GitHub for the latest release.
func (a *App) CheckUpdate() (UpdateInfo, error) {
	info := UpdateInfo{Current: appVersion}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, releasesAPI, nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "Hopline/"+appVersion)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return info, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return info, fmt.Errorf("GitHub: %s", res.Status)
	}
	var rel struct {
		Tag    string `json:"tag_name"`
		Page   string `json:"html_url"`
		Body   string `json:"body"`
		Assets []struct {
			Name   string `json:"name"`
			Size   int64  `json:"size"`
			URL    string `json:"browser_download_url"`
			Digest string `json:"digest"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(res.Body).Decode(&rel); err != nil {
		return info, err
	}
	info.Latest = strings.TrimPrefix(rel.Tag, "v")
	info.Page = rel.Page
	info.Notes = rel.Body
	for _, as := range rel.Assets {
		if assetRe.MatchString(as.Name) {
			info.url, info.Size = as.URL, as.Size
			info.sha256 = strings.TrimPrefix(as.Digest, "sha256:")
			if info.sha256 == "" { // older releases: the hash is in the notes
				info.sha256 = hashRe.FindString(rel.Body)
			}
		}
	}
	info.Available = info.url != "" && newer(info.Latest, appVersion)
	if exe, err := os.Executable(); err == nil && strings.Contains(strings.ToLower(exe), `\scoop\apps\`) {
		info.Managed = "scoop"
	}
	a.updMu.Lock()
	a.update = info
	a.updMu.Unlock()
	return info, nil
}

// SkipUpdate stops offering this version automatically.
func (a *App) SkipUpdate(version string) error {
	st := a.store.Settings()
	st.SkipVersion = version
	return a.store.PutSettings(st)
}

func (a *App) GetUpdateCheck() bool {
	st := a.store.Settings()
	return st.UpdateCheck == nil || *st.UpdateCheck
}

func (a *App) SetUpdateCheck(on bool) error {
	st := a.store.Settings()
	st.UpdateCheck = &on
	return a.store.PutSettings(st)
}

// watchUpdates checks shortly after start and then twice a day.
func (a *App) watchUpdates() {
	time.Sleep(8 * time.Second)
	for {
		if a.GetUpdateCheck() {
			if info, err := a.CheckUpdate(); err == nil && info.Available && info.Latest != a.store.Settings().SkipVersion {
				runtime.EventsEmit(a.ctx, "update:available", info)
			}
		}
		time.Sleep(12 * time.Hour)
	}
}

type progressWriter struct {
	a           *App
	done, total int64
	last        time.Time
}

func (p *progressWriter) Write(b []byte) (int, error) {
	p.done += int64(len(b))
	if time.Since(p.last) > 100*time.Millisecond || p.done == p.total {
		p.last = time.Now()
		runtime.EventsEmit(p.a.ctx, "update:progress", map[string]int64{"done": p.done, "total": p.total})
	}
	return len(b), nil
}

// ApplyUpdate downloads the latest executable, checks its SHA-256, swaps it in
// place of the running one and restarts Hopline. Errors starting with an
// upper-case code (SCOOP, NOT_WRITABLE) tell the UI to offer another way.
func (a *App) ApplyUpdate() error {
	a.updMu.Lock()
	info := a.update
	a.updMu.Unlock()
	if !info.Available {
		return errors.New("no update available")
	}
	if info.Managed == "scoop" {
		return errors.New("SCOOP")
	}
	if len(info.sha256) != 64 {
		return errors.New("the release has no SHA-256 to verify the download")
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if p, err := filepath.EvalSymlinks(exe); err == nil {
		exe = p
	}
	tmp := filepath.Join(filepath.Dir(exe), ".Hopline-update.tmp")
	f, err := os.Create(tmp)
	if err != nil {
		return errors.New("NOT_WRITABLE")
	}
	ok := false
	defer func() {
		if !ok {
			_ = os.Remove(tmp)
		}
	}()
	res, err := http.Get(info.url)
	if err != nil {
		f.Close()
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		f.Close()
		return fmt.Errorf("download: %s", res.Status)
	}
	h := sha256.New()
	_, err = io.Copy(io.MultiWriter(f, h, &progressWriter{a: a, total: res.ContentLength}), res.Body)
	f.Close()
	if err != nil {
		return err
	}
	if got := hex.EncodeToString(h.Sum(nil)); !strings.EqualFold(got, info.sha256) {
		return fmt.Errorf("checksum mismatch (got %s, expected %s)", got, info.sha256)
	}
	// A running .exe can't be overwritten on Windows, but it can be renamed.
	old := exe + ".old"
	_ = os.Remove(old)
	if err := os.Rename(exe, old); err != nil {
		return errors.New("NOT_WRITABLE")
	}
	if err := os.Rename(tmp, exe); err != nil {
		_ = os.Rename(old, exe)
		return err
	}
	ok = true
	// Start the new version only after this process has exited: it holds the
	// single-instance lock, and the new build may not know --updated-from.
	cmd := exec.Command("cmd.exe")
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CmdLine:       fmt.Sprintf(`cmd.exe /d /c ping -n 3 127.0.0.1 >nul & start "" "%s" --updated-from=%d`, exe, os.Getpid()),
		HideWindow:    true,
		CreationFlags: 0x08000000 | 0x00000200, // CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	a.quitting.Store(true)
	go func() {
		time.Sleep(300 * time.Millisecond)
		runtime.Quit(a.ctx)
	}()
	return nil
}

// updatedFrom handles "--updated-from=PID" before the app starts: wait for the
// old process (it holds the single-instance lock) and remove its renamed file.
// It reports whether this start follows an update.
func updatedFrom() bool {
	pid := 0
	for _, arg := range os.Args[1:] {
		if v, found := strings.CutPrefix(arg, "--updated-from="); found {
			pid, _ = strconv.Atoi(v)
		}
	}
	if pid > 0 {
		if h, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid)); err == nil {
			_, _ = windows.WaitForSingleObject(h, 20000)
			_ = windows.CloseHandle(h)
		}
	}
	if exe, err := os.Executable(); err == nil {
		for i := 0; i < 10; i++ { // the old process may need a moment to release the file
			if err := os.Remove(exe + ".old"); err == nil || os.IsNotExist(err) {
				break
			}
			time.Sleep(300 * time.Millisecond)
		}
	}
	return pid > 0
}

// WasUpdated lets the UI greet the user after an update.
func (a *App) WasUpdated() bool { return a.justUpdated }
