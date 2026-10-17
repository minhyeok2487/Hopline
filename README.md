# Hopline

MobaXterm에서 자주 쓰는 기능만 골라 만든 경량 터미널 (Go + Wails + xterm.js).

- 실행 파일: `build\bin\Hopline.exe` (단일 exe, WebView2 필요 — Windows 11 기본 탑재)
- 빌드: `wails build` (개발 모드: `wails dev`)

## 기능
- SSH 탭 + 세션 목록(폴더·검색), 빠른 접속 `user@host[:port]`
- 비밀번호 저장(Windows DPAPI 암호화), 개인키 인증, 구형 알고리즘 허용 옵션
- SFTP 패널: 탐색, 업로드(버튼/탐색기에서 끌어다 놓기), 다운로드, 이름 변경, 삭제, 새 폴더
- 시리얼(COM) 콘솔: 속도·데이터 비트·패리티·정지 비트
- 멀티 실행(체크된 탭에 동시 입력), 매크로(줄 단위 전송 + 줄 간격)
- 세션 로그 저장(ANSI 제거된 텍스트), 드래그 복사 · 우클릭 붙여넣기(여러 줄은 확인)
- 한국어 / English UI (설정 → 언어, 기본값은 Windows 언어를 따름)

## MCP 연동 (Claude Code에서 Hopline 조작)
상단 **MCP** 버튼 → "MCP 서버 켜기" → 표시된 `claude mcp add ...` 명령을 실행하면 등록됩니다 (127.0.0.1:7781, 토큰 인증).
Hopline이 실행 중일 때만 연결됩니다.

| 도구 | 설명 |
|---|---|
| `list_sessions`, `list_tabs` | 저장된 세션 / 연결된 탭 |
| `open_session` | 세션을 새 탭으로 열고 접속 대기 (비밀번호 미저장 시 앱에서 사용자에게 물어봄) |
| `run_command` | 명령 실행 후 출력 반환 (프롬프트·무출력 감지, `expect` 정규식, `--More--` 자동 넘김) |
| `send_keys`, `read_output` | 대화형 입력(Ctrl+C 등) / 최근 화면 읽기 |
| `sftp_list`, `sftp_read_file`, `sftp_write_file`, `sftp_download`, `sftp_upload` | 파일 작업 |
| `close_tab` | 탭 닫기 |

저장된 비밀번호는 MCP로 노출되지 않습니다. AI가 명령을 보내는 탭에는 잠시 **AI** 표시가 뜹니다.

## 데이터 위치
- 세션·매크로: `%APPDATA%\Hopline\data.json`
- 호스트 키: `%APPDATA%\Hopline\known_hosts` (처음 접속 시 자동 저장, 변경되면 접속 거부)
- 로그: `문서\Hopline\logs`

## 소스 구조
| 파일 | 역할 |
|---|---|
| `app.go` | 연결 관리, 입출력 이벤트, 매크로, 로그 |
| `ssh.go` | SSH 접속, PTY, keepalive, TOFU 호스트 키 |
| `sftp.go` | SFTP 목록/전송 |
| `serial.go` | COM 포트 |
| `mcp.go`, `outtap.go` | MCP 서버와 도구, 출력 캡처 |
| `store.go`, `dpapi_windows.go` | 세션/매크로 저장, 비밀번호 암호화 |
| `i18n.go`, `frontend/src/i18n.js` | 한국어/영어 언어팩 |
| `frontend/src/main.js` | UI 전체 |
