<p align="center">
  <img src="build/appicon.png" width="96" alt="Hopline icon">
</p>

<h1 align="center">Hopline</h1>

<p align="center">
  A lightweight SSH, SFTP and serial terminal for Windows, with a built-in MCP server so AI assistants can work in your sessions while you watch.
</p>

<p align="center">
  <a href="https://github.com/minhyeok2487/Hopline/releases/latest"><b>Download</b></a> ·
  <a href="https://hopline-app.vercel.app/en">Website</a> ·
  <a href="docs/GUIDE.md">User guide</a> ·
  English · <a href="README.ko.md">한국어</a>
</p>

![Claude Code driving Hopline through MCP](docs/media/hero.gif)

<p align="center"><a href="docs/media/hopline-promo.mp4">▶ Watch the 30-second demo video</a></p>

Hopline keeps the parts of a network engineer's terminal you use every day (saved sessions, tabs, SFTP, serial consoles, multi-exec) in a single ~16 MB executable. It is written in Go with [Wails](https://wails.io) and renders terminals with [xterm.js](https://xtermjs.org).

## Features

![Hopline main window](docs/screenshots/main-dark.png)

**Sessions and terminals**
- Saved SSH, Telnet and serial sessions in nested folders (drag & drop, rename, connect all), with search and keyboard navigation
- Tabs you can reorder, rename and duplicate, and a split view with two or four tabs side by side; quick connect with `user@host[:port]` or `telnet host`
- Import sessions from MobaXterm, PuTTY, SecureCRT and Xshell; back up and restore sessions, macros and settings (passwords optionally, encrypted with a passphrase)
- Password, private-key and keyboard-interactive auth; an option for legacy key exchange and ciphers used by older switches and firewalls
- Passwords are encrypted with Windows DPAPI, so only your Windows account can decrypt them
- Trust-on-first-use host keys: a changed key blocks the connection and tells you which line to remove
- Connection overlay with a cancel button, and a reconnect bar when a session drops

**Files and consoles**
- SFTP side panel for the active tab: breadcrumbs, upload by button or drag and drop, download, rename, delete, new folder
- Serial (COM) console with baud rate, data bits, parity and stop bits
- Built-in TFTP server for firmware upgrades and config backups, limited to one folder

**Working on many devices**
- Multi-exec: type once into every checked tab
- Macros: named command lists sent line by line with a configurable delay; pin them to the **command bar** under the tabs for one-click buttons (`Alt+1`–`9`), with `{{variables}}` asked at run time and an optional confirmation
- Logon actions: expect/send steps run after connecting (enable, console login, jump hosts), with hidden values encrypted
- Built-in updates: notices new releases, verifies the download and restarts into the new version
- Keeps running in the tray when the window is closed, so the MCP server and connections stay up; optional start with Windows
- Keyword highlighting for device output (down/error, up, warnings, IP/MAC, interface names) with editable rules
- Session logs: record every session automatically or per session, one folder per device, a timestamp on every line, and a log browser with search across all logs

**AI built in** (uses your installed [Claude Code](https://claude.com/claude-code), no API key)
- AI assistant panel (`Ctrl+Shift+A`) that reads the current tab's screen; suggested commands come with **Insert** / **Run** buttons, and commands that change configuration are only inserted
- Select output in the terminal and click **Ask AI** to have it explained
- AI work summary of a session log: commands run, changes, problems seen
- Scheduled checks: at set times Hopline connects in the background, runs read-only commands, saves the output and lets the AI compare it with the previous run

**Comfort**
- Dark and light themes, seven terminal color schemes, UI size (90–150%), font, size, line height and cursor settings
- Find in terminal (`Ctrl+Shift+F`), zoom (`Ctrl + = / -`), status bar with size, transfer and multi-exec state
- English and Korean UI, following your Windows language by default

| SFTP panel | Settings |
|---|---|
| ![SFTP panel](docs/screenshots/sftp.png) | ![Settings](docs/screenshots/settings.png) |

| Light theme and find | An AI assistant typing through MCP |
|---|---|
| ![Light theme with find](docs/screenshots/light-find.png) | ![MCP activity badge](docs/screenshots/mcp.png) |

## MCP integration

Hopline can run a local [Model Context Protocol](https://modelcontextprotocol.io) server so an AI client such as Claude Code can open your saved sessions and run commands. Everything happens in visible tabs: the tab comes to the front and shows an **AI** badge while commands are sent.

1. Click **MCP** in the toolbar and press **Connect to Claude Code**. Hopline turns its server on (`127.0.0.1:7781` only, bearer token), registers it with Claude Code and installs the [`hopline` skill](skills/hopline/SKILL.md), which teaches Claude a safe way to work on devices (check open tabs first, read-only by default, approval before changes, a summary table at the end).
   - No `claude` command on this PC? Press **Copy setup prompt for Claude** instead and paste it into a Claude Code chat; Claude runs the registration and saves the skill itself.
   - Prefer doing it by hand? The dialog also shows the plain `claude mcp add ...` command.
2. Open a new Claude Code session. Keep Hopline running and ask your assistant, for example: *"Use hopline to open core-sw01 and show the interface status. Read-only commands only."*

| Tool | What it does |
|---|---|
| `list_sessions`, `list_tabs` | Saved sessions and connected tabs, including tabs you opened yourself; the one you are looking at is marked `(active)` |
| `open_session` | Reuse the session's open tab, or open and connect a new one (`new: true` forces a new tab) |
| `run_command` | Send a command and return its output; detects the prompt, supports an `expect` regex and answers `--More--` pagers automatically |
| `send_keys`, `read_output` | Interactive input (Ctrl+C, y/n) and reading the current screen |
| `sftp_list`, `sftp_read_file`, `sftp_write_file`, `sftp_download`, `sftp_upload` | File operations over the tab's SSH connection |
| `run_on_tabs` | Run one command on many tabs or saved sessions in parallel and get each output back |
| `close_tab` | Disconnect and close a tab |

Every tab tool also accepts `tab: "active"`, so you can connect yourself and simply say *"run show version in my current tab"*.

Saved passwords never pass through MCP. If a session has no saved password, Hopline asks you for it in its own window while the assistant waits.

## Download

Grab `Hopline.zip` from the [latest release](https://github.com/minhyeok2487/Hopline/releases/latest), unzip it anywhere and run `Hopline.exe`; there is no installer. The bare `.exe` is attached too, for networks that allow it and for the built-in updater of older versions. It runs on Windows 10/11 with the WebView2 runtime (built into Windows 11).

The executable is not code-signed yet, so SmartScreen may warn on first launch: choose **More info → Run anyway**. The release notes list the SHA-256 so you can verify the download.

With [Scoop](https://scoop.sh) you can install and update it from the command line:

```bash
scoop install https://raw.githubusercontent.com/minhyeok2487/Hopline/main/bucket/hopline.json
```

New to Hopline? Read the [user guide](docs/GUIDE.md): sessions, SFTP, serial, multi-exec, macros, MCP setup and troubleshooting.

## Build from source

You need Go 1.25+, Node.js 20+ and the Wails v2 CLI:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

```bash
wails build
```

The executable is written to `build/bin/Hopline.exe`. Use `wails dev` for a live-reloading development build.

## Security model

Hopline lets an AI assistant type into real devices, so the defaults are conservative:

- **The AI never sees saved passwords.** Sessions connect with credentials stored in Hopline (encrypted with Windows DPAPI). When a password is missing, Hopline asks *you* in its own window.
- **Local only, token protected.** The MCP server is off until you enable it, listens on `127.0.0.1` only, rejects requests without the bearer token and has DNS-rebinding protection. Regenerating the token revokes the old one.
- **Everything is visible.** Every AI command runs in a normal tab that comes to the front with an **AI** badge, and you can type, press Ctrl+C or close the tab at any time.
- **Host keys are pinned.** A changed SSH host key blocks the connection instead of silently continuing.
- **Least privilege still matters.** Give the AI device accounts with only the rights it needs, and say "read-only commands only" when that is what you want.

## Where data is stored

| What | Location |
|---|---|
| Sessions, macros, settings | `%APPDATA%\Hopline\data.json` |
| Known host keys | `%APPDATA%\Hopline\known_hosts` |
| Session logs | `Documents\Hopline\logs\<session>\` (changeable in Settings) |
| Scheduled check results | `Documents\Hopline\logs\_checks\<check>\<run>\` |

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+Shift+F` | Find in terminal |
| `Ctrl + =` / `Ctrl + -` / `Ctrl+0` | Font size up / down / reset |
| `Ctrl+Shift+B` | Show or hide the sidebar |
| `Ctrl+Shift+A` | AI assistant panel |
| `Alt+1` … `Alt+9` | Run a command bar button |
| `Ctrl+,` | Settings |
| Drag / right-click | Copy / paste (Shift+right-click opens the menu) |

## Project layout

| Path | Purpose |
|---|---|
| `app.go` | Connection manager, terminal I/O events, macros |
| `logs.go` | Session logs: recording, browsing, search |
| `ai.go`, `checks.go` | AI assistant via the Claude Code CLI, scheduled checks |
| `ssh.go`, `sftp.go`, `serial.go` | SSH sessions and host keys, SFTP, serial ports |
| `mcp.go`, `outtap.go` | MCP server and tools, output capture |
| `store.go`, `dpapi_windows.go` | Session storage and password encryption |
| `i18n.go`, `frontend/src/i18n.js` | English and Korean messages |
| `frontend/src/` | UI (vanilla JS, xterm.js) |

## License

[MIT](LICENSE)
