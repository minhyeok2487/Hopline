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
import {Highlighter, DEFAULT_HL_RULES, HL_COLORS, compileRules, checkPattern} from './highlight';
import {renderMD, RISKY_CMD} from './md';

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
    folders: [],
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
    highlight: true,           // keyword highlighting
    hlRules: null,             // null = DEFAULT_HL_RULES
    sideWidth: 270,
    sideCollapsed: false,
    recents: [],               // [{id} | {adhoc:{host,user,port}}, t]
    collapsed: [],             // folder paths the user collapsed
    cmdBar: true,              // command bar under the tabs
    aiChip: true,              // "Ask AI" button on terminal selections
    aiOpen: false,             // AI panel shown
    aiWidth: 360,
    macroVars: {},             // last values typed for {{variables}}
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
    refreshHighlight(); // colours follow the scheme
    renderStatus();
}

let hlCompiled = [];
const hlRules = () => prefs.hlRules || DEFAULT_HL_RULES;
function refreshHighlight() {
    hlCompiled = prefs.highlight ? compileRules(hlRules()) : [];
    for (const tab of state.tabs) tab.hl.reset();
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

const targetOf = (s) => {
    if (s.kind === 'serial') return `${s.comPort || '?'} · ${s.baud || 9600}`;
    if (s.kind === 'telnet') return `telnet ${s.user ? s.user + '@' : ''}${s.host}${s.port && s.port !== 23 ? ':' + s.port : ''}`;
    return `${s.user ? s.user + '@' : ''}${s.host}${s.port && s.port !== 22 ? ':' + s.port : ''}`;
};

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
function modal(title, bodyHtml, {okText = t('common.ok'), cancelText = t('common.cancel'), onOk, onMount, onCancel, wide = false, danger = false, focusCancel = false, noCancel = false} = {}) {
    return new Promise((resolve) => {
        const bg = document.createElement('div');
        bg.className = 'modal-bg';
        const size = wide === 'xl' ? ' wide xl' : wide ? ' wide' : '';
        bg.innerHTML = `<div class="modal${size}" role="dialog" aria-label="${esc(title)}"><h3>${esc(title)}</h3>${bodyHtml}
            <div class="btns">${noCancel ? '' : `<button data-x="cancel">${esc(cancelText)}</button>`}<button class="primary${danger ? ' danger-btn' : ''}" data-x="ok">${esc(okText)}</button></div></div>`;
        if (danger) bg.querySelector('[data-x=ok]').style.cssText = 'background:var(--bad);border-color:var(--bad)';
        $('#modal-root').appendChild(bg);
        const root = bg.firstElementChild;
        const close = (v) => { bg.remove(); resolve(v); focusActive(); };
        const cancel = () => { onCancel?.(); close(null); };
        const ok = async () => {
            const v = onOk ? await onOk(root) : true;
            if (v !== false) close(v);
        };
        if (!noCancel) root.querySelector('[data-x=cancel]').onclick = cancel;
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
        const first = (focusCancel && root.querySelector('[data-x=cancel]'))
            || root.querySelector('[autofocus]') || root.querySelector('input,select,textarea') || root.querySelector('[data-x=ok]');
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
    const [sessions, folders] = await Promise.all([App.ListSessions(), App.ListFolders()]);
    state.sessions = sessions || [];
    state.folders = folders || [];
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

const folderName = (p) => p.slice(p.lastIndexOf('/') + 1);
const folderParent = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const joinFolder = (a, b) => [a, b].filter(Boolean).join('/');
const inFolder = (p, dir) => p === dir || p.startsWith(dir + '/');
const sessionsIn = (dir) => state.sessions.filter((s) => inFolder(s.folder || '', dir));

function saveCollapsed() {
    prefs.collapsed = [...state.collapsed];
    savePrefs();
}

// Folders are paths ("HQ/Rack 1"); the tree shows subfolders first, then sessions.
function renderSessions() {
    const q = $('#sess-filter').value.trim().toLowerCase();
    const tree = $('#sess-tree');
    const list = state.sessions.filter((s) => !q || [s.name, s.host, s.user, s.folder, s.comPort].join(' ').toLowerCase().includes(q));
    if (!state.sessions.length && !state.folders.length) {
        tree.innerHTML = `<div class="empty">${icon('terminal')}<span>${t('sess.none')}</span><button id="empty-add" class="primary">${icon('plus')}${t('sess.create')}</button>
            <button id="empty-import">${icon('import')}${t('imp.title')}</button></div>`;
        $('#empty-add').addEventListener('click', () => editSession(null));
        $('#empty-import').addEventListener('click', () => importDialog());
        return;
    }
    if (q && !list.length) {
        tree.innerHTML = `<div class="empty">${icon('search')}<span>${esc(t('sess.noMatch', {q}))}</span></div>`;
        return;
    }
    const root = {folders: new Map(), items: []};
    const node = (path) => {
        let n = root;
        let acc = '';
        for (const seg of (path || '').split('/').filter(Boolean)) {
            acc = joinFolder(acc, seg);
            if (!n.folders.has(seg)) n.folders.set(seg, {path: acc, name: seg, folders: new Map(), items: []});
            n = n.folders.get(seg);
        }
        return n;
    };
    if (!q) state.folders.forEach(node); // empty folders too, except while searching
    list.forEach((s) => node(s.folder).items.push(s));
    const count = (n) => n.items.length + [...n.folders.values()].reduce((a, c) => a + count(c), 0);
    const byName = (a, b) => a.name.localeCompare(b.name);
    let html = '';
    const walk = (n, depth) => {
        for (const f of [...n.folders.values()].sort(byName)) {
            const open = q || !state.collapsed.has(f.path);
            html += `<div class="folder" data-folder="${esc(f.path)}" draggable="true" style="--d:${depth}" title="${esc(f.path)}">
                ${icon(open ? 'chevDown' : 'chevRight')}<span class="fic">${icon(open ? 'folderOpen' : 'folder')}</span><span class="nm">${esc(f.name)}</span><span class="count">${count(f)}</span></div>`;
            if (open) walk(f, depth + 1);
        }
        for (const s of n.items.sort(byName)) {
            const live = liveCount(s.id);
            html += `<div class="item${state.selSession === s.id ? ' sel' : ''}${live ? ' live' : ''}" data-id="${s.id}" draggable="true" style="--d:${depth}" title="${esc(targetOf(s))}">
                <span class="ic">${icon(s.kind === 'serial' ? 'serial' : 'terminal')}</span><span class="nm">${highlight(s.name, q)}</span>
                ${live ? `<span class="live-n" title="${t('sess.liveTabs', {n: live})}">●${live > 1 ? live : ''}</span>` : `<span class="sub">${esc(targetOf(s))}</span>`}</div>`;
        }
    };
    walk(root, 0);
    tree.innerHTML = html;
}

$('#sess-filter').addEventListener('input', renderSessions);
$('#sess-filter').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); $('#sess-tree').focus(); moveSel(1); }
    if (e.key === 'Enter') { const first = $('#sess-tree .item'); if (first) openSession(state.sessions.find((s) => s.id === first.dataset.id)); }
});
$('#sess-add').onclick = () => editSession(null);
$('#folder-add').onclick = () => newFolder('');
$('#sess-import').onclick = () => importDialog();

// Import sessions from other terminals found on this PC, or from a file.
async function importDialog() {
    const sources = await App.ScanImports() || [];
    const report = (name, r) => {
        toast(t('imp.done', {name, n: r.added}) + (r.skipped ? ' ' + t('imp.skipped', {n: r.skipped}) : ''), 'ok');
        loadSessions();
    };
    const rows = sources.map((s) => `<div class="imp-row"><b>${esc(s.name)}</b><span class="hint">${esc(t('imp.count', {n: s.count}))}</span>
        <span class="imp-path mono" title="${esc(s.path)}">${esc(s.path)}</span><button type="button" class="primary" data-id="${esc(s.id)}">${t('imp.go')}</button></div>`).join('');
    await modal(t('imp.title'), `<p class="hint">${t('imp.hint')}</p>
        <div class="imp-list">${rows || `<p class="hint">${t('imp.none')}</p>`}</div>
        <div class="inline imp-file"><button type="button" data-x="file">${icon('folder')}${t('imp.file')}</button></div>`, {
        okText: t('common.close'),
        wide: true,
        onMount: (r) => {
            r.querySelector('[data-x=cancel]').classList.add('hidden');
            r.querySelectorAll('.imp-row button').forEach((b) => {
                b.onclick = async () => {
                    b.disabled = true;
                    try {
                        report(sources.find((s) => s.id === b.dataset.id).name, await App.ImportFrom(b.dataset.id));
                        b.textContent = t('imp.doneShort');
                    } catch (e) { toast(String(e), 'err'); b.disabled = false; }
                };
            });
            r.querySelector('[data-x=file]').onclick = async () => {
                try {
                    const res = await App.ImportFile();
                    if (res && (res.added || res.skipped)) report(t('imp.fromFile'), res);
                } catch (e) { toast(String(e), 'err'); }
            };
        },
    });
}

function toggleFolder(path, open) {
    if (open ?? state.collapsed.has(path)) state.collapsed.delete(path);
    else state.collapsed.add(path);
    saveCollapsed();
    renderSessions();
}

$('#sess-tree').addEventListener('click', (e) => {
    const f = e.target.closest('.folder');
    if (f) return toggleFolder(f.dataset.folder);
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

// ---- folder actions

const folderOk = (fn) => fn().then(loadSessions).catch((e) => toast(String(e), 'err'));

async function newFolder(parent) {
    const name = await modal(parent ? t('sess.newSub') : t('sess.newFolder'), `<div class="f">
        <label>${t('sess.folderName')}</label><input name="n" autofocus/>
        <span></span><span class="hint">${esc(parent ? t('sess.createIn', {p: parent}) : t('sess.folderPathHint'))}</span></div>`, {
        okText: t('common.create'),
        onOk: (r) => r.querySelector('[name=n]').value.trim() || false,
    });
    if (!name) return;
    if (parent) toggleFolder(parent, true);
    folderOk(() => App.CreateFolder(joinFolder(parent, name)));
}

async function renameFolder(path) {
    const name = await modal(t('sess.renameFolder'), `<div class="f"><label>${t('sess.folderName')}</label><input name="n" value="${esc(folderName(path))}" autofocus/></div>`, {
        onOk: (r) => r.querySelector('[name=n]').value.trim().replace(/\//g, ' ') || false,
    });
    if (!name || name === folderName(path)) return;
    const to = joinFolder(folderParent(path), name);
    if (state.collapsed.delete(path)) { state.collapsed.add(to); saveCollapsed(); }
    folderOk(() => App.RenameFolder(path, to));
}

async function deleteFolder(path) {
    const n = sessionsIn(path).length;
    const ok = await modal(t('sess.deleteFolder'), `<p>${esc(t('sess.deleteFolderBody', {name: folderName(path), n}))}</p>`, {okText: t('common.delete'), danger: true});
    if (ok) folderOk(() => App.DeleteFolder(path));
}

async function connectFolder(path) {
    const list = sessionsIn(path);
    if (!list.length) return toast(t('sess.folderEmpty'), 'err');
    if (list.length > 3 && !await modal(t('sess.connectAll', {n: list.length}), `<p>${esc(t('sess.connectAllBody', {name: folderName(path), n: list.length}))}</p>`, {okText: t('common.connect')})) return;
    list.forEach((s) => openSession(s));
}

async function moveSessionDialog(s) {
    const opts = ['', ...state.folders].map((f) => `<option value="${esc(f)}" ${f === (s.folder || '') ? 'selected' : ''}>${esc(f || t('sess.rootFolder'))}</option>`).join('');
    const to = await modal(t('sess.moveTitle'), `<div class="f"><label>${t('f.folder')}</label><select name="f">${opts}</select></div>`, {
        onOk: (r) => ({f: r.querySelector('[name=f]').value}),
    });
    if (to && to.f !== (s.folder || '')) folderOk(() => App.MoveSession(s.id, to.f));
}

$('#sess-tree').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const f = e.target.closest('.folder');
    if (f) {
        const p = f.dataset.folder;
        const n = sessionsIn(p).length;
        return ctxMenu(e.clientX, e.clientY, [
            {label: t('sess.newHere'), icon: 'plus', fn: () => { toggleFolder(p, true); editSession({folder: p}); }},
            {label: t('sess.newSub'), icon: 'folderPlus', fn: () => newFolder(p)},
            {label: t('sess.renameFolder'), fn: () => renameFolder(p)},
            '-',
            {label: t('sess.connectAll', {n}), icon: 'play', fn: () => connectFolder(p)},
            {label: state.collapsed.size ? t('sess.expandAll') : t('sess.collapseAll'), fn: () => {
                state.collapsed = state.collapsed.size ? new Set() : new Set(state.folders);
                saveCollapsed();
                renderSessions();
            }},
            '-',
            {label: t('sess.deleteFolder'), icon: 'close', danger: true, fn: () => deleteFolder(p)},
        ]);
    }
    const it = e.target.closest('.item');
    if (!it) {
        return ctxMenu(e.clientX, e.clientY, [
            {label: t('sess.new'), icon: 'plus', fn: () => editSession(null)},
            {label: t('sess.newFolder'), icon: 'folderPlus', fn: () => newFolder('')},
            {label: t('imp.title') + '…', icon: 'import', fn: () => importDialog()},
        ]);
    }
    const s = state.sessions.find((x) => x.id === it.dataset.id);
    selectSession(s.id);
    ctxMenu(e.clientX, e.clientY, [
        {label: t('common.connect'), icon: 'play', fn: () => openSession(s)},
        {label: t('common.edit'), icon: 'gear', fn: () => editSession(s)},
        {label: t('common.duplicate'), icon: 'plus', fn: () => editSession({...s, id: '', name: s.name + ' ' + t('sess.copySuffix'), hasPassword: false,
            logonSteps: (s.logonSteps || []).map((st) => ({...st, id: '', hasSecret: false}))})},
        {label: t('sess.moveTo'), icon: 'folder', fn: () => moveSessionDialog(s)},
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

// ---- drag sessions and folders onto folders (or empty space for the top level)

let treeDrag = null; // {id} for a session, {path} for a folder
const dropFolder = (e) => {
    const f = e.target.closest('.folder');
    if (f) return f.dataset.folder;
    const it = e.target.closest('.item');
    if (it) return state.sessions.find((s) => s.id === it.dataset.id)?.folder || '';
    return '';
};
const clearDropMarks = () => {
    $$('#sess-tree .drop-into').forEach((el) => el.classList.remove('drop-into'));
    $('#sess-tree').classList.remove('drop-root');
};
$('#sess-tree').addEventListener('dragstart', (e) => {
    const it = e.target.closest('.item');
    const f = e.target.closest('.folder');
    if (it) treeDrag = {id: it.dataset.id};
    else if (f) treeDrag = {path: f.dataset.folder};
    else return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', it ? it.dataset.id : f.dataset.folder);
});
$('#sess-tree').addEventListener('dragover', (e) => {
    if (!treeDrag) return;
    const to = dropFolder(e);
    const bad = treeDrag.path != null && inFolder(to, treeDrag.path);
    clearDropMarks();
    if (bad) return;
    e.preventDefault();
    if (!to) $('#sess-tree').classList.add('drop-root');
    else $(`#sess-tree .folder[data-folder="${CSS.escape(to)}"]`)?.classList.add('drop-into');
});
$('#sess-tree').addEventListener('dragleave', (e) => { if (!e.currentTarget.contains(e.relatedTarget)) clearDropMarks(); });
$('#sess-tree').addEventListener('drop', (e) => {
    if (!treeDrag) return;
    e.preventDefault();
    const drag = treeDrag;
    const to = dropFolder(e);
    treeDrag = null;
    clearDropMarks();
    if (drag.id) {
        const s = state.sessions.find((x) => x.id === drag.id);
        if (!s || (s.folder || '') === to) return;
        if (to) state.collapsed.delete(to);
        folderOk(() => App.MoveSession(drag.id, to));
    } else {
        if (inFolder(to, drag.path)) return toast(t('sess.folderIntoSelf'), 'err');
        const dest = joinFolder(to, folderName(drag.path));
        if (dest === drag.path) return;
        if (to) state.collapsed.delete(to);
        folderOk(() => App.RenameFolder(drag.path, dest));
    }
});
$('#sess-tree').addEventListener('dragend', () => { treeDrag = null; clearDropMarks(); });

const BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

async function editSession(s) {
    const isNew = !s || !s.id;
    s = {kind: 'ssh', port: 22, baud: 9600, dataBits: 8, parity: 'N', stopBits: '1', ...s};
    const folders = state.folders;
    const body = `<div class="f">
        <label>${t('f.kind')}</label><div class="seg" data-seg="kind"><button type="button" data-v="ssh">SSH</button><button type="button" data-v="telnet">Telnet</button><button type="button" data-v="serial">${t('f.serial')}</button></div>
        <label>${t('common.name')}</label><input name="name" value="${esc(s.name)}" placeholder="${t('f.namePh')}"/>
        <label>${t('f.folder')}</label><input name="folder" value="${esc(s.folder)}" list="folders" placeholder="${t('f.folderPh')}"/>
        <datalist id="folders">${folders.map((f) => `<option value="${esc(f)}">`).join('')}</datalist>

        <h4 class="ssh tel">${t('f.secConn')}</h4>
        <label class="ssh tel">${t('f.host')}</label><input class="ssh tel" name="host" value="${esc(s.host)}" autofocus placeholder="${t('f.hostPh')}"/>
        <label class="ssh tel">${t('common.port')}</label><input class="ssh tel" name="port" type="number" value="${s.port || 22}"/>
        <label class="ssh tel">${t('f.user')}</label><input class="ssh tel" name="user" value="${esc(s.user)}"/>
        <h4 class="ssh tel">${t('f.secAuth')}</h4>
        <label class="ssh tel">${t('pw.label')}</label><input class="ssh tel" name="pw" type="password" placeholder="${s.hasPassword ? t('f.pwSaved') : t('f.pwAsk')}"/>
        <span class="ssh tel"></span><label class="ssh tel chk"><input type="checkbox" name="save" ${s.hasPassword || isNew ? 'checked' : ''}/> ${t('pw.save')}</label>
        <label class="ssh">${t('f.key')}</label><div class="ssh inline"><input name="keyPath" value="${esc(s.keyPath)}" placeholder="${t('f.optional')}"/><button type="button" data-x="key">${t('common.browse')}</button></div>
        <span class="ssh"></span><label class="ssh chk"><input type="checkbox" name="legacy" ${s.legacy ? 'checked' : ''}/> ${t('f.legacy')}</label>
        <p class="full hint tel">${t('f.telHint')}</p>

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

        <h4>${t('log.sec')}</h4>
        <label>${t('log.record')}</label><select name="log"><option value="">${t('log.follow')}</option><option value="on">${t('log.always')}</option><option value="off">${t('log.never')}</option></select>
    </div>`;

    let kind = s.kind;
    const saved = await modal(isNew ? t('sess.new') : t('sess.edit'), body, {
        okText: t('common.save'),
        wide: true,
        onMount: (r) => {
            mountLogonEditor(r, s.logonSteps || []);
            r.querySelector('[name=parity]').value = s.parity || 'N';
            r.querySelector('[name=stopBits]').value = s.stopBits || '1';
            r.querySelector('[name=log]').value = s.log || '';
            const cls = {ssh: 'ssh', telnet: 'tel', serial: 'ser'};
            const sync = () => {
                r.querySelectorAll('[data-seg=kind] button').forEach((b) => b.classList.toggle('on', b.dataset.v === kind));
                r.querySelectorAll('.ssh, .tel, .ser').forEach((el) => el.classList.toggle('hidden', !el.classList.contains(cls[kind])));
                const tel = kind === 'telnet';
                r.querySelector('[name=user]').placeholder = tel ? t('f.telUserPh') : '';
                if (!s.hasPassword) r.querySelector('[name=pw]').placeholder = tel ? t('f.telPwPh') : t('f.pwAsk');
            };
            r.querySelectorAll('[data-seg=kind] button').forEach((b) => {
                b.onclick = () => {
                    const port = r.querySelector('[name=port]');
                    if (b.dataset.v === 'telnet' && port.value === '22') port.value = '23';
                    if (b.dataset.v === 'ssh' && port.value === '23') port.value = '22';
                    kind = b.dataset.v;
                    sync();
                };
            });
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
                parity: v('parity'), stopBits: v('stopBits'), log: v('log'),
            };
            if (out.kind !== 'serial' && !out.host) { toast(t('sess.needHost'), 'err'); r.querySelector('[name=host]').focus(); return false; }
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
    const key = tab.adhoc ? {adhoc: {kind: tab.session.kind, host: tab.session.host, user: tab.session.user, port: tab.session.port}} : {id: tab.session.id};
    const same = (r) => (key.id ? r.id === key.id : r.adhoc && (r.adhoc.kind || 'ssh') === key.adhoc.kind
        && r.adhoc.host === key.adhoc.host && r.adhoc.user === key.adhoc.user && r.adhoc.port === key.adhoc.port);
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
        const kind = a.kind || 'ssh';
        const name = kind === 'telnet' ? `telnet ${a.host}` : `${a.user}@${a.host}`;
        return {s: {id: '', name, ...a, kind}, adhoc: true, t: r.t};
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
    const tm = e.target.value.trim().match(/^telnet(?::\/\/|\s+)(?:([^@\s]+)@)?([^:\s]+)(?::(\d+))?$/i);
    if (tm) {
        const [, tuser, thost, tport] = tm;
        e.target.value = '';
        return openSession({id: '', kind: 'telnet', name: `telnet ${thost}`, host: thost, user: tuser || '', port: parseInt(tport || '23', 10)}, true);
    }
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
    pane.addEventListener('mousedown', () => { if (state.active?.pane !== pane) { const tb = state.tabs.find((x) => x.pane === pane); if (tb) activate(tb); } }, true);

    const term = new Terminal({...termOptions(), allowProposedApi: true});
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon((_, uri) => BrowserOpenURL(uri)));
    term.open(pane.querySelector('.term'));

    const tab = {
        id, session: s, adhoc, title: s.name, kind: s.kind, term, fit, search, pane,
        status: 'connecting', logging: false, multi: true, mcpPending: viaMcp, bot: false, ai: {msgs: [], busy: null},
        hl: new Highlighter(term, () => hlCompiled, () => resolveScheme(prefs.termScheme, isDark())),
    };
    state.tabs.push(tab);

    pane.querySelector('[data-x=cancel]').onclick = () => App.CancelConnect(id);
    pane.querySelector('[data-x=reconnect]').onclick = () => connectTab(tab);
    pane.querySelector('[data-x=close]').onclick = () => closeTab(tab, true);

    EventsOn('data:' + id, (b64) => term.write(b64ToBytes(b64)));
    EventsOn('closed:' + id, (reason) => markClosed(tab, reason));
    EventsOn('logon:' + id, (ev) => {
        if (!ev.error) return;
        const msg = ev.step === 0 && ev.error === 'timeout'
            ? t('lg.err.login', {expect: ev.expect})
            : t('lg.err.' + ev.error, {step: ev.step, total: ev.total, expect: ev.expect});
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
        if (!sel.trim()) hideAIChip();
    });
    pane.querySelector('.term').addEventListener('mouseup', (e) => {
        if (e.button === 0) setTimeout(() => showAIChip(tab, e.clientX, e.clientY), 0);
    });
    term.onScroll(hideAIChip);
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
        tab.logging = !!(await App.LogPath(tab.id).catch(() => ''));
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
        const hk = msg.match(/HOSTKEY_CHANGED (\{.*\})/);
        if (hk) return hostKeyChanged(tab, JSON.parse(hk[1]), password);
        term.write(`\x1b[31m${t('conn.failed')}: ${msg.replace(/\n/g, '\r\n')}\x1b[0m\r\n`);
        reportMcp(tab, msg);
        markClosed(tab, t('conn.failed') + ' · ' + msg.split('\n')[0]);
    }
}

// The device presented a different SSH host key than the one saved on first
// connect. Show both fingerprints and let the user decide; Cancel is the default.
async function hostKeyChanged(tab, info, password) {
    tab.term.write(`\x1b[33m${t('hk.term', {host: info.host})}\x1b[0m\r\n`);
    App.ShowWindow(); // the window may be hidden in the tray
    const trust = await modal(t('hk.title'), `<p>${t('hk.body', {host: esc(info.host)})}</p>
        <div class="hk-fp"><span class="hint">${t('hk.old')}</span><code>${(info.old || []).map(esc).join('<br>') || '-'}</code>
        <span class="hint">${t('hk.new')}</span><code>${esc(info.new)} <span class="hint">(${esc(info.type)})</span></code></div>
        <p class="hint">${t('hk.hint')}</p>`, {
        okText: t('hk.trust'), cancelText: t('hk.dont'), danger: true, focusCancel: true,
    });
    if (!trust) return markClosed(tab, t('hk.refused'));
    try {
        await App.TrustHostKey(info.host);
        tab.term.write(`\x1b[33m${t('hk.saved', {fp: info.new})}\x1b[0m\r\n`);
    } catch (e) {
        toast(String(e), 'err');
        return markClosed(tab, String(e));
    }
    return connectTab(tab, password);
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
    if (tab.ai.busy) App.AICancel(tab.ai.busy);
    hideAIChip();
    tab.hl.dispose();
    tab.term.dispose();
    tab.pane.remove();
    const i = state.tabs.indexOf(tab);
    state.tabs.splice(i, 1);
    split.slots = split.slots.map((id) => (id === tab.id ? null : id));
    if (state.active === tab) {
        state.active = null;
        const next = state.tabs[Math.min(i, state.tabs.length - 1)];
        // In split view, focus another visible tab before pulling a hidden one in.
        const shown = state.tabs.find((x) => split.slots.includes(x.id));
        if (split.mode !== 'single' && shown) activate(shown);
        else if (next) activate(next);
        else { App.SetActiveTab('').catch(() => {}); layoutPanes(); }
    }
    renderTabs();
    renderSessions();
    if (state.sftp.connId === tab.id) { state.sftp.connId = null; renderSftp(); }
}

// ---- split view: up to four tabs visible at once; the active tab is the focused pane.

const SPLITS = {
    single: [[0, 0, 1, 1]],
    v2: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]],
    h2: [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]],
    q4: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
};
const split = {mode: 'single', slots: [null], focus: 0};

function setSplit(mode, extra = null) {
    const n = SPLITS[mode].length;
    // Keep the active tab and whatever was already shown, then fill with other open tabs.
    const keep = [state.active?.id, extra?.id, ...split.slots].filter((id, i, a) => id && a.indexOf(id) === i && state.tabs.some((t) => t.id === id));
    for (const t of state.tabs) if (keep.length < n && !keep.includes(t.id)) keep.push(t.id);
    split.mode = mode;
    split.slots = Array.from({length: n}, (_, i) => keep[i] ?? null);
    split.focus = Math.max(0, split.slots.indexOf(state.active?.id));
    if (extra) { split.focus = split.slots.indexOf(extra.id); }
    const focusTab = state.tabs.find((t) => t.id === split.slots[split.focus]);
    if (focusTab) activate(focusTab); else layoutPanes();
}

function layoutPanes() {
    const terms = $('#terms');
    const rects = SPLITS[split.mode];
    terms.classList.toggle('split', split.mode !== 'single');
    terms.querySelectorAll('.slot-empty').forEach((el) => el.remove());
    const place = (el, [x, y, w, h]) => {
        Object.assign(el.style, {left: `calc(${x * 100}% + ${x ? 1 : 0}px)`, top: `calc(${y * 100}% + ${y ? 1 : 0}px)`,
            width: `calc(${w * 100}% - ${w < 1 ? 1 : 0}px)`, height: `calc(${h * 100}% - ${h < 1 ? 1 : 0}px)`});
    };
    if (split.mode === 'single') {
        for (const t of state.tabs) {
            t.pane.classList.toggle('on', t === state.active);
            t.pane.classList.remove('focus');
            t.pane.removeAttribute('style');
        }
    } else {
        if (state.active && !split.slots.includes(state.active.id)) split.slots[split.focus] = state.active.id;
        if (state.active) split.focus = split.slots.indexOf(state.active.id);
        for (const t of state.tabs) {
            const i = split.slots.indexOf(t.id);
            t.pane.classList.toggle('on', i >= 0);
            t.pane.classList.toggle('focus', i >= 0 && i === split.focus);
            if (i >= 0) place(t.pane, rects[i]); else t.pane.removeAttribute('style');
        }
        split.slots.forEach((id, i) => {
            if (id && state.tabs.some((t) => t.id === id)) return;
            const el = document.createElement('div');
            el.className = 'slot-empty' + (i === split.focus ? ' focus' : '');
            el.textContent = t('split.pick');
            el.onclick = () => { split.focus = i; layoutPanes(); };
            place(el, rects[i]);
            terms.appendChild(el);
        });
    }
    $('#btn-split').classList.toggle('on', split.mode !== 'single');
    requestAnimationFrame(() => state.tabs.forEach((t) => t.pane.classList.contains('on') && t.fit.fit()));
}

$('#btn-split').onclick = (e) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const opt = (mode, label) => ({label: (split.mode === mode ? '✓ ' : '') + label, fn: () => setSplit(mode)});
    ctxMenu(r.left, r.bottom + 4, [opt('single', t('split.single')), opt('v2', t('split.v2')), opt('h2', t('split.h2')), opt('q4', t('split.q4'))]);
};

function activate(tab) {
    state.active = tab;
    App.SetActiveTab(tab.id).catch(() => {});
    if (split.mode !== 'single' && !split.slots.includes(tab.id)) split.slots[split.focus] = tab.id;
    layoutPanes();
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
    renderCmdBar();
    renderAI();
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
    renderAI();
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
        ...(state.active && state.active !== tab ? [{label: t('split.with'), icon: 'split', fn: () => setSplit(split.mode === 'single' ? 'v2' : split.mode, tab)}] : []),
        {label: t('common.find'), icon: 'search', fn: () => { activate(tab); openFind(tab); }},
        {label: t('common.clear'), fn: () => tab.term.clear()},
        '-',
        {label: t('ai.askTab'), icon: 'spark', fn: () => { activate(tab); toggleAI(true); }},
        {label: t('ai.summaryTab'), icon: 'spark', fn: () => summarizeTab(tab)},
        {label: t('log.viewTab'), icon: 'logs', fn: async () => logViewer({rel: await App.LogPath(tab.id).catch(() => ''), session: tab.title})},
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

new ResizeObserver(() => state.tabs.forEach((t) => t.pane.classList.contains('on') && t.fit.fit())).observe($('#terms'));

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
$('#btn-logdir').onclick = () => logViewer();

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
    if (runBarKey(e)) return true;
    if (e.ctrlKey && e.shiftKey && !e.altKey && e.code === 'KeyA') { e.preventDefault(); toggleAI(true); return true; }
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
    renderCmdBar();
}

function renderMacros() {
    $('#macro-list').innerHTML = state.macros.length ? state.macros.map((m) => `<div class="item" data-id="${m.id}" title="${esc(m.body)}">
        <span class="ic">${icon('bolt')}</span><span class="nm">${esc(m.name)}</span>${m.bar ? `<span class="pin" title="${t('bar.onBar')}">${icon('pin')}</span>` : ''}
        <span class="sub">${t('macro.lines', {n: m.body.split('\n').filter(Boolean).length})}</span><button class="run" title="${t('common.run')}">${icon('play')}${t('common.run')}</button></div>`).join('')
        : `<div class="empty">${icon('bolt')}<span>${t('macro.empty')}</span><button id="macro-empty-add" class="primary">${icon('plus')}${t('macro.new')}</button></div>`;
    $('#macro-empty-add')?.addEventListener('click', () => editMacro(null));
}

// {{name}} or {{name|default}} in a macro asks for a value before it runs.
const VAR_RE = /\{\{\s*([^}|]+?)\s*(?:\|([^}]*))?\}\}/g;

async function fillVars(m) {
    const vars = [];
    for (const [, name, def] of m.body.matchAll(VAR_RE)) if (!vars.some((v) => v.name === name)) vars.push({name, def: def ?? ''});
    if (!vars.length) return m.body;
    const saved = prefs.macroVars[m.id] || {};
    const vals = await modal(t('macro.varsTitle', {name: m.name}), `<div class="f">
        ${vars.map((v, i) => `<label>${esc(v.name)}</label><input data-var="${esc(v.name)}" value="${esc(saved[v.name] ?? v.def)}" ${i ? '' : 'autofocus'} spellcheck="false"/>`).join('')}
        <pre class="full var-preview"></pre></div>`, {
        okText: t('common.run'),
        onMount: (r) => {
            const preview = () => { r.querySelector('.var-preview').textContent = apply(read(r)); };
            r.querySelectorAll('[data-var]').forEach((el) => el.addEventListener('input', preview));
            preview();
        },
        onOk: (r) => read(r),
    });
    if (!vals) return null;
    prefs.macroVars = {...prefs.macroVars, [m.id]: vals};
    savePrefs();
    return apply(vals);
    function read(r) { return Object.fromEntries([...r.querySelectorAll('[data-var]')].map((el) => [el.dataset.var, el.value])); }
    function apply(v) { return m.body.replace(VAR_RE, (_, name) => v[name.trim()] ?? ''); }
}

async function runMacro(m, allTabs = false) {
    if (!m) return;
    const targets = allTabs ? state.tabs.filter((x) => x.status === 'open').map((x) => x.id)
        : state.multi ? multiTargets() : (state.active?.status === 'open' ? [state.active.id] : []);
    if (!targets.length) return toast(t('macro.noTarget'), 'err');
    const body = await fillVars(m);
    if (body == null) return focusActive();
    if (m.confirm || (allTabs && targets.length > 1)) {
        const names = state.tabs.filter((x) => targets.includes(x.id)).map((x) => esc(x.title)).join(', ');
        const ok = await modal(t('macro.confirmTitle', {name: m.name}), `<p>${t('macro.confirmBody', {n: targets.length, names})}</p><pre>${esc(body)}</pre>`, {okText: t('common.run')});
        if (!ok) return;
    }
    App.RunMacro(targets, body, m.delayMs || 0);
    toast(t('macro.ran', {name: m.name, n: targets.length}), 'ok');
    focusActive();
}

async function editMacro(m) {
    m = {name: '', body: '', delayMs: 300, bar: true, confirm: false, ...m};
    const saved = await modal(m.id ? t('macro.edit') : t('macro.new'), `<div class="f">
        <label>${t('common.name')}</label><input name="name" value="${esc(m.name)}" autofocus placeholder="${t('macro.namePh')}"/>
        <label class="full">${t('macro.body')}</label>
        <textarea class="full" name="body" rows="8" spellcheck="false" placeholder="show version&#10;show interface {{${t('macro.varEx')}|Gi0/1}}">${esc(m.body)}</textarea>
        <p class="full hint">${t('macro.varHint')}</p>
        <label>${t('macro.delay')}</label><div class="inline"><input name="delay" type="number" min="0" step="100" value="${m.delayMs}"/><span class="hint">ms</span></div>
        <span></span><label class="chk"><input type="checkbox" name="bar" ${m.bar ? 'checked' : ''}/> ${t('macro.bar')}</label>
        <span></span><label class="chk"><input type="checkbox" name="confirm" ${m.confirm ? 'checked' : ''}/> ${t('macro.confirm')}</label>
    </div>`, {
        okText: t('common.save'),
        onOk: async (r) => {
            const out = {...m, name: r.querySelector('[name=name]').value.trim(), body: r.querySelector('[name=body]').value, delayMs: parseInt(r.querySelector('[name=delay]').value, 10) || 0,
                bar: r.querySelector('[name=bar]').checked, confirm: r.querySelector('[name=confirm]').checked};
            if (!out.name) { toast(t('macro.needName'), 'err'); return false; }
            return App.SaveMacro(out);
        },
    });
    if (saved) loadMacros();
}

async function toggleBar(m) {
    await App.SaveMacro({...m, bar: !m.bar});
    loadMacros();
}

function macroMenu(e, m) {
    ctxMenu(e.clientX, e.clientY, [
        {label: t('common.run'), icon: 'play', fn: () => runMacro(m)},
        {label: t('bar.runAll'), icon: 'multi', fn: () => runMacro(m, true)},
        {label: m.bar ? t('bar.unpin') : t('bar.pin'), icon: 'pin', fn: () => toggleBar(m)},
        {label: t('common.edit'), icon: 'gear', fn: () => editMacro(m)},
        '-',
        {label: t('common.delete'), icon: 'close', danger: true, fn: async () => {
            if (await modal(t('macro.deleteTitle'), `<p>${esc(t('macro.deleteBody', {name: m.name}))}</p>`, {okText: t('common.delete'), danger: true})) {
                await App.DeleteMacro(m.id);
                loadMacros();
            }
        }},
    ]);
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
    if (it) macroMenu(e, state.macros.find((x) => x.id === it.dataset.id));
});

// ---- command bar: pinned macros as one-click buttons under the tabs (Alt+1..9).

const barMacros = () => state.macros.filter((m) => m.bar);

function renderCmdBar() {
    const bar = $('#cmdbar');
    const show = prefs.cmdBar && state.tabs.length > 0;
    bar.classList.toggle('hidden', !show);
    if (!show) return;
    const items = barMacros();
    bar.innerHTML = items.map((m, i) => `<button class="cmd" draggable="true" data-id="${m.id}" title="${esc(m.body)}${i < 9 ? `\n\nAlt+${i + 1} · ${t('bar.tipKeys')}` : ''}">`
        + `${i < 9 ? `<kbd>${i + 1}</kbd>` : ''}${m.confirm ? icon('alert') : ''}<span>${esc(m.name)}</span></button>`).join('')
        + `<button class="cmd add" data-x="add" title="${t('bar.add')}">${icon('plus')}${items.length ? '' : `<span>${t('bar.addFirst')}</span>`}</button>`;
}

$('#cmdbar').addEventListener('click', (e) => {
    if (e.target.closest('[data-x=add]')) return editMacro({bar: true});
    const b = e.target.closest('.cmd[data-id]');
    if (b) runMacro(state.macros.find((m) => m.id === b.dataset.id), e.shiftKey);
});
$('#cmdbar').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const b = e.target.closest('.cmd[data-id]');
    if (b) macroMenu(e, state.macros.find((m) => m.id === b.dataset.id));
    else ctxMenu(e.clientX, e.clientY, [{label: t('bar.add'), icon: 'plus', fn: () => editMacro({bar: true})}, {label: t('bar.hide'), fn: () => { prefs.cmdBar = false; savePrefs(); renderCmdBar(); toast(t('bar.hidden')); }}]);
});
let barDrag = null;
$('#cmdbar').addEventListener('dragstart', (e) => { barDrag = e.target.closest('.cmd[data-id]')?.dataset.id; e.dataTransfer.effectAllowed = 'move'; });
$('#cmdbar').addEventListener('dragover', (e) => {
    if (!barDrag) return;
    e.preventDefault();
    $$('#cmdbar .cmd').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    const el = e.target.closest('.cmd[data-id]');
    if (el && el.dataset.id !== barDrag) el.classList.add(dropAfter(e, el) ? 'drop-after' : 'drop-before');
});
$('#cmdbar').addEventListener('drop', async (e) => {
    e.preventDefault();
    const el = e.target.closest('.cmd[data-id]');
    const from = barDrag;
    barDrag = null;
    if (!el || !from || el.dataset.id === from) return renderCmdBar();
    const ids = state.macros.map((m) => m.id).filter((id) => id !== from);
    ids.splice(ids.indexOf(el.dataset.id) + (dropAfter(e, el) ? 1 : 0), 0, from);
    state.macros.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    renderMacros();
    renderCmdBar();
    await App.ReorderMacros(ids).catch((err) => toast(String(err), 'err'));
});
$('#cmdbar').addEventListener('dragend', () => { barDrag = null; renderCmdBar(); });

function runBarKey(e) {
    if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey || !/^Digit[1-9]$/.test(e.code) || !prefs.cmdBar) return false;
    const m = barMacros()[Number(e.code.slice(5)) - 1];
    if (!m) return false;
    e.preventDefault();
    runMacro(m);
    return true;
}

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
    const [closeToTray, autostart, updateCheck, version, logSet, ai] = await Promise.all([App.GetCloseToTray(), App.GetAutostart(), App.GetUpdateCheck(), App.GetVersion(), App.GetLogSettings(), App.AIStatus()])
        .catch(() => [true, false, true, '', {auto: false, stamps: true, dir: ''}, {cli: false, model: ''}]);
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
        <label>${t('set.highlight')}</label><div class="inline"><label class="chk"><input type="checkbox" data-pref="highlight" ${prefs.highlight ? 'checked' : ''}/> ${t('set.highlightOn')}</label><button type="button" data-x="hl-rules">${t('hl.edit')}</button></div>
        <label>${t('set.scrollback')}</label><div class="inline"><input type="number" min="1000" max="200000" step="1000" data-pref="scrollback" value="${prefs.scrollback}"/><span class="hint">${t('set.lines')}</span></div>
        <h4>${t('set.secBehavior')}</h4>
        ${chk('copyOnSelect', t('set.copyOnSelect'))}
        ${chk('rightClickPaste', t('set.rightClickPaste'))}
        ${chk('confirmMultiline', t('set.confirmMultiline'))}
        ${chk('confirmClose', t('set.confirmClose'))}
        ${chk('cmdBar', t('set.cmdBar'))}
        <h4>${t('log.sec')}</h4>
        <span></span><label class="chk"><input type="checkbox" name="logAuto" ${logSet.auto ? 'checked' : ''}/> ${t('log.auto')}</label>
        <span></span><label class="chk"><input type="checkbox" name="logStamps" ${logSet.stamps ? 'checked' : ''}/> ${t('log.stamps')}</label>
        <label>${t('log.dir')}</label><div class="inline"><input name="logDir" value="${esc(logSet.dir)}" spellcheck="false"/><button type="button" data-x="log-pick">${t('common.browse')}</button><button type="button" class="icon" data-x="log-open" title="${t('log.openDir')}">${icon('folderOpen')}</button></div>
        <p class="full hint">${t('log.dirHint')}</p>
        <h4>${t('ai.sec')}</h4>
        <label>Claude Code</label><span class="hint">${ai.cli ? `<b style="color:var(--ok)">${t('ai.cliFound')}</b> <span class="mono">${esc(ai.path)}</span>` : t('ai.cliMissing')}</span>
        <label>${t('ai.model')}</label><select name="aiModel">${[['', t('ai.modelDefault')], ['sonnet', 'Sonnet'], ['opus', 'Opus'], ['haiku', t('ai.modelFast')]].map(([v, l]) => `<option value="${v}" ${ai.model === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        ${chk('aiChip', t('set.aiChip'))}
        <h4>${t('set.secWindow')}</h4>
        <span></span><label class="chk"><input type="checkbox" name="closeToTray" ${closeToTray ? 'checked' : ''}/> ${t('set.closeToTray')}</label>
        <span></span><label class="chk"><input type="checkbox" name="autostart" ${autostart ? 'checked' : ''}/> ${t('set.autostart')}</label>
        <h4>${t('bk.sec')}</h4>
        <span></span><div class="inline bk-btns"><button type="button" data-x="bk-export">${icon('upload')}${t('bk.export')}</button><button type="button" data-x="bk-restore">${icon('import')}${t('bk.restore')}</button></div>
        <h4>${t('set.secUpdate')}</h4>
        <label>${t('set.version')}</label><div class="inline"><span class="mono">v${esc(version)}</span><button type="button" data-x="upd-check">${t('set.checkNow')}</button></div>
        <span></span><label class="chk"><input type="checkbox" name="updateCheck" ${updateCheck ? 'checked' : ''}/> ${t('set.updateCheck')}</label>
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
            r.querySelector('[data-x=hl-rules]').onclick = () => editHlRules();
            r.querySelector('[data-x=log-pick]').onclick = async () => {
                const d = await App.PickLogDir().catch(() => '');
                if (d) r.querySelector('[name=logDir]').value = d;
            };
            r.querySelector('[data-x=log-open]').onclick = () => App.RevealLog('');
            r.querySelector('[data-x=upd-check]').onclick = () => checkUpdateNow();
            r.querySelector('[data-x=bk-export]').onclick = () => exportBackup();
            r.querySelector('[data-x=bk-restore]').onclick = () => restoreBackup();
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
            const upd = r.querySelector('[name=updateCheck]').checked;
            const logNew = {auto: r.querySelector('[name=logAuto]').checked, stamps: r.querySelector('[name=logStamps]').checked, dir: r.querySelector('[name=logDir]').value.trim()};
            const model = r.querySelector('[name=aiModel]').value;
            try {
                if (logNew.auto !== logSet.auto || logNew.stamps !== logSet.stamps || logNew.dir !== logSet.dir) await App.SetLogSettings(logNew);
                if (model !== (ai.model || '')) await App.SetAIModel(model);
                if (tray !== closeToTray) await App.SetCloseToTray(tray);
                if (auto !== autostart) await App.SetAutostart(auto);
                if (upd !== updateCheck) await App.SetUpdateCheck(upd);
            } catch (e) { toast(String(e), 'err'); return false; }
            return true;
        },
    });
    if (ok) { savePrefs(); toast(t('set.saved'), 'ok'); }
    renderCmdBar();
}
$('#btn-settings').onclick = () => settingsDialog();

// Keyword highlighting rules: name, regex, colour, ignore case. Applied on OK; the
// settings dialog's Cancel still reverts them with everything else.
async function editHlRules() {
    const colorOpts = (c) => HL_COLORS.map((k) => `<option value="${k}" ${k === c ? 'selected' : ''}>${t('hl.c.' + k)}</option>`).join('');
    const row = (r) => `<div class="hl-row" data-key="${esc(r.key || '')}">
        <input type="checkbox" class="hl-on" ${r.on ? 'checked' : ''} title="${t('hl.on')}"/>
        <input class="hl-name" value="${esc(r.key ? t(r.key) : r.name)}" placeholder="${t('hl.namePh')}"/>
        <input class="hl-pat mono" value="${esc(r.pattern)}" placeholder="${t('hl.patternPh')}" spellcheck="false"/>
        <select class="hl-color" data-c="${r.color}">${colorOpts(r.color)}</select>
        <input type="checkbox" class="hl-ci" ${r.ci ? 'checked' : ''} title="${t('hl.ci')}"/>
        <button type="button" class="ghost icon" data-a="del" title="${t('common.delete')}">${icon('close')}</button></div>`;
    const head = `<span></span><span class="hd">${t('hl.name')}</span><span class="hd">${t('hl.pattern')}</span><span class="hd">${t('hl.color')}</span><span class="hd" title="${t('hl.ci')}">Aa</span><span></span>`;
    const read = (r) => [...r.querySelectorAll('.hl-row')].map((el, i) => {
        const key = el.dataset.key;
        const name = el.querySelector('.hl-name').value.trim();
        return {
            id: 'r' + i, on: el.querySelector('.hl-on').checked,
            key: key && name === t(key) ? key : '', name: key && name === t(key) ? '' : name,
            pattern: el.querySelector('.hl-pat').value.trim(), color: el.querySelector('.hl-color').value,
            ci: el.querySelector('.hl-ci').checked,
        };
    });
    const saved = await modal(t('hl.title'), `<p class="hint">${t('hl.hint')}</p><div class="hl-rules"></div>
        <div class="inline hl-btns"><button type="button" data-x="add">${icon('plus')}${t('hl.add')}</button><button type="button" data-x="reset">${t('hl.reset')}</button></div>`, {
        wide: true,
        onMount: (r) => {
            const box = r.querySelector('.hl-rules');
            const render = (rules) => {
                box.innerHTML = head + rules.map(row).join('');
                box.querySelectorAll('.hl-color').forEach((s) => { s.dataset.c = s.value; });
            };
            render(hlRules());
            box.addEventListener('change', (e) => { if (e.target.classList.contains('hl-color')) e.target.dataset.c = e.target.value; });
            box.addEventListener('click', (e) => {
                if (!e.target.closest('[data-a=del]')) return;
                const rules = read(r);
                rules.splice([...box.querySelectorAll('.hl-row')].indexOf(e.target.closest('.hl-row')), 1);
                render(rules);
            });
            r.querySelector('[data-x=add]').onclick = () => {
                render([...read(r), {on: true, name: '', pattern: '', color: 'magenta', ci: true}]);
                [...box.querySelectorAll('.hl-name')].pop().focus();
            };
            r.querySelector('[data-x=reset]').onclick = () => render(DEFAULT_HL_RULES);
        },
        onOk: (r) => {
            const rules = read(r).filter((x) => x.pattern);
            for (const x of rules) {
                const err = checkPattern(x.pattern);
                if (err) { toast(t('hl.bad', {p: x.pattern, e: err}), 'err'); return false; }
            }
            return rules;
        },
    });
    if (!saved) return;
    prefs.hlRules = JSON.stringify(saved) === JSON.stringify(DEFAULT_HL_RULES.map((x, i) => ({...x, id: 'r' + i}))) ? null : saved;
    refreshHighlight();
}

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

// ---------------------------------------------------------------- updates

let updateOpen = false;
async function updateDialog(info) {
    if (updateOpen) return;
    if ($('.modal-bg')) { // don't interrupt another dialog; ask once it closes
        const wait = setInterval(() => { if (!$('.modal-bg')) { clearInterval(wait); updateDialog(info); } }, 1000);
        return;
    }
    updateOpen = true;
    const live = state.tabs.filter((x) => x.status === 'open').length;
    let off;
    await modal(t('upd.title'), `<p>${t('upd.body', {latest: esc(info.latest), current: esc(info.current)})}</p>
        ${live ? `<p class="hint">${t('upd.tabs', {n: live})}</p>` : ''}
        <div class="inline upd-links"><button type="button" data-x="notes">${t('upd.notes')}</button><button type="button" data-x="skip">${t('upd.skip')}</button></div>
        <div class="upd-progress hidden"><div class="bar"><i></i></div><span class="hint" data-el="pct"></span></div>`, {
        okText: t('upd.now'),
        onMount: (r) => {
            r.querySelector('[data-x=notes]').onclick = () => BrowserOpenURL(info.page);
            r.querySelector('[data-x=skip]').onclick = async () => {
                await App.SkipUpdate(info.latest);
                r.querySelector('[data-x=cancel]').click();
                toast(t('upd.skipped', {v: info.latest}));
            };
            off = EventsOn('update:progress', ({done, total}) => {
                const pct = total ? Math.round((done / total) * 100) : 0;
                r.querySelector('.upd-progress i').style.width = pct + '%';
                r.querySelector('[data-el=pct]').textContent = `${fmtSize(done)}${total ? ' / ' + fmtSize(total) : ''} · ${pct}%`;
            });
        },
        onOk: async (r) => {
            r.querySelectorAll('button').forEach((b) => { b.disabled = true; });
            r.querySelector('.upd-progress').classList.remove('hidden');
            r.querySelector('[data-el=pct]').textContent = t('upd.downloading');
            try {
                await App.ApplyUpdate(); // Hopline restarts on success
                r.querySelector('[data-el=pct]').textContent = t('upd.restarting');
                return false;
            } catch (e) {
                const msg = String(e);
                r.querySelectorAll('button').forEach((b) => { b.disabled = false; });
                r.querySelector('.upd-progress').classList.add('hidden');
                if (msg.includes('SCOOP')) {
                    ClipboardSetText('scoop update hopline');
                    toast(t('upd.scoop'), 'info');
                    return true;
                }
                if (msg.includes('NOT_WRITABLE')) {
                    BrowserOpenURL(info.page);
                    toast(t('upd.manual'), 'err');
                    return true;
                }
                toast(t('upd.failed', {e: msg}), 'err');
                return false;
            }
        },
    });
    off?.();
    updateOpen = false;
}
EventsOn('update:available', (info) => updateDialog(info));

async function checkUpdateNow() {
    try {
        const info = await App.CheckUpdate();
        if (info.available) updateDialog(info);
        else toast(t('upd.latest', {v: info.current}), 'ok');
    } catch (e) { toast(t('upd.checkFailed', {e: String(e)}), 'err'); }
}

// ---------------------------------------------------------------- backup

async function exportBackup() {
    await modal(t('bk.export').replace('…', ''), `<div class="f">
        <span></span><label class="chk"><input type="checkbox" name="prefs" checked/> ${t('bk.withPrefs')}</label>
        <span></span><label class="chk"><input type="checkbox" name="secrets"/> ${t('bk.withSecrets')}</label>
        <label class="bk-pass hidden">${t('bk.pass')}</label><input class="bk-pass hidden" name="p1" type="password" autocomplete="new-password"/>
        <label class="bk-pass hidden">${t('bk.pass2')}</label><input class="bk-pass hidden" name="p2" type="password" autocomplete="new-password"/>
        <p class="full hint">${t('bk.exportHint')}</p></div>`, {
        okText: t('bk.save'),
        onMount: (r) => {
            r.querySelector('[name=secrets]').addEventListener('change', (e) => {
                r.querySelectorAll('.bk-pass').forEach((el) => el.classList.toggle('hidden', !e.target.checked));
                if (e.target.checked) r.querySelector('[name=p1]').focus();
            });
        },
        onOk: async (r) => {
            let pass = '';
            if (r.querySelector('[name=secrets]').checked) {
                pass = r.querySelector('[name=p1]').value;
                if (pass.length < 6) { toast(t('bk.passShort'), 'err'); return false; }
                if (pass !== r.querySelector('[name=p2]').value) { toast(t('bk.passMismatch'), 'err'); return false; }
            }
            try {
                const path = await App.ExportBackup(pass, r.querySelector('[name=prefs]').checked);
                if (!path) return false; // save dialog cancelled
                toast(t('bk.saved', {p: path}), 'ok');
                return true;
            } catch (e) { toast(String(e), 'err'); return false; }
        },
    });
}

async function restoreBackup() {
    let info;
    try { info = await App.OpenBackup(); } catch (e) { return toast(String(e), 'err'); }
    if (!info || !info.path) return;
    await modal(t('bk.restore').replace('…', ''), `<div class="f">
        <span></span><p>${t('bk.summary', {s: info.sessions, m: info.macros, d: esc((info.exported || '').slice(0, 10))})}</p>
        ${info.hasSecrets ? `<label>${t('bk.pass')}</label><input name="p" type="password" autofocus/><span></span><span class="hint">${t('bk.passOptional')}</span>` : ''}
        ${info.hasPrefs ? `<span></span><label class="chk"><input type="checkbox" name="prefs"/> ${t('bk.restorePrefs')}</label>` : ''}
        <p class="full hint">${t('bk.restoreHint')}</p></div>`, {
        okText: t('bk.restoreGo'),
        onOk: async (r) => {
            try {
                const res = await App.RestoreBackup(info.path, r.querySelector('[name=p]')?.value || '', !!r.querySelector('[name=prefs]')?.checked);
                toast(t('bk.restored', {a: res.added, k: res.skipped, m: res.macros, p: res.passwords}), 'ok');
                loadSessions();
                loadMacros();
                if (res.prefs) setTimeout(() => location.reload(), 800);
                return true;
            } catch (e) {
                toast(String(e).includes('BAD_PASSPHRASE') ? t('bk.badPass') : String(e), 'err');
                return false;
            }
        },
    });
}

// ---------------------------------------------------------------- TFTP server

const tftpLog = [];
function setTftpRunning(on) {
    state.tftpRunning = on;
    $('#btn-tftp').classList.toggle('on', on);
    $('#sb-tftp').className = 'sb-item' + (on ? ' on' : '');
    $('#sb-tftp').innerHTML = on ? `${icon('server')}TFTP` : '';
}
EventsOn('tftp:state', (on) => setTftpRunning(on));
EventsOn('tftp:transfer', (ev) => {
    tftpLog.unshift(ev);
    tftpLog.length = Math.min(tftpLog.length, 50);
    const what = t(ev.dir === 'get' ? 'tftp.sent' : 'tftp.received', {f: ev.file, peer: ev.peer, size: fmtSize(ev.bytes || 0)});
    toast(ev.error ? `TFTP: ${ev.file} · ${ev.error}` : `TFTP: ${what}`, ev.error ? 'err' : 'ok');
    renderTftpLog();
});
function renderTftpLog() {
    const box = $('.tftp-log');
    if (!box) return;
    box.innerHTML = tftpLog.length ? tftpLog.map((e) => `<div class="${e.error ? 'bad' : ''}"><span class="mono">${esc(e.time)}</span>
        <span>${e.dir === 'get' ? '↓' : '↑'} ${esc(e.file)}</span><span class="hint">${esc(e.peer)}</span>
        <span class="hint">${e.error ? esc(e.error) : fmtSize(e.bytes || 0)}</span></div>`).join('')
        : `<p class="hint">${t('tftp.noLog')}</p>`;
}

async function tftpDialog() {
    let info = await App.GetTFTPInfo();
    const ip = () => info.ips[0] || '<PC-IP>';
    const examples = () => `copy tftp://${ip()}/ios.bin flash:\ncopy running-config tftp://${ip()}/backups/sw1-confg`;
    await modal(t('tftp.title'), `<div class="f">
        <label>${t('mcp.status')}</label><div class="inline"><span data-el="state"></span><button type="button" data-x="toggle"></button></div>
        <label>${t('tftp.root')}</label><div class="inline"><input name="root" value="${esc(info.root)}" spellcheck="false"/><button type="button" data-x="pick">${t('common.browse')}</button><button type="button" data-x="open">${icon('folderOpen')}</button></div>
        <label>${t('common.port')}</label><input name="port" type="number" value="${info.port}"/>
        <span></span><label class="chk"><input type="checkbox" name="write" ${info.write ? 'checked' : ''}/> ${t('tftp.write')}</label>
        <label>${t('tftp.ips')}</label><div class="tftp-ips">${info.ips.map((x) => `<code>${esc(x)}</code>`).join('') || '-'}</div>
        <label class="full">${t('tftp.example')}</label><pre class="full tftp-ex">${esc(examples())}</pre>
        <label class="full">${t('tftp.log')}</label><div class="full tftp-log"></div>
        <p class="full hint">${t('tftp.hint')}</p></div>`, {
        okText: t('common.close'),
        wide: true,
        onMount: (r) => {
            r.querySelector('[data-x=cancel]').classList.add('hidden');
            const sync = () => {
                r.querySelector('[data-el=state]').innerHTML = info.running
                    ? `<b style="color:var(--ok)">${t('mcp.statusOn')}</b> <span class="mono">udp/${info.port}</span>` : t('mcp.statusOff');
                const b = r.querySelector('[data-x=toggle]');
                b.textContent = info.running ? t('tftp.stop') : t('tftp.start');
                b.classList.toggle('primary', !info.running);
                setTftpRunning(info.running);
            };
            sync();
            renderTftpLog();
            r.querySelector('[data-x=toggle]').onclick = async () => {
                try {
                    if (info.running) { await App.StopTFTP(); info = await App.GetTFTPInfo(); }
                    else {
                        info = await App.StartTFTP(r.querySelector('[name=root]').value.trim(), parseInt(r.querySelector('[name=port]').value, 10) || 69, r.querySelector('[name=write]').checked);
                        toast(t('tftp.started', {p: info.port}), 'ok');
                    }
                } catch (e) { toast(String(e), 'err'); }
                sync();
            };
            r.querySelector('[data-x=pick]').onclick = async () => {
                const p = await App.PickTFTPFolder();
                if (p) r.querySelector('[name=root]').value = p;
            };
            r.querySelector('[data-x=open]').onclick = () => App.OpenTFTPFolder();
        },
    });
}
$('#btn-tftp').onclick = () => tftpDialog();

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

// ---------------------------------------------------------------- session logs

const fmtDate = (ms) => {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Log browser: sessions on the left, a log's text on the right; Enter in the
// search box searches inside every log.
async function logViewer({rel = '', session = ''} = {}) {
    if ($('.modal-bg')) return;
    let logs = await App.ListLogs().catch(() => []) || [];
    let cur = rel || logs.find((l) => !session || l.session === session)?.rel || '';
    let open = new Set([logs.find((l) => l.rel === cur)?.session || session].filter(Boolean));
    let hits = null; // full-text results
    let gotoLine = 0;
    let rootEl;

    const groups = () => {
        const m = new Map();
        for (const l of logs) {
            if (!m.has(l.session)) m.set(l.session, []);
            m.get(l.session).push(l);
        }
        return [...m.entries()];
    };
    const renderList = () => {
        const q = rootEl.querySelector('[name=lq]').value.trim().toLowerCase();
        const list = rootEl.querySelector('.lv-list');
        if (hits) {
            list.innerHTML = `<div class="lv-hits-head">${t('log.hits', {n: hits.length})}<button class="ghost" data-x="hits-clear">${icon('close')}</button></div>`
                + (hits.map((h, i) => `<div class="item lv-hit" data-i="${i}"><span class="nm"><b>${esc(h.session)}</b> · ${fmtDate(h.time)} · ${t('log.line', {n: h.line})}</span><span class="sub mono">${esc(h.text)}</span></div>`).join('')
                || `<div class="empty"><span>${t('log.noHits')}</span></div>`);
            return;
        }
        const gs = groups().filter(([s]) => !q || s.toLowerCase().includes(q));
        list.innerHTML = gs.map(([s, ls]) => `<div class="folder${open.has(s) || q ? ' open' : ''}" data-s="${esc(s)}"><span class="fic">${icon(open.has(s) || q ? 'chevDown' : 'chevRight')}</span><span class="nm">${esc(s)}</span><span class="sub">${ls.length}</span></div>`
            + (open.has(s) || q ? ls.map((l) => `<div class="item lv-file${l.rel === cur ? ' sel' : ''}" data-rel="${esc(l.rel)}"><span class="nm">${fmtDate(l.time)}</span>${l.active ? '<span class="badge rec">REC</span>' : ''}${l.summary ? `<span class="pin" title="${t('ai.hasSummary')}">${icon('spark')}</span>` : ''}<span class="sub">${fmtSize(l.size)}</span></div>`).join('') : '')).join('')
            || `<div class="empty">${icon('logs')}<span>${t(logs.length ? 'log.noMatch' : 'log.none')}</span></div>`;
    };
    const showFile = async () => {
        const view = rootEl.querySelector('.lv-view');
        const l = logs.find((x) => x.rel === cur);
        if (!l) {
            view.innerHTML = `<div class="empty"><span>${t('log.pick')}</span></div>`;
            return;
        }
        view.innerHTML = `<div class="lv-bar"><b>${esc(l.session)}</b><span class="hint">${fmtDate(l.time)} · ${fmtSize(l.size)}</span>${l.active ? '<span class="badge rec">REC</span>' : ''}<span class="grow"></span>
            <button data-x="sum">${icon('spark')}${t(l.summary ? 'ai.summaryShow' : 'ai.summary')}</button>
            <button class="icon" data-x="reveal" title="${t('log.reveal')}">${icon('folderOpen')}</button>
            <button class="icon" data-x="del" title="${t('common.delete')}" ${l.active ? 'disabled' : ''}>${icon('trash')}</button></div>
            <div class="lv-text mono"><div class="loadbar"><i></i></div></div>`;
        const res = await App.ReadLog(cur).catch((e) => ({text: String(e)}));
        if (l.rel !== cur) return;
        const box = view.querySelector('.lv-text');
        const q = (hits && rootEl.querySelector('[name=lq]').value.trim()) || '';
        const lines = res.text.split('\n');
        box.innerHTML = (res.truncated ? `<div class="hint">${t('log.truncated')}</div>` : '')
            + lines.map((ln, i) => `<div class="ln" data-n="${i + 1}">${q ? markText(ln, q) : esc(ln)}</div>`).join('');
        if (gotoLine) {
            const el = box.querySelector(`.ln[data-n="${gotoLine}"]`);
            el?.classList.add('hit');
            el?.scrollIntoView({block: 'center'});
            gotoLine = 0;
        } else box.scrollTop = box.scrollHeight;
        view.querySelector('[data-x=sum]').onclick = () => (l.summary && res.summary
            ? aiReport(t('ai.summaryOf', {name: l.session}), {text: res.summary, rel: l.rel})
            : aiReport(t('ai.summaryOf', {name: l.session}), {start: (id) => App.AISummarizeLog(id, l.rel), rel: l.rel, onSaved: () => { l.summary = true; renderList(); }}));
        view.querySelector('[data-x=reveal]').onclick = () => App.RevealLog(l.rel);
        view.querySelector('[data-x=del]').onclick = async () => {
            if (!await confirmInline(view, t('log.deleteAsk'))) return;
            try {
                await App.DeleteLog(l.rel);
                logs = logs.filter((x) => x !== l);
                cur = '';
                renderList();
                showFile();
            } catch (e) { toast(String(e), 'err'); }
        };
    };

    await modal(t('log.title'), `<div class="lv">
        <div class="lv-side"><label class="field"><i data-icon="search"></i><input name="lq" placeholder="${t('log.searchPh')}" spellcheck="false"/></label><div class="lv-list list"></div></div>
        <div class="lv-view"></div></div>`, {
        wide: 'xl', noCancel: true, okText: t('common.close'),
        onMount: (r) => {
            rootEl = r;
            hydrateIcons(r);
            renderList();
            showFile();
            const input = r.querySelector('[name=lq]');
            input.addEventListener('input', () => { if (!hits) renderList(); });
            input.addEventListener('keydown', async (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                e.stopPropagation();
                const q = input.value.trim();
                if (!q) { hits = null; return renderList(); }
                r.querySelector('.lv-list').innerHTML = '<div class="loadbar"><i></i></div>';
                hits = await App.SearchLogs(q).catch(() => []) || [];
                renderList();
            });
            r.querySelector('.lv-list').addEventListener('click', (e) => {
                if (e.target.closest('[data-x=hits-clear]')) { hits = null; input.value = ''; renderList(); return showFile(); }
                const f = e.target.closest('.folder');
                if (f) { const s = f.dataset.s; open.has(s) ? open.delete(s) : open.add(s); return renderList(); }
                const h = e.target.closest('.lv-hit');
                if (h) { const hit = hits[+h.dataset.i]; cur = hit.rel; gotoLine = hit.line; return showFile(); }
                const it = e.target.closest('.lv-file');
                if (it) { cur = it.dataset.rel; renderList(); showFile(); }
            });
        },
    });
}

function markText(s, q) {
    const lo = s.toLowerCase();
    const k = q.toLowerCase();
    let out = '';
    let i = 0;
    for (let j = lo.indexOf(k); j >= 0; j = lo.indexOf(k, i)) {
        out += esc(s.slice(i, j)) + `<mark>${esc(s.slice(j, j + k.length))}</mark>`;
        i = j + k.length;
    }
    return out + esc(s.slice(i));
}

// A small yes/no strip inside a dialog (no nested modal).
function confirmInline(host, text) {
    return new Promise((resolve) => {
        host.querySelector('.inline-ask')?.remove();
        const d = document.createElement('div');
        d.className = 'inline-ask';
        d.innerHTML = `<span>${esc(text)}</span><button data-v="0">${t('common.cancel')}</button><button class="primary" data-v="1" style="background:var(--bad);border-color:var(--bad)">${t('common.delete')}</button>`;
        host.prepend(d);
        d.onclick = (e) => {
            const b = e.target.closest('button');
            if (!b) return;
            d.remove();
            resolve(b.dataset.v === '1');
        };
        d.querySelector('[data-v="0"]').focus();
    });
}

// ---------------------------------------------------------------- AI helper

const AI_ERR = {
    NO_CLI: 'ai.err.noCli', AI_AUTH: 'ai.err.auth', CANCELED: 'ai.err.canceled', timeout: 'ai.err.timeout',
};
const aiErrText = (e) => (AI_ERR[e] ? t(AI_ERR[e]) : t('ai.err.other', {e}));
const newReqId = () => 'r' + Math.random().toString(36).slice(2, 10);

// Visible terminal text: the last n lines up to the cursor, wrapped rows joined.
function termText(tab, n = 120) {
    const b = tab.term.buffer.active;
    const end = b.baseY + b.cursorY;
    const out = [];
    for (let i = Math.max(0, end - n * 2); i <= end; i++) {
        const l = b.getLine(i);
        if (!l) continue;
        const s = l.translateToString(true);
        if (l.isWrapped && out.length) out[out.length - 1] += s; else out.push(s);
    }
    return out.slice(-n).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Stream an AI request; onDelta(textSoFar), resolves to {text, error}.
function aiStream(start, onDelta) {
    const id = newReqId();
    let acc = '';
    return {
        id,
        done: new Promise((resolve) => {
            EventsOn('ai:delta:' + id, (d) => { acc += d; onDelta(acc); });
            EventsOn('ai:done:' + id, (res) => {
                EventsOff('ai:delta:' + id, 'ai:done:' + id);
                resolve(res);
            });
            start(id);
        }),
    };
}

const mdLabels = () => ({insert: t('ai.insert'), insertTip: t('ai.insertTip'), run: t('common.run'), runTip: t('ai.runTip'), runAll: t('ai.runAll')});

// Wire Insert/Run buttons in rendered answers to a tab.
function wireCommands(root, getTab) {
    root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        const tab = getTab();
        if (!tab || tab.status !== 'open') return toast(t('macro.noTarget'), 'err');
        const block = b.closest('.cmd-block');
        if (b.dataset.act === 'all') {
            const cmds = [...block.querySelectorAll('.cmd-row')].map((r) => r.dataset.cmd);
            App.RunMacro([tab.id], cmds.join('\n'), 400);
        } else {
            const cmd = b.closest('.cmd-row').dataset.cmd;
            if (b.dataset.act === 'run' && RISKY_CMD.test(cmd)) return; // never one-click a config change
            App.Write(tab.id, b.dataset.act === 'run' ? cmd + '\r' : cmd);
        }
        b.classList.add('done');
        activate(tab);
    });
}

function toggleAI(open = !prefs.aiOpen) {
    prefs.aiOpen = open;
    savePrefs();
    renderAI();
    if (open) requestAnimationFrame(() => $('#ai textarea').focus());
    else focusActive();
}

function renderAI() {
    const panel = $('#ai');
    const show = prefs.aiOpen;
    panel.classList.toggle('hidden', !show);
    $('#btn-ai').classList.toggle('on', show);
    if (!show) return;
    panel.style.width = prefs.aiWidth + 'px';
    const tab = state.active;
    panel.querySelector('.ai-target').textContent = tab ? '· ' + tab.title : '';
    const log = panel.querySelector('.ai-log');
    if (!tab) {
        log.innerHTML = `<div class="ai-empty">${t('ai.noTab')}</div>`;
        return;
    }
    if (!tab.ai.msgs.length) {
        log.innerHTML = `<div class="ai-empty">${icon('spark')}<p>${t('ai.intro')}</p>
            ${['ai.ex1', 'ai.ex2', 'ai.ex3'].map((k) => `<button class="ai-ex" data-q="${esc(t(k))}">${esc(t(k))}</button>`).join('')}</div>`;
    } else {
        log.innerHTML = tab.ai.msgs.map((m, i) => `<div class="ai-msg ${m.role}${m.error ? ' err' : ''}" data-i="${i}">${m.role === 'user'
            ? `${m.quote ? `<pre class="quote">${esc(m.quote)}</pre>` : ''}<div>${esc(m.text)}</div>`
            : (m.text ? renderMD(m.text, {commands: true, labels: mdLabels()}) : '<div class="typing"><i></i><i></i><i></i></div>')}</div>`).join('');
    }
    panel.querySelector('[data-x=ai-send]').innerHTML = tab.ai.busy ? `${icon('stop')}<span>${t('ai.stop')}</span>` : `${icon('send')}<span>${t('ai.send')}</span>`;
    log.scrollTop = log.scrollHeight;
}

async function askAI(tab, {question, kind = 'ask', quote = '', context = null}) {
    if (tab.ai.busy) return;
    const withScreen = $('#ai [name=ai-screen]').checked;
    const history = tab.ai.msgs.filter((m) => !m.error).slice(-6).map((m) => ({role: m.role, text: (m.quote ? m.quote + '\n' : '') + m.text}));
    tab.ai.msgs.push({role: 'user', text: question || t('ai.explainQ'), quote});
    const ans = {role: 'assistant', text: ''};
    tab.ai.msgs.push(ans);
    const req = {
        kind, question, history,
        context: context ?? (withScreen ? termText(tab) : ''),
        session: tab.title, target: targetOf(tab.session),
    };
    let raf = 0;
    const s = aiStream((id) => App.AIAsk(id, req), (txt) => {
        ans.text = txt;
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (state.active === tab) renderAI(); });
    });
    tab.ai.busy = s.id;
    renderAI();
    const res = await s.done;
    tab.ai.busy = null;
    if (res.error && res.error !== 'CANCELED') { ans.text = aiErrText(res.error); ans.error = true; }
    else ans.text = res.text || ans.text || t('ai.err.empty');
    if (state.active === tab) renderAI();
}

(() => {
    const panel = $('#ai');
    const input = panel.querySelector('textarea');
    const send = () => {
        const tab = state.active;
        if (!tab) return;
        if (tab.ai.busy) return App.AICancel(tab.ai.busy);
        const q = input.value.trim();
        if (!q) return input.focus();
        input.value = '';
        askAI(tab, {question: q});
    };
    panel.querySelector('[data-x=ai-send]').onclick = send;
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
        if (e.key === 'Escape') { e.preventDefault(); focusActive(); }
    });
    panel.querySelector('[data-x=ai-close]').onclick = () => toggleAI(false);
    panel.querySelector('[data-x=ai-new]').onclick = () => {
        const tab = state.active;
        if (!tab) return;
        if (tab.ai.busy) App.AICancel(tab.ai.busy);
        tab.ai = {msgs: [], busy: null};
        renderAI();
    };
    panel.querySelector('.ai-log').addEventListener('click', (e) => {
        const ex = e.target.closest('.ai-ex');
        if (ex && state.active) askAI(state.active, {question: ex.dataset.q});
    });
    wireCommands(panel.querySelector('.ai-log'), () => state.active);
    $('#btn-ai').onclick = () => toggleAI();
    // Drag the panel's left edge to resize it.
    panel.addEventListener('mousedown', (e) => {
        if (e.offsetX > 5 || e.target !== panel) return;
        e.preventDefault();
        const move = (ev) => {
            prefs.aiWidth = Math.max(280, Math.min(innerWidth * 0.6, innerWidth - ev.clientX)) / uiZoom();
            panel.style.width = prefs.aiWidth + 'px';
        };
        const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); savePrefs(); };
        addEventListener('mousemove', move);
        addEventListener('mouseup', up);
    });
})();

// "Ask AI" chip next to a terminal selection.
let chipFor = null;
function showAIChip(tab, x, y) {
    const sel = tab.term.getSelection().trim();
    if (!prefs.aiChip || sel.length < 3 || tab !== state.active) return hideAIChip();
    const chip = $('#ai-chip');
    chip.classList.remove('hidden');
    const z = uiZoom();
    const r = chip.getBoundingClientRect();
    chip.style.left = Math.min(x + 8, innerWidth - r.width - 8) / z + 'px';
    chip.style.top = Math.max(4, y - r.height - 10) / z + 'px';
    chipFor = {tab, sel};
}
function hideAIChip() {
    $('#ai-chip').classList.add('hidden');
    chipFor = null;
}
$('#ai-chip').addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection
$('#ai-chip').onclick = () => {
    if (!chipFor) return;
    const {tab, sel} = chipFor;
    hideAIChip();
    if (!prefs.aiOpen) toggleAI(true);
    const quote = sel.length > 4000 ? sel.slice(0, 4000) + '\n…' : sel;
    askAI(tab, {kind: 'explain', question: '', quote, context: sel.slice(0, 20000)});
};
addEventListener('keydown', () => hideAIChip(), true);

// Streaming report dialog (log summaries).
async function aiReport(title, {start = null, text = '', rel = '', onSaved = null}) {
    let body;
    let req = null;
    let final = text;
    const draw = (md) => { body.innerHTML = md ? renderMD(md) : '<div class="typing"><i></i><i></i><i></i></div>'; };
    await modal(title, `<div class="ai-report"><div class="ai-report-body md"></div></div>
        <div class="inline ai-report-btns"><button type="button" data-x="copy">${icon('copy')}${t('ai.copy')}</button>
        ${rel && text ? `<button type="button" data-x="redo">${icon('refresh')}${t('ai.redo')}</button>` : ''}<span class="hint grow" data-el="note"></span></div>`, {
        wide: true, noCancel: true, okText: t('common.close'),
        onMount: (r) => {
            body = r.querySelector('.ai-report-body');
            const note = r.querySelector('[data-el=note]');
            r.querySelector('[data-x=copy]').onclick = () => { ClipboardSetText(final); toast(t('ai.copied'), 'ok'); };
            const run = async (fn) => {
                draw('');
                note.textContent = t('ai.working');
                req = aiStream(fn, (txt) => { final = txt; draw(txt); });
                const res = await req.done;
                req = null;
                if (res.error) { final = ''; body.innerHTML = `<p class="err">${esc(aiErrText(res.error))}</p>`; note.textContent = ''; return; }
                final = res.text || final;
                draw(final);
                note.textContent = rel ? t('ai.saved') : '';
                onSaved?.();
            };
            r.querySelector('[data-x=redo]')?.addEventListener('click', () => run((id) => App.AISummarizeLog(id, rel)));
            if (start) run(start); else draw(text);
        },
    });
    if (req) App.AICancel(req.id);
}

async function summarizeTab(tab) {
    const rel = tab.status === 'open' ? await App.LogPath(tab.id).catch(() => '') : '';
    if (rel) return aiReport(t('ai.summaryOf', {name: tab.title}), {start: (id) => App.AISummarizeLog(id, rel), rel});
    const text = termText(tab, Math.min(prefs.scrollback, 5000));
    return aiReport(t('ai.summaryOf', {name: tab.title}), {start: (id) => App.AISummarizeText(id, tab.title, text)});
}

// ---------------------------------------------------------------- scheduled checks

let checksOpen = null; // re-render hook while the dialog is open

function scheduleText(c) {
    if (c.mode === 'daily') return t('chk.daily', {t: c.times});
    if (c.mode === 'interval') return t('chk.every', {n: c.everyMin});
    return t('chk.manual');
}

function setChecksBadge(status) {
    const b = $('#btn-checks');
    b.classList.toggle('alert', status === 'warn' || status === 'fail');
    b.classList.toggle('bad', status === 'fail');
}

EventsOn('check:state', () => checksOpen?.());
EventsOn('check:done', (ev) => {
    checksOpen?.();
    const kind = ev.status === 'ok' ? 'ok' : 'err';
    toast(t('chk.done.' + ev.status, {name: ev.name}) + (ev.note ? ' · ' + ev.note : ''), kind);
    if (ev.status !== 'ok' && !checksOpen) setChecksBadge(ev.status);
});

async function checksDialog() {
    if ($('.modal-bg')) return;
    setChecksBadge('');
    let list = [];
    let rootEl;
    const draw = async () => {
        list = await App.ListChecks().catch(() => []) || [];
        if (!rootEl?.isConnected) return;
        rootEl.querySelector('.chk-list').innerHTML = list.length ? list.map((c) => `<div class="item chk-item" data-id="${c.id}">
            <span class="dot ${c.running ? 'connecting' : c.lastStatus || 'none'}"></span>
            <span class="nm"><b>${esc(c.name)}</b><span class="sub">${esc(scheduleText(c))} · ${t('chk.nDevices', {n: c.sessions.length})}${c.ai ? ' · AI' : ''}${c.enabled ? '' : ' · ' + t('chk.off')}</span>
            <span class="sub">${c.running ? t('chk.running') : c.lastRun ? t('chk.last', {ago: ago(c.lastRun)}) + (c.lastNote ? ' · ' + esc(c.lastNote) : '') : t('chk.never')}${c.next && !c.running ? ' · ' + t('chk.next', {at: fmtDate(c.next)}) : ''}</span></span>
            <button data-x="run" ${c.running ? 'disabled' : ''}>${icon('play')}${t('common.run')}</button>
            <button data-x="runs">${t('chk.results')}</button></div>`).join('')
            : `<div class="empty">${icon('clock')}<span>${t('chk.empty')}</span></div>`;
    };
    checksOpen = draw;
    await modal(t('chk.title'), `<p class="hint">${t('chk.hint')}</p>
        <div class="chk-list list"></div>
        <div class="inline"><button type="button" class="primary" data-x="new">${icon('plus')}${t('chk.new')}</button></div>`, {
        wide: true, noCancel: true, okText: t('common.close'),
        onMount: (r) => {
            rootEl = r;
            draw();
            r.querySelector('[data-x=new]').onclick = () => editCheck(null).then(draw);
            const listEl = r.querySelector('.chk-list');
            const find = (e) => list.find((c) => c.id === e.target.closest('.chk-item')?.dataset.id);
            listEl.addEventListener('click', async (e) => {
                const c = find(e);
                if (!c) return;
                if (e.target.closest('[data-x=run]')) {
                    await App.RunCheckNow(c.id).catch((err) => toast(String(err), 'err'));
                    return draw();
                }
                if (e.target.closest('[data-x=runs]')) return checkRuns(c);
            });
            listEl.addEventListener('dblclick', (e) => { const c = find(e); if (c && !e.target.closest('button')) editCheck(c).then(draw); });
            listEl.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const c = find(e);
                if (!c) return;
                ctxMenu(e.clientX, e.clientY, [
                    {label: t('common.run'), icon: 'play', fn: () => App.RunCheckNow(c.id).then(draw).catch((err) => toast(String(err), 'err'))},
                    {label: t('chk.results'), icon: 'logs', fn: () => checkRuns(c)},
                    {label: t('common.edit'), icon: 'gear', fn: () => editCheck(c).then(draw)},
                    '-',
                    {label: t('common.delete'), icon: 'close', danger: true, fn: async () => {
                        if (await confirmInline(r, t('chk.deleteAsk', {name: c.name}))) { await App.DeleteCheck(c.id); draw(); }
                    }},
                ]);
            });
        },
    });
    checksOpen = null;
}

// Editing happens in a panel that replaces the list (dialogs don't nest).
function editCheck(c) {
    return new Promise((resolve) => {
        const host = $('.modal-bg .modal');
        c = {name: '', sessions: [], commands: '', mode: 'daily', times: '08:30', everyMin: 60, enabled: true, ai: true, ...c};
        const sessions = state.sessions;
        const panel = document.createElement('div');
        panel.className = 'chk-edit';
        panel.innerHTML = `<h3>${c.id ? t('chk.edit') : t('chk.new')}</h3><div class="f">
            <label>${t('common.name')}</label><input name="name" value="${esc(c.name)}" placeholder="${t('chk.namePh')}" autofocus/>
            <label>${t('chk.sessions')}</label><div class="chk-sess"><label class="field"><i data-icon="search"></i><input name="sq" placeholder="${t('sess.search')}" spellcheck="false"/></label>
                <div class="chk-sess-list">${sessions.map((s) => `<label class="chk" data-name="${esc((s.folder ? s.folder + '/' : '') + s.name).toLowerCase()}"><input type="checkbox" value="${s.id}" ${c.sessions.includes(s.id) ? 'checked' : ''}/> ${s.folder ? `<span class="hint">${esc(s.folder)}/</span>` : ''}${esc(s.name)}${s.hasPassword || s.keyPath || s.kind !== 'ssh' ? '' : ` <span class="warn-txt">${t('chk.noPw')}</span>`}</label>`).join('') || `<span class="hint">${t('chk.noSessions')}</span>`}</div></div>
            <label class="full">${t('chk.commands')}</label>
            <textarea class="full" name="commands" rows="5" spellcheck="false" placeholder="show interface status&#10;show ip route summary">${esc(c.commands)}</textarea>
            <p class="full hint">${t('chk.cmdHint')}</p>
            <label>${t('chk.when')}</label><div class="inline"><div class="seg" data-seg="mode">${['daily', 'interval', 'manual'].map((m) => `<button type="button" data-v="${m}">${t('chk.mode.' + m)}</button>`).join('')}</div>
                <input name="times" class="m-daily" value="${esc(c.times)}" placeholder="08:30, 18:00" style="width:140px"/>
                <span class="m-interval inline"><input name="every" type="number" min="5" step="5" value="${c.everyMin}" style="width:80px"/><span class="hint">${t('chk.minutes')}</span></span></div>
            <span></span><label class="chk"><input type="checkbox" name="ai" ${c.ai ? 'checked' : ''}/> ${t('chk.ai')}</label>
            <span></span><label class="chk"><input type="checkbox" name="enabled" ${c.enabled ? 'checked' : ''}/> ${t('chk.enabled')}</label>
        </div><div class="btns"><button data-x="back">${t('common.cancel')}</button><button class="primary" data-x="save">${t('common.save')}</button></div>`;
        hydrateIcons(panel);
        host.appendChild(panel);
        host.classList.add('editing');
        let mode = c.mode;
        const sync = () => {
            panel.querySelectorAll('[data-seg=mode] button').forEach((b) => b.classList.toggle('on', b.dataset.v === mode));
            panel.querySelector('.m-daily').classList.toggle('hidden', mode !== 'daily');
            panel.querySelector('.m-interval').classList.toggle('hidden', mode !== 'interval');
        };
        panel.querySelectorAll('[data-seg=mode] button').forEach((b) => { b.onclick = () => { mode = b.dataset.v; sync(); }; });
        sync();
        panel.querySelector('[name=sq]').addEventListener('input', (e) => {
            const q = e.target.value.trim().toLowerCase();
            panel.querySelectorAll('.chk-sess-list > label').forEach((l) => l.classList.toggle('hidden', !!q && !l.dataset.name.includes(q)));
        });
        const done = (v) => { panel.remove(); host.classList.remove('editing'); resolve(v); };
        // Esc/Enter belong to this panel while it's open.
        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
            if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') e.stopPropagation();
        });
        panel.querySelector('[data-x=back]').onclick = () => done(null);
        panel.querySelector('[data-x=save]').onclick = async () => {
            const out = {...c,
                name: panel.querySelector('[name=name]').value.trim(),
                sessions: [...panel.querySelectorAll('.chk-sess-list input:checked')].map((x) => x.value),
                commands: panel.querySelector('[name=commands]').value,
                mode, times: panel.querySelector('[name=times]').value.trim(), everyMin: parseInt(panel.querySelector('[name=every]').value, 10) || 60,
                ai: panel.querySelector('[name=ai]').checked, enabled: panel.querySelector('[name=enabled]').checked};
            const risky = out.commands.split('\n').find((l) => l.trim() && RISKY_CMD.test(l));
            if (risky) return toast(t('chk.riskyCmd', {cmd: risky.trim()}), 'err');
            try { done(await App.SaveCheck(out)); } catch (e) { toast(String(e), 'err'); }
        };
        setTimeout(() => panel.querySelector('[name=name]').focus(), 0);
    });
}

async function checkRuns(c) {
    const host = $('.modal-bg .modal');
    const runs = await App.CheckRuns(c.id).catch(() => []) || [];
    const panel = document.createElement('div');
    panel.className = 'chk-edit chk-runs';
    panel.innerHTML = `<h3>${esc(c.name)} · ${t('chk.results')}</h3>
        <div class="lv"><div class="lv-side"><div class="list">${runs.map((r, i) => `<div class="item run-item${i ? '' : ' sel'}" data-rel="${esc(r.rel)}"><span class="dot ${r.status || 'none'}"></span><span class="nm">${fmtDate(r.time)}</span></div>`).join('') || `<div class="empty"><span>${t('chk.noRuns')}</span></div>`}</div></div>
        <div class="lv-view"><div class="run-tabs"></div><div class="run-body"></div></div></div>
        <div class="btns"><button data-x="reveal">${icon('folderOpen')}${t('log.reveal')}</button><span class="grow"></span><button class="primary" data-x="back">${t('common.close')}</button></div>`;
    host.appendChild(panel);
    host.classList.add('editing');
    let cur = runs[0]?.rel;
    const show = async () => {
        if (!cur) return;
        const v = await App.ReadCheckRun(cur).catch((e) => ({report: String(e), files: []}));
        const tabs = panel.querySelector('.run-tabs');
        tabs.innerHTML = `<button class="on" data-f="-1">${t('chk.report')}</button>` + (v.files || []).map((f, i) => `<button data-f="${i}">${esc(f.name)}</button>`).join('');
        const body = panel.querySelector('.run-body');
        const pick = (i) => {
            tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.f === String(i)));
            body.innerHTML = i < 0 ? `<div class="md">${renderMD(v.report)}</div>` : `<pre class="mono">${esc(v.files[i].text)}</pre>`;
        };
        tabs.onclick = (e) => { const b = e.target.closest('button'); if (b) pick(+b.dataset.f); };
        pick(-1);
    };
    panel.querySelector('.list').addEventListener('click', (e) => {
        const it = e.target.closest('.run-item');
        if (!it) return;
        panel.querySelectorAll('.run-item').forEach((x) => x.classList.toggle('sel', x === it));
        cur = it.dataset.rel;
        show();
    });
    const close = () => { panel.remove(); host.classList.remove('editing'); };
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
    panel.querySelector('[data-x=back]').onclick = close;
    panel.querySelector('[data-x=reveal]').onclick = () => (cur ? App.RevealLog(cur + '/report.md') : App.RevealLog(''));
    panel.querySelector('[data-x=back]').focus();
    show();
}

$('#btn-checks').onclick = () => checksDialog();

// ---------------------------------------------------------------- boot

(async () => {
    hydrateIcons();
    await loadPrefs();
    state.collapsed = new Set(prefs.collapsed);
    applyLanguage();
    applyLayout();
    applyTheme();
    await Promise.all([loadSessions(), loadMacros(), refreshMcpButton(), App.GetTFTPInfo().then((i) => setTftpRunning(i.running)).catch(() => {})]);
    renderTabs();
    document.body.classList.remove('booting');
    if (await App.WasUpdated().catch(() => false)) toast(t('upd.done', {v: await App.GetVersion()}), 'ok');
    setInterval(renderRecents, 60000); // keep "n min ago" fresh
})();
