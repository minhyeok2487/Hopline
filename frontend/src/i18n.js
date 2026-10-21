// UI language packs. t('key', {var}) fills {var} placeholders.
// Strings are trusted app text; a few contain simple markup (<b>, <br>) and are inserted as HTML.

export const LANGS = {ko: '한국어', en: 'English'};

const ko = {
    // time
    'time.now': '방금', 'time.min': '{n}분 전', 'time.hour': '{n}시간 전', 'time.day': '{n}일 전',
    // common
    'common.ok': '확인', 'common.cancel': '취소', 'common.save': '저장', 'common.delete': '삭제', 'common.close': '닫기',
    'common.edit': '편집', 'common.duplicate': '복제', 'common.connect': '연결', 'common.create': '만들기', 'common.run': '실행', 'common.name': '이름',
    'common.port': '포트', 'common.find': '찾기', 'common.rename': '이름 바꾸기', 'common.clear': '화면 지우기',
    'common.retry': '다시 시도', 'common.browse': '찾기',
    // static chrome
    'side.collapse': '사이드바 숨기기 (Ctrl+Shift+B)', 'side.open': '사이드바 보이기 (Ctrl+Shift+B)',
    'side.sessions': '세션', 'side.sftp': 'SFTP', 'side.macros': '매크로',
    'sess.search': '세션 검색', 'sess.new': '새 세션',
    'sftp.up': '상위 폴더', 'sftp.crumbs': '클릭해서 경로 입력', 'sftp.refresh': '새로고침', 'sftp.upload': '업로드', 'sftp.newFolder': '새 폴더',
    'macro.hint': '멀티 실행 중이면 체크된 탭 전체에 실행합니다', 'macro.new': '새 매크로',
    'resizer': '드래그해서 너비 조절',
    'quick.ph': '빠른 접속  user@host[:port]',
    'top.multi': '멀티 실행', 'top.multiTip': '입력을 체크된 모든 탭에 동시 전송', 'top.log': '로그', 'top.logTip': '현재 탭 로그 저장',
    'top.logdir': '로그 폴더 열기', 'top.mcp': 'MCP 연동', 'top.settings': '설정',
    'empty.title': '어디에 접속할까요?',
    'keys.nextTab': '다음 탭', 'keys.find': '터미널에서 찾기', 'keys.zoom': '글자 크기', 'keys.sidebar': '사이드바',
    'keys.drag': '드래그 / 우클릭', 'keys.copyPaste': '복사 / 붙여넣기', 'keys.settings': '설정',
    // password
    'pw.label': '비밀번호', 'pw.save': '비밀번호 저장 (Windows 계정으로 암호화)', 'pw.connect': '접속', 'pw.title': '{name} 비밀번호',
    // sessions
    'sess.noMatch': '"{q}"와 일치하는 세션이 없습니다', 'sess.none': '저장된 세션이 없습니다', 'sess.create': '새 세션 만들기',
    'sess.newFolder': '새 폴더', 'sess.newSub': '새 하위 폴더', 'sess.newHere': '이 폴더에 새 세션', 'sess.renameFolder': '폴더 이름 바꾸기',
    'sess.deleteFolder': '폴더 삭제', 'sess.deleteFolderBody': '"{name}" 폴더를 삭제할까요? 안에 있는 세션 {n}개와 하위 폴더는 지워지지 않고 한 단계 위로 옮겨집니다.',
    'sess.connectAll': '모두 접속 ({n}개)', 'sess.connectAllBody': '"{name}" 폴더의 세션 {n}개를 모두 접속할까요?', 'sess.folderEmpty': '폴더에 세션이 없습니다',
    'sess.moveTo': '폴더로 이동…', 'sess.moveTitle': '폴더로 이동', 'sess.rootFolder': '(최상위)', 'sess.folderName': '폴더 이름',
    'sess.folderPathHint': '/로 구분하면 하위 폴더가 됩니다 (예: 본사/서버실). 세션을 폴더로 끌어다 놓아 옮길 수 있습니다.', 'sess.createIn': '{p} 안에 만듭니다',
    'sess.folderIntoSelf': '폴더를 자기 안으로 옮길 수 없습니다', 'sess.collapseAll': '모든 폴더 접기', 'sess.expandAll': '모든 폴더 펼치기',
    'sess.liveTabs': '연결된 탭 {n}개', 'sess.edit': '세션 편집', 'sess.copySuffix': '복사본',
    'sess.deleteTitle': '세션 삭제', 'sess.deleteBody': '"{name}" 세션을 삭제할까요? 저장된 비밀번호도 함께 지워집니다.',
    'sess.saved': '"{name}" 세션을 저장했습니다', 'sess.saveFailed': '저장하지 못했습니다: {e}',
    'sess.needHost': '호스트를 입력하세요', 'sess.needCom': 'COM 포트를 선택하세요',
    // session form
    'f.kind': '종류', 'f.serial': '시리얼 (COM)', 'f.namePh': '비우면 호스트명', 'f.folder': '폴더', 'f.folderPh': '예: 본사/서버실',
    'f.secConn': '연결', 'f.host': '호스트', 'f.hostPh': '예: 10.0.0.1', 'f.user': '사용자', 'f.secAuth': '인증',
    'f.pwSaved': '저장됨 · 바꿀 때만 입력', 'f.pwAsk': '비우면 접속할 때 물어봄', 'f.key': '개인키', 'f.optional': '선택 사항',
    'f.legacy': '구형 알고리즘 허용 (오래된 스위치·방화벽)', 'f.secPort': '포트 설정', 'f.rescan': '포트 다시 찾기',
    'f.baud': '속도', 'f.dataBits': '데이터 비트', 'f.parity': '패리티', 'f.parityN': '없음', 'f.parityE': '짝수', 'f.parityO': '홀수',
    'set.highlight': '키워드 강조', 'set.highlightOn': 'down·error·IP 같은 단어에 색 입히기',
    'hl.edit': '규칙 편집…', 'hl.title': '키워드 강조 규칙', 'hl.add': '규칙 추가', 'hl.reset': '기본값으로',
    'hl.hint': '장비 출력에서 정규식과 맞는 글자에 색을 입힙니다. 위에 있는 규칙이 먼저 적용됩니다. 여러 단어는 | 로 구분하고 단어 단위로 찾으려면 \\b로 감싸세요 (예: \\b(down|error)\\b).',
    'hl.on': '사용', 'hl.name': '이름', 'hl.pattern': '찾을 글자 (정규식)', 'hl.color': '색', 'hl.ci': '대소문자 무시',
    'hl.namePh': '예: 내 장비', 'hl.patternPh': '예: \\bcore-sw\\d+\\b', 'hl.bad': '잘못된 정규식 "{p}": {e}',
    'hl.c.red': '빨강', 'hl.c.yellow': '노랑', 'hl.c.green': '초록', 'hl.c.blue': '파랑', 'hl.c.cyan': '하늘', 'hl.c.magenta': '보라',
    'hl.r.sev': 'Cisco 심각 로그 (%..-0~3-..)', 'hl.r.bad': '오류·다운', 'hl.r.warn': '경고·대기', 'hl.r.good': '정상·연결',
    'hl.r.addr': 'IP·MAC 주소', 'hl.r.intf': '인터페이스 이름',
    'set.secUpdate': '업데이트', 'set.version': '현재 버전', 'set.checkNow': '지금 확인', 'set.updateCheck': '시작할 때 새 버전 확인',
    'upd.title': '새 버전이 있습니다', 'upd.body': 'Hopline <b>v{latest}</b>이(가) 나왔습니다. 지금 버전은 v{current}입니다. 업데이트할까요?',
    'upd.tabs': '업데이트하면 Hopline이 다시 시작되면서 열린 연결 {n}개가 끊깁니다.', 'upd.now': '업데이트', 'upd.notes': '변경 사항 보기',
    'upd.skip': '이 버전 건너뛰기', 'upd.skipped': 'v{v}은(는) 자동으로 묻지 않습니다. 설정 › 업데이트에서 직접 확인할 수 있습니다.',
    'upd.downloading': '내려받는 중…', 'upd.restarting': '검증 완료. Hopline을 다시 시작합니다…',
    'upd.scoop': 'Scoop으로 설치한 Hopline입니다. 터미널에서 scoop update hopline 을 실행하세요(명령을 복사했습니다).',
    'upd.manual': '이 폴더에는 파일을 바꿀 수 없어 릴리스 페이지를 열었습니다. 새 파일을 내려받아 바꿔 주세요.',
    'upd.failed': '업데이트하지 못했습니다: {e}', 'upd.latest': '최신 버전입니다 (v{v})', 'upd.checkFailed': '업데이트를 확인하지 못했습니다: {e}',
    'upd.done': 'v{v}(으)로 업데이트했습니다',
    'set.secWindow': '창', 'set.closeToTray': '닫기 버튼을 누르면 트레이로 숨기기 (MCP 서버와 연결 유지)',
    'set.autostart': 'Windows 시작 시 트레이로 실행',
    'tray.title': '창을 닫으면 트레이로 숨겨집니다', 'tray.hide': '트레이로 숨기기', 'tray.quitNow': '지금 완전히 종료',
    'tray.body': 'Hopline은 작업 표시줄 오른쪽 알림 영역에서 계속 실행되어 MCP 서버와 열린 연결이 유지됩니다. 트레이 아이콘을 클릭하면 창이 다시 열리고, 완전히 끄려면 아이콘을 우클릭해 <b>종료</b>를 누르세요.',
    'tray.change': '설정 › 창에서 닫기 동작을 바꿀 수 있습니다.',
    'mcp.connectClaude': 'Claude Code에 연결', 'mcp.copyPrompt': 'Claude용 설정 문구 복사', 'mcp.manual': '직접 등록',
    'mcp.claudeHint': '[Claude Code에 연결]은 MCP 서버를 켜고 Claude Code 등록과 hopline 스킬 설치를 한 번에 합니다. claude 명령이 없거나 다른 PC의 Claude에 설정하려면 설정 문구를 복사해 Claude Code 채팅에 붙여넣으세요. 끝나면 Claude Code에서 새 세션을 여세요.',
    'mcp.claudeDone': 'Claude Code에 hopline을 등록하고 스킬을 설치했습니다. Claude Code에서 새 세션을 열면 바로 쓸 수 있습니다.',
    'mcp.noCli': 'claude 명령을 찾지 못해 스킬만 설치했습니다. [Claude용 설정 문구 복사]를 눌러 Claude Code 채팅에 붙여넣으세요.',
    'mcp.skillKept': '(직접 고친 스킬 파일은 그대로 두었습니다)',
    'mcp.promptCopied': '설정 문구를 복사했습니다. Claude Code 채팅에 붙여넣으면 Claude가 등록과 스킬 설치를 합니다.',
    'lg.sec': '자동 로그온', 'lg.enable': '접속하면 아래 단계를 자동으로 실행', 'lg.cr': '먼저 Enter 보내기 (시리얼 콘솔 깨우기)',
    'lg.expect': '기다릴 문자열 (Expect)', 'lg.send': '보낼 내용 (Send)', 'lg.hide': '숨김', 'lg.add': '단계 추가', 'lg.preset': 'enable 예시 추가',
    'lg.expectPh': '예: Password:', 'lg.sendPh': 'Enter는 자동으로 붙음', 'lg.secretSaved': '저장됨 · 바꿀 때만 입력', 'lg.secretPh': '비밀번호 등 숨길 값',
    'lg.up': '위로', 'lg.down': '아래로', 'lg.none': '단계가 없습니다. 단계 추가나 enable 예시로 시작하세요.',
    'lg.hint': '화면에 Expect 문자열이 나오면 Send 내용을 입력하고 Enter를 누릅니다. Expect를 비우면 바로 보냅니다. 장비를 거쳐 들어갈 때는 ssh/telnet 명령과 로그인 단계를 이어서 적으세요. 숨김 값은 Windows 계정으로 암호화되어 저장되고 AI에게는 전달되지 않습니다.',
    'lg.needSecret': '숨김 단계에 보낼 값을 입력하세요',
    'lg.err.timeout': '자동 로그온 {step}/{total}단계: "{expect}"이(가) 30초 동안 나오지 않아 중단했습니다',
    'lg.err.closed': '자동 로그온 중 연결이 끊겼습니다', 'lg.err.decrypt': '자동 로그온: 저장된 숨김 값을 복호화하지 못했습니다',
    'lg.err.write': '자동 로그온: 입력을 보내지 못했습니다',
    'f.stopBits': '정지 비트', 'f.scanning': '찾는 중…', 'f.noPorts': '(연결된 COM 포트 없음)', 'f.portMissing': '{p} (연결 안 됨)',
    // recents / quick connect
    'recent.title': '최근 접속',
    'recent.empty': '왼쪽 목록에서 세션을 더블클릭하거나, 위의 빠른 접속에 <b>user@host</b>를 입력하세요.',
    'quick.format': 'user@host 또는 user@host:port 형식으로 입력하세요', 'quick.userTitle': '사용자 이름', 'quick.userFor': '{host}에 접속할 계정',
    // connection
    'conn.connecting': '접속 중', 'conn.sec': '{s}초', 'conn.reconnect': '재접속', 'conn.closeTab': '탭 닫기',
    'conn.authFailed': '인증 실패', 'conn.pwCanceled': '비밀번호 입력을 취소했습니다', 'conn.canceled': '접속을 취소했습니다',
    'conn.failed': '접속 실패', 'conn.lost': '연결 끊김',
    // terminal
    'term.copy': '복사', 'term.paste': '붙여넣기', 'term.selectAll': '모두 선택',
    'paste.title': '여러 줄 붙여넣기', 'paste.body': '{n}줄을 <b>{name}</b>에 붙여넣습니다. 각 줄이 명령으로 실행될 수 있습니다.', 'paste.ok': '{n}줄 붙여넣기',
    'tab.closeTitle': '탭 닫기', 'tab.closeBody': '<b>{name}</b> 연결을 끊고 탭을 닫을까요?', 'tab.multiTarget': '멀티 실행 대상', 'tab.closeOthers': '다른 탭 모두 닫기',
    'multi.on': '멀티 실행: 입력이 체크된 모든 탭으로 전송됩니다',
    'log.needConn': '연결된 탭에서만 로그를 저장할 수 있습니다', 'log.started': '로그 저장 시작: {p}', 'log.stopped': '로그 저장을 멈췄습니다',
    'find.prev': '이전 (Shift+Enter)', 'find.next': '다음 (Enter)', 'find.close': '닫기 (Esc)', 'find.none': '없음',
    'zoom.size': '글자 크기 {n}px',
    // status bar
    'sb.open': '연결됨', 'sb.connecting': '접속 중', 'sb.closed': '연결 끊김', 'sb.logging': '로그 저장 중', 'sb.none': '연결 없음',
    'sb.multi': '멀티 실행 · {n}개 탭', 'sb.xfer': '전송 {n}개',
    // sftp
    'sftp.pick': '연결된 SSH 탭을 선택하면<br>파일 목록이 여기에 표시됩니다', 'sftp.emptyDir': '빈 폴더<br>파일을 끌어다 놓으면 업로드합니다',
    'sftp.open': '열기', 'sftp.download': '다운로드', 'sftp.copyPath': '경로 복사', 'sftp.pathCopied': '경로를 복사했습니다', 'sftp.newName': '새 이름',
    'sftp.deleteEmpty': '삭제 (빈 폴더만)', 'sftp.deleteBody': '<b>{p}</b>를 서버에서 삭제할까요? 되돌릴 수 없습니다.', 'sftp.deleted': '{name} 삭제됨',
    'sftp.createIn': '{p} 안에 만듭니다', 'sftp.dropHint': 'SFTP 패널을 열고 연결된 SSH 탭에 끌어다 놓으세요', 'sftp.done': '{name} 전송 완료',
    // macros
    'macro.lines': '{n}줄', 'macro.empty': '자주 쓰는 명령 묶음을<br>매크로로 저장해 두세요', 'macro.edit': '매크로 편집',
    'macro.noTarget': '실행할 연결된 탭이 없습니다', 'macro.ran': '"{name}" 실행 → {n}개 탭', 'macro.namePh': '예: 기본 점검',
    'macro.body': '명령 (한 줄에 하나씩, 줄마다 Enter를 보냅니다)', 'macro.delay': '줄 간격', 'macro.needName': '이름을 입력하세요',
    'macro.deleteTitle': '매크로 삭제', 'macro.deleteBody': '"{name}" 매크로를 삭제할까요?',
    // settings
    'set.title': '설정', 'set.secView': '화면', 'set.lang': '언어', 'set.langAuto': '자동 (Windows 언어)',
    'set.uiScale': 'UI 크기', 'set.theme': '앱 테마', 'set.system': '시스템', 'set.dark': '다크', 'set.light': '라이트',
    'set.secTerm': '터미널', 'set.scheme': '색 테마', 'set.schemeAuto': '자동 (앱 테마 따라감)', 'set.font': '글꼴', 'set.fontSize': '글자 크기',
    'set.lineHeight': '줄 간격', 'set.cursor': '커서', 'set.block': '블록', 'set.bar': '막대', 'set.underline': '밑줄', 'set.blink': '깜빡임',
    'set.scrollback': '스크롤백', 'set.lines': '줄', 'set.secBehavior': '동작',
    'set.copyOnSelect': '드래그로 선택하면 바로 복사', 'set.rightClickPaste': '우클릭으로 붙여넣기 (Shift+우클릭은 메뉴)',
    'set.confirmMultiline': '여러 줄을 붙여넣기 전에 확인', 'set.confirmClose': '연결된 탭을 닫기 전에 확인', 'set.saved': '설정을 저장했습니다',
    // mcp
    'mcp.noSession': '세션 없음', 'mcp.opening': 'AI가 "{name}" 세션을 엽니다', 'mcp.running': 'MCP 서버 실행 중 ({url})', 'mcp.off': 'MCP 서버 꺼짐',
    'mcp.title': 'MCP 연동', 'mcp.enable': 'MCP 서버 켜기 (127.0.0.1 전용)', 'mcp.status': '상태', 'mcp.statusOn': '실행 중', 'mcp.statusOff': '꺼짐',
    'mcp.cmdLabel': 'Claude Code 등록 명령 (토큰 포함 · 다른 사람과 공유하지 마세요)', 'mcp.copyCmd': '명령 복사', 'mcp.regen': '토큰 재발급',
    'mcp.hint': 'AI가 저장된 세션을 탭으로 열고 명령을 실행해 결과를 읽습니다. 저장된 비밀번호는 AI에 전달되지 않습니다.',
    'mcp.apply': '적용', 'mcp.copied': '명령을 복사했습니다', 'mcp.regenDone': '토큰을 재발급했습니다. [Claude Code에 연결]을 다시 누르세요.',
    'mcp.startedAt': 'MCP 서버 실행 중: {url}', 'mcp.stopped': 'MCP 서버를 껐습니다',
};

const en = {
    'time.now': 'just now', 'time.min': '{n}m ago', 'time.hour': '{n}h ago', 'time.day': '{n}d ago',
    'common.ok': 'OK', 'common.cancel': 'Cancel', 'common.save': 'Save', 'common.delete': 'Delete', 'common.close': 'Close',
    'common.edit': 'Edit', 'common.duplicate': 'Duplicate', 'common.connect': 'Connect', 'common.create': 'Create', 'common.run': 'Run', 'common.name': 'Name',
    'common.port': 'Port', 'common.find': 'Find', 'common.rename': 'Rename', 'common.clear': 'Clear screen',
    'common.retry': 'Retry', 'common.browse': 'Browse',
    'side.collapse': 'Hide sidebar (Ctrl+Shift+B)', 'side.open': 'Show sidebar (Ctrl+Shift+B)',
    'side.sessions': 'Sessions', 'side.sftp': 'SFTP', 'side.macros': 'Macros',
    'sess.search': 'Search sessions', 'sess.new': 'New session',
    'sftp.up': 'Parent folder', 'sftp.crumbs': 'Click to type a path', 'sftp.refresh': 'Refresh', 'sftp.upload': 'Upload', 'sftp.newFolder': 'New folder',
    'macro.hint': 'Runs on every checked tab while multi-exec is on', 'macro.new': 'New macro',
    'resizer': 'Drag to resize',
    'quick.ph': 'Quick connect  user@host[:port]',
    'top.multi': 'Multi-exec', 'top.multiTip': 'Send input to every checked tab', 'top.log': 'Log', 'top.logTip': 'Log the current tab to a file',
    'top.logdir': 'Open log folder', 'top.mcp': 'MCP integration', 'top.settings': 'Settings',
    'empty.title': 'Where to?',
    'keys.nextTab': 'Next tab', 'keys.find': 'Find in terminal', 'keys.zoom': 'Font size', 'keys.sidebar': 'Sidebar',
    'keys.drag': 'Drag / Right-click', 'keys.copyPaste': 'Copy / Paste', 'keys.settings': 'Settings',
    'pw.label': 'Password', 'pw.save': 'Save password (encrypted with your Windows account)', 'pw.connect': 'Connect', 'pw.title': 'Password for {name}',
    'sess.noMatch': 'No sessions match "{q}"', 'sess.none': 'No saved sessions yet', 'sess.create': 'Create a session',
    'sess.newFolder': 'New folder', 'sess.newSub': 'New subfolder', 'sess.newHere': 'New session here', 'sess.renameFolder': 'Rename folder',
    'sess.deleteFolder': 'Delete folder', 'sess.deleteFolderBody': 'Delete the folder "{name}"? Its {n} session(s) and subfolders are kept and move up one level.',
    'sess.connectAll': 'Connect all ({n})', 'sess.connectAllBody': 'Connect all {n} sessions in "{name}"?', 'sess.folderEmpty': 'This folder has no sessions',
    'sess.moveTo': 'Move to folder…', 'sess.moveTitle': 'Move to folder', 'sess.rootFolder': '(top level)', 'sess.folderName': 'Folder name',
    'sess.folderPathHint': 'Use / for subfolders (e.g. HQ/Server room). Drag sessions onto a folder to move them.', 'sess.createIn': 'Created inside {p}',
    'sess.folderIntoSelf': 'A folder can\'t be moved into itself', 'sess.collapseAll': 'Collapse all folders', 'sess.expandAll': 'Expand all folders',
    'sess.liveTabs': '{n} connected tab(s)', 'sess.edit': 'Edit session', 'sess.copySuffix': 'copy',
    'sess.deleteTitle': 'Delete session', 'sess.deleteBody': 'Delete "{name}"? Its saved password is removed too.',
    'sess.saved': 'Saved "{name}"', 'sess.saveFailed': 'Couldn\'t save: {e}',
    'sess.needHost': 'Enter a host', 'sess.needCom': 'Choose a COM port',
    'f.kind': 'Type', 'f.serial': 'Serial (COM)', 'f.namePh': 'Defaults to the host name', 'f.folder': 'Folder', 'f.folderPh': 'e.g. HQ/Server room',
    'f.secConn': 'Connection', 'f.host': 'Host', 'f.hostPh': 'e.g. 10.0.0.1', 'f.user': 'User', 'f.secAuth': 'Authentication',
    'f.pwSaved': 'Saved · type only to change', 'f.pwAsk': 'Leave empty to be asked when connecting', 'f.key': 'Private key', 'f.optional': 'Optional',
    'f.legacy': 'Allow legacy algorithms (older switches and firewalls)', 'f.secPort': 'Port settings', 'f.rescan': 'Rescan ports',
    'f.baud': 'Baud rate', 'f.dataBits': 'Data bits', 'f.parity': 'Parity', 'f.parityN': 'None', 'f.parityE': 'Even', 'f.parityO': 'Odd',
    'set.highlight': 'Keyword highlighting', 'set.highlightOn': 'Colour words like down, error and IP addresses',
    'hl.edit': 'Edit rules…', 'hl.title': 'Keyword highlighting rules', 'hl.add': 'Add rule', 'hl.reset': 'Reset to defaults',
    'hl.hint': 'Text in device output that matches a regular expression is coloured. Rules higher in the list win. Separate words with | and wrap them in \\b to match whole words (e.g. \\b(down|error)\\b).',
    'hl.on': 'On', 'hl.name': 'Name', 'hl.pattern': 'Match (regular expression)', 'hl.color': 'Colour', 'hl.ci': 'Ignore case',
    'hl.namePh': 'e.g. My devices', 'hl.patternPh': 'e.g. \\bcore-sw\\d+\\b', 'hl.bad': 'Invalid regular expression "{p}": {e}',
    'hl.c.red': 'Red', 'hl.c.yellow': 'Yellow', 'hl.c.green': 'Green', 'hl.c.blue': 'Blue', 'hl.c.cyan': 'Cyan', 'hl.c.magenta': 'Magenta',
    'hl.r.sev': 'Cisco severe logs (%..-0..3-..)', 'hl.r.bad': 'Errors, down', 'hl.r.warn': 'Warnings, standby', 'hl.r.good': 'Healthy, connected',
    'hl.r.addr': 'IP and MAC addresses', 'hl.r.intf': 'Interface names',
    'set.secUpdate': 'Updates', 'set.version': 'Version', 'set.checkNow': 'Check now', 'set.updateCheck': 'Check for a new version on start',
    'upd.title': 'A new version is available', 'upd.body': 'Hopline <b>v{latest}</b> is out (you have v{current}). Update now?',
    'upd.tabs': 'Hopline restarts to update, which closes {n} open connection(s).', 'upd.now': 'Update', 'upd.notes': 'What\'s new',
    'upd.skip': 'Skip this version', 'upd.skipped': 'You won\'t be asked about v{v} again. Check any time in Settings › Updates.',
    'upd.downloading': 'Downloading…', 'upd.restarting': 'Verified. Restarting Hopline…',
    'upd.scoop': 'This Hopline was installed with Scoop: run scoop update hopline in a terminal (command copied).',
    'upd.manual': 'Hopline can\'t replace files in its folder, so the release page was opened. Download the new file and swap it in.',
    'upd.failed': 'Update failed: {e}', 'upd.latest': 'You\'re up to date (v{v})', 'upd.checkFailed': 'Couldn\'t check for updates: {e}',
    'upd.done': 'Updated to v{v}',
    'set.secWindow': 'Window', 'set.closeToTray': 'Closing the window hides it to the tray (keeps the MCP server and connections)',
    'set.autostart': 'Start in the tray when Windows starts',
    'tray.title': 'Hopline keeps running in the tray', 'tray.hide': 'Hide to tray', 'tray.quitNow': 'Quit now',
    'tray.body': 'Closing the window keeps Hopline running in the notification area, so the MCP server and open connections stay up. Click the tray icon to bring the window back; right-click it and choose <b>Quit</b> to exit.',
    'tray.change': 'You can change this in Settings › Window.',
    'mcp.connectClaude': 'Connect to Claude Code', 'mcp.copyPrompt': 'Copy setup prompt for Claude', 'mcp.manual': 'Manual setup',
    'mcp.claudeHint': 'Connect to Claude Code turns the MCP server on, registers it with Claude Code and installs the hopline skill in one step. Without the claude command, copy the setup prompt and paste it into a Claude Code chat instead. Then open a new Claude Code session.',
    'mcp.claudeDone': 'Registered hopline with Claude Code and installed the skill. Open a new Claude Code session to use it.',
    'mcp.noCli': 'The claude command wasn\'t found, so only the skill was installed. Use Copy setup prompt for Claude and paste it into a Claude Code chat.',
    'mcp.skillKept': '(your edited skill file was left as is)',
    'mcp.promptCopied': 'Setup prompt copied. Paste it into a Claude Code chat and Claude will register the server and install the skill.',
    'lg.sec': 'Logon actions', 'lg.enable': 'Run these steps after connecting', 'lg.cr': 'Send Enter first (wakes a serial console)',
    'lg.expect': 'Expect', 'lg.send': 'Send', 'lg.hide': 'Hide', 'lg.add': 'Add step', 'lg.preset': 'Add enable example',
    'lg.expectPh': 'e.g. Password:', 'lg.sendPh': 'Enter is added', 'lg.secretSaved': 'Saved · type only to change', 'lg.secretPh': 'Password or other secret',
    'lg.up': 'Move up', 'lg.down': 'Move down', 'lg.none': 'No steps yet. Start with Add step or the enable example.',
    'lg.hint': 'When the Expect text appears, Hopline types Send and presses Enter. An empty Expect sends right away. To hop through devices, add the ssh/telnet command and its login steps in order. Hidden values are encrypted with your Windows account and never passed to AI assistants.',
    'lg.needSecret': 'Enter the value for the hidden step',
    'lg.err.timeout': 'Logon step {step}/{total}: "{expect}" did not appear within 30 s; stopped',
    'lg.err.closed': 'The connection closed during logon actions', 'lg.err.decrypt': 'Logon actions: could not decrypt a hidden value',
    'lg.err.write': 'Logon actions: could not send input',
    'f.stopBits': 'Stop bits', 'f.scanning': 'Searching…', 'f.noPorts': '(no COM ports found)', 'f.portMissing': '{p} (not connected)',
    'recent.title': 'Recent',
    'recent.empty': 'Double-click a session on the left, or type <b>user@host</b> in quick connect above.',
    'quick.format': 'Use user@host or user@host:port', 'quick.userTitle': 'User name', 'quick.userFor': 'Account for {host}',
    'conn.connecting': 'Connecting', 'conn.sec': '{s}s', 'conn.reconnect': 'Reconnect', 'conn.closeTab': 'Close tab',
    'conn.authFailed': 'Authentication failed', 'conn.pwCanceled': 'Password entry canceled', 'conn.canceled': 'Connection canceled',
    'conn.failed': 'Connection failed', 'conn.lost': 'Disconnected',
    'term.copy': 'Copy', 'term.paste': 'Paste', 'term.selectAll': 'Select all',
    'paste.title': 'Paste multiple lines', 'paste.body': 'Paste {n} lines into <b>{name}</b>? Each line may run as a command.', 'paste.ok': 'Paste {n} lines',
    'tab.closeTitle': 'Close tab', 'tab.closeBody': 'Disconnect <b>{name}</b> and close the tab?', 'tab.multiTarget': 'Multi-exec target', 'tab.closeOthers': 'Close other tabs',
    'multi.on': 'Multi-exec: input goes to every checked tab',
    'log.needConn': 'Logging needs a connected tab', 'log.started': 'Logging to {p}', 'log.stopped': 'Logging stopped',
    'find.prev': 'Previous (Shift+Enter)', 'find.next': 'Next (Enter)', 'find.close': 'Close (Esc)', 'find.none': 'None',
    'zoom.size': 'Font size {n}px',
    'sb.open': 'Connected', 'sb.connecting': 'Connecting', 'sb.closed': 'Disconnected', 'sb.logging': 'Logging', 'sb.none': 'Not connected',
    'sb.multi': 'Multi-exec · {n} tabs', 'sb.xfer': '{n} transfer(s)',
    'sftp.pick': 'Select a connected SSH tab<br>to browse its files here', 'sftp.emptyDir': 'Empty folder<br>Drop files here to upload',
    'sftp.open': 'Open', 'sftp.download': 'Download', 'sftp.copyPath': 'Copy path', 'sftp.pathCopied': 'Path copied', 'sftp.newName': 'New name',
    'sftp.deleteEmpty': 'Delete (empty folders only)', 'sftp.deleteBody': 'Delete <b>{p}</b> from the server? This can\'t be undone.', 'sftp.deleted': 'Deleted {name}',
    'sftp.createIn': 'Created inside {p}', 'sftp.dropHint': 'Open the SFTP panel with a connected SSH tab, then drop files there', 'sftp.done': '{name} transferred',
    'macro.lines': '{n} lines', 'macro.empty': 'Save command sets you use often<br>as macros', 'macro.edit': 'Edit macro',
    'macro.noTarget': 'No connected tab to run on', 'macro.ran': 'Ran "{name}" on {n} tab(s)', 'macro.namePh': 'e.g. Health check',
    'macro.body': 'Commands (one per line; Enter is sent after each)', 'macro.delay': 'Line delay', 'macro.needName': 'Enter a name',
    'macro.deleteTitle': 'Delete macro', 'macro.deleteBody': 'Delete the macro "{name}"?',
    'set.title': 'Settings', 'set.secView': 'Appearance', 'set.lang': 'Language', 'set.langAuto': 'Auto (Windows language)',
    'set.uiScale': 'UI size', 'set.theme': 'App theme', 'set.system': 'System', 'set.dark': 'Dark', 'set.light': 'Light',
    'set.secTerm': 'Terminal', 'set.scheme': 'Color scheme', 'set.schemeAuto': 'Auto (follows app theme)', 'set.font': 'Font', 'set.fontSize': 'Font size',
    'set.lineHeight': 'Line height', 'set.cursor': 'Cursor', 'set.block': 'Block', 'set.bar': 'Bar', 'set.underline': 'Underline', 'set.blink': 'Blink',
    'set.scrollback': 'Scrollback', 'set.lines': 'lines', 'set.secBehavior': 'Behavior',
    'set.copyOnSelect': 'Copy on select', 'set.rightClickPaste': 'Right-click pastes (Shift+right-click opens the menu)',
    'set.confirmMultiline': 'Confirm before pasting multiple lines', 'set.confirmClose': 'Confirm before closing a connected tab', 'set.saved': 'Settings saved',
    'mcp.noSession': 'Session not found', 'mcp.opening': 'AI is opening "{name}"', 'mcp.running': 'MCP server running ({url})', 'mcp.off': 'MCP server off',
    'mcp.title': 'MCP integration', 'mcp.enable': 'Enable MCP server (127.0.0.1 only)', 'mcp.status': 'Status', 'mcp.statusOn': 'Running', 'mcp.statusOff': 'Off',
    'mcp.cmdLabel': 'Claude Code registration command (contains your token · don\'t share it)', 'mcp.copyCmd': 'Copy command', 'mcp.regen': 'New token',
    'mcp.hint': 'AI clients can open saved sessions as tabs, run commands and read the output. Saved passwords are never sent to the AI.',
    'mcp.apply': 'Apply', 'mcp.copied': 'Command copied', 'mcp.regenDone': 'New token issued. Press Connect to Claude Code again.',
    'mcp.startedAt': 'MCP server running: {url}', 'mcp.stopped': 'MCP server stopped',
};

const DICT = {ko, en};
let cur = 'en';

/** Resolve 'auto' to the OS/UI language. */
export function resolveLang(pref) {
    if (pref === 'ko' || pref === 'en') return pref;
    return (navigator.language || '').toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

export function setLang(lang) {
    cur = DICT[lang] ? lang : 'en';
    document.documentElement.lang = cur;
}

export const getLang = () => cur;

export function t(key, vars) {
    const s = DICT[cur][key] ?? DICT.en[key] ?? key;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

// Static markup: data-i18n (text), data-i18n-html, data-i18n-title, data-i18n-placeholder.
export function applyStatic(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
}
