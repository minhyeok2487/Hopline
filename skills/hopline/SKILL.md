---
name: hopline
description: Work on network devices and servers through the Hopline terminal's MCP tools (the "hopline" MCP server) - check status, run show/diagnostic commands, troubleshoot, compare devices, back up configs, move files over SFTP, use serial consoles, and make config changes with approval. Use this whenever the user mentions Hopline, a session or tab they have open, or asks to inspect, check, troubleshoot, collect from or configure a switch, router, firewall or server ("스위치 점검해줘", "인터페이스 상태 봐줘", "방화벽 클러스터 상태", "장비 접속해서 확인", "show run 백업", "지금 탭에서 실행해줘"), even if they don't say "hopline".
---

<!-- Installed by Hopline. It is replaced when Hopline updates this skill; delete this line to keep your own edits. -->

# Working on devices through Hopline

Hopline is a terminal app (SSH, serial) running on the user's PC. Its MCP tools type into real terminal tabs that the user can see, so everything you run happens in front of them, on real equipment. Treat it like working over someone's shoulder on production gear: careful, explicit, and easy to follow.

## 1. Find the right tab

Start with `list_tabs`. The user often already has the device open (and is logged in, maybe in enable mode). Each line shows the tab id, name, kind, target, and `(active)` for the tab in front.

- "this tab", "current tab", "지금 탭", "여기서" → use `tab: "active"`.
- A device name the user mentions → match it against tab names and targets.
- Nothing suitable open → `list_sessions`, then `open_session` with the saved session name. It reuses an open tab of the same session; pass `new: true` only when a second tab is really needed.

Sessions marked `auto_logon=true` run their logon steps (enable, jump host, console login) before `open_session` returns, so the tab is already at the right prompt. If a session has no saved password, Hopline asks the user for it in its own window; wait for that. Never ask the user to type a password into the chat, and never send credentials with `send_keys`.

If the hopline tools fail with a connection error, Hopline is not running or its MCP server is off: ask the user to start Hopline (it keeps running in the tray) and check the MCP button.

## 2. Know the platform before typing

Read the prompt in the tab output (`read_output` if needed) and, if unclear, run a version command first:

| Platform | Prompt looks like | Identify with |
|---|---|---|
| Cisco IOS / IOS-XE | `Switch>` / `Switch#` | `show version` |
| Cisco NX-OS | `switch#` | `show version` |
| Check Point Gaia clish | `gw-01>` | `show version all` |
| Check Point expert (bash) | `[Expert@gw-01:0]#` | `cpinfo -y all`, `fw ver` |
| Linux | `user@host:~$` | `uname -a`, `cat /etc/os-release` |

`>` on Cisco means user EXEC: many show commands need `enable` first (the user may need to type the enable password, or the session has a logon action for it).

## 3. Read-only by default

Run only commands that read state unless the user clearly asked for a change. Show, display, get, ping, traceroute, cat, tail, log viewing are fine.

For anything that changes state (configure terminal, set/add/delete in clish, interface shutdown, clear counters/sessions, reload, policy install, file writes, service restarts):

1. Write out the exact commands, which device, and what they will do.
2. Say how to undo it.
3. Wait for an explicit go-ahead in the chat for that change, then apply it to one device at a time and verify.

Save configuration (`write memory`, `copy run start`, `save config`) only when the user asks. Never reload, erase, format or delete files unless the user asked for exactly that.

## 4. Running commands well

- `run_command` waits for the prompt and answers `--More--` automatically. For long output on Cisco you can still send `terminal length 0` once.
- Slow commands (large `show tech`, debugs, file copies): pass a larger `timeout_sec` and an `expect` regex for the prompt, for example `expect: "#\\s*$"`.
- Interactive questions (`[confirm]`, `y/n`, `Destination filename`) → answer with `send_keys` after you've confirmed the action is wanted. Stop a runaway command with `send_keys` text `"\u0003"` (Ctrl+C).
- `read_output` shows what's on screen without typing, useful to see what the user just did or to check a command that timed out.
- Several devices: use `run_on_tabs` with `sessions` (saved session names) and/or `tabs` (open tabs, or `["all"]`). It opens what's needed and runs the command on every device in parallel, returning each output under its own header. Run read-only checks this way; apply changes one device at a time.

Handy read-only sets:

- **Cisco health:** `show version`, `show inventory`, `show processes cpu sorted | ex 0.00`, `show memory statistics`, `show environment all`, `show interfaces status`, `show ip interface brief`, `show interfaces counters errors`, `show logging | last 50`
- **Cisco L2/L3:** `show vlan brief`, `show spanning-tree summary`, `show etherchannel summary`, `show cdp neighbors`, `show ip route summary`, `show ip ospf neighbor`, `show ip bgp summary`
- **Check Point (expert):** `cphaprob state`, `cphaprob -a if`, `fw stat`, `cpstat fw -f policy`, `fw ctl pstat`, `fw ctl multik stat`, `cpwd_admin list`, `df -h`, `free -m`, `top -bn1 | head -20`
- **Check Point (clish):** `show cluster state`, `show interfaces all`, `show route`, `show configuration` (or run them from expert with `clish -c "show route"`)
- **Linux:** `uptime`, `df -h`, `free -m`, `ip -br addr`, `ss -tulpn`, `systemctl --failed`, `journalctl -p err -n 50`

## 5. Files

- Back up a config: run the show command and save the text locally, or `sftp_download` a file from an SSH tab to a Windows path the user chooses.
- `sftp_read_file` / `sftp_list` to inspect files; `sftp_upload` / `sftp_write_file` change the device, so treat them like config changes (ask first).
- SFTP only works on SSH tabs whose server offers SFTP (many network devices don't).

## 6. Reporting back

Answer in the user's language (Korean if they wrote in Korean).

- Lead with the conclusion: healthy, or what's wrong and where.
- Then a short table per device or per check (item, value, status), flagging anything abnormal: errors and drops, down links, high CPU or memory, failover or cluster problems, recent critical logs.
- Quote only the relevant lines of raw output as evidence, not whole dumps.
- End with suggested next steps, and for changes, the commands you'd run (not yet run).

## 7. Leave things tidy

Don't close tabs the user opened. Close tabs you opened only if the user wants them gone. Leave the device in the mode you found it (exit config mode, turn off any `debug` you started with `undebug all`).
