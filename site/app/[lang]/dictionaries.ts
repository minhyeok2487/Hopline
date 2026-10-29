const en = {
  meta: {
    title: "Hopline: lightweight SSH & serial terminal with an MCP server",
    description:
      "Hopline is a free, open-source SSH, Telnet, SFTP and serial terminal for Windows in a single 16 MB executable, with a built-in MCP server so AI assistants like Claude Code can work in your sessions while you watch.",
  },
  nav: { features: "Features", ai: "AI", install: "Install", faq: "FAQ", github: "GitHub" },
  hero: {
    badge: "Free and open source · Windows",
    title1: "A lightweight terminal",
    title2: "your AI can drive.",
    lead: "SSH, Telnet, SFTP and serial consoles in one 16 MB executable. A built-in MCP server lets Claude Code open your sessions, run commands and read the output, in tabs you can see.",
    download: "Download for Windows",
    github: "View on GitHub",
    meta: "{version} · {size} · no installer",
    or: "or with Scoop",
  },
  strip: ["Single 16 MB .exe", "SSH · Telnet · SFTP · Serial", "Built-in MCP server", "MIT license"],
  features: {
    title: "Everything you use every day, nothing you don't",
    lead: "Just what network engineers need for daily SSH, Telnet and serial work, kept light.",
    items: [
      { icon: "spark", title: "AI assistant in the terminal", body: "Ask about the current screen, or select output and click Ask AI. Suggested commands get Insert and Run buttons; config changes are only inserted. Uses your Claude Code, no API key." },
      { icon: "clock", title: "Scheduled checks", body: "At set times Hopline connects in the background, runs read-only commands and saves the output. The AI compares each run with the last and flags what changed." },
      { icon: "terminal", title: "SSH and Telnet tabs", body: "Saved sessions in nested folders with drag and drop, search and quick connect. Telnet answers the login prompts for older gear. Passwords are encrypted with your Windows account." },
      { icon: "import", title: "Bring your sessions", body: "Import from MobaXterm, PuTTY, SecureCRT and Xshell with their folders, in one click. Exported session files work too." },
      { icon: "folder", title: "SFTP panel", body: "Browse the active SSH tab's files over the same connection. Drag files or folders in from Explorer to upload." },
      { icon: "serial", title: "Serial console", body: "COM ports with baud, data bits, parity and stop bits, and adapter names so you pick the right USB console cable." },
      { icon: "split", title: "Split view", body: "Two tabs side by side, stacked, or four at once. Click a pane to work in it." },
      { icon: "multi", title: "Multi-exec and macros", body: "Type once into every checked tab, or send a saved command list line by line with a delay." },
      { icon: "bolt", title: "Command bar", body: "Pin the commands you use most as buttons under the tabs. Alt+1 to 9, {{variables}} asked at run time, and a confirm step for config changes." },
      { icon: "logs", title: "Session logs that read well", body: "Record every session automatically, one folder per device, a timestamp on each line. Search all logs at once and get an AI work summary." },
      { icon: "key", title: "Logon actions", body: "Expect-and-send steps after connecting: enable mode, console logins, hopping through a jump host. Hidden values stay encrypted." },
      { icon: "palette", title: "Keyword highlighting", body: "down and errors in red, up in green, IP and MAC addresses and interface names coloured, with rules you can edit." },
      { icon: "server", title: "Built-in TFTP server", body: "Serve a folder for firmware upgrades and config backups, with this PC's addresses and Cisco copy examples at hand." },
      { icon: "archive", title: "Backup and restore", body: "Sessions, macros and settings in one file. Passwords can come along, encrypted with your own passphrase." },
      { icon: "tray", title: "Tray and auto updates", body: "Close the window and the MCP server and connections stay up. New versions are verified and installed with one click." },
      { icon: "theme", title: "Comfortable to look at", body: "Dark and light themes, seven terminal colour schemes, UI scaling, Korean and English." },
    ],
  },
  ai: {
    eyebrow: "MCP integration",
    title: "Ask Claude. Watch it work.",
    lead: "Hopline runs a local MCP server. Your assistant types into real, visible tabs, and the tab it's using comes to the front with an AI badge, so nothing happens behind your back.",
    points: [
      { title: "One click to connect", body: "Connect to Claude Code registers the server and installs the hopline skill. No terminal commands to copy." },
      { title: "Many devices at once", body: "run_on_tabs opens the sessions it needs and runs the same check on every device in parallel, then reports per device." },
      { title: "Careful by default", body: "The skill keeps Claude read-only, shows exact commands before any change and waits for your approval." },
      { title: "Passwords stay with you", body: "Saved passwords never reach the AI. If a session needs one, Hopline asks you in its own window." },
    ],
    prompt: "Use hopline to check interface errors on every switch in the HQ folder and summarise them in a table. Read-only.",
    tools: "13 tools: list_sessions, list_tabs, open_session, run_command, run_on_tabs, send_keys, read_output, sftp_* and close_tab. It also works in tabs you opened yourself.",
  },
  gallery: {
    title: "A closer look",
    items: [
      { src: "/shots/main-dark.png", alt: "Sessions, tabs and a terminal in the dark theme" },
      { src: "/shots/sftp.png", alt: "SFTP panel browsing the active SSH tab" },
      { src: "/shots/guide-multi-exec.png", alt: "Multi-exec sending to two tabs" },
      { src: "/shots/settings.png", alt: "Settings dialog with terminal colour schemes" },
      { src: "/shots/light-find.png", alt: "Light theme with find in terminal" },
      { src: "/shots/mcp.png", alt: "Claude Code driving Hopline through MCP" },
    ],
  },
  promo: { title: "60 seconds with Hopline", lead: "From saved sessions to Claude running commands in your tabs." },
  install: {
    title: "Install in a minute",
    steps: [
      { title: "Download", body: "Get Hopline.zip from the latest release, unzip it anywhere and run Hopline.exe. There is no installer." },
      { title: "Run it", body: "The executable isn't code-signed yet: if SmartScreen warns, choose More info, then Run anyway." },
      { title: "Connect Claude (optional)", body: "Click MCP, then Connect to Claude Code. Open a new Claude Code session and ask away." },
    ],
    scoop: "Prefer Scoop?",
    copy: "Copy",
    copied: "Copied",
    needs: "Requires Windows 10 or 11 with the Microsoft Edge WebView2 runtime (built into Windows 11).",
    guide: "Read the user guide",
  },
  faq: {
    title: "Questions",
    items: [
      { q: "Is it really free?", a: "Yes. Hopline is open source under the MIT license, with no account, telemetry or paid tier." },
      { q: "macOS or Linux?", a: "Windows only for now. Hopline is written in Go with Wails, so other platforms are possible later." },
      { q: "Is it safe to let an AI type into my devices?", a: "The MCP server only listens on 127.0.0.1 and requires a token. Everything happens in visible tabs, and the bundled skill keeps the assistant read-only until you approve a change. Use least-privilege device accounts all the same." },
      { q: "Can I bring my sessions from MobaXterm or PuTTY?", a: "Yes. The import button above the session list finds MobaXterm, PuTTY, SecureCRT and Xshell sessions on your PC and brings them in with their folders. Passwords are not imported; Hopline asks for them on first connect." },
      { q: "Which AI assistants work?", a: "Any MCP client that supports streamable HTTP with a bearer token. One-click setup is built for Claude Code." },
    ],
  },
  footer: { made: "Made for network engineers.", license: "MIT License", releases: "Releases", guide: "User guide" },
  lang: { switch: "한국어", label: "Language" },
};

export type Dict = typeof en;

const ko: Dict = {
  meta: {
    title: "Hopline: MCP 서버를 내장한 가벼운 SSH·시리얼 터미널",
    description:
      "Hopline은 Windows용 무료 오픈소스 SSH·텔넷·SFTP·시리얼 터미널입니다. 16MB 실행 파일 하나로 동작하고, MCP 서버가 내장되어 Claude Code 같은 AI가 내 세션에서 일하는 모습을 그대로 지켜볼 수 있습니다.",
  },
  nav: { features: "기능", ai: "AI 연동", install: "설치", faq: "FAQ", github: "GitHub" },
  hero: {
    badge: "무료 · 오픈소스 · Windows",
    title1: "AI가 직접 다루는",
    title2: "가벼운 터미널.",
    lead: "SSH, 텔넷, SFTP, 시리얼 콘솔을 16MB 실행 파일 하나에 담았습니다. 내장 MCP 서버로 Claude Code가 세션을 열고 명령을 실행해 결과를 읽습니다. 모든 과정은 눈앞의 탭에서 이뤄집니다.",
    download: "Windows용 다운로드",
    github: "GitHub에서 보기",
    meta: "{version} · {size} · 설치 필요 없음",
    or: "Scoop으로 설치",
  },
  strip: ["16MB 실행 파일 하나", "SSH · 텔넷 · SFTP · 시리얼", "MCP 서버 내장", "MIT 라이선스"],
  features: {
    title: "매일 쓰는 기능만, 가볍게",
    lead: "네트워크 엔지니어가 매일 하는 SSH·텔넷·시리얼 작업에 필요한 것만 담아 가볍게 만들었습니다.",
    items: [
      { icon: "spark", title: "터미널 속 AI 도우미", body: "지금 화면에 대해 묻거나, 출력을 선택해 AI에게 묻기를 누르세요. 제안한 명령은 입력·실행 버튼으로 보내고, 설정 변경은 입력만 됩니다. 설치된 Claude Code를 써서 API 키가 필요 없습니다." },
      { icon: "clock", title: "정기 점검", body: "정해둔 시각에 백그라운드로 접속해 조회 명령을 실행하고 결과를 저장합니다. AI가 지난번 결과와 비교해 달라진 점을 알려 줍니다." },
      { icon: "terminal", title: "SSH·텔넷 탭과 세션 관리", body: "폴더 안의 폴더, 끌어서 정리, 검색, 빠른 접속. 오래된 장비는 텔넷으로, 로그인 프롬프트에 자동 입력합니다. 비밀번호는 Windows 계정으로 암호화합니다." },
      { icon: "import", title: "쓰던 세션 그대로", body: "MobaXterm, PuTTY, SecureCRT, Xshell의 세션을 폴더 구조째 한 번에 가져옵니다. 내보낸 세션 파일도 됩니다." },
      { icon: "folder", title: "SFTP 패널", body: "지금 보고 있는 SSH 탭의 파일을 같은 연결로 탐색합니다. 탐색기에서 파일이나 폴더를 끌어다 놓으면 업로드됩니다." },
      { icon: "serial", title: "시리얼 콘솔", body: "속도, 데이터 비트, 패리티, 정지 비트 설정. 어댑터 이름이 함께 보여 USB 콘솔 케이블을 바로 고를 수 있습니다." },
      { icon: "split", title: "화면 나누기", body: "탭 2개를 좌우나 위아래로, 또는 4개를 한 화면에. 칸을 클릭해 바로 작업합니다." },
      { icon: "multi", title: "멀티 실행과 매크로", body: "한 번 입력하면 체크한 모든 탭에 전송됩니다. 자주 쓰는 명령 묶음은 줄 간격을 두고 한 줄씩 보냅니다." },
      { icon: "bolt", title: "명령 버튼 바", body: "자주 쓰는 명령을 탭 아래 버튼으로. Alt+숫자로 실행하고, {{변수}}는 실행할 때 묻고, 설정 변경은 한 번 더 확인합니다." },
      { icon: "logs", title: "읽기 좋은 세션 로그", body: "모든 세션 자동 기록, 장비별 폴더, 줄마다 시각. 전체 로그를 한 번에 검색하고 AI 작업 요약까지 받습니다." },
      { icon: "key", title: "자동 로그온", body: "접속 후 기다릴 문자열과 보낼 내용을 자동 실행합니다. enable, 콘솔 로그인, 점프 서버 경유까지. 숨김 값은 암호화됩니다." },
      { icon: "palette", title: "키워드 강조", body: "down과 error는 빨강, up은 초록, IP·MAC 주소와 인터페이스 이름에도 색이 들어갑니다. 규칙은 직접 바꿀 수 있습니다." },
      { icon: "server", title: "내장 TFTP 서버", body: "펌웨어 업그레이드와 설정 백업용 폴더를 바로 엽니다. 이 PC 주소와 Cisco copy 예시까지 한눈에." },
      { icon: "archive", title: "백업과 복원", body: "세션, 매크로, 설정을 파일 하나로. 비밀번호도 직접 정한 암호로 암호화해 함께 옮길 수 있습니다." },
      { icon: "tray", title: "트레이 실행과 자동 업데이트", body: "창을 닫아도 MCP 서버와 연결이 유지됩니다. 새 버전은 검증 후 버튼 한 번으로 설치합니다." },
      { icon: "theme", title: "보기 편한 화면", body: "다크·라이트 테마, 터미널 색 테마 7종, UI 크기 조절, 한국어·영어." },
    ],
  },
  ai: {
    eyebrow: "MCP 연동",
    title: "Claude에게 맡기고, 지켜보세요.",
    lead: "Hopline은 로컬 MCP 서버를 띄웁니다. AI는 눈에 보이는 실제 탭에 입력하고, 사용 중인 탭은 앞으로 나와 AI 표시가 붙습니다. 몰래 일어나는 일은 없습니다.",
    points: [
      { title: "버튼 한 번으로 연결", body: "Claude Code에 연결을 누르면 서버 등록과 hopline 스킬 설치가 끝납니다. 명령을 복사할 필요가 없습니다." },
      { title: "여러 장비를 한 번에", body: "run_on_tabs가 필요한 세션을 열고 모든 장비에 같은 점검을 동시에 실행한 뒤 장비별로 결과를 돌려줍니다." },
      { title: "기본은 조심스럽게", body: "스킬이 Claude를 조회 전용으로 두고, 설정 변경 전에는 정확한 명령을 보여 준 뒤 승인을 기다립니다." },
      { title: "비밀번호는 내 손에", body: "저장된 비밀번호는 AI에 전달되지 않습니다. 필요하면 Hopline 창에서 직접 묻습니다." },
    ],
    prompt: "hopline으로 본사 폴더 스위치 전부 인터페이스 에러 확인해서 표로 정리해줘. 조회만 해.",
    tools: "도구 13개: list_sessions, list_tabs, open_session, run_command, run_on_tabs, send_keys, read_output, sftp_*, close_tab. 내가 직접 연 탭에서도 동작합니다.",
  },
  gallery: {
    title: "화면 둘러보기",
    items: [
      { src: "/shots/main-dark.png", alt: "다크 테마의 세션 목록, 탭, 터미널" },
      { src: "/shots/sftp.png", alt: "SSH 탭의 파일을 보여 주는 SFTP 패널" },
      { src: "/shots/guide-multi-exec.png", alt: "두 탭에 동시에 입력하는 멀티 실행" },
      { src: "/shots/settings.png", alt: "터미널 색 테마가 보이는 설정 창" },
      { src: "/shots/light-find.png", alt: "라이트 테마와 터미널 찾기" },
      { src: "/shots/mcp.png", alt: "MCP로 Hopline을 조작하는 Claude Code" },
    ],
  },
  promo: { title: "60초로 보는 Hopline", lead: "세션 저장부터 Claude가 탭에서 명령을 실행하는 모습까지." },
  install: {
    title: "1분이면 설치 끝",
    steps: [
      { title: "다운로드", body: "최신 릴리스에서 Hopline.zip을 받아 아무 폴더에나 압축을 풀고 Hopline.exe를 실행하세요. 설치 과정이 없습니다." },
      { title: "실행", body: "아직 코드 서명이 없어 SmartScreen 경고가 뜰 수 있습니다. 추가 정보 → 실행을 누르세요." },
      { title: "Claude 연결 (선택)", body: "MCP 버튼 → Claude Code에 연결을 누르고, Claude Code에서 새 세션을 열어 요청하세요." },
    ],
    scoop: "Scoop을 쓰신다면",
    copy: "복사",
    copied: "복사됨",
    needs: "Windows 10/11과 Microsoft Edge WebView2 런타임이 필요합니다(Windows 11에는 기본 포함).",
    guide: "사용 가이드 보기",
  },
  faq: {
    title: "자주 묻는 질문",
    items: [
      { q: "정말 무료인가요?", a: "네. MIT 라이선스 오픈소스이고, 계정이나 사용 기록 수집, 유료 버전이 없습니다." },
      { q: "macOS나 Linux에서도 되나요?", a: "지금은 Windows 전용입니다. Go와 Wails로 만들어서 나중에 다른 OS도 지원할 수 있습니다." },
      { q: "AI가 장비에 입력해도 안전한가요?", a: "MCP 서버는 127.0.0.1에서만 열리고 토큰이 있어야 접속됩니다. 모든 작업은 보이는 탭에서 이뤄지고, 함께 설치되는 스킬이 승인 전까지 조회만 하게 합니다. 그래도 장비 계정은 필요한 권한만 가진 계정을 쓰세요." },
      { q: "MobaXterm이나 PuTTY에서 쓰던 세션을 옮길 수 있나요?", a: "네. 세션 목록 위의 가져오기 버튼을 누르면 이 PC의 MobaXterm, PuTTY, SecureCRT, Xshell 세션을 찾아 폴더 구조째 가져옵니다. 비밀번호는 가져오지 않고, 처음 접속할 때 묻습니다." },
      { q: "어떤 AI와 쓸 수 있나요?", a: "토큰 인증을 쓰는 HTTP 방식의 MCP를 지원하는 클라이언트면 됩니다. 원클릭 설정은 Claude Code용입니다." },
    ],
  },
  footer: { made: "네트워크 엔지니어를 위해 만들었습니다.", license: "MIT 라이선스", releases: "릴리스", guide: "사용 가이드" },
  lang: { switch: "English", label: "언어" },
};

const dictionaries = { en, ko } as const;

export type Locale = keyof typeof dictionaries;
export const locales: Locale[] = ["ko", "en"];

export const hasLocale = (locale: string): locale is Locale => locale in dictionaries;

export const getDictionary = (locale: Locale): Dict => dictionaries[locale];
