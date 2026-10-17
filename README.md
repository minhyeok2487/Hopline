<p align="center">
  <img src="build/appicon.png" width="96" alt="Hopline icon">
</p>

<h1 align="center">Hopline</h1>

<p align="center">
  A lightweight SSH, SFTP and serial terminal for Windows, with a built-in MCP server so AI assistants can work in your sessions while you watch.
</p>

<p align="center">
  English · <a href="README.ko.md">한국어</a>
</p>

![Hopline main window](docs/screenshots/main-dark.png)

Hopline keeps the parts of a network engineer's terminal you use every day (saved sessions, tabs, SFTP, serial consoles, multi-exec) in a single ~13 MB executable. It is written in Go with [Wails](https://wails.io) and renders terminals with [xterm.js](https://xtermjs.org).

## Features

**Sessions and terminals**
- Saved SSH and serial sessions in folders, with search and keyboard navigation
- Tabs you can reorder, rename and duplicate; quick connect with `user@host[:port]`
- Password, private-key and keyboard-interactive auth; an option for legacy key exchange and ciphers used by older switches and firewalls
- Passwords are encrypted with Windows DPAPI, so only your Windows account can decrypt them
- Trust-on-first-use host keys: a changed key blocks the connection and tells you which line to remove
- Connection overlay with a cancel button, and a reconnect bar when a session drops

**Files and consoles**
- SFTP side panel for the active tab: breadcrumbs, upload by button or drag and drop, download, rename, delete, new folder
- Serial (COM) console with baud rate, data bits, parity and stop bits

**Working on many devices**
- Multi-exec: type once into every checked tab
- Macros: named command lists sent line by line with a configurable delay
- Per-tab session logs saved as plain text (escape codes stripped)

**Comfort**
- Dark and light themes, seven terminal color schemes, font, size, line height and cursor settings
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

1. Click **MCP** in the toolbar and turn the server on (it listens on `127.0.0.1:7781` only and requires a bearer token).
2. Copy the registration command shown in the dialog and run it once:

   ```bash
   claude mcp add --scope user --transport http hopline http://127.0.0.1:7781/mcp --header "Authorization: Bearer <token>"
   ```

3. Keep Hopline running and ask your assistant, for example: *"Use hopline to open core-sw01 and show the interface status. Read-only commands only."*

| Tool | What it does |
|---|---|
| `list_sessions`, `list_tabs` | Saved sessions and connected tabs |
| `open_session` | Open a saved session as a new tab and wait until it connects |
| `run_command` | Send a command and return its output; detects the prompt, supports an `expect` regex and answers `--More--` pagers automatically |
| `send_keys`, `read_output` | Interactive input (Ctrl+C, y/n) and reading the current screen |
| `sftp_list`, `sftp_read_file`, `sftp_write_file`, `sftp_download`, `sftp_upload` | File operations over the tab's SSH connection |
| `close_tab` | Disconnect and close a tab |

Saved passwords never pass through MCP. If a session has no saved password, Hopline asks you for it in its own window while the assistant waits.

## Install and build

Hopline targets Windows 10/11 and needs the WebView2 runtime (included with Windows 11).

To build from source you need Go 1.25+, Node.js 20+ and the Wails v2 CLI:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

```bash
wails build
```

The executable is written to `build/bin/Hopline.exe`. Use `wails dev` for a live-reloading development build.

## Where data is stored

| What | Location |
|---|---|
| Sessions, macros, settings | `%APPDATA%\Hopline\data.json` |
| Known host keys | `%APPDATA%\Hopline\known_hosts` |
| Session logs | `Documents\Hopline\logs` |

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+Shift+F` | Find in terminal |
| `Ctrl + =` / `Ctrl + -` / `Ctrl+0` | Font size up / down / reset |
| `Ctrl+Shift+B` | Show or hide the sidebar |
| `Ctrl+,` | Settings |
| Drag / right-click | Copy / paste (Shift+right-click opens the menu) |

## Project layout

| Path | Purpose |
|---|---|
| `app.go` | Connection manager, terminal I/O events, macros, logging |
| `ssh.go`, `sftp.go`, `serial.go` | SSH sessions and host keys, SFTP, serial ports |
| `mcp.go`, `outtap.go` | MCP server and tools, output capture |
| `store.go`, `dpapi_windows.go` | Session storage and password encryption |
| `i18n.go`, `frontend/src/i18n.js` | English and Korean messages |
| `frontend/src/` | UI (vanilla JS, xterm.js) |

## License

[MIT](LICENSE)
