package main

import (
	"errors"
	"net/url"
	"regexp"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// Hand an AI panel conversation over to the Claude desktop app. The app
// registers the claude:// scheme; claude://resume?session=<id> imports a
// Claude Code CLI session (the panel runs the CLI) and opens it in the Code
// tab. The link is the app's own, not a documented API, so the UI only offers
// it when the scheme is registered and reports failures plainly.

var sessionIDRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// HasClaudeDesktop reports whether the Claude desktop app's link handler is installed.
func (a *App) HasClaudeDesktop() bool {
	k, err := registry.OpenKey(registry.CLASSES_ROOT, `claude\shell\open\command`, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()
	v, _, err := k.GetStringValue("")
	return err == nil && v != ""
}

// OpenInClaudeDesktop opens a Claude Code session (from AIResult.Session) in the desktop app.
func (a *App) OpenInClaudeDesktop(session string) error {
	if !sessionIDRe.MatchString(session) {
		return errors.New("invalid session id")
	}
	if !a.HasClaudeDesktop() {
		return errors.New("NO_DESKTOP")
	}
	return shellOpen("claude://resume?session=" + url.QueryEscape(session))
}

func shellOpen(target string) error {
	verb, _ := windows.UTF16PtrFromString("open")
	file, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return err
	}
	return windows.ShellExecute(0, verb, file, nil, nil, windows.SW_SHOWNORMAL)
}
