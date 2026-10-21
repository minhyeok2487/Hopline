package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

type sshConn struct {
	client  *ssh.Client
	session *ssh.Session
	stdin   io.WriteCloser
	done    chan struct{}

	sftpMu sync.Mutex
	sftp   *sftp.Client
}

func dialSSH(ctx context.Context, s Session, password string, cols, rows int, out io.Writer, dataDir string) (*sshConn, error) {
	var auths []ssh.AuthMethod
	if s.KeyPath != "" {
		raw, err := os.ReadFile(s.KeyPath)
		if err != nil {
			return nil, fmt.Errorf(T("ssh.keyRead"), err)
		}
		signer, err := ssh.ParsePrivateKey(raw)
		var pm *ssh.PassphraseMissingError
		if errors.As(err, &pm) {
			if password == "" {
				return nil, errors.New(ErrNeedPassword)
			}
			signer, err = ssh.ParsePrivateKeyWithPassphrase(raw, []byte(password))
		}
		if err != nil {
			return nil, fmt.Errorf(T("ssh.keyParse"), err)
		}
		auths = append(auths, ssh.PublicKeys(signer))
	}
	if password != "" {
		auths = append(auths,
			ssh.Password(password),
			ssh.KeyboardInteractive(func(_, _ string, qs []string, _ []bool) ([]string, error) {
				ans := make([]string, len(qs))
				for i := range qs {
					ans[i] = password
				}
				return ans, nil
			}))
	}

	cfg := &ssh.ClientConfig{
		User:            s.User,
		Auth:            auths,
		HostKeyCallback: tofuHostKeys(filepath.Join(dataDir, "known_hosts"), out),
		Timeout:         10 * time.Second,
	}
	if s.Legacy {
		sup, ins := ssh.SupportedAlgorithms(), ssh.InsecureAlgorithms()
		cfg.KeyExchanges = append(sup.KeyExchanges, ins.KeyExchanges...)
		cfg.Ciphers = append(sup.Ciphers, ins.Ciphers...)
		cfg.MACs = append(sup.MACs, ins.MACs...)
		cfg.HostKeyAlgorithms = append(sup.HostKeys, ins.HostKeys...)
	}

	addr := net.JoinHostPort(s.Host, strconv.Itoa(s.Port))
	fmt.Fprintf(out, "\x1b[90m"+T("ssh.connecting")+"\x1b[0m\r\n", addr)
	d := net.Dialer{Timeout: 10 * time.Second}
	nc, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, err
	}
	// Abort the handshake when the user cancels, and bound it in time.
	stop := context.AfterFunc(ctx, func() { nc.Close() })
	_ = nc.SetDeadline(time.Now().Add(30 * time.Second))
	cc, chans, reqs, err := ssh.NewClientConn(nc, addr, cfg)
	if !stop() || err != nil {
		nc.Close()
		if err == nil {
			err = ctx.Err()
		}
		return nil, err
	}
	_ = nc.SetDeadline(time.Time{})
	client := ssh.NewClient(cc, chans, reqs)
	sess, err := client.NewSession()
	if err != nil {
		client.Close()
		return nil, err
	}
	modes := ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 115200, ssh.TTY_OP_OSPEED: 115200}
	if cols <= 0 || rows <= 0 {
		cols, rows = 120, 32
	}
	if err := sess.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		client.Close()
		return nil, err
	}
	stdin, err := sess.StdinPipe()
	if err != nil {
		client.Close()
		return nil, err
	}
	sess.Stdout = out
	sess.Stderr = out
	if err := sess.Shell(); err != nil {
		client.Close()
		return nil, err
	}
	c := &sshConn{client: client, session: sess, stdin: stdin, done: make(chan struct{})}
	go c.keepalive()
	return c, nil
}

func (c *sshConn) keepalive() {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-c.done:
			return
		case <-t.C:
			if _, _, err := c.client.SendRequest("keepalive@openssh.com", true, nil); err != nil {
				return
			}
		}
	}
}

// wait blocks until the remote shell ends and returns a human-readable reason.
func (c *sshConn) wait() string {
	err := c.session.Wait()
	if err != nil {
		var ee *ssh.ExitError
		if errors.As(err, &ee) {
			return fmt.Sprintf(T("ssh.shellExitCode"), ee.ExitStatus())
		}
		return err.Error()
	}
	return T("ssh.shellExit")
}

func (c *sshConn) Write(p []byte) (int, error) { return c.stdin.Write(p) }

func (c *sshConn) Resize(cols, rows int) error { return c.session.WindowChange(rows, cols) }

func (c *sshConn) Close() error {
	select {
	case <-c.done:
	default:
		close(c.done)
	}
	c.sftpMu.Lock()
	if c.sftp != nil {
		c.sftp.Close()
		c.sftp = nil
	}
	c.sftpMu.Unlock()
	return c.client.Close()
}

// sftpClient lazily opens an SFTP channel on the existing SSH connection.
func (c *sshConn) sftpClient() (*sftp.Client, error) {
	c.sftpMu.Lock()
	defer c.sftpMu.Unlock()
	if c.sftp != nil {
		return c.sftp, nil
	}
	cl, err := sftp.NewClient(c.client)
	if err != nil {
		return nil, fmt.Errorf(T("ssh.noSftp"), err)
	}
	c.sftp = cl
	return cl, nil
}

// tofuHostKeys trusts and records unknown hosts on first use, and refuses a
// changed key (possible MITM) with a pointer to the known_hosts file.
func tofuHostKeys(path string, out io.Writer) ssh.HostKeyCallback {
	return func(host string, remote net.Addr, key ssh.PublicKey) error {
		if _, err := os.Stat(path); os.IsNotExist(err) {
			_ = os.WriteFile(path, nil, 0o600)
		}
		check, err := knownhosts.New(path)
		if err != nil {
			return err
		}
		err = check(host, remote, key)
		var ke *knownhosts.KeyError
		if err == nil {
			return nil
		}
		if !errors.As(err, &ke) {
			return err
		}
		if len(ke.Want) > 0 {
			return hostKeyChangedError(host, key, ke, path)
		}
		f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			return err
		}
		defer f.Close()
		if _, err := f.WriteString(knownhosts.Line([]string{knownhosts.Normalize(host)}, key) + "\n"); err != nil {
			return err
		}
		fmt.Fprintf(out, "\x1b[33m"+T("ssh.hostKeySaved")+"\x1b[0m\r\n", key.Type(), ssh.FingerprintSHA256(key))
		return nil
	}
}
