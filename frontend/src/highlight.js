// Keyword highlighting: colour words like "down", "error" or IP addresses in
// plain device output. Colours are xterm decorations, so the text the device
// sent (and what gets copied) is untouched.

export const HL_COLORS = ['red', 'yellow', 'green', 'blue', 'cyan', 'magenta'];

// key names an i18n label; user rules carry their own name instead.
export const DEFAULT_HL_RULES = [
    {key: 'hl.r.sev', color: 'red', ci: false, pattern: '%[A-Z0-9_]+-[0-3]-[A-Z0-9_]+'},
    {key: 'hl.r.bad', color: 'red', ci: true,
        pattern: '\\b(?:down|err-?disabled?|errors?|fail(?:ed|ure|s)?|denied|deny|refused|unreachable|timed? ?out|critical|alert|emergency|drop(?:ped|s)?|block(?:ed)?|reject(?:ed)?|invalid|mismatch|offline|lost|not ready)\\b'},
    {key: 'hl.r.warn', color: 'yellow', ci: true,
        pattern: '%[A-Z0-9_]+-4-[A-Z0-9_]+|\\b(?:warn(?:ing)?s?|notconnect|not connected|standby|disabled|inactive|shutdown|degraded|flap(?:ping)?|retry(?:ing)?|pending|suspended)\\b'},
    {key: 'hl.r.good', color: 'green', ci: true,
        pattern: '\\b(?:up|connected|active|established|ok|success(?:ful)?|enabled|online|running|full|forwarding|passed|permit(?:ted)?|accept(?:ed)?|allow(?:ed)?|ready)\\b'},
    {key: 'hl.r.addr', color: 'blue', ci: true,
        pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}(?:/\\d{1,2})?\\b|\\b(?:[0-9a-f]{4}\\.){2}[0-9a-f]{4}\\b|\\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\\b'},
    {key: 'hl.r.intf', color: 'cyan', ci: false,
        pattern: '\\b(?:(?:Ten|TwentyFive|Forty|Hundred)?GigabitEthernet|FastEthernet|Ethernet|Port-channel|Loopback|Tunnel|Vlan|Gi|Te|Fa|Fo|Hu|Twe|Eth|Et|Po|Lo|Tu|Vl|mgmt|eth|bond)\\d+(?:/\\d+)*(?:\\.\\d+)?\\b'},
].map((r, i) => ({id: 'd' + i, on: true, name: '', ...r}));

/** compileRules turns enabled rules into regexes, skipping invalid ones. */
export function compileRules(rules) {
    const out = [];
    for (const r of rules || []) {
        if (!r.on || !r.pattern) continue;
        try {
            out.push({re: new RegExp(r.pattern, r.ci ? 'gi' : 'g'), color: r.color});
        } catch { /* ignore an invalid pattern */ }
    }
    return out;
}

export function checkPattern(p) {
    try { new RegExp(p); return ''; } catch (e) { return e.message; }
}

/**
 * Highlighter colours one terminal. Lines above the cursor are coloured once;
 * the cursor line is redone on each pass because it may still grow.
 */
export class Highlighter {
    constructor(term, getRules, getTheme) {
        this.term = term;
        this.getRules = getRules;
        this.getTheme = getTheme;
        this.markers = [];   // one marker per coloured line (its decorations go with it)
        this.cur = null;     // marker of the cursor line (provisional)
        this.done = null;    // marker of the last finished line
        this.timer = 0;
        this.sub = term.onWriteParsed(() => this.schedule());
    }

    schedule() {
        if (!this.timer) this.timer = setTimeout(() => { this.timer = 0; this.scan(); }, 40);
    }

    /** reset drops every colour (rules or theme changed) and recolours the recent screen. */
    reset() {
        for (const m of this.markers) m.dispose();
        this.markers = [];
        this.cur?.dispose();
        this.done?.dispose();
        this.cur = this.done = null;
        this.schedule();
    }

    dispose() {
        clearTimeout(this.timer);
        this.sub.dispose();
        this.reset();
        clearTimeout(this.timer);
    }

    scan() {
        const rules = this.getRules();
        const buf = this.term.buffer.active;
        if (!rules.length || buf.type !== 'normal') return; // full-screen apps redraw; leave them alone
        const cursor = buf.baseY + buf.cursorY;
        const live = (m) => m && !m.isDisposed && m.line >= 0;
        let start = live(this.done) ? this.done.line + 1 : cursor - this.term.rows * 2;
        if (live(this.cur)) start = Math.min(start, this.cur.line);
        start = Math.max(0, start, cursor - 1000); // a huge burst: colour the recent part only
        // The provisional line is redone from scratch.
        if (this.cur) {
            this.markers = this.markers.filter((m) => m !== this.cur);
            this.cur.dispose();
        }
        this.cur = null;
        const theme = this.getTheme();
        for (let y = start; y <= cursor; y++) {
            const m = this.colourLine(buf, y, cursor, rules, theme);
            if (!m) continue;
            this.markers.push(m);
            if (y === cursor) this.cur = m;
        }
        this.done?.dispose();
        this.done = cursor > 0 ? this.term.registerMarker(-1) : null;
        if (this.markers.length > 4000) this.markers = this.markers.filter((m) => !m.isDisposed);
    }

    colourLine(buf, y, cursor, rules, theme) {
        const line = buf.getLine(y);
        if (!line) return null;
        // Text plus the cell column of each character (wide characters take two cells).
        let text = '';
        const col = [];
        for (let x = 0; x < line.length; x++) {
            const c = line.getCell(x, this.cell);
            this.cell = c;
            if (!c || c.getWidth() === 0) continue;
            const ch = c.getChars() || ' ';
            for (let k = 0; k < ch.length; k++) col.push(x);
            text += ch;
        }
        col.push(line.length);
        if (!text.trim()) return null;
        const taken = new Uint8Array(text.length);
        const hits = [];
        for (const r of rules) { // earlier rules win where matches overlap
            r.re.lastIndex = 0;
            let m;
            while ((m = r.re.exec(text))) {
                if (!m[0]) { r.re.lastIndex++; continue; }
                const a = m.index;
                const b = a + m[0].length;
                if (taken.subarray(a, b).some(Boolean)) continue;
                taken.fill(1, a, b);
                hits.push([col[a], col[b] - col[a], theme[r.color] || r.color]);
            }
        }
        if (!hits.length) return null;
        const marker = this.term.registerMarker(y - cursor);
        if (!marker) return null;
        for (const [x, width, color] of hits) {
            this.term.registerDecoration({marker, x, width, foregroundColor: color, layer: 'bottom'});
        }
        return marker;
    }
}
