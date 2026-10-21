package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/scrypt"
)

// Backup file: sessions, folders, macros and (optionally) UI preferences as
// JSON. Saved passwords and hidden logon values are only included when the
// user sets a backup passphrase; they are then encrypted with scrypt +
// AES-256-GCM so the file can be restored on another PC.

type backupFile struct {
	App      string        `json:"app"`
	Format   int           `json:"format"`
	Exported string        `json:"exported"`
	Version  string        `json:"version"`
	Sessions []Session     `json:"sessions"`
	Folders  []string      `json:"folders,omitempty"`
	Macros   []Macro       `json:"macros,omitempty"`
	UIPrefs  string        `json:"uiPrefs,omitempty"`
	Secrets  *sealedSecret `json:"secrets,omitempty"`
}

type sealedSecret struct {
	KDF   string `json:"kdf"` // scrypt N=32768 r=8 p=1
	Salt  string `json:"salt"`
	Nonce string `json:"nonce"`
	Data  string `json:"data"`
}

// sessionSecrets: per session ID, its password and hidden logon values by step ID.
type sessionSecrets map[string]struct {
	Password string            `json:"password,omitempty"`
	Steps    map[string]string `json:"steps,omitempty"`
}

func backupKey(pass string, salt []byte) ([]byte, error) {
	return scrypt.Key([]byte(pass), salt, 1<<15, 8, 1, 32)
}

func seal(pass string, plain []byte) (*sealedSecret, error) {
	salt := make([]byte, 16)
	nonce := make([]byte, 12)
	_, _ = rand.Read(salt)
	_, _ = rand.Read(nonce)
	key, err := backupKey(pass, salt)
	if err != nil {
		return nil, err
	}
	blk, _ := aes.NewCipher(key)
	gcm, _ := cipher.NewGCM(blk)
	enc := base64.StdEncoding.EncodeToString
	return &sealedSecret{KDF: "scrypt", Salt: enc(salt), Nonce: enc(nonce), Data: enc(gcm.Seal(nil, nonce, plain, nil))}, nil
}

func open(pass string, s *sealedSecret) ([]byte, error) {
	dec := base64.StdEncoding.DecodeString
	salt, err1 := dec(s.Salt)
	nonce, err2 := dec(s.Nonce)
	data, err3 := dec(s.Data)
	if err := errors.Join(err1, err2, err3); err != nil {
		return nil, err
	}
	key, err := backupKey(pass, salt)
	if err != nil {
		return nil, err
	}
	blk, _ := aes.NewCipher(key)
	gcm, _ := cipher.NewGCM(blk)
	plain, err := gcm.Open(nil, nonce, data, nil)
	if err != nil {
		return nil, errors.New("BAD_PASSPHRASE")
	}
	return plain, nil
}

// ExportBackup asks where to save and writes the backup. An empty passphrase
// leaves passwords out. Returns the path ("" if the user cancelled).
func (a *App) ExportBackup(passphrase string, includePrefs bool) (string, error) {
	p, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           T("dlg.backupSave"),
		DefaultFilename: "Hopline-backup-" + time.Now().Format("20060102") + ".json",
		Filters:         []runtime.FileFilter{{DisplayName: "Hopline backup (*.json)", Pattern: "*.json"}},
	})
	if err != nil || p == "" {
		return "", err
	}
	if !strings.HasSuffix(strings.ToLower(p), ".json") {
		p += ".json"
	}
	return p, a.writeBackup(p, passphrase, includePrefs)
}

func (a *App) writeBackup(p, passphrase string, includePrefs bool) error {
	var err error
	f := backupFile{App: "Hopline", Format: 1, Exported: time.Now().Format(time.RFC3339), Version: appVersion,
		Sessions: forUI(a.store.Sessions()), Folders: a.store.Folders(), Macros: a.store.Macros()}
	if includePrefs {
		f.UIPrefs = a.store.Settings().UIPrefs
	}
	if passphrase != "" {
		secrets := sessionSecrets{}
		for _, s := range a.store.Sessions() {
			e := secrets[s.ID]
			if s.HasPassword {
				if pw, err := a.store.Password(s.ID); err == nil {
					e.Password = pw
				}
			}
			for _, st := range s.LogonSteps {
				if st.Secret != "" {
					if v, err := decryptString(st.Secret); err == nil {
						if e.Steps == nil {
							e.Steps = map[string]string{}
						}
						e.Steps[st.ID] = v
					}
				}
			}
			if e.Password != "" || len(e.Steps) > 0 {
				secrets[s.ID] = e
			}
		}
		plain, _ := json.Marshal(secrets)
		if f.Secrets, err = seal(passphrase, plain); err != nil {
			return err
		}
	}
	raw, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, raw, 0o600)
}

// BackupInfo summarises a backup file before restoring it.
type BackupInfo struct {
	Path       string `json:"path"`
	Exported   string `json:"exported"`
	Sessions   int    `json:"sessions"`
	Macros     int    `json:"macros"`
	HasSecrets bool   `json:"hasSecrets"`
	HasPrefs   bool   `json:"hasPrefs"`
}

func readBackup(p string) (backupFile, error) {
	var f backupFile
	raw, err := os.ReadFile(p)
	if err != nil {
		return f, err
	}
	if err := json.Unmarshal(raw, &f); err != nil || f.App != "Hopline" {
		return f, errors.New(T("err.notBackup"))
	}
	return f, nil
}

// OpenBackup lets the user pick a backup file and reports what it holds.
func (a *App) OpenBackup() (BackupInfo, error) {
	p, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   T("dlg.backupOpen"),
		Filters: []runtime.FileFilter{{DisplayName: "Hopline backup (*.json)", Pattern: "*.json"}},
	})
	if err != nil || p == "" {
		return BackupInfo{}, err
	}
	f, err := readBackup(p)
	if err != nil {
		return BackupInfo{}, err
	}
	return BackupInfo{Path: p, Exported: f.Exported, Sessions: len(f.Sessions), Macros: len(f.Macros),
		HasSecrets: f.Secrets != nil, HasPrefs: f.UIPrefs != ""}, nil
}

type RestoreResult struct {
	Added     int  `json:"added"`
	Skipped   int  `json:"skipped"`
	Macros    int  `json:"macros"`
	Passwords int  `json:"passwords"`
	Prefs     bool `json:"prefs"`
}

// RestoreBackup merges a backup into this PC's data: new sessions are added
// (ones already present are skipped), macros with new names are added, and
// preferences are replaced only when withPrefs is set.
func (a *App) RestoreBackup(p, passphrase string, withPrefs bool) (RestoreResult, error) {
	var res RestoreResult
	f, err := readBackup(p)
	if err != nil {
		return res, err
	}
	secrets := sessionSecrets{}
	if f.Secrets != nil && passphrase != "" {
		plain, err := open(passphrase, f.Secrets)
		if err != nil {
			return res, err
		}
		if err := json.Unmarshal(plain, &secrets); err != nil {
			return res, err
		}
	}
	for _, fd := range f.Folders {
		_ = a.store.AddFolder(fd)
	}
	existing := a.store.Sessions()
	for _, s := range f.Sessions {
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
		sec := secrets[s.ID]
		steps := make([]LogonStep, len(s.LogonSteps))
		for i, st := range s.LogonSteps {
			st.Secret, st.HasSecret = "", false
			if v, ok := sec.Steps[st.ID]; ok && st.Hide {
				st.Send = v // re-encrypted for this PC by mergeSteps
			}
			st.ID = ""
			steps[i] = st
		}
		s.LogonSteps = steps
		s.ID, s.Password, s.HasPassword = "", "", false
		saved, err := a.store.Put(s, sec.Password, sec.Password != "")
		if err != nil {
			return res, err
		}
		if sec.Password != "" {
			res.Passwords++
		}
		existing = append(existing, saved)
		res.Added++
	}
	have := map[string]bool{}
	for _, m := range a.store.Macros() {
		have[m.Name] = true
	}
	for _, m := range f.Macros {
		if have[m.Name] {
			continue
		}
		m.ID = ""
		if _, err := a.store.PutMacro(m); err != nil {
			return res, err
		}
		res.Macros++
	}
	if withPrefs && f.UIPrefs != "" {
		if err := a.SaveUIPrefs(f.UIPrefs); err != nil {
			return res, err
		}
		res.Prefs = true
	}
	return res, nil
}
