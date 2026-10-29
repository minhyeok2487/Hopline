# Hopline user guide

English · [한국어](GUIDE.ko.md) · [Back to README](../README.md)

This guide walks through everyday use of Hopline: installing it, saving sessions, working in the terminal, moving files, serial consoles, running commands on many devices, and letting an AI assistant work through MCP.

- [Install](#install)
- [Connect for the first time](#connect-for-the-first-time)
- [Save and organize sessions](#save-and-organize-sessions)
- [Authentication and host keys](#authentication-and-host-keys)
- [Working in the terminal](#working-in-the-terminal)
- [SFTP file panel](#sftp-file-panel)
- [Serial console](#serial-console)
- [TFTP server](#tftp-server)
- [Logon actions (enable, jump hosts)](#logon-actions-enable-jump-hosts)
- [Multi-exec and macros](#multi-exec-and-macros)
- [Session logs](#session-logs)
- [AI assistant and scheduled checks](#ai-assistant-and-scheduled-checks)
- [Import and backup](#import-and-backup)
- [Settings](#settings)
- [AI assistants (MCP)](#ai-assistants-mcp)
- [Troubleshooting](#troubleshooting)

## Install

1. Download `Hopline.zip` from the [latest release](https://github.com/minhyeok2487/Hopline/releases/latest) and unzip it into any folder. It holds a single `Hopline.exe`; settings don't depend on the file name or folder. If your network allows `.exe` downloads you can take `Hopline.exe` instead. The version is in the program (Settings › Updates, and the file's Properties › Details).
2. Keep the folder anywhere (for example `C:\Tools\Hopline\`) and run `Hopline.exe`. There is no installer.
3. The executable is not code-signed yet, so Windows SmartScreen may say *"Windows protected your PC"*. Click **More info → Run anyway**. You can compare the file's SHA-256 with the value on the release page first.

Hopline needs the Microsoft Edge WebView2 runtime. It is built into Windows 11 and most up-to-date Windows 10 installs; if the app does not start, install the [WebView2 Evergreen runtime](https://developer.microsoft.com/microsoft-edge/webview2/).

To uninstall, delete the Hopline executable and, if you want to remove your data too, the folders listed in [Where data is stored](../README.md#where-data-is-stored).

## Connect for the first time

The fastest way is **quick connect** at the top of the window:

1. Type `user@host` or `user@host:port` (or `telnet host[:port]` for Telnet) and press **Enter**.
2. Enter the password when asked. Quick-connect sessions are not saved.

While Hopline connects, the tab shows a **Connecting** card with the elapsed time and a **Cancel** button, so an unreachable device never freezes the window. When a connection drops, a bar at the bottom of the tab offers **Reconnect** (or press **Enter**) and **Close tab**.

## Save and organize sessions

Click **+** in the Sessions panel to create a session, or right-click an existing one for **Connect, Edit, Duplicate, Delete**.

![Session context menu](screenshots/guide-session-menu.png)

![Editing an SSH session](screenshots/guide-session-editor.png)

| Field | Notes |
|---|---|
| Name | Shown in the list and on the tab. Defaults to the host. |
| Folder | Pick an existing folder or type a path; `/` makes subfolders (`HQ/Server room`). |
| Host, Port, User | Port defaults to 22. |
| Password | Leave empty to be asked on every connect. With **Save password** checked, it is stored encrypted (see below). |
| Private key | Optional path to an OpenSSH or PEM key (`id_ed25519`, `id_rsa`, …). PuTTY `.ppk` files must be converted first. |
| Type | SSH, **Telnet** (port 23; with a user name and password saved, Hopline answers the login prompts; Telnet is not encrypted) or Serial |
| Allow legacy algorithms | Enables older key exchanges and ciphers (for example `diffie-hellman-group1-sha1`, CBC ciphers) that old switches and firewalls still require. Leave it off for modern hosts. |

Tips:
- Double-click a session or select it and press **Enter** to connect; **F2** edits it.
- Type in **Search sessions** to filter by name, host, user or folder. Arrow keys move through the results.
- A green dot next to a session means it has an open tab (`●2` = two tabs).

**Folders**

- Create one with the folder button next to **+**, or right-click empty space → **New folder**. Folders can be empty and can hold subfolders.
- **Drag** a session onto a folder to move it, or onto empty space to move it to the top level. Folders can be dragged into other folders the same way. Right-click a session → **Move to folder…** does the same from a list.
- Right-click a folder for **New session here, New subfolder, Rename folder, Connect all, Collapse/Expand all folders, Delete folder**. Deleting a folder never deletes sessions: its sessions and subfolders move up one level.
- Click a folder to collapse it; Hopline remembers which folders you collapsed. Searching shows matches inside collapsed folders too.
- The empty screen lists your **recent** connections for one-click reconnects.

## Authentication and host keys

**Saved passwords** are encrypted with Windows DPAPI under your Windows account and stored in `%APPDATA%\Hopline\data.json`. Another Windows user, or another PC, cannot decrypt them.

**Private keys with a passphrase:** Hopline asks for the passphrase in the password prompt when it connects.

**Host keys (trust on first use):** the first time you connect to a host, its key is saved to `%APPDATA%\Hopline\known_hosts` and the fingerprint is printed in yellow in the terminal.

If a host later presents a different key, Hopline stops and shows **The SSH host key has changed** with the saved and the new fingerprint:

- **Don't connect** (the default, also on Enter): nothing changes. Choose this if you don't know why the key changed; someone may be intercepting the connection.
- **Trust new key and connect**: for a device you reinstalled or replaced (lab VMs, RMA swaps, a gateway rebuilt with Gaia). Hopline replaces only that host's old line in known_hosts and connects.

## Working in the terminal

| Action | How |
|---|---|
| Copy | Select text with the mouse (copied automatically), or **Ctrl+Shift+C** |
| Paste | Right-click, or **Ctrl+Shift+V**. Pasting several lines asks for confirmation first, because each line can run as a command. |
| Context menu | **Shift + right-click** (copy, paste, select all, find, clear screen) |
| Find | **Ctrl+Shift+F**, then **Enter** / **Shift+Enter** for next and previous, **Esc** to close |
| Font size | **Ctrl + =**, **Ctrl + -**, **Ctrl+0** to reset |
| Switch tabs | **Ctrl+Tab**, **Ctrl+Shift+Tab** |
| Rename a tab | Double-click its title |
| Reorder tabs | Drag a tab |
| Close a tab | **✕**, middle-click, or the tab's right-click menu. A connected tab asks first (can be turned off in Settings). |
| Duplicate / reconnect | Tab right-click menu |
| Split view | **Split** in the toolbar: one tab, two side by side, two stacked or four. Click a pane to work in it; clicking a tab puts it into the selected pane. Tab menu → **Show side by side**. |
| Sidebar | **Ctrl+Shift+B** hides or shows it; drag its edge to resize, double-click the edge to reset |

The status bar shows the active connection, terminal size, transfers in progress, multi-exec state and whether the MCP server is running.

## SFTP file panel

Open the **SFTP** tab in the sidebar. It shows the files of the **active SSH tab** using that tab's existing connection; nothing else to log in to.

![SFTP panel](screenshots/sftp.png)

- **Navigate:** double-click a folder, use **↑** for the parent folder, click a part of the path, or click empty space in the path bar to type a path.
- **Download:** double-click a file (or right-click → Download) and choose where to save it.
- **Upload:** click **Upload**, or drag files or whole folders from Explorer onto the file list. Progress appears below the list and in the status bar.
- **Right-click a file or folder** for Rename, Copy path and Delete. Folders can only be deleted when empty, to avoid accidental recursive deletes.

If the panel says SFTP is unavailable, the server does not provide the SFTP subsystem (common on network devices).

## Serial console

Create a session with **Type: Serial (COM)**:

![Serial session settings](screenshots/guide-session-serial.png)

- **Port** lists the COM ports Windows currently sees, with the adapter name when available. Click the refresh button after plugging in a USB console cable.
- Common console settings are **9600 8N1** (Cisco and most switches) or **115200 8N1**.
- If the port is not listed, install the driver for your USB-serial adapter (FTDI, Prolific, Silicon Labs CP210x) and check Device Manager.

## TFTP server

Click **TFTP** in the toolbar to serve files to devices, for firmware upgrades or config backups.

- Choose the folder (default `Documents\Hopline\tftp`) and port (69), then **Start**. The dialog lists this PC's addresses and Cisco examples such as `copy tftp://<PC>/ios.bin flash:`.
- Devices can only read files inside that folder. Turn on **Accept uploads from devices** to receive backups (`copy running-config tftp://<PC>/backups/sw1-confg`).
- Transfers show up in the dialog and as notifications. On first start, allow Hopline in the Windows Firewall prompt. Stop the server when you're done.

## Logon actions (enable, jump hosts)

In the session editor, **Logon actions** holds *expect → send* steps that Hopline types for you every time the session connects. They work for SSH and serial sessions.

- When the **Expect** text appears, Hopline types **Send** and presses Enter. An empty Expect sends right away.
- Values marked **Hide** (passwords) are encrypted with your Windows account, are not shown again in the editor, and are never passed to AI assistants.
- **Send Enter first** wakes a serial console that waits silently.
- If a step's text does not appear within 30 seconds, Hopline stops and tells you which step in the terminal and in a notification.

| Use | Expect | Send | Hide |
|---|---|---|---|
| Enable mode | `>` | `enable` | |
| | `assword:` | enable password | ✓ |
| Serial console login (with Send Enter first) | `sername:` | `admin` | |
| | `assword:` | password | ✓ |
| Hop through a jump host | `$ ` | `ssh admin@10.0.0.2` | |
| | `assword:` | device password | ✓ |

**Add enable example** inserts the two enable steps; just fill in the password. Matching is case-sensitive, so `assword:` catches both `Password:` and `password:`.

## Multi-exec and macros

**Multi-exec** sends what you type to every checked tab at once, for example to run the same `show` command on several switches.

![Multi-exec across two tabs](screenshots/guide-multi-exec.png)

1. Open the tabs you want and click **Multi-exec** in the toolbar. An orange frame shows it is on.
2. Each tab gets a checkbox; uncheck tabs that should not receive input.
3. Type in any checked tab. The status bar shows how many tabs are targeted.

**Macros** are named command lists sent line by line, with **Enter** after each line and a delay in between.

![Editing a macro](screenshots/guide-macro-editor.png)

- Create one with **+** in the **Macros** panel; double-click a macro to edit it.
- Click **Run** to send it to the active tab, or to every checked tab while multi-exec is on.
- For network devices, start with a pager-off line such as `terminal length 0` so long output is not interrupted by `--More--`.
- Raise the line delay for slow devices or commands that take a moment to return the prompt.

**Command bar.** Macros marked **Show on the command bar** appear as buttons in a row under the tabs. Click one to send it to the active tab (or every checked tab while multi-exec is on), **Shift+click** to send it to every open tab, or press **Alt+1** … **Alt+9**. Drag buttons to reorder them, right-click one to edit it, and use **+** to add a new one. Hide the bar from its right-click menu or in Settings › Behavior.

- **Variables:** write `{{name}}` or `{{name|default}}` in a command, e.g. `show interface {{port|Gi0/1}}`. Hopline asks for the value when the macro runs and remembers the last one.
- **Ask before sending:** turn this on for macros that change configuration (`write memory`, `reload`). You see the exact text and the target tabs before anything is sent.

## Session logs

Click **Log** in the toolbar to start recording the active tab; the tab shows a red **REC** badge. Click again to stop.

- **Record automatically:** Settings › Session logs › *Record every session automatically* starts a log as soon as any session connects. Each session can override it in its editor (**Record**: follow app setting / always / never).
- **One folder per device:** logs go to `Documents\Hopline\logs\<session>\<date>_<time>.log`. The folder can be changed in Settings.
- **Clean text:** colour codes are removed, backspaces are applied (so `--More--` prompts disappear), and every line starts with the time it arrived, like `[2026-10-25 14:03:21]`. Turn the timestamps off in Settings if you don't want them.

**Browse and search.** The list button next to **Log** opens the log browser: sessions on the left, the log on the right. Type in the box to filter sessions; press **Enter** to search inside every log and click a result to jump to that line. From a log you can make an **AI work summary**, show it in Explorer or delete it. Right-click a tab › **View log** opens the log of that tab.

## AI assistant and scheduled checks

Hopline's AI features run on the [Claude Code](https://claude.com/claude-code) on your PC (the CLI, or the one built into the Claude desktop app), with the account it is signed in to; there is no API key to set. The AI gets the text Hopline sends it (screen, selection, log) and nothing else: it can't type in your sessions by itself, and saved passwords never leave Hopline. Settings › AI assistant shows whether Claude Code was found and lets you pick a model.

**AI assistant panel** (**AI** button or `Ctrl+Shift+A`). Ask about the current tab in plain words: *"anything wrong here?"*, *"how do I see interfaces that are down?"*. With **Include the terminal screen** checked, the last screenful of the tab is sent along. Commands in the answer get buttons:

- **Insert** types the command without Enter, so you can check or edit it first.
- **Run** types it and presses Enter. Commands that change configuration (`configure`, `no shutdown`, `reload`, `write` and the like) are shown in orange with **Insert** only.

Each tab keeps its own conversation; the refresh button starts a new one.

**Ask AI about a selection.** Select output in the terminal and click the **Ask AI** chip that appears next to it to get an explanation, what looks abnormal and what to check next. Turn the chip off in Settings if you don't use it.

**AI work summary.** Right-click a tab › **AI work summary**, or open a log and click **AI work summary**, for a short report: summary, commands run, configuration changes, problems seen and follow-up. Summaries of saved logs are kept next to the log as `<name>.summary.md`.

**Scheduled checks** (**Checks** button). A check is a list of read-only commands run on chosen saved sessions daily at set times (e.g. `08:30, 18:00`), every N minutes, or only when you click **Run**.

- Hopline must be running (the tray is enough). A run missed while it was closed is caught up within two hours.
- It connects in the background without opening tabs, runs the session's logon actions first, then the commands, and disconnects. Sessions need a saved password or key.
- Commands that could change configuration can't be saved in a check.
- Output is saved per device under `Documents\Hopline\logs\_checks\<check>\<run>\`. With **AI** on, the AI reads the output, compares it with the previous run and marks the run OK, needs a look or problem found. You get a notice when a run ends; **Results** shows the summary and each device's output.

## Import and backup

**Import from other terminals:** the import button above the session list (or right-click empty space) finds MobaXterm, PuTTY, SecureCRT and Xshell sessions on this PC and imports SSH, Telnet and serial sessions with their folders into a folder named after the program. Exported files (`.mxtsessions`, SecureCRT `.ini`, Xshell `.xsh`) can be imported too. Passwords are not imported, and sessions you already have are skipped.

**Backup:** Settings › Backup › **Export settings** saves sessions, folders, macros and (optionally) appearance settings to a JSON file. Check **Include saved passwords** and set a backup passphrase to include them, encrypted, so you can restore on another PC. **Restore from backup** merges the file into your current data.

## Settings

Open with the gear button or **Ctrl+,**. Changes preview immediately; **Cancel** reverts them.

![Settings](screenshots/settings.png)

| Setting | What it does |
|---|---|
| Language | Auto (follows Windows), 한국어 or English |
| UI size | Scales the sidebar, toolbar and dialogs (90–150%). Terminal text uses **Font size**. |
| App theme | System, Dark or Light |
| Color scheme | Terminal colors: Auto (follows the app theme), Hopline Dark, One Light, Dracula, Solarized Dark, Gruvbox Dark, Nord, Campbell |
| Font, Font size, Line height | Terminal text. Monospace fonts with Korean fallback are recommended (D2Coding, Cascadia Mono). |
| Cursor, Blink | Block, bar or underline cursor |
| Keyword highlighting | Colours words in plain device output: errors and `down` red, warnings yellow, `up`/`connected` green, IP and MAC addresses blue, interface names cyan, Cisco severity 0-3 logs red. **Edit rules…** adds your own words or regular expressions, sets colours and order (rules higher in the list win), or resets to the defaults. Copied text is unchanged. |
| Scrollback | Lines kept per tab |
| Copy on select | Copy as soon as you select text |
| Right-click pastes | Off: right-click opens the menu instead |
| Confirm multi-line paste, Confirm closing a connected tab | Safety prompts |
| Closing the window hides it to the tray | On by default. See [Keep running in the tray](#keep-running-in-the-tray). |
| Updates | Hopline checks GitHub for a new version on start and twice a day. **Update** downloads it, verifies its SHA-256, swaps it in and restarts Hopline (open connections close). **Skip this version** stops asking about that version; **Check now** asks right away. Scoop installs are told to run `scoop update hopline` instead. |
| Start in the tray when Windows starts | Launches Hopline hidden at sign-in so the MCP server is always available |

## AI assistants (MCP)

Hopline can run a local MCP server so an AI assistant such as Claude Code can open your saved sessions as tabs, run commands and read the output, while you watch.

![Claude driving Hopline](screenshots/mcp.png)

**Set up**

1. Click **MCP** in the toolbar and press **Connect to Claude Code**. Hopline turns the server on (it listens on `127.0.0.1:7781` only and requires a token), registers it with Claude Code and installs the `hopline` skill to `~/.claude/skills/hopline`.
   - Using the Claude desktop app without the CLI also works: Hopline uses the Claude Code built into the app, and the server then shows up in the app's Code tab.
   - If neither is found, press **Copy setup prompt for Claude** and paste it into a Claude Code chat. Claude registers the server and saves the skill for you.
   - To do it by hand, check **Enable MCP server**, then run the command from **Copy command** once in a terminal:

     ```bash
     claude mcp add --scope user --transport http hopline http://127.0.0.1:7781/mcp --header "Authorization: Bearer <token>"
     ```

2. Keep Hopline running. Start a new Claude Code session and ask, for example:
   - *"Use hopline to open core-sw01 and show the interface status."*
   - *"With hopline, check disk usage on every Linux server in the Lab folder. Read-only commands only."*

**The hopline skill** tells Claude how to work on devices through Hopline: check your open tabs first, identify the platform, stay read-only unless you ask for a change, show the exact commands and wait for your approval before changing anything, and finish with a short summary table. Hopline updates the installed skill when Hopline itself is updated; delete the `Installed by Hopline` line in the file to keep your own edits.

**Tabs you already opened:** you don't have to let the assistant connect. Open a session yourself (and log in on a serial console), then ask *"run `show ip interface brief` in my current tab"*. `list_tabs` shows every connected tab with `(active)` on the one in front, all tab tools accept `tab: "active"`, and `open_session` reuses an open tab of the same session instead of opening a duplicate.

**What you will see:** the tab the assistant uses comes to the front and shows an **AI** badge while it types. If a session has no saved password, Hopline asks **you** for it in its own window; the assistant never receives saved passwords.

**Tools:** `list_sessions`, `list_tabs`, `open_session`, `run_command`, `run_on_tabs` (one command on many devices in parallel), `send_keys`, `read_output`, `sftp_list`, `sftp_read_file`, `sftp_write_file`, `sftp_download`, `sftp_upload`, `close_tab`. `run_command` waits for the prompt (or an `expect` pattern, up to 600 s) and answers `--More--` pagers automatically.

**Staying safe**
- Tell the assistant explicitly when only read-only commands are allowed, and review what it plans before approving tool calls.
- Use device accounts with the least privilege you need.
- **New token** in the MCP dialog invalidates the old token immediately; register the new command in Claude Code afterwards.
- Turning the MCP server off closes the port.

### Keep running in the tray

Closing the window does not quit Hopline: it hides to the notification area (system tray), and the MCP server and open connections keep running, so an assistant can keep working with the window closed.

- Click the tray icon, or run the Hopline executable again, to bring the window back with its tabs. Only one Hopline runs at a time.
- Right-click the tray icon and choose **Quit** to exit for real.
- If an assistant opens a session with no saved password while the window is hidden, the window comes back and asks you.
- On Windows 11 a new tray icon starts in the hidden icons (**^**); drag it onto the taskbar to keep it visible.
- Settings › Window: turn off **Closing the window hides it to the tray** to make the close button quit, or turn on **Start in the tray when Windows starts**.

## Troubleshooting

| Problem | What to do |
|---|---|
| *"Windows protected your PC"* on first run | The executable is not code-signed. Click **More info → Run anyway**, after checking the SHA-256 on the release page if you like. |
| The window stays blank or the app does not start | Install the WebView2 Evergreen runtime. |
| *The SSH host key has changed* | See [Authentication and host keys](#authentication-and-host-keys): trust the new key only if the device was reinstalled or replaced. |
| Old switch or firewall: *no common algorithm* / handshake failed | Edit the session and turn on **Allow legacy algorithms**. |
| *Authentication failed* | Hopline asks for the password again. Check the user name; for key auth, check the key path and that the key is in OpenSSH/PEM format. |
| SFTP panel: *SFTP unavailable* | The server does not offer the SFTP subsystem. Use the terminal or a host that supports SFTP. |
| COM port not listed | Install the USB-serial driver, replug the cable, click refresh in the session editor. |
| Claude Code cannot reach hopline (*connection refused*) | Hopline must be running with the MCP server on. Check the port in the MCP dialog matches the registered URL. |
| Claude Code gets *401 Unauthorized* | The token changed. Copy the command from the MCP dialog again and re-register (`claude mcp remove hopline -s user`, then add). |
| AI: *Claude Code isn't installed* | Install Claude Code (see the MCP dialog), then reopen the AI panel. |
| AI: *sign-in has expired* | Run `claude` in PowerShell, sign in again, then retry. |
| A scheduled check says *No saved password or key* | Save the password in the session (edit the session, enter it, keep **Save password** checked). |
| Pasting asks for confirmation every time | Turn off **Confirm multi-line paste** in Settings. |
