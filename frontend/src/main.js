import '@xterm/xterm/css/xterm.css';
import './style.css';
import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import {WebLinksAddon} from '@xterm/addon-web-links';
import {SearchAddon} from '@xterm/addon-search';
import * as App from '../wailsjs/go/main/App';
import {
    BrowserOpenURL, ClipboardGetText, ClipboardSetText, EventsOff, EventsOn, OnFileDrop,
} from '../wailsjs/runtime/runtime';
import {icon, hydrateIcons} from './icons';
import {SCHEMES, FONTS, resolveScheme, fontStack} from './themes';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

const state = {
    sessions: [],
    macros: [],
    tabs: [],          // see openSession for the tab shape
    active: null,
    multi: false,
    collapsed: new Set(),
    selSession: null,
    sftp: {connId: null, path: '', entries: [], loading: false, error: ''},
    transfers: new Map(),
    mcpRunning: false,
};

// ---------------------------------------------------------------- preferences

const DEFAULT_PREFS = {
    appTheme: 'system',        // system | dark | light
    termScheme: 'auto',
    fontFamily: 'D2Coding',
    fontSize: 14,
    lineHeight: 1.15,
    cursorStyle: 'block',      // block | bar | underline
    cursorBlink: true,
    scrollback: 20000,
    copyOnSelect: true,
    rightClickPaste: true,
    confirmMultiline: true,
    confirmClose: true,
    sideWidth: 270,
    sideCollapsed: false,
    recents: [],               // [{id} | {adhoc:{host,user,port}}, t]
};
let prefs = {...DEFAULT_PREFS};
let saveTimer;

async function loadPrefs() {
    try {
        const raw = await App.GetUIPrefs();
        if (raw) prefs = {...DEFAULT_PREFS, ...JSON.parse(raw)};
    } catch { /* keep defaults */ }
}

function savePrefs() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => App.SaveUIPrefs(JSON.stringify(prefs)).catch(() => {}), 300);
}

const darkMQ = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => prefs.appTheme === 'dark' || (prefs.appTheme === 'system' && darkMQ.matches);
darkMQ.addEventListener('change', () => prefs.appTheme === 'system' && applyTheme());

function termOptions() {
    return {
        theme: resolveScheme(prefs.termScheme, isDark()),
        fontFamily: fontStack(prefs.fontFamily),
        fontSize: prefs.fontSize,
        lineHeight: prefs.lineHeight,
        cursorStyle: prefs.cursorStyle,
        cursorBlink: prefs.cursorBlink,
        scrollback: prefs.scrollback,
    };
}

function applyTheme() {
    document.documentElement.dataset.theme = isDark() ? 'dark' : 'light';
    const opts = termOptions();
    document.documentElement.style.setProperty('--term-bg', opts.theme.background);
    for (const t of state.tabs) {
        Object.assign(t.term.options, opts);
        t.fit.fit();
    }
    renderStatus();
}

function applyLayout() {
    $('#app').style.setProperty('--side-w', prefs.sideWidth + 'px');
    $('#app').classList.toggle('side-collapsed', prefs.sideCollapsed);
    $('#side-open').classList.toggle('hidden', !prefs.sideCollapsed);
}

// ---------------------------------------------------------------- utils

function toast(msg, kind = 'info') {
    if (kind === true) kind = 'err';
    const d = document.createElement('div');
    d.className = kind;
    d.innerHTML = icon(kind === 'err' ? 'alert' : kind === 'ok' ? 'check' : 'info') + `<span>${esc(msg)}</span>`;
    const remove = () => { d.classList.add('out'); setTimeout(() => d.remove(), 200); };
    d.onclick = remove;
    $('#toast').appendChild(d);
    setTimeout(remove, kind === 'err' ? 7000 : 3500);
}

function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

const newConnId = () => 'c' + Math.random().toString(36).slice(2, 10);

function fmtSize(n) {
    if (n < 1024) return n + ' B';
    const u = ['KB', 'MB', 'GB', 'TB'];
    let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return n.toFixed(n < 10 ? 1 : 0) + ' ' + u[i];
}

function ago(t) {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return '방금';
    if (s < 3600) return Math.floor(s / 60) + '분 전';
    if (s < 86400) return Math.floor(s / 3600) + '시간 전';
    return Math.floor(s / 86400) + '일 전';
}

const targetOf = (s) => s.kind === 'serial'
    ? `${s.comPort || '?'} · ${s.baud || 9600}`
    : `${s.user ? s.user + '@' : ''}${s.host}${s.port && s.port !== 22 ? ':' + s.port : ''}`;

function ctxMenu(x, y, items) {
    const m = $('#ctx');
    m.innerHTML = '';
    for (const it of items) {
        if (it === '-') { m.appendChild(document.createElement('hr')); continue; }
        const d = document.createElement('div');
        d.innerHTML = (it.icon ? icon(it.icon) : '') + `<span>${esc(it.label)}</span>`;
        if (it.danger) d.className = 'danger';
        d.onclick = () => { hideCtx(); it.fn(); };
        m.appendChild(d);
    }
    m.classList.remove('hidden');
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, innerWidth - r.width - 4) + 'px';
    m.style.top = Math.min(y, innerHeight - r.height - 4) + 'px';
}
const hideCtx = () => $('#ctx').classList.add('hidden');
addEventListener('click', hideCtx);
addEventListener('blur', hideCtx);

/** modal(title, html, opts) — onOk(root) returns false to keep it open. Resolves to onOk's result or null. */
function modal(title, bodyHtml, {okText = '확인', onOk, onMount, onCancel, wide = false, danger = false} = {}) {
    return new Promise((resolve) => {
        const bg = document.createElement('div');
        bg.className = 'modal-bg';
        bg.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-label="${esc(title)}"><h3>${esc(title)}</h3>${bodyHtml}
            <div class="btns"><button data-x="cancel">취소</button><button class="primary${danger ? ' danger-btn' : ''}" data-x="ok">${esc(okText)}</button></div></div>`;
        if (danger) bg.querySelector('[data-x=ok]').style.cssText = 'background:var(--bad);border-color:var(--bad)';
        $('#modal-root').appendChild(bg);
        const root = bg.firstElementChild;
        const close = (v) => { bg.remove(); resolve(v); focusActive(); };
        const cancel = () => { onCancel?.(); close(null); };
        const ok = async () => {
            const v = onOk ? await onOk(root) : true;
            if (v !== false) close(v);
        };
        root.querySelector('[data-x=cancel]').onclick = cancel;
        root.querySelector('[data-x=ok]').onclick = ok;
        bg.addEventListener('mousedown', (e) => { if (e.target === bg) cancel(); });
        bg.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') cancel();
            if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); ok(); }
        });
        onMount?.(root);
        // Focus again on the next tick: a terminal that triggered the modal can reclaim focus.
        const first = root.querySelector('[autofocus]') || root.querySelector('input,select,textarea');
        first?.focus();
        setTimeout(() => first?.focus(), 0);
    });
}

async function promptPassword(title, canSave) {
    return modal(title, `<div class="f">
        <label>비밀번호</label><input type="password" name="pw" autofocus/>
        ${canSave ? '<span></span><label class="chk"><input type="checkbox" name="save"/> 비밀번호 저장 (Windows 계정으로 암호화)</label>' : ''}
    </div>`, {
        okText: '접속',
        onOk: (r) => {
            const input = r.querySelector('[name=pw]');
            if (!input.value) { input.focus(); return false; } // an empty Enter shouldn't count as cancel
            return {pw: input.value, save: !!r.querySelector('[name=save]')?.checked};
        },
    });
}

// ---------------------------------------------------------------- sessions panel

async function loadSessions() {
    state.sessions = await App.ListSessions() || [];
    renderSessions();
    renderRecents();
}

function liveCount(sessionId) {
    return state.tabs.filter((t) => !t.adhoc && t.session.id === sessionId && t.status === 'open').length;
}

function highlight(text, q) {
    const s = esc(text);
    if (!q) return s;
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return s;
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
}

function renderSessions() {
    const q = $('#sess-filter').value.trim().toLowerCase();
    const tree = $('#sess-tree');
    const list = state.sessions.filter((s) => !q || [s.name, s.host, s.user, s.folder, s.comPort].join(' ').toLowerCase().includes(q));
    if (!list.length) {
        tree.innerHTML = state.sessions.length
            ? `<div class="empty">${icon('search')}<span>"${esc(q)}"와 일치하는 세션이 없습니다</span></div>`
            : `<div class="empty">${icon('terminal')}<span>저장된 세션이 없습니다</span><button id="empty-add" class="primary">${icon('plus')}새 세션 만들기</button></div>`;
        $('#empty-add')?.addEventListener('click', () => editSession(null));
        return;
    }
    const groups = new Map();
    for (const s of list) {
        const f = s.folder || '';
        if (!groups.has(f)) groups.set(f, []);
        groups.get(f).push(s);
    }
    let html = '';
    for (const [f, items] of groups) {
        const open = q || !state.collapsed.has(f);
        if (f) html += `<div class="folder" data-folder="${esc(f)}">${icon(open ? 'chevDown' : 'chevRight')}${esc(f)}<span class="count">${items.length}</span></div>`;
        if (!open) continue;
        for (const s of items) {
            const n = liveCount(s.id);
            html += `<div class="item${f ? ' indent' : ''}${state.selSession === s.id ? ' sel' : ''}${n ? ' live' : ''}" data-id="${s.id}" title="${esc(targetOf(s))}">
                <span class="ic">${icon(s.kind === 'serial' ? 'serial' : 'terminal')}</span><span class="nm">${highlight(s.name, q)}</span>
                ${n ? `<span class="live-n" title="연결된 탭 ${n}개">●${n > 1 ? n : ''}</span>` : `<span class="sub">${esc(targetOf(s))}</span>`}</div>`;
        }
    }
    tree.innerHTML = html;
}

$('#sess-filter').addEventListener('input', renderSessions);
$('#sess-filter').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); $('#sess-tree').focus(); moveSel(1); }
    if (e.key === 'Enter') { const first = $('#sess-tree .item'); if (first) openSession(state.sessions.find((s) => s.id === first.dataset.id)); }
});
$('#sess-add').onclick = () => editSession(null);
$('#sess-tree').addEventListener('click', (e) => {
    const f = e.target.closest('.folder');
    if (f) {
        const k = f.dataset.folder;
        state.collapsed.has(k) ? state.collapsed.delete(k) : state.collapsed.add(k);
        return renderSessions();
    }
    const it = e.target.closest('.item');
    if (it) selectSession(it.dataset.id);
});

// Toggle the highlight in place: re-rendering here would replace the element
// between the two clicks of a double-click and swallow the dblclick event.
function selectSession(id) {
    state.selSession = id;
    $$('#sess-tree .item').forEach((el) => el.classList.toggle('sel', el.dataset.id === id));
    $(`#sess-tree .item[data-id="${id}"]`)?.scrollIntoView({block: 'nearest'});
}

function moveSel(d) {
    const items = $$('#sess-tree .item');
    if (!items.length) return;
    const i = items.findIndex((el) => el.dataset.id === state.selSession);
    const n = items[Math.max(0, Math.min(items.length - 1, i < 0 ? 0 : i + d))];
    selectSession(n.dataset.id);
}

$('#sess-tree').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
    if (e.key === 'Enter' && state.selSession) openSession(state.sessions.find((s) => s.id === state.selSession));
    if (e.key === 'F2' && state.selSession) editSession(state.sessions.find((s) => s.id === state.selSession));
});
$('#sess-tree').addEventListener('dblclick', (e) => {
    const it = e.target.closest('.item');
    if (it) openSession(state.sessions.find((s) => s.id === it.dataset.id));
});
$('#sess-tree').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const it = e.target.closest('.item');
    if (!it) return ctxMenu(e.clientX, e.clientY, [{label: '새 세션', icon: 'plus', fn: () => editSession(null)}]);
    const s = state.sessions.find((x) => x.id === it.dataset.id);
    selectSession(s.id);
    ctxMenu(e.clientX, e.clientY, [
        {label: '연결', icon: 'play', fn: () => openSession(s)},
        {label: '편집', icon: 'gear', fn: () => editSession(s)},
        {label: '복제', icon: 'plus', fn: () => editSession({...s, id: '', name: s.name + ' 복사본', hasPassword: false})},
        '-',
        {label: '삭제', icon: 'close', danger: true, fn: async () => {
            if (await modal('세션 삭제', `<p>"${esc(s.name)}" 세션을 삭제할까요? 저장된 비밀번호도 함께 지워집니다.</p>`, {okText: '삭제', danger: true})) {
                await App.DeleteSession(s.id);
                prefs.recents = prefs.recents.filter((r) => r.id !== s.id);
                savePrefs();
                loadSessions();
            }
        }},
    ]);
});

const BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

async function editSession(s) {
    const isNew = !s || !s.id;
    s = {kind: 'ssh', port: 22, baud: 9600, dataBits: 8, parity: 'N', stopBits: '1', ...s};
    const folders = [...new Set(state.sessions.map((x) => x.folder).filter(Boolean))];
    const body = `<div class="f">
        <label>종류</label><div class="seg" data-seg="kind"><button type="button" data-v="ssh">SSH</button><button type="button" data-v="serial">시리얼 (COM)</button></div>
        <label>이름</label><input name="name" value="${esc(s.name)}" placeholder="비우면 호스트명"/>
        <label>폴더</label><input name="folder" value="${esc(s.folder)}" list="folders" placeholder="예: 본사 장비"/>
        <datalist id="folders">${folders.map((f) => `<option value="${esc(f)}">`).join('')}</datalist>

        <h4 class="ssh">연결</h4>
        <label class="ssh">호스트</label><input class="ssh" name="host" value="${esc(s.host)}" autofocus placeholder="예: 10.0.0.1"/>
        <label class="ssh">포트</label><input class="ssh" name="port" type="number" value="${s.port || 22}"/>
        <label class="ssh">사용자</label><input class="ssh" name="user" value="${esc(s.user)}"/>
        <h4 class="ssh">인증</h4>
        <label class="ssh">비밀번호</label><input class="ssh" name="pw" type="password" placeholder="${s.hasPassword ? '저장됨 · 바꿀 때만 입력' : '비우면 접속할 때 물어봄'}"/>
        <span class="ssh"></span><label class="ssh chk"><input type="checkbox" name="save" ${s.hasPassword || isNew ? 'checked' : ''}/> 비밀번호 저장 (Windows 계정으로 암호화)</label>
        <label class="ssh">개인키</label><div class="ssh inline"><input name="keyPath" value="${esc(s.keyPath)}" placeholder="선택 사항"/><button type="button" data-x="key">찾기</button></div>
        <span class="ssh"></span><label class="ssh chk"><input type="checkbox" name="legacy" ${s.legacy ? 'checked' : ''}/> 구형 알고리즘 허용 (오래된 스위치·방화벽)</label>

        <h4 class="ser">포트 설정</h4>
        <label class="ser">포트</label><div class="ser inline"><select name="comPort"></select><button type="button" data-x="scan" title="포트 다시 찾기">${icon('refresh')}</button></div>
        <label class="ser">속도</label><input class="ser" name="baud" list="bauds" value="${s.baud || 9600}"/>
        <datalist id="bauds">${BAUDS.map((b) => `<option value="${b}">`).join('')}</datalist>
        <label class="ser">데이터 비트</label><select class="ser" name="dataBits">${[8, 7, 6, 5].map((b) => `<option ${s.dataBits === b ? 'selected' : ''}>${b}</option>`).join('')}</select>
        <label class="ser">패리티</label><select class="ser" name="parity"><option value="N">없음</option><option value="E">짝수</option><option value="O">홀수</option></select>
        <label class="ser">정지 비트</label><select class="ser" name="stopBits"><option>1</option><option>2</option></select>
    </div>`;

    let kind = s.kind;
    const saved = await modal(isNew ? '새 세션' : '세션 편집', body, {
        okText: '저장',
        onMount: (r) => {
            r.querySelector('[name=parity]').value = s.parity || 'N';
            r.querySelector('[name=stopBits]').value = s.stopBits || '1';
            const sync = () => {
                r.querySelectorAll('[data-seg=kind] button').forEach((b) => b.classList.toggle('on', b.dataset.v === kind));
                r.querySelectorAll('.ssh').forEach((el) => el.classList.toggle('hidden', kind !== 'ssh'));
                r.querySelectorAll('.ser').forEach((el) => el.classList.toggle('hidden', kind !== 'serial'));
            };
            r.querySelectorAll('[data-seg=kind] button').forEach((b) => { b.onclick = () => { kind = b.dataset.v; sync(); }; });
            sync();
            const scan = async () => {
                const sel = r.querySelector('[name=comPort]');
                sel.innerHTML = '<option value="">찾는 중…</option>';
                const ports = await App.ListSerialPorts() || [];
                const cur = s.comPort;
                sel.innerHTML = ports.map((p) => `<option value="${esc(p.name)}">${esc(p.label)}</option>`).join('')
                    || '<option value="">(연결된 COM 포트 없음)</option>';
                if (cur && !ports.some((p) => p.name === cur)) sel.insertAdjacentHTML('afterbegin', `<option value="${esc(cur)}">${esc(cur)} (연결 안 됨)</option>`);
                if (cur) sel.value = cur;
            };
            r.querySelector('[data-x=scan]').onclick = scan;
            scan();
            r.querySelector('[data-x=key]').onclick = async () => {
                const p = await App.PickKeyFile();
                if (p) r.querySelector('[name=keyPath]').value = p;
            };
        },
        onOk: async (r) => {
            const v = (n) => r.querySelector(`[name=${n}]`).value.trim();
            const out = {
                ...s,
                kind, name: v('name'), folder: v('folder'),
                host: v('host'), port: parseInt(v('port'), 10) || 22, user: v('user'), keyPath: v('keyPath'),
                legacy: r.querySelector('[name=legacy]').checked,
                comPort: v('comPort'), baud: parseInt(v('baud'), 10) || 9600, dataBits: parseInt(v('dataBits'), 10),
                parity: v('parity'), stopBits: v('stopBits'),
            };
            if (out.kind === 'ssh' && !out.host) { toast('호스트를 입력하세요', 'err'); r.querySelector('[name=host]').focus(); return false; }
            if (out.kind === 'serial' && !out.comPort) { toast('COM 포트를 선택하세요', 'err'); return false; }
            try {
                return await App.SaveSession(out, r.querySelector('[name=pw]').value, r.querySelector('[name=save]').checked);
            } catch (e) {
                toast('저장하지 못했습니다: ' + e, 'err');
                return false;
            }
        },
    });
    if (saved) {
        state.selSession = saved.id;
        toast(`"${saved.name}" 세션을 저장했습니다`, 'ok');
        loadSessions();
    }
}

// ---------------------------------------------------------------- recents (empty state)

function pushRecent(tab) {
    const key = tab.adhoc ? {adhoc: {host: tab.session.host, user: tab.session.user, port: tab.session.port}} : {id: tab.session.id};
    const same = (r) => (key.id ? r.id === key.id : r.adhoc && r.adhoc.host === key.adhoc.host && r.adhoc.user === key.adhoc.user && r.adhoc.port === key.adhoc.port);
    prefs.recents = [{...key, t: Date.now()}, ...prefs.recents.filter((r) => !same(r))].slice(0, 8);
    savePrefs();
    renderRecents();
}

function renderRecents() {
    const items = prefs.recents.map((r) => {
        if (r.id) {
            const s = state.sessions.find((x) => x.id === r.id);
            return s && {s, adhoc: false, t: r.t};
        }
        const a = r.adhoc;
        return {s: {id: '', kind: 'ssh', name: `${a.user}@${a.host}`, ...a}, adhoc: true, t: r.t};
    }).filter(Boolean).slice(0, 6);
    $('#recents').innerHTML = items.length
        ? '<div class="rec-title">최근 접속</div>' + items.map((x, i) => `<button class="recent" data-i="${i}">
            <span class="ic">${icon(x.s.kind === 'serial' ? 'serial' : 'terminal')}</span><span class="nm">${esc(x.s.name)}</span>
            <span class="hint">${ago(x.t)}</span><span class="sub">${esc(targetOf(x.s))}</span></button>`).join('')
        : '<p class="hint">왼쪽 목록에서 세션을 더블클릭하거나, 위의 빠른 접속에 <b>user@host</b>를 입력하세요.</p>';
    $$('#recents .recent').forEach((b) => { b.onclick = () => { const x = items[b.dataset.i]; openSession(x.s, x.adhoc); }; });
}

// ---------------------------------------------------------------- quick connect

$('#quick').addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') { e.target.value = ''; focusActive(); return; }
    if (e.key !== 'Enter') return;
    const m = e.target.value.trim().match(/^(?:([^@\s]+)@)?([^:\s]+)(?::(\d+))?$/);
    if (!m) return toast('user@host 또는 user@host:port 형식으로 입력하세요', 'err');
    let [, user, host, port] = m;
    if (!user) {
        const r = await modal('사용자 이름', `<div class="f"><label>사용자</label><input name="u" autofocus/><span></span><span class="hint">${esc(host)}에 접속할 계정</span></div>`, {
            onOk: (root) => root.querySelector('[name=u]').value.trim() || false,
        });
        if (!r) return;
        user = r;
    }
    e.target.value = '';
    openSession({id: '', kind: 'ssh', name: `${user}@${host}`, host, user, port: parseInt(port || '22', 10)}, true);
});

// ---------------------------------------------------------------- tabs & terminals

function openSession(s, adhoc = false, forcedId = null, viaMcp = false) {
    if (!s) return;
    const id = forcedId || newConnId();
    const pane = document.createElement('div');
    pane.className = 'pane';
    pane.innerHTML = `<div class="term"></div>
        <div class="overlay"><div class="card"><div class="spinner"></div><div><b>접속 중</b></div>
            <div class="target">${esc(targetOf(s))}</div><div class="sub" data-el="elapsed">0.0초</div>
            <button data-x="cancel">취소</button></div></div>
        <div class="closedbar"><span class="msg"></span>
            <button class="primary" data-x="reconnect">${icon('refresh')}재접속 <kbd>Enter</kbd></button>
            <button data-x="close">탭 닫기</button></div>`;
    $('#terms').appendChild(pane);

    const term = new Terminal({...termOptions(), allowProposedApi: true});
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon((_, uri) => BrowserOpenURL(uri)));
    term.open(pane.querySelector('.term'));

    const tab = {
        id, session: s, adhoc, title: s.name, kind: s.kind, term, fit, search, pane,
        status: 'connecting', logging: false, multi: true, mcpPending: viaMcp, bot: false,
    };
    state.tabs.push(tab);

    pane.querySelector('[data-x=cancel]').onclick = () => App.CancelConnect(id);
    pane.querySelector('[data-x=reconnect]').onclick = () => connectTab(tab);
    pane.querySelector('[data-x=close]').onclick = () => closeTab(tab, true);

    EventsOn('data:' + id, (b64) => term.write(b64ToBytes(b64)));
    EventsOn('closed:' + id, (reason) => markClosed(tab, reason));

    term.onData((d) => {
        if (tab.status === 'closed') {
            if (d === '\r') connectTab(tab);
            return;
        }
        if (tab.status !== 'open') return;
        if (state.multi && tab.multi) App.WriteMulti(multiTargets(), d);
        else App.Write(id, d);
    });
    term.onResize(({cols, rows}) => {
        if (tab.status === 'open') App.Resize(id, cols, rows);
        if (state.active === tab) renderStatus();
    });
    term.onSelectionChange(() => {
        const sel = term.getSelection();
        if (sel && prefs.copyOnSelect) ClipboardSetText(sel);
    });
    term.attachCustomKeyEventHandler((e) => {
        if (e.type !== 'keydown') return true;
        if (handleGlobalKey(e)) return false;
        if (e.ctrlKey && e.shiftKey && e.code === 'KeyV') { e.preventDefault(); pasteInto(tab); return false; }
        if (e.ctrlKey && e.shiftKey && e.code === 'KeyC') { ClipboardSetText(term.getSelection()); return false; }
        return true;
    });
    pane.querySelector('.term').addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (prefs.rightClickPaste && !e.shiftKey) return pasteInto(tab);
        ctxMenu(e.clientX, e.clientY, [
            {label: '복사', fn: () => ClipboardSetText(term.getSelection())},
            {label: '붙여넣기', fn: () => pasteInto(tab)},
            {label: '모두 선택', fn: () => term.selectAll()},
            '-',
            {label: '찾기', icon: 'search', fn: () => openFind(tab)},
            {label: '화면 지우기', fn: () => term.clear()},
        ]);
    });

    activate(tab);
    connectTab(tab);
}

async function pasteInto(tab) {
    const text = await ClipboardGetText();
    if (!text) return;
    const lines = text.replace(/\r?\n$/, '').split(/\r?\n/).length;
    if (lines > 1 && prefs.confirmMultiline) {
        const ok = await modal('여러 줄 붙여넣기', `<p>${lines}줄을 <b>${esc(tab.title)}</b>에 붙여넣습니다. 각 줄이 명령으로 실행될 수 있습니다.</p><pre>${esc(text.slice(0, 2000))}</pre>`, {okText: `${lines}줄 붙여넣기`});
        if (!ok) return;
    }
    tab.term.paste(text);
}

// The overlay waits a moment so fast connections don't flash it.
function showConnecting(tab) {
    const ov = tab.pane.querySelector('.overlay');
    const el = ov.querySelector('[data-el=elapsed]');
    const t0 = performance.now();
    clearInterval(tab.connTimer);
    clearTimeout(tab.connShow);
    tab.connShow = setTimeout(() => ov.classList.add('show'), 180);
    tab.connTimer = setInterval(() => { el.textContent = ((performance.now() - t0) / 1000).toFixed(1) + '초'; }, 100);
}

function hideConnecting(tab) {
    clearInterval(tab.connTimer);
    clearTimeout(tab.connShow);
    tab.pane.querySelector('.overlay').classList.remove('show');
}

async function connectTab(tab, password = '') {
    tab.status = 'connecting';
    tab.pane.querySelector('.closedbar').classList.remove('show');
    renderTabs();
    showConnecting(tab);
    const {term, fit} = tab;
    fit.fit();
    try {
        if (tab.adhoc) await App.ConnectAdhoc(tab.id, tab.session, password, term.cols, term.rows);
        else await App.Connect(tab.id, tab.session.id, password, term.cols, term.rows);
        hideConnecting(tab);
        tab.status = 'open';
        reportMcp(tab, '');
        pushRecent(tab);
        renderTabs();
        renderSessions();
        if (state.active === tab) { refreshSftpForActive(); term.focus(); }
    } catch (err) {
        hideConnecting(tab);
        const msg = String(err);
        if (msg.includes('NEED_PASSWORD') || msg.includes('AUTH_FAILED')) {
            if (msg.includes('AUTH_FAILED')) term.write('\x1b[31m인증 실패\x1b[0m\r\n');
            const r = await promptPassword(`${tab.title} 비밀번호`, !tab.adhoc);
            if (r && r.pw) {
                if (r.save) await App.SetSessionPassword(tab.session.id, r.pw).then(loadSessions).catch((e) => toast(String(e), 'err'));
                return connectTab(tab, r.pw);
            }
            return markClosed(tab, '비밀번호 입력을 취소했습니다');
        }
        if (msg.includes('CANCELED')) return markClosed(tab, '접속을 취소했습니다');
        term.write(`\x1b[31m접속 실패: ${msg.replace(/\n/g, '\r\n')}\x1b[0m\r\n`);
        reportMcp(tab, msg);
        markClosed(tab, '접속 실패 · ' + msg.split('\n')[0]);
    }
}

// Tell the backend how a tab opened by MCP open_session ended up.
function reportMcp(tab, err) {
    if (!tab.mcpPending) return;
    tab.mcpPending = false;
    App.ReportOpenResult(tab.id, err);
}

function markClosed(tab, reason) {
    reportMcp(tab, reason || '접속 실패');
    if (tab.status === 'closed') return;
    tab.status = 'closed';
    tab.logging = false;
    hideConnecting(tab);
    if (reason) tab.term.write(`\r\n\x1b[90m── ${reason} ──\x1b[0m\r\n`);
    const bar = tab.pane.querySelector('.closedbar');
    bar.querySelector('.msg').innerHTML = `<b>연결 끊김</b>${esc(reason || '')}`;
    bar.classList.add('show');
    renderTabs();
    renderSessions();
    if (state.sftp.connId === tab.id) { state.sftp.connId = null; renderSftp(); }
}

async function closeTab(tab, force = false) {
    if (!force && prefs.confirmClose && tab.status === 'open') {
        const ok = await modal('탭 닫기', `<p><b>${esc(tab.title)}</b> 연결을 끊고 탭을 닫을까요?</p>`, {okText: '닫기', danger: true});
        if (!ok) return;
    }
    App.Disconnect(tab.id);
    hideConnecting(tab);
    EventsOff('data:' + tab.id, 'closed:' + tab.id);
    tab.term.dispose();
    tab.pane.remove();
    const i = state.tabs.indexOf(tab);
    state.tabs.splice(i, 1);
    if (state.active === tab) {
        state.active = null;
        const next = state.tabs[Math.min(i, state.tabs.length - 1)];
        if (next) activate(next);
    }
    renderTabs();
    renderSessions();
    if (state.sftp.connId === tab.id) { state.sftp.connId = null; renderSftp(); }
}

function activate(tab) {
    state.active = tab;
    for (const t of state.tabs) t.pane.classList.toggle('on', t === tab);
    renderTabs();
    requestAnimationFrame(() => {
        tab.fit.fit();
        if (!$('#modal-root').children.length && !tab.pane.querySelector('.findbar')) tab.term.focus(); // don't steal focus from a dialog
    });
    refreshSftpForActive();
}

function focusActive() {
    if ($('#modal-root').children.length) return;
    state.active?.term.focus();
}

function cycleTab(dir) {
    if (state.tabs.length < 2) return;
    const i = state.tabs.indexOf(state.active);
    activate(state.tabs[(i + dir + state.tabs.length) % state.tabs.length]);
}

const multiTargets = () => state.tabs.filter((t) => t.multi && t.status === 'open').map((t) => t.id);

function renderTabs() {
    $('#empty').classList.toggle('hidden', state.tabs.length > 0);
    $('#terms').classList.toggle('multi', state.multi);
    $('#btn-multi').classList.toggle('on', state.multi);
    $('#btn-log').classList.toggle('on', !!state.active?.logging);
    $('#tabbar').innerHTML = state.tabs.map((t) => `<div class="tab${t === state.active ? ' on' : ''}" data-id="${t.id}" draggable="true" role="tab" aria-selected="${t === state.active}" title="${esc(targetOf(t.session))}">
        ${state.multi ? `<input type="checkbox" ${t.multi ? 'checked' : ''} title="멀티 실행 대상"/>` : ''}
        <span class="dot ${t.status}"></span><span class="t">${esc(t.title)}</span>
        ${t.logging ? '<span class="badge rec">REC</span>' : ''}${t.bot ? `<span class="badge bot" title="${esc(t.bot)}">AI</span>` : ''}
        <button class="x" title="닫기">${icon('close')}</button></div>`).join('');
    renderStatus();
}

$('#tabbar').addEventListener('click', (e) => {
    const el = e.target.closest('.tab');
    if (!el) return;
    const tab = state.tabs.find((t) => t.id === el.dataset.id);
    if (e.target.closest('.x')) return closeTab(tab);
    if (e.target.type === 'checkbox') { tab.multi = e.target.checked; renderStatus(); return; }
    if (e.target.classList.contains('rename')) return;
    activate(tab);
});
$('#tabbar').addEventListener('dblclick', (e) => {
    const el = e.target.closest('.tab');
    if (!el || e.target.closest('.x')) return;
    renameTab(state.tabs.find((t) => t.id === el.dataset.id));
});
$('#tabbar').addEventListener('auxclick', (e) => {
    const el = e.target.closest('.tab');
    if (el && e.button === 1) closeTab(state.tabs.find((t) => t.id === el.dataset.id));
});
$('#tabbar').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const el = e.target.closest('.tab');
    if (!el) return;
    const tab = state.tabs.find((t) => t.id === el.dataset.id);
    ctxMenu(e.clientX, e.clientY, [
        {label: '재접속', icon: 'refresh', fn: () => { if (tab.status === 'open') App.Disconnect(tab.id); setTimeout(() => connectTab(tab), 200); }},
        {label: '복제', icon: 'plus', fn: () => openSession(tab.session, tab.adhoc)},
        {label: '이름 바꾸기', fn: () => renameTab(tab)},
        {label: '찾기', icon: 'search', fn: () => { activate(tab); openFind(tab); }},
        {label: '화면 지우기', fn: () => tab.term.clear()},
        '-',
        {label: '다른 탭 모두 닫기', fn: () => state.tabs.filter((t) => t !== tab).forEach((t) => closeTab(t, true))},
        {label: '닫기', icon: 'close', danger: true, fn: () => closeTab(tab)},
    ]);
});

function renameTab(tab) {
    const el = $(`.tab[data-id="${tab.id}"] .t`);
    if (!el) return;
    const input = document.createElement('input');
    input.className = 'rename';
    input.value = tab.title;
    el.replaceWith(input);
    input.focus();
    input.select();
    const done = (save) => {
        if (save && input.value.trim()) tab.title = input.value.trim();
        renderTabs();
        focusActive();
    };
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') done(true);
        if (e.key === 'Escape') done(false);
        e.stopPropagation();
    });
    input.addEventListener('blur', () => done(true));
}

// Drag tabs to reorder.
let dragId = null;
$('#tabbar').addEventListener('dragstart', (e) => {
    const el = e.target.closest('.tab');
    if (!el) return;
    dragId = el.dataset.id;
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
});
$('#tabbar').addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    $$('.tab').forEach((t) => t.classList.remove('drop-before'));
    e.target.closest('.tab')?.classList.add('drop-before');
});
$('#tabbar').addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const over = e.target.closest('.tab');
    const from = state.tabs.findIndex((t) => t.id === dragId);
    const [moved] = state.tabs.splice(from, 1);
    const to = over ? state.tabs.findIndex((t) => t.id === over.dataset.id) : state.tabs.length;
    state.tabs.splice(to < 0 ? state.tabs.length : to, 0, moved);
    dragId = null;
    renderTabs();
});
$('#tabbar').addEventListener('dragend', () => { dragId = null; renderTabs(); });

new ResizeObserver(() => state.active?.fit.fit()).observe($('#terms'));

$('#btn-multi').onclick = () => {
    state.multi = !state.multi;
    renderTabs();
    if (state.multi) toast('멀티 실행: 입력이 체크된 모든 탭으로 전송됩니다');
    focusActive();
};
$('#btn-log').onclick = async () => {
    const t = state.active;
    if (!t || t.status !== 'open') return toast('연결된 탭에서만 로그를 저장할 수 있습니다', 'err');
    try {
        const p = await App.SetLogging(t.id, !t.logging);
        t.logging = !t.logging;
        toast(t.logging ? '로그 저장 시작: ' + p : '로그 저장을 멈췄습니다', t.logging ? 'ok' : 'info');
        renderTabs();
    } catch (e) { toast(String(e), 'err'); }
    focusActive();
};
$('#btn-logdir').onclick = () => App.OpenLogFolder();

// ---------------------------------------------------------------- find in terminal

const FIND_DECOR = {
    matchBackground: '#6b5a1a', matchBorder: '#c9a227', matchOverviewRuler: '#c9a227',
    activeMatchBackground: '#c9a227', activeMatchBorder: '#ffd75e', activeMatchColorOverviewRuler: '#ffd75e',
};

function openFind(tab) {
    let bar = tab.pane.querySelector('.findbar');
    if (!bar) {
        bar = document.createElement('div');
        bar.className = 'findbar';
        bar.innerHTML = `<label class="field">${icon('search')}<input placeholder="찾기" spellcheck="false"/></label>
            <span class="count"></span>
            <button class="ghost icon" data-x="prev" title="이전 (Shift+Enter)">${icon('arrowUp')}</button>
            <button class="ghost icon" data-x="next" title="다음 (Enter)">${icon('arrowDown')}</button>
            <button class="ghost icon" data-x="close" title="닫기 (Esc)">${icon('close')}</button>`;
        tab.pane.appendChild(bar);
        const input = bar.querySelector('input');
        const count = bar.querySelector('.count');
        tab.findSub = tab.search.onDidChangeResults(({resultIndex, resultCount}) => {
            count.textContent = resultCount ? `${resultIndex + 1}/${resultCount}` : (input.value ? '없음' : '');
        });
        const go = (back) => input.value && (back
            ? tab.search.findPrevious(input.value, {decorations: FIND_DECOR})
            : tab.search.findNext(input.value, {decorations: FIND_DECOR}));
        input.addEventListener('input', () => { if (input.value) go(false); else { tab.search.clearDecorations(); count.textContent = ''; } });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey); }
            if (e.key === 'Escape') closeFind(tab);
        });
        bar.querySelector('[data-x=prev]').onclick = () => go(true);
        bar.querySelector('[data-x=next]').onclick = () => go(false);
        bar.querySelector('[data-x=close]').onclick = () => closeFind(tab);
    }
    const input = bar.querySelector('input');
    const sel = tab.term.getSelection();
    if (sel && !sel.includes('\n')) input.value = sel;
    input.focus();
    input.select();
}

function closeFind(tab) {
    tab.search.clearDecorations();
    tab.findSub?.dispose();
    tab.pane.querySelector('.findbar')?.remove();
    tab.term.focus();
}

// ---------------------------------------------------------------- keyboard

function zoom(d) {
    prefs.fontSize = d === 0 ? DEFAULT_PREFS.fontSize : Math.max(9, Math.min(28, prefs.fontSize + d));
    savePrefs();
    applyTheme();
    toast(`글자 크기 ${prefs.fontSize}px`);
}

function toggleSidebar() {
    prefs.sideCollapsed = !prefs.sideCollapsed;
    savePrefs();
    applyLayout();
}

// Returns true when the key was handled (used by both the window and xterm).
function handleGlobalKey(e) {
    // Only Ctrl+Shift combos and keys shells don't use (Ctrl+B is tmux's prefix, Ctrl+F moves the cursor).
    if (!e.ctrlKey || e.altKey) return false;
    if (e.key === 'Tab') { e.preventDefault(); cycleTab(e.shiftKey ? -1 : 1); return true; }
    if (e.shiftKey) {
        if (e.code === 'KeyB') { e.preventDefault(); toggleSidebar(); return true; }
        if (e.code === 'KeyF' && state.active) { e.preventDefault(); openFind(state.active); return true; }
        return false;
    }
    if (e.code === 'Equal' || e.key === '+') { e.preventDefault(); zoom(1); return true; }
    if (e.code === 'Minus') { e.preventDefault(); zoom(-1); return true; }
    if (e.code === 'Digit0') { e.preventDefault(); zoom(0); return true; }
    if (e.code === 'Comma') { e.preventDefault(); settingsDialog(); return true; }
    return false;
}
addEventListener('keydown', (e) => {
    if ($('#modal-root').children.length) return;
    if (e.target.closest?.('.xterm')) return; // xterm's own handler already ran
    handleGlobalKey(e);
});

// ---------------------------------------------------------------- sidebar resize

$('#side-collapse').onclick = toggleSidebar;
$('#side-open').onclick = toggleSidebar;
$('#resizer').addEventListener('mousedown', (e) => {
    e.preventDefault();
    const r = $('#resizer');
    r.classList.add('drag');
    const move = (ev) => {
        prefs.sideWidth = Math.max(200, Math.min(520, ev.clientX));
        $('#app').style.setProperty('--side-w', prefs.sideWidth + 'px');
    };
    const up = () => {
        r.classList.remove('drag');
        removeEventListener('mousemove', move);
        removeEventListener('mouseup', up);
        savePrefs();
    };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
});
$('#resizer').addEventListener('dblclick', () => { prefs.sideWidth = DEFAULT_PREFS.sideWidth; savePrefs(); applyLayout(); });

// ---------------------------------------------------------------- status bar

function renderStatus() {
    const t = state.active;
    const statusText = {open: '연결됨', connecting: '접속 중', closed: '연결 끊김'};
    $('#sb-conn').innerHTML = t
        ? `<span class="sb-dot ${t.status}"></span>${icon(t.kind === 'serial' ? 'serial' : 'terminal')}<span>${esc(targetOf(t.session))}</span><span>· ${statusText[t.status]}</span>${t.logging ? '<span>· 로그 저장 중</span>' : ''}`
        : '<span>연결 없음</span>';
    $('#sb-size').textContent = t ? `${t.term.cols}×${t.term.rows} · ${prefs.fontSize}px` : '';
    const n = multiTargets().length;
    $('#sb-multi').textContent = state.multi ? `멀티 실행 · ${n}개 탭` : '';
    $('#sb-mcp').className = 'sb-item' + (state.mcpRunning ? ' on' : '');
    $('#sb-mcp').innerHTML = state.mcpRunning ? `${icon('bot')}MCP` : '';
    const xs = [...state.transfers.values()];
    if (xs.length) {
        const done = xs.reduce((a, x) => a + x.done, 0);
        const total = xs.reduce((a, x) => a + (x.total || 0), 0);
        $('#sb-xfer').innerHTML = `${icon('upload')}전송 ${xs.length}개${total ? ` · ${Math.round((done / total) * 100)}%` : ''}`;
    } else {
        $('#sb-xfer').textContent = '';
    }
}

// ---------------------------------------------------------------- SFTP

function sftpActiveConn() {
    const t = state.active;
    return t && t.kind === 'ssh' && t.status === 'open' ? t : null;
}

function refreshSftpForActive() {
    if ($('#p-sftp').classList.contains('hidden')) return;
    const t = sftpActiveConn();
    if (!t) { state.sftp.connId = null; return renderSftp(); }
    if (state.sftp.connId !== t.id) {
        state.sftp = {connId: t.id, path: t.sftpPath || '', entries: [], loading: false, error: ''};
        loadSftp(state.sftp.path);
    }
}

async function loadSftp(path) {
    const id = state.sftp.connId;
    if (!id) return renderSftp();
    state.sftp.loading = true;
    state.sftp.error = '';
    renderSftp();
    try {
        const r = await App.SftpList(id, path);
        if (state.sftp.connId !== id) return;
        state.sftp.path = r.path;
        state.sftp.entries = r.entries || [];
        const t = state.tabs.find((x) => x.id === id);
        if (t) t.sftpPath = r.path;
    } catch (e) {
        if (state.sftp.connId !== id) return;
        state.sftp.error = String(e);
    }
    state.sftp.loading = false;
    renderSftp();
}

function renderCrumbs(path) {
    const parts = path.split('/').filter(Boolean);
    let acc = '';
    const segs = [`<a data-p="/">/</a>`];
    parts.forEach((p, i) => {
        acc += '/' + p;
        segs.push(`${i ? '<span class="sep">/</span>' : ''}<a data-p="${esc(acc)}">${esc(p)}</a>`);
    });
    const c = $('#sftp-crumbs');
    c.innerHTML = path ? `<span>${segs.join('')}</span>` : '';
    c.scrollLeft = c.scrollWidth; // keep the deepest folder visible
}

function renderSftp() {
    const {connId, path, entries, loading, error} = state.sftp;
    const t = state.tabs.find((x) => x.id === connId);
    const target = t && targetOf(t.session);
    $('#sftp-host').innerHTML = t ? `${icon('terminal')}<b>${esc(t.title)}</b>${target !== t.title ? `<span>${esc(target)}</span>` : ''}` : '';
    $('#sftp-loading').classList.toggle('hidden', !loading);
    renderCrumbs(connId ? path : '');
    const list = $('#sftp-list');
    if (!connId) {
        list.innerHTML = `<div class="empty">${icon('folder')}<span>연결된 SSH 탭을 선택하면<br>파일 목록이 여기에 표시됩니다</span></div>`;
        return;
    }
    if (error) {
        list.innerHTML = `<div class="empty">${icon('alert')}<span>${esc(error)}</span><button id="sftp-retry">${icon('refresh')}다시 시도</button></div>`;
        $('#sftp-retry').onclick = () => loadSftp(path);
        return;
    }
    if (loading && !entries.length) {
        list.innerHTML = '<div class="skel"></div>'.repeat(6);
        return;
    }
    list.innerHTML = entries.length ? entries.map((e, i) => `<div class="item ${e.isDir ? 'dir' : 'file'}" data-i="${i}" title="${esc(e.name)}\n${esc(e.mode)}  ${new Date(e.modTime * 1000).toLocaleString()}">
        <span class="ic">${icon(e.isDir ? 'folder' : e.isLink ? 'link' : 'file')}</span><span class="nm">${esc(e.name)}</span>
        <span class="sub">${e.isDir ? '' : fmtSize(e.size)}</span></div>`).join('')
        : `<div class="empty">${icon('folderOpen')}<span>빈 폴더<br>파일을 끌어다 놓으면 업로드합니다</span></div>`;
}

const joinPath = (dir, name) => (dir === '/' ? '' : dir.replace(/\/$/, '')) + '/' + name;
const parentPath = (p) => p.replace(/\/[^/]+\/?$/, '') || '/';

$('#sftp-crumbs').addEventListener('click', (e) => {
    if (!state.sftp.connId) return;
    const a = e.target.closest('a');
    if (a) return loadSftp(a.dataset.p);
    // Click on blank space: edit the path as text.
    const input = $('#sftp-path');
    input.value = state.sftp.path;
    $('#sftp-crumbs').classList.add('hidden');
    input.classList.remove('hidden');
    input.focus();
    input.select();
});
const endPathEdit = () => { $('#sftp-path').classList.add('hidden'); $('#sftp-crumbs').classList.remove('hidden'); };
$('#sftp-path').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { endPathEdit(); loadSftp(e.target.value.trim()); }
    if (e.key === 'Escape') endPathEdit();
});
$('#sftp-path').addEventListener('blur', endPathEdit);

$('#sftp-list').addEventListener('click', (e) => {
    const it = e.target.closest('.item');
    $$('#sftp-list .item').forEach((x) => x.classList.toggle('sel', x === it));
});
$('#sftp-list').addEventListener('dblclick', (e) => {
    const it = e.target.closest('.item');
    if (!it) return;
    const en = state.sftp.entries[it.dataset.i];
    const p = joinPath(state.sftp.path, en.name);
    if (en.isDir) loadSftp(p);
    else App.SftpDownload(state.sftp.connId, p).catch((err) => toast(String(err), 'err'));
});
$('#sftp-list').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const it = e.target.closest('.item');
    if (!it || !state.sftp.connId) return;
    const en = state.sftp.entries[it.dataset.i];
    const id = state.sftp.connId;
    const p = joinPath(state.sftp.path, en.name);
    const fail = (err) => toast(String(err), 'err');
    const items = [];
    if (en.isDir) items.push({label: '열기', icon: 'folderOpen', fn: () => loadSftp(p)});
    else items.push({label: '다운로드', icon: 'arrowDown', fn: () => App.SftpDownload(id, p).catch(fail)});
    items.push({label: '경로 복사', fn: () => { ClipboardSetText(p); toast('경로를 복사했습니다', 'ok'); }});
    items.push({label: '이름 바꾸기', fn: async () => {
        const nn = await modal('이름 바꾸기', `<div class="f"><label>새 이름</label><input name="n" value="${esc(en.name)}" autofocus/></div>`, {
            onOk: (r) => r.querySelector('[name=n]').value.trim() || false,
        });
        if (nn && nn !== en.name) App.SftpRename(id, p, joinPath(state.sftp.path, nn)).then(() => loadSftp(state.sftp.path)).catch(fail);
    }});
    items.push('-');
    items.push({label: en.isDir ? '삭제 (빈 폴더만)' : '삭제', icon: 'close', danger: true, fn: async () => {
        if (await modal('삭제', `<p><b>${esc(p)}</b>를 서버에서 삭제할까요? 되돌릴 수 없습니다.</p>`, {okText: '삭제', danger: true})) {
            App.SftpRemove(id, p, en.isDir).then(() => { toast(`${en.name} 삭제됨`, 'ok'); loadSftp(state.sftp.path); }).catch(fail);
        }
    }});
    ctxMenu(e.clientX, e.clientY, items);
});
$('#sftp-up').onclick = () => state.sftp.connId && loadSftp(parentPath(state.sftp.path));
$('#sftp-refresh').onclick = () => state.sftp.connId && loadSftp(state.sftp.path);
$('#sftp-upload').onclick = () => state.sftp.connId && App.SftpUploadDialog(state.sftp.connId, state.sftp.path).catch((err) => toast(String(err), 'err'));
$('#sftp-mkdir').onclick = async () => {
    if (!state.sftp.connId) return;
    const n = await modal('새 폴더', `<div class="f"><label>이름</label><input name="n" autofocus/><span></span><span class="hint">${esc(state.sftp.path)} 안에 만듭니다</span></div>`, {
        onOk: (r) => r.querySelector('[name=n]').value.trim() || false,
    });
    if (n) App.SftpMkdir(state.sftp.connId, joinPath(state.sftp.path, n)).then(() => loadSftp(state.sftp.path)).catch((err) => toast(String(err), 'err'));
};

OnFileDrop((x, y, paths) => {
    if (!state.sftp.connId || $('#p-sftp').classList.contains('hidden')) return toast('SFTP 패널을 열고 연결된 SSH 탭에 끌어다 놓으세요', 'err');
    App.SftpUploadPaths(state.sftp.connId, state.sftp.path, paths).catch((err) => toast(String(err), 'err'));
}, true);

EventsOn('sftp:progress', (p) => {
    const key = p.connId + '|' + p.name;
    if (p.finish) {
        state.transfers.delete(key);
        if (p.error) toast(`${p.name}: ${p.error}`, 'err');
        else toast(`${p.name} 전송 완료`, 'ok');
        if (p.connId === state.sftp.connId) loadSftp(state.sftp.path);
    } else {
        state.transfers.set(key, p);
    }
    $('#sftp-progress').innerHTML = [...state.transfers.values()].map((t) => {
        const pct = t.total ? Math.round((t.done / t.total) * 100) : 0;
        return `<div class="xfer"><div class="top"><span>${esc(t.name)}</span><span class="mono">${pct}%</span></div>
            <div class="bar"><i style="width:${pct}%"></i></div><span class="hint">${fmtSize(t.done)}${t.total ? ' / ' + fmtSize(t.total) : ''}</span></div>`;
    }).join('');
    renderStatus();
});

// ---------------------------------------------------------------- macros

async function loadMacros() {
    state.macros = await App.ListMacros() || [];
    renderMacros();
}

function renderMacros() {
    $('#macro-list').innerHTML = state.macros.length ? state.macros.map((m) => `<div class="item" data-id="${m.id}" title="${esc(m.body)}">
        <span class="ic">${icon('bolt')}</span><span class="nm">${esc(m.name)}</span>
        <span class="sub">${m.body.split('\n').filter(Boolean).length}줄</span><button class="run" title="실행">${icon('play')}실행</button></div>`).join('')
        : `<div class="empty">${icon('bolt')}<span>자주 쓰는 명령 묶음을<br>매크로로 저장해 두세요</span><button id="macro-empty-add" class="primary">${icon('plus')}새 매크로</button></div>`;
    $('#macro-empty-add')?.addEventListener('click', () => editMacro(null));
}

function runMacro(m) {
    const targets = state.multi ? multiTargets() : (state.active?.status === 'open' ? [state.active.id] : []);
    if (!targets.length) return toast('실행할 연결된 탭이 없습니다', 'err');
    App.RunMacro(targets, m.body, m.delayMs || 0);
    toast(`"${m.name}" 실행 → ${targets.length}개 탭`, 'ok');
    focusActive();
}

async function editMacro(m) {
    m = {name: '', body: '', delayMs: 300, ...m};
    const saved = await modal(m.id ? '매크로 편집' : '새 매크로', `<div class="f">
        <label>이름</label><input name="name" value="${esc(m.name)}" autofocus placeholder="예: 기본 점검"/>
        <label class="full">명령 (한 줄에 하나씩, 줄마다 Enter를 보냅니다)</label>
        <textarea class="full" name="body" rows="8" spellcheck="false" placeholder="show version&#10;show interface brief">${esc(m.body)}</textarea>
        <label>줄 간격</label><div class="inline"><input name="delay" type="number" min="0" step="100" value="${m.delayMs}"/><span class="hint">ms</span></div>
    </div>`, {
        okText: '저장',
        onOk: async (r) => {
            const out = {...m, name: r.querySelector('[name=name]').value.trim(), body: r.querySelector('[name=body]').value, delayMs: parseInt(r.querySelector('[name=delay]').value, 10) || 0};
            if (!out.name) { toast('이름을 입력하세요', 'err'); return false; }
            return App.SaveMacro(out);
        },
    });
    if (saved) loadMacros();
}

$('#macro-add').onclick = () => editMacro(null);
$('#macro-list').addEventListener('click', (e) => {
    const run = e.target.closest('.run');
    if (run) runMacro(state.macros.find((m) => m.id === run.closest('.item').dataset.id));
});
$('#macro-list').addEventListener('dblclick', (e) => {
    const it = e.target.closest('.item');
    if (it && !e.target.closest('.run')) editMacro(state.macros.find((m) => m.id === it.dataset.id));
});
$('#macro-list').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const it = e.target.closest('.item');
    if (!it) return;
    const m = state.macros.find((x) => x.id === it.dataset.id);
    ctxMenu(e.clientX, e.clientY, [
        {label: '실행', icon: 'play', fn: () => runMacro(m)},
        {label: '편집', icon: 'gear', fn: () => editMacro(m)},
        '-',
        {label: '삭제', icon: 'close', danger: true, fn: async () => { await App.DeleteMacro(m.id); loadMacros(); }},
    ]);
});

// ---------------------------------------------------------------- side panels

$$('.side-tabs button').forEach((b) => {
    b.onclick = () => {
        $$('.side-tabs button').forEach((x) => x.classList.toggle('on', x === b));
        for (const p of ['sessions', 'sftp', 'macros']) $('#p-' + p).classList.toggle('hidden', p !== b.dataset.panel);
        if (b.dataset.panel === 'sftp') {
            state.sftp.connId = null;
            refreshSftpForActive();
            if (!state.sftp.connId) renderSftp();
        }
    };
});

// ---------------------------------------------------------------- settings

function schemePreview(name) {
    const c = resolveScheme(name, isDark());
    return `<div class="preview" style="background:${c.background};color:${c.foreground};font-family:${esc(fontStack(prefs.fontFamily))}">`
        + `<span style="color:${c.green}">admin@sw1</span>:<span style="color:${c.blue}">~</span>$ show interface status\n`
        + `Gi0/1  <span style="color:${c.green}">connected</span>   100  a-full  a-1000\n`
        + `Gi0/2  <span style="color:${c.red}">notconnect</span>  1    auto    auto\n`
        + `<span style="color:${c.yellow}">%LINK-3-UPDOWN</span>: <span style="color:${c.cyan}">Gi0/3</span> changed state to <span style="color:${c.magenta}">up</span>`
        + `<div class="swatches">${['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'].map((k) => `<i style="background:${c[k]}"></i>`).join('')}</div></div>`;
}

async function settingsDialog() {
    if ($('.modal-bg')) return;
    const before = JSON.stringify(prefs);
    const seg = (key, opts) => `<div class="seg" data-pref="${key}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${String(prefs[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const chk = (key, label) => `<span></span><label class="chk"><input type="checkbox" data-pref="${key}" ${prefs[key] ? 'checked' : ''}/> ${label}</label>`;
    const body = `<div class="f">
        <h4>화면</h4>
        <label>앱 테마</label>${seg('appTheme', [['system', '시스템'], ['dark', '다크'], ['light', '라이트']])}
        <h4>터미널</h4>
        <label>색 테마</label><select data-pref="termScheme"><option value="auto">자동 (앱 테마 따라감)</option>${Object.keys(SCHEMES).map((k) => `<option ${prefs.termScheme === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>
        <div class="full" id="scheme-preview">${schemePreview(prefs.termScheme)}</div>
        <label>글꼴</label><select data-pref="fontFamily">${[...new Set([prefs.fontFamily, ...FONTS])].map((f) => `<option ${prefs.fontFamily === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select>
        <label>글자 크기</label><div class="inline"><input type="range" min="9" max="28" step="1" data-pref="fontSize" value="${prefs.fontSize}"/><output class="mono">${prefs.fontSize}px</output></div>
        <label>줄 간격</label><div class="inline"><input type="range" min="1" max="1.6" step="0.05" data-pref="lineHeight" value="${prefs.lineHeight}"/><output class="mono">${prefs.lineHeight}</output></div>
        <label>커서</label><div class="inline">${seg('cursorStyle', [['block', '블록'], ['bar', '막대'], ['underline', '밑줄']])}<label class="chk"><input type="checkbox" data-pref="cursorBlink" ${prefs.cursorBlink ? 'checked' : ''}/> 깜빡임</label></div>
        <label>스크롤백</label><div class="inline"><input type="number" min="1000" max="200000" step="1000" data-pref="scrollback" value="${prefs.scrollback}"/><span class="hint">줄</span></div>
        <h4>동작</h4>
        ${chk('copyOnSelect', '드래그로 선택하면 바로 복사')}
        ${chk('rightClickPaste', '우클릭으로 붙여넣기 (Shift+우클릭은 메뉴)')}
        ${chk('confirmMultiline', '여러 줄을 붙여넣기 전에 확인')}
        ${chk('confirmClose', '연결된 탭을 닫기 전에 확인')}
    </div>`;
    const ok = await modal('설정', body, {
        okText: '저장',
        wide: true,
        onMount: (r) => {
            const update = (key, raw) => {
                const cur = DEFAULT_PREFS[key];
                prefs[key] = typeof cur === 'number' ? Number(raw) : typeof cur === 'boolean' ? !!raw : raw;
                applyTheme();
                r.querySelector('#scheme-preview').innerHTML = schemePreview(prefs.termScheme);
            };
            r.querySelectorAll('.seg[data-pref]').forEach((s) => s.querySelectorAll('button').forEach((b) => {
                b.onclick = () => {
                    s.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
                    update(s.dataset.pref, b.dataset.v);
                };
            }));
            r.querySelectorAll('select[data-pref], input[data-pref]').forEach((el) => {
                el.addEventListener('input', () => {
                    update(el.dataset.pref, el.type === 'checkbox' ? el.checked : el.value);
                    const out = el.parentElement.querySelector('output');
                    if (out) out.textContent = el.dataset.pref === 'fontSize' ? el.value + 'px' : el.value;
                });
            });
        },
        onCancel: () => { prefs = JSON.parse(before); applyTheme(); },
    });
    if (ok) { savePrefs(); toast('설정을 저장했습니다', 'ok'); }
}
$('#btn-settings').onclick = settingsDialog;

// ---------------------------------------------------------------- MCP bridge

EventsOn('mcp:open', async ({connId, sessionId}) => {
    let s = state.sessions.find((x) => x.id === sessionId);
    if (!s) { await loadSessions(); s = state.sessions.find((x) => x.id === sessionId); }
    if (!s) return App.ReportOpenResult(connId, '세션 없음');
    toast(`AI가 "${s.name}" 세션을 엽니다`);
    openSession(s, false, connId, true);
});
EventsOn('mcp:close', (id) => {
    const t = state.tabs.find((x) => x.id === id);
    if (t) closeTab(t, true);
});
EventsOn('mcp:activity', ({connId, msg}) => {
    const t = state.tabs.find((x) => x.id === connId);
    if (!t) return;
    t.bot = msg;
    // Bring the tab the AI is typing into to the front so the user can watch it.
    if (state.active !== t) activate(t);
    renderTabs();
    clearTimeout(t.botTimer);
    t.botTimer = setTimeout(() => { t.bot = false; renderTabs(); }, 4000);
});

async function refreshMcpButton() {
    const info = await App.GetMCPInfo();
    state.mcpRunning = info.running;
    $('#btn-mcp').classList.toggle('on', info.running);
    $('#btn-mcp').title = info.running ? `MCP 서버 실행 중 (${info.url})` : 'MCP 서버 꺼짐';
    renderStatus();
}

async function mcpDialog() {
    let info = await App.GetMCPInfo();
    await modal('MCP 연동', `<div class="f">
        <span></span><label class="chk"><input type="checkbox" name="on" ${info.enabled ? 'checked' : ''}/> MCP 서버 켜기 (127.0.0.1 전용)</label>
        <label>포트</label><input name="port" type="number" value="${info.port}"/>
        <label>상태</label><span>${info.running ? '<b style="color:var(--ok)">실행 중</b> <span class="mono">' + esc(info.url) + '</span>' : '꺼짐'}</span>
        ${info.command ? `<label class="full">Claude Code 등록 명령 (토큰 포함 · 다른 사람과 공유하지 마세요)</label>
        <textarea class="full" name="cmd" rows="3" readonly>${esc(info.command)}</textarea>
        <span></span><div class="inline"><button type="button" data-x="copy">명령 복사</button><button type="button" data-x="regen">토큰 재발급</button></div>` : ''}
        <p class="full hint">AI가 저장된 세션을 탭으로 열고 명령을 실행해 결과를 읽습니다. 저장된 비밀번호는 AI에 전달되지 않습니다.</p>
    </div>`, {
        okText: '적용',
        onMount: (r) => {
            r.querySelector('[data-x=copy]')?.addEventListener('click', () => { ClipboardSetText(info.command); toast('명령을 복사했습니다', 'ok'); });
            r.querySelector('[data-x=regen]')?.addEventListener('click', async () => {
                info = await App.RegenerateMCPToken();
                r.querySelector('[name=cmd]').value = info.command;
                toast('토큰을 재발급했습니다. Claude Code에 다시 등록하세요.');
            });
        },
        onOk: async (r) => {
            try {
                info = await App.SetMCPEnabled(r.querySelector('[name=on]').checked, parseInt(r.querySelector('[name=port]').value, 10) || 0);
                toast(info.running ? `MCP 서버 실행 중: ${info.url}` : 'MCP 서버를 껐습니다', 'ok');
            } catch (e) { toast(String(e), 'err'); return false; }
            return true;
        },
    });
    refreshMcpButton();
}
$('#btn-mcp').onclick = mcpDialog;

// ---------------------------------------------------------------- boot

(async () => {
    hydrateIcons();
    await loadPrefs();
    applyLayout();
    applyTheme();
    await Promise.all([loadSessions(), loadMacros(), refreshMcpButton()]);
    renderTabs();
    document.body.classList.remove('booting');
    setInterval(renderRecents, 60000); // keep "n분 전" fresh
})();
