package main

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

// When a host's SSH key no longer matches known_hosts, the connection is
// refused and the UI shows both fingerprints. If the user trusts the new key
// (the device was reinstalled or replaced), only that host's old lines are
// replaced.

const hostKeyChangedPrefix = "HOSTKEY_CHANGED "

// hostKeyChange is what the UI shows; the rest stays in the backend until the
// user decides.
type hostKeyChange struct {
	Host  string   `json:"host"`
	Type  string   `json:"type"`
	New   string   `json:"new"`
	Old   []string `json:"old"`
	Path  string   `json:"path"`
	lines []int    // 1-based lines in known_hosts holding the old key(s)
	entry string   // known_hosts line for the new key
}

var pendingKeys sync.Map // normalized host -> hostKeyChange

func hostKeyChangedError(host string, key ssh.PublicKey, ke *knownhosts.KeyError, path string) error {
	c := hostKeyChange{
		Host:  knownhosts.Normalize(host),
		Type:  key.Type(),
		New:   ssh.FingerprintSHA256(key),
		Path:  path,
		entry: knownhosts.Line([]string{knownhosts.Normalize(host)}, key),
	}
	for _, w := range ke.Want {
		c.Old = append(c.Old, ssh.FingerprintSHA256(w.Key))
		if w.Filename == path {
			c.lines = append(c.lines, w.Line)
		}
	}
	pendingKeys.Store(c.Host, c)
	raw, _ := json.Marshal(c)
	return errors.New(hostKeyChangedPrefix + string(raw))
}

// TrustHostKey replaces the stored key of host with the one it just presented.
func (a *App) TrustHostKey(host string) error {
	v, ok := pendingKeys.LoadAndDelete(host)
	if !ok {
		return errors.New("no pending key change for " + host)
	}
	c := v.(hostKeyChange)
	raw, err := os.ReadFile(c.Path)
	if err != nil {
		return err
	}
	drop := map[int]bool{}
	for _, n := range c.lines {
		drop[n] = true
	}
	lines := strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n")
	out := make([]string, 0, len(lines)+1)
	for i, ln := range lines {
		if drop[i+1] || (ln == "" && i == len(lines)-1) {
			continue
		}
		out = append(out, ln)
	}
	out = append(out, c.entry)
	tmp := c.Path + ".tmp"
	if err := os.WriteFile(tmp, []byte(strings.Join(out, "\n")+"\n"), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, c.Path)
}
