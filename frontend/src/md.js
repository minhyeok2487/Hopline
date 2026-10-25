// A small, safe Markdown renderer for AI answers and reports: everything is
// escaped first, then headings, lists, quotes, code blocks, **bold** and
// `code` are turned into markup. ```cli blocks become runnable command rows.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

// Commands that change a device or interrupt traffic: never offered as one-click "Run".
export const RISKY_CMD = /^\s*(conf(ig(ure)?)?\b|set\b|delete\b|del\b|unset\b|no\s|reload|reboot|restart|shutdown|halt|poweroff|clear\b|erase|format|write\b|wr\b|copy\b.*\b(run|start)|commit|save\b|install|upgrade|request\s+system|rm\s|mv\s|dd\s|mkfs|kill|cpstop|cprestart|fw\s+unloadlocal|clusterxl_admin|systemctl\s+(stop|restart)|service\s+\S+\s+(stop|restart)|iptables\b|ip\s+(link|addr|route)\s+(set|add|del)|interface\b|vlan\b|router\b|hostname\b|username\b|enable\s+secret|crypto\b)/i;

function inline(s) {
    return esc(s)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}

/**
 * renderMD(text, {commands}) — when commands is true, ```cli blocks become
 * rows with data-cmd attributes the caller wires to Insert/Run buttons.
 */
export function renderMD(src, {commands = false, labels = {}} = {}) {
    const lines = String(src ?? '').replace(/\r/g, '').split('\n');
    const out = [];
    let list = null; // 'ul' | 'ol'
    let para = [];
    const flushPara = () => {
        if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
        para = [];
    };
    const closeList = () => {
        if (list) out.push(`</${list}>`);
        list = null;
    };
    for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        const fence = ln.match(/^\s*```\s*([\w-]*)\s*$/);
        if (fence) {
            flushPara();
            closeList();
            const lang = fence[1].toLowerCase();
            const body = [];
            for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) body.push(lines[i]);
            const cmds = body.filter((l) => l.trim());
            if (commands && cmds.length && ['cli', 'bash', 'sh', 'shell', 'console', 'text', ''].includes(lang)) {
                const rows = cmds.map((c) => {
                    const risky = RISKY_CMD.test(c);
                    return `<div class="cmd-row${risky ? ' risky' : ''}" data-cmd="${esc(c)}"><code>${esc(c)}</code>`
                        + `<button data-act="insert" title="${esc(labels.insertTip || '')}">${esc(labels.insert || 'Insert')}</button>`
                        + (risky ? '' : `<button data-act="run" class="primary" title="${esc(labels.runTip || '')}">${esc(labels.run || 'Run')}</button>`)
                        + '</div>';
                }).join('');
                const all = cmds.length > 1 && !cmds.some((c) => RISKY_CMD.test(c))
                    ? `<button class="cmd-all" data-act="all">${esc(labels.runAll || 'Run all')}</button>` : '';
                out.push(`<div class="cmd-block">${rows}${all}</div>`);
            } else {
                out.push(`<pre class="code">${esc(body.join('\n'))}</pre>`);
            }
            continue;
        }
        const h = ln.match(/^(#{1,4})\s+(.*)$/);
        if (h) {
            flushPara();
            closeList();
            const n = Math.min(h[1].length + 2, 6);
            out.push(`<h${n}>${inline(h[2])}</h${n}>`);
            continue;
        }
        const li = ln.match(/^\s*([-*•]|\d+[.)])\s+(.*)$/);
        if (li) {
            flushPara();
            const want = /\d/.test(li[1]) ? 'ol' : 'ul';
            if (list !== want) { closeList(); out.push(`<${want}>`); list = want; }
            out.push(`<li>${inline(li[2])}</li>`);
            continue;
        }
        const q = ln.match(/^\s*>\s?(.*)$/);
        if (q) {
            flushPara();
            closeList();
            out.push(`<blockquote>${inline(q[1])}</blockquote>`);
            continue;
        }
        if (/^\s*\|.*\|\s*$/.test(ln)) { // tables: keep them readable as monospace rows
            flushPara();
            closeList();
            const rows = [];
            for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) {
                if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().slice(1, -1).split('|').map((c) => c.trim()));
            }
            i--;
            out.push(`<table>${rows.map((r, k) => `<tr>${r.map((c) => (k ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`)).join('')}</tr>`).join('')}</table>`);
            continue;
        }
        if (!ln.trim()) {
            flushPara();
            closeList();
            continue;
        }
        if (/^\s*⚠/.test(ln)) {
            flushPara();
            closeList();
            out.push(`<p class="warn">${inline(ln.trim())}</p>`);
            continue;
        }
        closeList();
        para.push(ln);
    }
    flushPara();
    closeList();
    return out.join('');
}
