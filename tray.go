package main

import (
	"context"
	_ "embed"
	"errors"
	"fmt"
	"os"
	goruntime "runtime"

	"fyne.io/systray"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/sys/windows/registry"
)

// Closing the window hides it to the notification area so the MCP server and
// open connections keep running; the tray menu (or running Hopline again)
// brings it back, and "Quit" really exits.

//go:embed build/windows/icon.ico
var trayIcon []byte

type trayState struct {
	open, mcp, quit *systray.MenuItem
}

func (a *App) startTray() {
	go func() {
		goruntime.LockOSThread() // the tray window and its message loop must share a thread
		systray.Run(a.trayReady, nil)
	}()
}

func (a *App) trayReady() {
	systray.SetIcon(trayIcon)
	systray.SetOnTapped(a.ShowWindow)
	a.tray.open = systray.AddMenuItem("", "")
	a.tray.mcp = systray.AddMenuItem("", "")
	a.tray.mcp.Disable()
	systray.AddSeparator()
	a.tray.quit = systray.AddMenuItem("", "")
	a.refreshTray()
	go func() {
		for {
			select {
			case <-a.tray.open.ClickedCh:
				a.ShowWindow()
			case <-a.tray.quit.ClickedCh:
				a.QuitApp()
			}
		}
	}()
}

// refreshTray updates labels for the current language and MCP state.
func (a *App) refreshTray() {
	if a.tray.open == nil {
		return
	}
	info := a.GetMCPInfo()
	status := T("tray.mcpOff")
	if info.Running {
		status = fmt.Sprintf(T("tray.mcpOn"), info.Port)
	}
	systray.SetTooltip("Hopline · " + status)
	a.tray.open.SetTitle(T("tray.open"))
	a.tray.mcp.SetTitle(status)
	a.tray.quit.SetTitle(T("tray.quit"))
}

// ShowWindow brings the (possibly hidden) window to the front.
func (a *App) ShowWindow() {
	runtime.WindowShow(a.ctx)
	runtime.WindowUnminimise(a.ctx)
	runtime.WindowSetAlwaysOnTop(a.ctx, true) // a hidden window can't take focus by itself
	runtime.WindowSetAlwaysOnTop(a.ctx, false)
}

// HideWindow hides the window to the tray. remember marks the first-close notice as seen.
func (a *App) HideWindow(remember bool) {
	if remember {
		st := a.store.Settings()
		st.TrayNoticeShown = true
		_ = a.store.PutSettings(st)
	}
	runtime.WindowHide(a.ctx)
}

// QuitApp exits for real (tray menu or the first-close notice).
func (a *App) QuitApp() {
	a.quitting.Store(true)
	runtime.Quit(a.ctx)
}

// beforeClose runs when the window's close button is pressed.
func (a *App) beforeClose(ctx context.Context) (prevent bool) {
	st := a.store.Settings()
	if a.quitting.Load() || st.CloseToTray != nil && !*st.CloseToTray {
		return false
	}
	if !st.TrayNoticeShown {
		runtime.EventsEmit(ctx, "app:closeAsk") // the UI explains the tray once, then hides or quits
		return true
	}
	runtime.WindowHide(ctx)
	return true
}

func (a *App) GetCloseToTray() bool {
	st := a.store.Settings()
	return st.CloseToTray == nil || *st.CloseToTray
}

func (a *App) SetCloseToTray(on bool) error {
	st := a.store.Settings()
	st.CloseToTray = &on
	return a.store.PutSettings(st)
}

const runKey = `Software\Microsoft\Windows\CurrentVersion\Run`

// GetAutostart reports whether Hopline starts (to the tray) when Windows starts.
func (a *App) GetAutostart() bool {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer k.Close()
	v, _, err := k.GetStringValue("Hopline")
	return err == nil && v != ""
}

func (a *App) SetAutostart(on bool) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, runKey, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	if !on {
		if err := k.DeleteValue("Hopline"); err != nil && !errors.Is(err, registry.ErrNotExist) {
			return err
		}
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	return k.SetStringValue("Hopline", `"`+exe+`" --tray`)
}

// startHidden: launched by the autostart entry.
func startHidden() bool {
	for _, a := range os.Args[1:] {
		if a == "--tray" {
			return true
		}
	}
	return false
}
