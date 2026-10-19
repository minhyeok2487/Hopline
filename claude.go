package main

import (
	"bytes"
	"context"
	_ "embed"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// One-click Claude Code setup: register the MCP server with the claude CLI and
// install the bundled "hopline" skill into ~/.claude/skills.

//go:embed skills/hopline/SKILL.md
var skillMD string

// skillMarker is the line that says Hopline owns the installed file; users who
// delete it keep their edits across updates.
const skillMarker = "<!-- Installed by Hopline."

var errSkillCustomized = errors.New("skill edited by the user")

func skillFile() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".claude", "skills", "hopline", "SKILL.md")
}

// installSkill writes the bundled skill. With onlyUpdate it touches nothing
// unless an older Hopline-installed copy is already there.
func installSkill(onlyUpdate bool) (string, error) {
	p := skillFile()
	old, err := os.ReadFile(p)
	switch {
	case err == nil && string(old) == skillMD:
		return p, nil
	case err == nil && !strings.Contains(string(old), skillMarker):
		return p, errSkillCustomized
	case err != nil && onlyUpdate:
		return p, nil
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return p, err
	}
	return p, os.WriteFile(p, []byte(skillMD), 0o644)
}

// ClaudeSetup reports what ConnectClaudeCode did.
type ClaudeSetup struct {
	CLIFound   bool   `json:"cliFound"`
	Registered bool   `json:"registered"`
	SkillPath  string `json:"skillPath"`
	SkillKept  bool   `json:"skillKept"` // the user's edited skill was left alone
	Output     string `json:"output,omitempty"`
}

func findClaude() string {
	if p, err := exec.LookPath("claude"); err == nil {
		return p
	}
	home, _ := os.UserHomeDir()
	for _, p := range []string{
		filepath.Join(home, ".local", "bin", "claude.exe"),
		filepath.Join(os.Getenv("APPDATA"), "npm", "claude.cmd"),
	} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func runHidden(exe string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, exe, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	var out bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &out
	err := cmd.Run()
	return strings.TrimSpace(out.String()), err
}

// ConnectClaudeCode turns the MCP server on if needed, installs the skill and
// registers the server with Claude Code (user scope), replacing an old entry.
func (a *App) ConnectClaudeCode() (ClaudeSetup, error) {
	var res ClaudeSetup
	info := a.GetMCPInfo()
	if !info.Running {
		var err error
		if info, err = a.SetMCPEnabled(true, 0); err != nil {
			return res, err
		}
	}
	p, err := installSkill(false)
	res.SkillPath = p
	if errors.Is(err, errSkillCustomized) {
		res.SkillKept = true
	} else if err != nil {
		return res, err
	}
	exe := findClaude()
	if exe == "" {
		return res, nil
	}
	res.CLIFound = true
	_, _ = runHidden(exe, "mcp", "remove", "hopline", "-s", "user")
	out, err := runHidden(exe, "mcp", "add", "--scope", "user", "--transport", "http", "hopline", info.URL,
		"--header", "Authorization: Bearer "+info.Token)
	if err != nil {
		res.Output = out
		return res, fmt.Errorf("claude mcp add: %v %s", err, out)
	}
	res.Registered = true
	return res, nil
}

// GetClaudeSetupPrompt is text to paste into a Claude Code chat: Claude then
// registers the server and saves the skill itself.
func (a *App) GetClaudeSetupPrompt() string {
	info := a.GetMCPInfo()
	if info.Command == "" {
		return ""
	}
	tmpl := T("claude.prompt")
	return fmt.Sprintf(tmpl, info.Command, skillMD)
}

// updateSkill refreshes an installed, unedited skill after Hopline updates.
func updateSkill() {
	_, _ = installSkill(true)
}
