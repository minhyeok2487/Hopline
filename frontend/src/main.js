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
import {LANGS, t, setLang, resolveLang, applyStatic} from './i18n';

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
    lang: 'auto',              // auto | ko | en
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
    uiScale: 100,              // % zoom for the app chrome (terminal text uses fontSize)
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

function applyLanguage() {
    const lang = resolveLang(prefs.lang);
    setLang(lang);
    App.SetLanguage(lang).catch(() => {});
    applyStatic();
    for (const tab of state.tabs) applyStatic(tab.pane);
    renderSessions();
    renderRecents();
    renderMacros();
    renderSftp();
    renderTabs();
    refreshMcpButton().catch(() => {});
    fitTopbar(); // labels change width with the language
}

const uiZoom = () => (prefs.uiScale || 100) / 100;

function fitTopbar() {
    const bar = $('#topbar');
    bar.classList.remove('compact');
    if (bar.scrollWidth > bar.clientWidth + 1) bar.classList.add('compact');
}
new ResizeObserver(fitTopbar).observe($('#topbar'));

function applyLayout() {
    document.documentElement.style.setProperty('--ui-zoom', uiZoom());
    $('#app').style.setProperty('--side-w', prefs.sideWidth + 'px');
    $('#app').classList.toggle('side-collapsed', prefs.sideCollapsed);
    $('#side-open').classList.toggle('hidden', !prefs.sideCollapsed);
    fitTopbar();
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

function ago(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return t('time.now');
    if (s < 3600) return t('time.min', {n: Math.floor(s / 60)});
    if (s < 86400) return t('time.hour', {n: Math.floor(s / 3600)});
    return t('time.day', {n: Math.floor(s / 86400)});
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
    // The menu is zoomed with the UI, so its CSS offsets are in zoomed units.
    const z = uiZoom();
    m.style.left = Math.min(x, innerWidth - r.width - 4) / z + 'px';
    m.style.top = Math.min(y, innerHeight - r.height - 4) / z + 'px';
}
const hideCtx = () => $('#ctx').classList.add('hidden');
addEventListener('click', hideCtx);
addEventListener('blur', hideCtx);
addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || $('#ctx').classList.contains('hidden')) return;
    e.preventDefault();
    e.stopPropagation();
    hideCtx();
}, true);

/** modal(title, html, opts) — onOk(root) returns false to keep it open. Resolves to onOk's result or null. */
function modal(title, bodyHtml, {okText = t('common.ok'), onOk, onMount, onCancel, wide = false, danger = false} = {}) {
    return new Promise((resolve) => {
        const bg = document.createElement('div');
        bg.className = 'modal-bg';
        bg.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-label="${esc(title)}"><h3>${esc(title)}</h3>${bodyHtml}
            <div class="btns"><button data-x="cancel">${t('common.cancel')}</button><button class="primary${danger ? ' danger-btn' : ''}" data-x="ok">${esc(okText)}</button></div></div>`;
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
        // Ignore the backdrop briefly so the second click of a double-click doesn't cancel right away.
        const opened = performance.now();
        bg.addEventListener('mousedown', (e) => { if (e.target === bg && performance.now() - opened > 400) cancel(); });
        bg.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') cancel();
            if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); ok(); }
        });
        onMount?.(root);
        // Focus again on the next tick: a terminal that triggered the modal can reclaim focus.
        // A plain confirmation has no field: focus OK so Enter/Esc work and keys don't reach the terminal.
        const first = root.querySelector('[autofocus]') || root.querySelector('input,select,textarea') || root.querySelector('[data-x=ok]');
        first?.focus();
        setTimeout(() => first?.focus(), 0);
    });
}

async function promptPassword(title, canSave) {
    return modal(title, `<div class="f">
        <label>${t('pw.label')}</label><input type="password" name="pw" autofocus/>
        ${canSave ? `<span></span><label class="chk"><input type="checkbox" name="save"/> ${t('pw.save')}</label>` : ''}
    </div>`, {
        okText: t('pw.connect'),
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
            ? `<div class="empty">${icon('search')}<span>${esc(t('sess.noMatch', {q}))}</span></div>`
            : `<div class="empty">${icon('terminal')}<span>${t('sess.none')}</span><button id="empty-add" class="primary">${icon('plus')}${t('sess.create')}</button></div>`;
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
                ${n ? `<span class="live-n" title="${t('sess.liveTabs', {n})}">●${n > 1 ? n : ''}</span>` : `<span class="sub">${esc(targetOf(s))}</span>`}</div>`;
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
    if (!it) return ctxMenu(e.clientX, e.clientY, [{label: t('sess.new'), icon: 'plus', fn: () => editSession(null)}]);
    const s = state.sessions.find((x) => x.id === it.dataset.id);
    selectSession(s.id);
    ctxMenu(e.clientX, e.clientY, [
        {label: t('common.connect'), icon: 'play', fn: () => openSession(s)},
        {label: t('common.edit'), icon: 'gear', fn: () => editSession(s)},
        {label: t('common.duplicate'), icon: 'plus', fn: () => editSession({...s, id: '', name: s.name + ' ' + t('sess.copySuffix'), hasPassword: false,
            logonSteps: (s.logonSteps || []).map((st) => ({...st, id: '', hasSecret: false}))})},
        '-',
        {label: t('common.delete'), icon: 'close', danger: true, fn: async () => {
            if (await modal(t('sess.deleteTitle'), `<p>${esc(t('sess.deleteBody', {name: s.name}))}</p>`, {okText: t('common.delete'), danger: true})) {
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
        <label>${t('f.kind')}</label><div class="seg" data-seg="kind"><button type="button" data-v="ssh">SSH</button><button type="button" data-v="serial">${t('f.serial')}</button></div>
        <label>${t('common.name')}</label><input name="name" value="${esc(s.name)}" placeholder="${t('f.namePh')}"/>
        <label>${t('f.folder')}</label><input name="folder" value="${esc(s.folder)}" list="folders" placeholder="${t('f.folderPh')}"/>
        <datalist id="folders">${folders.map((f) => `<option value="${esc(f)}">`).join('')}</datalist>

        <h4 class="ssh">${t('f.secConn')}</h4>
        <label class="ssh">${t('f.host')}</label><input class="ssh" name="host" value="${esc(s.host)}" autofocus placeholder="${t('f.hostPh')}"/>
        <label class="ssh">${t('common.port')}</label><input class="ssh" name="port" type="number" value="${s.port || 22}"/>
        <label class="ssh">${t('f.user')}</label><input class="ssh" name="user" value="${esc(s.user)}"/>
        <h4 class="ssh">${t('f.secAuth')}</h4>
        <label class="ssh">${t('pw.label')}</label><input class="ssh" name="pw" type="password" placeholder="${s.hasPassword ? t('f.pwSaved') : t('f.pwAsk')}"/>
        <span class="ssh"></span><label class="ssh chk"><input type="checkbox" name="save" ${s.hasPassword || isNew ? 'checked' : ''}/> ${t('pw.save')}</label>
        <label class="ssh">${t('f.key')}</label><div class="ssh inline"><input name="keyPath" value="${esc(s.keyPath)}" placeholder="${t('f.optional')}"/><button type="button" data-x="key">${t('common.browse')}</button></div>
        <span class="ssh"></span><label class="ssh chk"><input type="checkbox" name="legacy" ${s.legacy ? 'checked' : ''}/> ${t('f.legacy')}</label>

        <h4 class="ser">${t('f.secPort')}</h4>
        <label class="ser">${t('common.port')}</label><div class="ser inline"><select name="comPort"></select><button type="button" data-x="scan" title="${t('f.rescan')}">${icon('refresh')}</button></div>
        <label class="ser">${t('f.baud')}</label><input class="ser" name="baud" list="bauds" value="${s.baud || 9600}"/>
        <datalist id="bauds">${BAUDS.map((b) => `<option value="${b}">`).join('')}</datalist>
        <label class="ser">${t('f.dataBits')}</label><select class="ser" name="dataBits">${[8, 7, 6, 5].map((b) => `<option ${s.dataBits === b ? 'selected' : ''}>${b}</option>`).join('')}</select>
        <label class="ser">${t('f.parity')}</label><select class="ser" name="parity"><option value="N">${t('f.parityN')}</option><option value="E">${t('f.parityE')}</option><option value="O">${t('f.parityO')}</option></select>
        <label class="ser">${t('f.stopBits')}</label><select class="ser" name="stopBits"><option>1</option><option>2</option></select>

        <h4>${t('lg.sec')}</h4>
        <span></span><label class="chk"><input type="checkbox" name="autoLogon" ${s.autoLogon ? 'checked' : ''}/> ${t('lg.enable')}</label>
        <span></span><div class="lg-box">
            <label class="chk"><input type="checkbox" name="logonCR" ${s.logonCR ? 'checked' : ''}/> ${t('lg.cr')}</label>
            <div class="lg-steps"></div>
            <div class="inline lg-btns"><button type="button" data-x="lg-add">${icon('plus')}${t('lg.add')}</button><button type="button" data-x="lg-enable">${t('lg.preset')}</button></div>
            <p class="hint">${t('lg.hint')}</p>
        </div>
    </div>`;

    let kind = s.kind;
    const saved = await modal(isNew ? t('sess.new') : t('sess.edit'), body, {
        okText: t('common.save'),
        wide: true,
        onMount: (r) => {
            mountLogonEditor(r, s.logonSteps || []);
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
                sel.innerHTML = `<option value="">${t('f.scanning')}</option>`;
                const ports = await App.ListSerialPorts() || [];
                const cur = s.comPort;
                sel.innerHTML = ports.map((p) => `<option value="${esc(p.name)}">${esc(p.label)}</option>`).join('')
                    || `<option value="">${t('f.noPorts')}</option>`;
                if (cur && !ports.some((p) => p.name === cur)) sel.insertAdjacentHTML('afterbegin', `<option value="${esc(cur)}">${esc(t('f.portMissing', {p: cur}))}</option>`);
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
            if (out.kind === 'ssh' && !out.host) { toast(t('sess.needHost'), 'err'); r.querySelector('[name=host]').focus(); return false; }
            if (out.kind === 'serial' && !out.comPort) { toast(t('sess.needCom'), 'err'); return false; }
            out.autoLogon = r.querySelector('[name=autoLogon]').checked;
            out.logonCR = r.querySelector('[name=logonCR]').checked;
            out.logonSteps = readLogonSteps(r);
            const blank = out.logonSteps.find((st) => st.hide && !st.send && !st.hasSecret);
            if (out.autoLogon && blank) { toast(t('lg.needSecret'), 'err'); return false; }
            try {
                return await App.SaveSession(out, r.querySelector('[name=pw]').value, r.querySelector('[name=save]').checked);
            } catch (e) {
                toast(t('sess.saveFailed', {e}), 'err');
                return false;
            }
        },
    });
    if (saved) {
        state.selSession = saved.id;
        toast(t('sess.saved', {name: saved.name}), 'ok');
        loadSessions();
    }
}

// Logon actions editor: one row per expect/send step.
const sendPh = (st) => (!st.hide ? t('lg.sendPh') : st.hasSecret ? t('lg.secretSaved') : t('lg.secretPh'));

function mountLogonEditor(r, steps) {
    const box = r.querySelector('.lg-steps');
    const head = `<span class="hd">${t('lg.expect')}</span><span class="hd">${t('lg.send')}</span><span class="hd">${t('lg.hide')}</span><span></span>`;
    const row = (st) => `<div class="lg-row" data-id="${esc(st.id || '')}" data-secret="${st.hasSecret ? 1 : 0}">
        <input class="lg-exp" value="${esc(st.expect)}" placeholder="${t('lg.expectPh')}" spellcheck="false"/>
        <input class="lg-send" type="${st.hide ? 'password' : 'text'}" value="${esc(st.hide ? '' : st.send)}"
            placeholder="${sendPh(st)}" spellcheck="false"/>
        <input class="lg-hide" type="checkbox" ${st.hide ? 'checked' : ''} title="${t('lg.hide')}"/>
        <span class="acts"><button type="button" class="ghost icon" data-a="up" title="${t('lg.up')}">${icon('arrowUp')}</button><button type="button" class="ghost icon" data-a="down" title="${t('lg.down')}">${icon('arrowDown')}</button><button type="button" class="ghost icon" data-a="del" title="${t('common.delete')}">${icon('close')}</button></span></div>`;
    const render = (list) => { box.innerHTML = list.length ? head + list.map(row).join('') : `<p class="hint">${t('lg.none')}</p>`; };
    const sync = () => r.querySelector('.lg-box').classList.toggle('off', !r.querySelector('[name=autoLogon]').checked);
    render(steps);
    sync();
    r.querySelector('[name=autoLogon]').addEventListener('change', sync);
    const add = (list) => {
        render([...readLogonSteps(r, true), ...list]);
        if (!r.querySelector('[name=autoLogon]').checked) { r.querySelector('[name=autoLogon]').checked = true; sync(); }
        // Focus what still needs typing: a new secret, else the first new row.
        const rows = [...box.querySelectorAll('.lg-row')].slice(-list.length);
        const k = list.findIndex((st) => st.hide && !st.send);
        rows[Math.max(k, 0)]?.querySelector(k >= 0 || list[0].expect ? '.lg-send' : '.lg-exp').focus();
    };
    r.querySelector('[data-x=lg-add]').onclick = () => add([{expect: '', send: ''}]);
    r.querySelector('[data-x=lg-enable]').onclick = () => add([{expect: '>', send: 'enable'}, {expect: 'assword:', send: '', hide: true}]);
    box.addEventListener('change', (e) => {
        if (!e.target.classList.contains('lg-hide')) return;
        const el = e.target.closest('.lg-row');
        const send = el.querySelector('.lg-send');
        send.type = e.target.checked ? 'password' : 'text';
        send.placeholder = sendPh({hide: e.target.checked, hasSecret: el.dataset.secret === '1'});
    });
    box.addEventListener('click', (e) => {
        const b = e.target.closest('[data-a]');
        if (!b) return;
        const list = readLogonSteps(r, true);
        const i = [...box.querySelectorAll('.lg-row')].indexOf(b.closest('.lg-row'));
        if (b.dataset.a === 'del') list.splice(i, 1);
        else {
            const j = b.dataset.a === 'up' ? i - 1 : i + 1;
            if (j < 0 || j >= list.length) return;
            [list[i], list[j]] = [list[j], list[i]];
        }
        render(list);
    });
}

// keepEmpty: keep blank rows (while editing); otherwise rows with nothing in them are dropped.
function readLogonSteps(r, keepEmpty = false) {
    return [...r.querySelectorAll('.lg-row')].map((el) => ({
        id: el.dataset.id,
        expect: el.querySelector('.lg-exp').value,
        send: el.querySelector('.lg-send').value,
        hide: el.querySelector('.lg-hide').checked,
        hasSecret: el.dataset.secret === '1',
    })).filter((st) => keepEmpty || st.expect || st.send || (st.hide && st.hasSecret));
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
        ? `<div class="rec-title">${t('recent.title')}</div>` + items.map((x, i) => `<button class="recent" data-i="${i}">
            <span class="ic">${icon(x.s.kind === 'serial' ? 'serial' : 'terminal')}</span><span class="nm">${esc(x.s.name)}</span>
            <span class="hint">${ago(x.t)}</span><span class="sub">${esc(targetOf(x.s))}</span></button>`).join('')
        : `<p class="hint">${t('recent.empty')}</p>`;
    $$('#recents .recent').forEach((b) => { b.onclick = () => { const x = items[b.dataset.i]; openSession(x.s, x.adhoc); }; });
}

// ---------------------------------------------------------------- quick connect

$('#quick').addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') { e.target.value = ''; focusActive(); return; }
    if (e.key !== 'Enter') return;
    const m = e.target.value.trim().match(/^(?:([^@\s]+)@)?([^:\s]+)(?::(\d+))?$/);
    if (!m) return toast(t('quick.format'), 'err');
    let [, user, host, port] = m;
    if (!user) {
        const r = await modal(t('quick.userTitle'), `<div class="f"><label>${t('f.user')}</label><input name="u" autofocus/><span></span><span class="hint">${esc(t('quick.userFor', {host}))}</span></div>`, {
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
        <div class="overlay"><div class="card"><div class="spinner"></div><div><b data-i18n="conn.connecting"></b></div>
            <div class="target">${esc(targetOf(s))}</div><div class="sub" data-el="elapsed"></div>
            <button data-x="cancel" data-i18n="common.cancel"></button></div></div>
        <div class="closedbar"><span class="msg"></span>
            <button class="primary" data-x="reconnect">${icon('refresh')}<span data-i18n="conn.reconnect"></span> <kbd>Enter</kbd></button>
            <button data-x="close" data-i18n="conn.closeTab"></button></div>`;
    applyStatic(pane);
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
    EventsOn('logon:' + id, (ev) => {
        if (!ev.error) return;
        const msg = t('lg.err.' + ev.error, {step: ev.step, total: ev.total, expect: ev.expect});
        term.write(`\r\n\x1b[33m── ${msg} ──\x1b[0m\r\n`);
        toast(msg, 'err');
    });

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
            {label: t('term.copy'), fn: () => ClipboardSetText(term.getSelection())},
            {label: t('term.paste'), fn: () => pasteInto(tab)},
            {label: t('term.selectAll'), fn: () => term.selectAll()},
            '-',
            {label: t('common.find'), icon: 'search', fn: () => openFind(tab)},
            {label: t('common.clear'), fn: () => term.clear()},
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
        const ok = await modal(t('paste.title'), `<p>${t('paste.body', {n: lines, name: esc(tab.title)})}</p><pre>${esc(text.slice(0, 2000))}</pre>`, {okText: t('paste.ok', {n: lines})});
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
    tab.connTimer = setInterval(() => { el.textContent = t('conn.sec', {s: ((performance.now() - t0) / 1000).toFixed(1)}); }, 100);
    el.textContent = t('conn.sec', {s: '0.0'});
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
            if (msg.includes('AUTH_FAILED')) term.write(`\x1b[31m${t('conn.authFailed')}\x1b[0m\r\n`);
            App.ShowWindow(); // the window may be hidden in the tray (e.g. an AI opened this tab)
            const r = await promptPassword(t('pw.title', {name: tab.title}), !tab.adhoc);
            if (r && r.pw) {
                if (r.save) await App.SetSessionPassword(tab.session.id, r.pw).then(loadSessions).catch((e) => toast(String(e), 'err'));
                return connectTab(tab, r.pw);
            }
            return markClosed(tab, t('conn.pwCanceled'));
        }
        if (msg.includes('CANCELED')) return markClosed(tab, t('conn.canceled'));
        term.write(`\x1b[31m${t('conn.failed')}: ${msg.replace(/\n/g, '\r\n')}\x1b[0m\r\n`);
        reportMcp(tab, msg);
        markClosed(tab, t('conn.failed') + ' · ' + msg.split('\n')[0]);
    }
}

// Tell the backend how a tab opened by MCP open_session ended up.
function reportMcp(tab, err) {
    if (!tab.mcpPending) return;
    tab.mcpPending = false;
    App.ReportOpenResult(tab.id, err);
}

function markClosed(tab, reason) {
    reportMcp(tab, reason || t('conn.failed'));
    if (tab.status === 'closed') return;
    tab.status = 'closed';
    tab.logging = false;
    hideConnecting(tab);
    if (reason) tab.term.write(`\r\n\x1b[90m── ${reason} ──\x1b[0m\r\n`);
    const bar = tab.pane.querySelector('.closedbar');
    bar.querySelector('.msg').innerHTML = `<b>${t('conn.lost')}</b>${esc(reason || '')}`;
    bar.classList.add('show');
    renderTabs();
    renderSessions();
    if (state.sftp.connId === tab.id) { state.sftp.connId = null; renderSftp(); }
}

async function closeTab(tab, force = false) {
    if (!force && prefs.confirmClose && tab.status === 'open') {
        const ok = await modal(t('tab.closeTitle'), `<p>${t('tab.closeBody', {name: esc(tab.title)})}</p>`, {okText: t('common.close'), danger: true});
        if (!ok) return;
    }
    App.Disconnect(tab.id);
    hideConnecting(tab);
    EventsOff('data:' + tab.id, 'closed:' + tab.id, 'logon:' + tab.id);
    tab.term.dispose();
    tab.pane.remove();
    const i = state.tabs.indexOf(tab);
    state.tabs.splice(i, 1);
    if (state.active === tab) {
        state.active = null;
        const next = state.tabs[Math.min(i, state.tabs.length - 1)];
        if (next) activate(next);
        else App.SetActiveTab('').catch(() => {});
    }
    renderTabs();
    renderSessions();
    if (state.sftp.connId === tab.id) { state.sftp.connId = null; renderSftp(); }
}

function activate(tab) {
    state.active = tab;
    App.SetActiveTab(tab.id).catch(() => {});
    for (const t of state.tabs) t.pane.classList.toggle('on', t === tab);
    syncActiveTab();
    requestAnimationFrame(() => {
        tab.fit.fit();
        // Don't steal focus from a dialog, the find bar or a tab being renamed.
        if (!$('#modal-root').children.length && !tab.pane.querySelector('.findbar') && !$('#tabbar .rename')) tab.term.focus();
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
    $('#tabbar').innerHTML = state.tabs.map((tb) => `<div class="tab${tb === state.active ? ' on' : ''}" data-id="${tb.id}" draggable="true" role="tab" aria-selected="${tb === state.active}" title="${esc(targetOf(tb.session))}">
        ${state.multi ? `<input type="checkbox" ${tb.multi ? 'checked' : ''} title="${t('tab.multiTarget')}"/>` : ''}
        <span class="dot ${tb.status}"></span><span class="t">${esc(tb.title)}</span>
        ${tb.logging ? '<span class="badge rec">REC</span>' : ''}${tb.bot ? `<span class="badge bot" title="${esc(tb.bot)}">AI</span>` : ''}
        <button class="x" title="${t('common.close')}">${icon('close')}</button></div>`).join('');
    renderStatus();
}

// Mark the active tab without rebuilding the bar: rebuilding between the two
// clicks of a double-click would swallow the dblclick (rename).
function syncActiveTab() {
    const els = $$('#tabbar .tab');
    if (els.length !== state.tabs.length) return renderTabs();
    for (const el of els) {
        const on = el.dataset.id === state.active?.id;
        el.classList.toggle('on', on);
        el.setAttribute('aria-selected', on);
    }
    $('#btn-log').classList.toggle('on', !!state.active?.logging);
    renderStatus();
}

$('#tabbar').addEventListener('click', (e) => {
    const el = e.target.closest('.tab');
    if (!el) return;
    const tab = state.tabs.find((t) => t.id === el.dataset.id);
    if (e.target.closest('.x')) return closeTab(tab);
    if (e.target.type === 'checkbox') { tab.multi = e.target.checked; renderStatus(); return; }
    if (e.target.classList.contains('rename')) return;
    if (state.active !== tab) activate(tab);
    else focusActive();
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
        {label: t('conn.reconnect'), icon: 'refresh', fn: () => { if (tab.status === 'open') App.Disconnect(tab.id); setTimeout(() => connectTab(tab), 200); }},
        {label: t('common.duplicate'), icon: 'plus', fn: () => openSession(tab.session, tab.adhoc)},
        {label: t('common.rename'), fn: () => renameTab(tab)},
        {label: t('common.find'), icon: 'search', fn: () => { activate(tab); openFind(tab); }},
        {label: t('common.clear'), fn: () => tab.term.clear()},
        '-',
        {label: t('tab.closeOthers'), fn: () => state.tabs.filter((x) => x !== tab).forEach((x) => closeTab(x, true))},
        {label: t('common.close'), icon: 'close', danger: true, fn: () => closeTab(tab)},
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
    let finished = false;
    const done = (save) => {
        if (finished) return;
        finished = true;
        if (save && input.value.trim()) {
            tab.title = input.value.trim();
            App.SetTabTitle(tab.id, tab.title).catch(() => {});
        }
        renderTabs();
        focusActive();
    };
    input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key !== 'Enter' && e.key !== 'Escape') return;
        e.preventDefault(); // otherwise the Enter keypress lands in the terminal once it has focus
        done(e.key === 'Enter');
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
    $$('.tab').forEach((t) => t.classList.remove('drop-before', 'drop-after'));
    const over = e.target.closest('.tab');
    if (over && over.dataset.id !== dragId) over.classList.add(dropAfter(e, over) ? 'drop-after' : 'drop-before');
});
const dropAfter = (e, el) => { const r = el.getBoundingClientRect(); return e.clientX > r.left + r.width / 2; };
$('#tabbar').addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const over = e.target.closest('.tab');
    const after = over && dropAfter(e, over);
    const from = state.tabs.findIndex((t) => t.id === dragId);
    const [moved] = state.tabs.splice(from, 1);
    let to = over ? state.tabs.findIndex((t) => t.id === over.dataset.id) : state.tabs.length;
    if (to < 0) to = state.tabs.length;
    else if (after) to++;
    state.tabs.splice(to, 0, moved);
    dragId = null;
    renderTabs();
});
$('#tabbar').addEventListener('dragend', () => { dragId = null; renderTabs(); });

new ResizeObserver(() => state.active?.fit.fit()).observe($('#terms'));

$('#btn-multi').onclick = () => {
    state.multi = !state.multi;
    renderTabs();
    if (state.multi) toast(t('multi.on'));
    focusActive();
};
$('#btn-log').onclick = async () => {
    const tab = state.active;
    if (!tab || tab.status !== 'open') return toast(t('log.needConn'), 'err');
    try {
        const p = await App.SetLogging(tab.id, !tab.logging);
        tab.logging = !tab.logging;
        toast(tab.logging ? t('log.started', {p}) : t('log.stopped'), tab.logging ? 'ok' : 'info');
        renderTabs();
    } catch (e) { toast(String(e), 'err'); }
    focusActive();
};
$('#btn-logdir').onclick = () => App.OpenLogFolder();

// ---------------------------------------------------------------- find in terminal

// Match colors per theme so highlighted text stays readable (xterm needs #RRGGBB).
const FIND_DECOR_DARK = {
    matchBackground: '#6b5a1a', matchBorder: '#c9a227', matchOverviewRuler: '#c9a227',
    activeMatchBackground: '#c9a227', activeMatchBorder: '#ffd75e', activeMatchColorOverviewRuler: '#ffd75e',
};
const FIND_DECOR_LIGHT = {
    matchBackground: '#fff1a8', matchBorder: '#e0b400', matchOverviewRuler: '#e0b400',
    activeMatchBackground: '#ffc94d', activeMatchBorder: '#c98a00', activeMatchColorOverviewRuler: '#c98a00',
};
const findDecor = () => (resolveScheme(prefs.termScheme, isDark()).background.match(/^#[0-7]/) ? FIND_DECOR_DARK : FIND_DECOR_LIGHT);

function openFind(tab) {
    let bar = tab.pane.querySelector('.findbar');
    if (!bar) {
        bar = document.createElement('div');
        bar.className = 'findbar';
        bar.innerHTML = `<label class="field">${icon('search')}<input placeholder="${t('common.find')}" spellcheck="false"/></label>
            <span class="count"></span>
            <button class="ghost icon" data-x="prev" title="${t('find.prev')}">${icon('arrowUp')}</button>
            <button class="ghost icon" data-x="next" title="${t('find.next')}">${icon('arrowDown')}</button>
            <button class="ghost icon" data-x="close" title="${t('find.close')}">${icon('close')}</button>`;
        tab.pane.appendChild(bar);
        const input = bar.querySelector('input');
        const count = bar.querySelector('.count');
        tab.findSub = tab.search.onDidChangeResults(({resultIndex, resultCount}) => {
            count.textContent = resultCount ? `${resultIndex + 1}/${resultCount}` : (input.value ? t('find.none') : '');
        });
        const go = (back) => input.value && (back
            ? tab.search.findPrevious(input.value, {decorations: findDecor()})
            : tab.search.findNext(input.value, {decorations: findDecor()}));
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
    toast(t('zoom.size', {n: prefs.fontSize}));
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
        prefs.sideWidth = Math.max(200, Math.min(520, ev.clientX / uiZoom()));
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
    const a = state.active;
    $('#sb-conn').innerHTML = a
        ? `<span class="sb-dot ${a.status}"></span>${icon(a.kind === 'serial' ? 'serial' : 'terminal')}<span>${esc(targetOf(a.session))}</span><span>· ${t('sb.' + a.status)}</span>${a.logging ? `<span>· ${t('sb.logging')}</span>` : ''}`
        : `<span>${t('sb.none')}</span>`;
    $('#sb-size').textContent = a ? `${a.term.cols}×${a.term.rows} · ${prefs.fontSize}px` : '';
    const n = multiTargets().length;
    $('#sb-multi').textContent = state.multi ? t('sb.multi', {n}) : '';
    $('#sb-mcp').className = 'sb-item' + (state.mcpRunning ? ' on' : '');
    $('#sb-mcp').innerHTML = state.mcpRunning ? `${icon('bot')}MCP` : '';
    const xs = [...state.transfers.values()];
    if (xs.length) {
        const done = xs.reduce((a, x) => a + x.done, 0);
        const total = xs.reduce((a, x) => a + (x.total || 0), 0);
        $('#sb-xfer').innerHTML = `${icon('upload')}${t('sb.xfer', {n: xs.length})}${total ? ` · ${Math.round((done / total) * 100)}%` : ''}`;
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
    const tb = state.tabs.find((x) => x.id === connId);
    const target = tb && targetOf(tb.session);
    $('#sftp-host').innerHTML = tb ? `${icon('terminal')}<b>${esc(tb.title)}</b>${target !== tb.title ? `<span>${esc(target)}</span>` : ''}` : '';
    $('#sftp-loading').classList.toggle('hidden', !loading);
    renderCrumbs(connId ? path : '');
    const list = $('#sftp-list');
    if (!connId) {
        list.innerHTML = `<div class="empty">${icon('folder')}<span>${t('sftp.pick')}</span></div>`;
        return;
    }
    if (error) {
        list.innerHTML = `<div class="empty">${icon('alert')}<span>${esc(error)}</span><button id="sftp-retry">${icon('refresh')}${t('common.retry')}</button></div>`;
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
        : `<div class="empty">${icon('folderOpen')}<span>${t('sftp.emptyDir')}</span></div>`;
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
    if (en.isDir) items.push({label: t('sftp.open'), icon: 'folderOpen', fn: () => loadSftp(p)});
    else items.push({label: t('sftp.download'), icon: 'arrowDown', fn: () => App.SftpDownload(id, p).catch(fail)});
    items.push({label: t('sftp.copyPath'), fn: () => { ClipboardSetText(p); toast(t('sftp.pathCopied'), 'ok'); }});
    items.push({label: t('common.rename'), fn: async () => {
        const nn = await modal(t('common.rename'), `<div class="f"><label>${t('sftp.newName')}</label><input name="n" value="${esc(en.name)}" autofocus/></div>`, {
            onOk: (r) => r.querySelector('[name=n]').value.trim() || false,
        });
        if (nn && nn !== en.name) App.SftpRename(id, p, joinPath(state.sftp.path, nn)).then(() => loadSftp(state.sftp.path)).catch(fail);
    }});
    items.push('-');
    items.push({label: en.isDir ? t('sftp.deleteEmpty') : t('common.delete'), icon: 'close', danger: true, fn: async () => {
        if (await modal(t('common.delete'), `<p>${t('sftp.deleteBody', {p: esc(p)})}</p>`, {okText: t('common.delete'), danger: true})) {
            App.SftpRemove(id, p, en.isDir).then(() => { toast(t('sftp.deleted', {name: en.name}), 'ok'); loadSftp(state.sftp.path); }).catch(fail);
        }
    }});
    ctxMenu(e.clientX, e.clientY, items);
});
$('#sftp-up').onclick = () => state.sftp.connId && loadSftp(parentPath(state.sftp.path));
$('#sftp-refresh').onclick = () => state.sftp.connId && loadSftp(state.sftp.path);
$('#sftp-upload').onclick = () => state.sftp.connId && App.SftpUploadDialog(state.sftp.connId, state.sftp.path).catch((err) => toast(String(err), 'err'));
$('#sftp-mkdir').onclick = async () => {
    if (!state.sftp.connId) return;
    const n = await modal(t('sftp.newFolder'), `<div class="f"><label>${t('common.name')}</label><input name="n" autofocus/><span></span><span class="hint">${esc(t('sftp.createIn', {p: state.sftp.path}))}</span></div>`, {
        onOk: (r) => r.querySelector('[name=n]').value.trim() || false,
    });
    if (n) App.SftpMkdir(state.sftp.connId, joinPath(state.sftp.path, n)).then(() => loadSftp(state.sftp.path)).catch((err) => toast(String(err), 'err'));
};

OnFileDrop((x, y, paths) => {
    if (!state.sftp.connId || $('#p-sftp').classList.contains('hidden')) return toast(t('sftp.dropHint'), 'err');
    App.SftpUploadPaths(state.sftp.connId, state.sftp.path, paths).catch((err) => toast(String(err), 'err'));
}, true);

EventsOn('sftp:progress', (p) => {
    const key = p.connId + '|' + p.name;
    if (p.finish) {
        state.transfers.delete(key);
        if (p.error) toast(`${p.name}: ${p.error}`, 'err');
        else toast(t('sftp.done', {name: p.name}), 'ok');
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
        <span class="sub">${t('macro.lines', {n: m.body.split('\n').filter(Boolean).length})}</span><button class="run" title="${t('common.run')}">${icon('play')}${t('common.run')}</button></div>`).join('')
        : `<div class="empty">${icon('bolt')}<span>${t('macro.empty')}</span><button id="macro-empty-add" class="primary">${icon('plus')}${t('macro.new')}</button></div>`;
    $('#macro-empty-add')?.addEventListener('click', () => editMacro(null));
}

function runMacro(m) {
    const targets = state.multi ? multiTargets() : (state.active?.status === 'open' ? [state.active.id] : []);
    if (!targets.length) return toast(t('macro.noTarget'), 'err');
    App.RunMacro(targets, m.body, m.delayMs || 0);
    toast(t('macro.ran', {name: m.name, n: targets.length}), 'ok');
    focusActive();
}

async function editMacro(m) {
    m = {name: '', body: '', delayMs: 300, ...m};
    const saved = await modal(m.id ? t('macro.edit') : t('macro.new'), `<div class="f">
        <label>${t('common.name')}</label><input name="name" value="${esc(m.name)}" autofocus placeholder="${t('macro.namePh')}"/>
        <label class="full">${t('macro.body')}</label>
        <textarea class="full" name="body" rows="8" spellcheck="false" placeholder="show version&#10;show interface brief">${esc(m.body)}</textarea>
        <label>${t('macro.delay')}</label><div class="inline"><input name="delay" type="number" min="0" step="100" value="${m.delayMs}"/><span class="hint">ms</span></div>
    </div>`, {
        okText: t('common.save'),
        onOk: async (r) => {
            const out = {...m, name: r.querySelector('[name=name]').value.trim(), body: r.querySelector('[name=body]').value, delayMs: parseInt(r.querySelector('[name=delay]').value, 10) || 0};
            if (!out.name) { toast(t('macro.needName'), 'err'); return false; }
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
        {label: t('common.run'), icon: 'play', fn: () => runMacro(m)},
        {label: t('common.edit'), icon: 'gear', fn: () => editMacro(m)},
        '-',
        {label: t('common.delete'), icon: 'close', danger: true, fn: async () => {
            if (await modal(t('macro.deleteTitle'), `<p>${esc(t('macro.deleteBody', {name: m.name}))}</p>`, {okText: t('common.delete'), danger: true})) {
                await App.DeleteMacro(m.id);
                loadMacros();
            }
        }},
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

async function settingsDialog(before = null) {
    if ($('.modal-bg')) return;
    before = before ?? JSON.stringify(prefs); // kept across a language re-render so Cancel still reverts
    const [closeToTray, autostart] = await Promise.all([App.GetCloseToTray(), App.GetAutostart()]).catch(() => [true, false]);
    if ($('.modal-bg')) return;
    const seg = (key, opts) => `<div class="seg" data-pref="${key}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${String(prefs[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const chk = (key, label) => `<span></span><label class="chk"><input type="checkbox" data-pref="${key}" ${prefs[key] ? 'checked' : ''}/> ${label}</label>`;
    const body = `<div class="f">
        <h4>${t('set.secView')}</h4>
        <label>${t('set.lang')}</label><select data-pref="lang"><option value="auto" ${prefs.lang === 'auto' ? 'selected' : ''}>${t('set.langAuto')}</option>${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${prefs.lang === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <label>${t('set.uiScale')}</label><div class="inline"><input type="range" min="90" max="150" step="10" data-pref="uiScale" value="${prefs.uiScale}"/><output class="mono">${prefs.uiScale}%</output></div>
        <label>${t('set.theme')}</label>${seg('appTheme', [['system', t('set.system')], ['dark', t('set.dark')], ['light', t('set.light')]])}
        <h4>${t('set.secTerm')}</h4>
        <label>${t('set.scheme')}</label><select data-pref="termScheme"><option value="auto">${t('set.schemeAuto')}</option>${Object.keys(SCHEMES).map((k) => `<option ${prefs.termScheme === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>
        <div class="full" id="scheme-preview">${schemePreview(prefs.termScheme)}</div>
        <label>${t('set.font')}</label><select data-pref="fontFamily">${[...new Set([prefs.fontFamily, ...FONTS])].map((f) => `<option ${prefs.fontFamily === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select>
        <label>${t('set.fontSize')}</label><div class="inline"><input type="range" min="9" max="28" step="1" data-pref="fontSize" value="${prefs.fontSize}"/><output class="mono">${prefs.fontSize}px</output></div>
        <label>${t('set.lineHeight')}</label><div class="inline"><input type="range" min="1" max="1.6" step="0.05" data-pref="lineHeight" value="${prefs.lineHeight}"/><output class="mono">${prefs.lineHeight}</output></div>
        <label>${t('set.cursor')}</label><div class="inline">${seg('cursorStyle', [['block', t('set.block')], ['bar', t('set.bar')], ['underline', t('set.underline')]])}<label class="chk"><input type="checkbox" data-pref="cursorBlink" ${prefs.cursorBlink ? 'checked' : ''}/> ${t('set.blink')}</label></div>
        <label>${t('set.scrollback')}</label><div class="inline"><input type="number" min="1000" max="200000" step="1000" data-pref="scrollback" value="${prefs.scrollback}"/><span class="hint">${t('set.lines')}</span></div>
        <h4>${t('set.secBehavior')}</h4>
        ${chk('copyOnSelect', t('set.copyOnSelect'))}
        ${chk('rightClickPaste', t('set.rightClickPaste'))}
        ${chk('confirmMultiline', t('set.confirmMultiline'))}
        ${chk('confirmClose', t('set.confirmClose'))}
        <h4>${t('set.secWindow')}</h4>
        <span></span><label class="chk"><input type="checkbox" name="closeToTray" ${closeToTray ? 'checked' : ''}/> ${t('set.closeToTray')}</label>
        <span></span><label class="chk"><input type="checkbox" name="autostart" ${autostart ? 'checked' : ''}/> ${t('set.autostart')}</label>
    </div>`;
    const ok = await modal(t('set.title'), body, {
        okText: t('common.save'),
        wide: true,
        onMount: (r) => {
            const update = (key, raw) => {
                const cur = DEFAULT_PREFS[key];
                prefs[key] = typeof cur === 'number' ? Number(raw) : typeof cur === 'boolean' ? !!raw : raw;
                if (key === 'lang') {
                    // Re-open the dialog so its own labels switch language too.
                    applyLanguage();
                    r.closest('.modal-bg').remove();
                    settingsDialog(before);
                    return;
                }
                if (key === 'uiScale') applyLayout();
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
                    if (out) out.textContent = el.dataset.pref === 'fontSize' ? el.value + 'px' : el.dataset.pref === 'uiScale' ? el.value + '%' : el.value;
                });
            });
        },
        onCancel: () => { prefs = JSON.parse(before); applyLanguage(); applyLayout(); applyTheme(); },
        onOk: async (r) => {
            const tray = r.querySelector('[name=closeToTray]').checked;
            const auto = r.querySelector('[name=autostart]').checked;
            try {
                if (tray !== closeToTray) await App.SetCloseToTray(tray);
                if (auto !== autostart) await App.SetAutostart(auto);
            } catch (e) { toast(String(e), 'err'); return false; }
            return true;
        },
    });
    if (ok) { savePrefs(); toast(t('set.saved'), 'ok'); }
}
$('#btn-settings').onclick = () => settingsDialog();

// ---------------------------------------------------------------- MCP bridge

EventsOn('mcp:open', async ({connId, sessionId}) => {
    let s = state.sessions.find((x) => x.id === sessionId);
    if (!s) { await loadSessions(); s = state.sessions.find((x) => x.id === sessionId); }
    if (!s) return App.ReportOpenResult(connId, t('mcp.noSession'));
    toast(t('mcp.opening', {name: s.name}));
    openSession(s, false, connId, true);
});
EventsOn('mcp:focus', (id) => {
    const t = state.tabs.find((x) => x.id === id);
    if (t && state.active !== t) activate(t);
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
    $('#btn-mcp').title = info.running ? t('mcp.running', {url: info.url}) : t('mcp.off');
    renderStatus();
}

const mcpStatus = (info) => (info.running ? `<b style="color:var(--ok)">${t('mcp.statusOn')}</b> <span class="mono">${esc(info.url)}</span>` : t('mcp.statusOff'));

async function mcpDialog() {
    let info = await App.GetMCPInfo();
    await modal(t('mcp.title'), `<div class="f">
        <span></span><label class="chk"><input type="checkbox" name="on" ${info.enabled ? 'checked' : ''}/> ${t('mcp.enable')}</label>
        <label>${t('common.port')}</label><input name="port" type="number" value="${info.port}"/>
        <label>${t('mcp.status')}</label><span data-el="status">${mcpStatus(info)}</span>
        <h4>Claude Code</h4>
        <span></span><div class="inline claude-btns"><button type="button" class="primary" data-x="claude">${icon('bot')}${t('mcp.connectClaude')}</button><button type="button" data-x="prompt">${t('mcp.copyPrompt')}</button></div>
        <p class="full hint">${t('mcp.claudeHint')}</p>
        <h4>${t('mcp.manual')}</h4>
        ${info.command ? `<label class="full">${t('mcp.cmdLabel')}</label>
        <textarea class="full" name="cmd" rows="3" readonly>${esc(info.command)}</textarea>
        <span></span><div class="inline"><button type="button" data-x="copy">${t('mcp.copyCmd')}</button><button type="button" data-x="regen">${t('mcp.regen')}</button></div>` : ''}
        <p class="full hint">${t('mcp.hint')}</p>
    </div>`, {
        okText: t('mcp.apply'),
        onMount: (r) => {
            r.querySelector('[data-x=copy]')?.addEventListener('click', () => { ClipboardSetText(info.command); toast(t('mcp.copied'), 'ok'); });
            // Both Claude options need the server on (and a token), so they switch it on first.
            const ensureOn = async () => {
                if (info.running) return;
                info = await App.SetMCPEnabled(true, parseInt(r.querySelector('[name=port]').value, 10) || 0);
                r.querySelector('[name=on]').checked = true;
                r.querySelector('[data-el=status]').innerHTML = mcpStatus(info);
                refreshMcpButton();
            };
            r.querySelector('[data-x=claude]').addEventListener('click', async (e) => {
                const b = e.currentTarget;
                b.disabled = true;
                try {
                    await ensureOn();
                    const res = await App.ConnectClaudeCode();
                    const kept = res.skillKept ? ' ' + t('mcp.skillKept') : '';
                    if (res.registered) toast(t('mcp.claudeDone') + kept, 'ok');
                    else toast(t('mcp.noCli') + kept, 'err');
                } catch (err) { toast(String(err), 'err'); }
                b.disabled = false;
            });
            r.querySelector('[data-x=prompt]').addEventListener('click', async () => {
                try {
                    await ensureOn();
                    ClipboardSetText(await App.GetClaudeSetupPrompt());
                    toast(t('mcp.promptCopied'), 'ok');
                } catch (err) { toast(String(err), 'err'); }
            });
            r.querySelector('[data-x=regen]')?.addEventListener('click', async () => {
                info = await App.RegenerateMCPToken();
                r.querySelector('[name=cmd]').value = info.command;
                toast(t('mcp.regenDone'));
            });
        },
        onOk: async (r) => {
            try {
                info = await App.SetMCPEnabled(r.querySelector('[name=on]').checked, parseInt(r.querySelector('[name=port]').value, 10) || 0);
                toast(info.running ? t('mcp.startedAt', {url: info.url}) : t('mcp.stopped'), 'ok');
            } catch (e) { toast(String(e), 'err'); return false; }
            return true;
        },
    });
    refreshMcpButton();
}
$('#btn-mcp').onclick = mcpDialog;

// ---------------------------------------------------------------- close to tray

EventsOn('app:closeAsk', async () => {
    if ($('.modal-bg')) { App.ShowWindow(); return; }
    const hide = await modal(t('tray.title'), `<p>${t('tray.body')}</p>
        <p class="hint">${t('tray.change')}</p>
        <div class="inline"><button type="button" data-x="quit">${t('tray.quitNow')}</button></div>`, {
        okText: t('tray.hide'),
        onMount: (r) => { r.querySelector('[data-x=quit]').onclick = () => App.QuitApp(); },
    });
    if (hide) App.HideWindow(true);
});

// ---------------------------------------------------------------- boot

(async () => {
    hydrateIcons();
    await loadPrefs();
    applyLanguage();
    applyLayout();
    applyTheme();
    await Promise.all([loadSessions(), loadMacros(), refreshMcpButton()]);
    renderTabs();
    document.body.classList.remove('booting');
    setInterval(renderRecents, 60000); // keep "n min ago" fresh
})();
