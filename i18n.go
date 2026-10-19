package main

import "sync/atomic"

// Backend messages shown to the user (errors, terminal notices, dialog titles)
// follow the UI language. MCP tool output stays in English for AI clients.

var curLang atomic.Value // "ko" | "en"

var messages = map[string]map[string]string{
	"en": {
		"dlg.pickKey":          "Choose a private key",
		"dlg.downloadTo":       "Save download as",
		"dlg.uploadFiles":      "Files to upload",
		"err.sessionNotFound":  "Session not found",
		"err.decrypt":          "Couldn't decrypt the saved password: %w",
		"err.alreadyConnected": "Already connected",
		"err.notConnected":     "Not connected",
		"err.notSSH":           "Not an SSH session",
		"err.port":             "Port %d is unavailable: %w",
		"msg.userDisconnected": "Disconnected by user",
		"msg.mcpDisconnected":  "Disconnected via MCP",
		"serial.openFail":      "Couldn't open %s: %w",
		"serial.connected":     "%s connected (%d %d%s%s)",
		"serial.closed":        "Port closed",
		"ssh.keyRead":          "Couldn't read the private key: %w",
		"ssh.keyParse":         "Couldn't parse the private key: %w",
		"ssh.connecting":       "Connecting to %s...",
		"ssh.shellExitCode":    "Shell exited (code %d)",
		"ssh.shellExit":        "Shell exited",
		"ssh.noSftp":           "SFTP unavailable (the server may not support the sftp subsystem): %w",
		"ssh.hostKeyChanged":   "The host key has changed! (%s)\r\nThis could be a man-in-the-middle attack. If the device was reinstalled, remove its line from:\r\n%s",
		"ssh.hostKeySaved":     "Saved new host key: %s %s",
		"tray.open":            "Open Hopline",
		"tray.quit":            "Quit",
		"tray.mcpOn":           "MCP server running (port %d)",
		"tray.mcpOff":          "MCP server off",
	},
	"ko": {
		"dlg.pickKey":          "개인키 선택",
		"dlg.downloadTo":       "다운로드 위치",
		"dlg.uploadFiles":      "업로드할 파일",
		"err.sessionNotFound":  "세션을 찾을 수 없습니다",
		"err.decrypt":          "저장된 비밀번호 복호화 실패: %w",
		"err.alreadyConnected": "이미 연결되어 있습니다",
		"err.notConnected":     "연결되지 않음",
		"err.notSSH":           "SSH 세션이 아닙니다",
		"err.port":             "포트 %d 사용 불가: %w",
		"msg.userDisconnected": "사용자가 연결을 끊음",
		"msg.mcpDisconnected":  "MCP가 연결을 끊음",
		"serial.openFail":      "%s 열기 실패: %w",
		"serial.connected":     "%s 연결됨 (%d %d%s%s)",
		"serial.closed":        "포트가 닫혔습니다",
		"ssh.keyRead":          "개인키 읽기 실패: %w",
		"ssh.keyParse":         "개인키 해석 실패: %w",
		"ssh.connecting":       "%s 접속 중...",
		"ssh.shellExitCode":    "셸 종료 (코드 %d)",
		"ssh.shellExit":        "셸 종료",
		"ssh.noSftp":           "SFTP 사용 불가 (서버가 sftp 서브시스템을 지원하지 않을 수 있음): %w",
		"ssh.hostKeyChanged":   "호스트 키가 변경되었습니다! (%s)\r\n중간자 공격일 수 있습니다. 장비를 재설치한 경우라면 다음 파일에서 해당 줄을 지우세요:\r\n%s",
		"ssh.hostKeySaved":     "새 호스트 키 저장: %s %s",
		"tray.open":            "Hopline 열기",
		"tray.quit":            "종료",
		"tray.mcpOn":           "MCP 서버 실행 중 (포트 %d)",
		"tray.mcpOff":          "MCP 서버 꺼짐",
	},
}

// T returns the message for key in the current UI language (English fallback).
func T(key string) string {
	lang, _ := curLang.Load().(string)
	if m, ok := messages[lang][key]; ok {
		return m
	}
	return messages["en"][key]
}

// SetLanguage is called by the UI on start and whenever the language changes.
func (a *App) SetLanguage(lang string) {
	if lang != "ko" {
		lang = "en"
	}
	curLang.Store(lang)
	a.refreshTray()
}
