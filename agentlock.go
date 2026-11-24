package main

import (
	"fmt"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Several AI sessions (e.g. two Claude Code chats) can share one Hopline MCP
// server. Typing into the same terminal at once mixes their output and lets
// one change the CLI mode (conf t, expert, vsenv) under the other, so a tab
// runs one AI command at a time and stays with the AI session that last drove
// it until that session has been quiet for agentLease.

const agentLease = 5 * time.Minute

type tabLock struct {
	mu    sync.Mutex
	owner string    // MCP session that last drove the tab ("" = none)
	seen  time.Time // when the owner last finished a command
	busy  bool      // an AI command is running right now
}

// agentID names the MCP session behind a tool call.
func agentID(req *mcp.CallToolRequest) string {
	if req == nil || req.Session == nil {
		return ""
	}
	if id := req.Session.ID(); id != "" {
		return id
	}
	return fmt.Sprintf("%p", req.Session)
}

// heldByOther reports whether another AI session still owns the tab. Callers hold l.mu.
func (l *tabLock) heldByOther(agent string, now time.Time) bool {
	if l.busy && l.owner != agent {
		return true
	}
	return l.owner != "" && l.owner != agent && now.Sub(l.seen) < agentLease
}

// tryOwn takes the tab for agent if nobody else holds it (used when
// open_session picks a tab to reuse).
func (l *tabLock) tryOwn(agent string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if l.busy || l.heldByOther(agent, now) {
		return false
	}
	l.owner, l.seen = agent, now
	return true
}

// own marks a freshly opened tab as agent's.
func (l *tabLock) own(agent string) {
	l.mu.Lock()
	l.owner, l.seen = agent, time.Now()
	l.mu.Unlock()
}

// state describes the tab for list_tabs from agent's point of view.
func (l *tabLock) state(agent string) string {
	l.mu.Lock()
	defer l.mu.Unlock()
	switch {
	case l.owner == "" || time.Since(l.seen) >= agentLease && !l.busy:
		return ""
	case l.owner == agent:
		if l.busy {
			return "yours, running"
		}
		return "yours"
	case l.busy:
		return "in use by another AI session (running a command)"
	default:
		return "in use by another AI session"
	}
}

// claim reserves the tab for one command from agent. The returned release
// must be called when the command is done.
func (a *App) claim(lc *liveConn, agent string) (func(), error) {
	l := &lc.lock
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if l.busy {
		if l.owner == agent {
			return nil, fmt.Errorf("tab %s is still running your previous command; wait for it (read_output) or stop it with send_keys \"\\u0003\"", lc.id)
		}
		return nil, fmt.Errorf("tab %s (%s) is busy: another AI session is running a command on it. Use open_session with new=true to get your own tab", lc.id, lc.name)
	}
	if l.heldByOther(agent, now) {
		ago := now.Sub(l.seen).Round(time.Second)
		return nil, fmt.Errorf("tab %s (%s) is being used by another AI session (last command %s ago; free after %s idle). Use open_session with new=true to get your own tab", lc.id, lc.name, ago, agentLease)
	}
	l.owner, l.busy = agent, true
	return func() {
		l.mu.Lock()
		l.busy, l.seen = false, time.Now()
		l.mu.Unlock()
	}, nil
}
