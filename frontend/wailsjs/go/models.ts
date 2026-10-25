export namespace main {
	
	export class AIInfo {
	    cli: boolean;
	    path: string;
	    model: string;
	
	    static createFrom(source: any = {}) {
	        return new AIInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.cli = source["cli"];
	        this.path = source["path"];
	        this.model = source["model"];
	    }
	}
	export class AIMsg {
	    role: string;
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new AIMsg(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.role = source["role"];
	        this.text = source["text"];
	    }
	}
	export class AIRequest {
	    kind: string;
	    question: string;
	    context: string;
	    session: string;
	    target: string;
	    history: AIMsg[];
	
	    static createFrom(source: any = {}) {
	        return new AIRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.question = source["question"];
	        this.context = source["context"];
	        this.session = source["session"];
	        this.target = source["target"];
	        this.history = this.convertValues(source["history"], AIMsg);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class BackupInfo {
	    path: string;
	    exported: string;
	    sessions: number;
	    macros: number;
	    hasSecrets: boolean;
	    hasPrefs: boolean;
	
	    static createFrom(source: any = {}) {
	        return new BackupInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.exported = source["exported"];
	        this.sessions = source["sessions"];
	        this.macros = source["macros"];
	        this.hasSecrets = source["hasSecrets"];
	        this.hasPrefs = source["hasPrefs"];
	    }
	}
	export class Check {
	    id: string;
	    name: string;
	    sessions: string[];
	    commands: string;
	    mode: string;
	    times: string;
	    everyMin: number;
	    enabled: boolean;
	    ai: boolean;
	    lastRun?: number;
	    lastStatus?: string;
	    lastRel?: string;
	    lastNote?: string;
	
	    static createFrom(source: any = {}) {
	        return new Check(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.sessions = source["sessions"];
	        this.commands = source["commands"];
	        this.mode = source["mode"];
	        this.times = source["times"];
	        this.everyMin = source["everyMin"];
	        this.enabled = source["enabled"];
	        this.ai = source["ai"];
	        this.lastRun = source["lastRun"];
	        this.lastStatus = source["lastStatus"];
	        this.lastRel = source["lastRel"];
	        this.lastNote = source["lastNote"];
	    }
	}
	export class CheckRun {
	    rel: string;
	    time: number;
	    status: string;
	
	    static createFrom(source: any = {}) {
	        return new CheckRun(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rel = source["rel"];
	        this.time = source["time"];
	        this.status = source["status"];
	    }
	}
	export class RunFile {
	    name: string;
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new RunFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.text = source["text"];
	    }
	}
	export class CheckRunView {
	    report: string;
	    files: RunFile[];
	
	    static createFrom(source: any = {}) {
	        return new CheckRunView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.report = source["report"];
	        this.files = this.convertValues(source["files"], RunFile);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CheckView {
	    id: string;
	    name: string;
	    sessions: string[];
	    commands: string;
	    mode: string;
	    times: string;
	    everyMin: number;
	    enabled: boolean;
	    ai: boolean;
	    lastRun?: number;
	    lastStatus?: string;
	    lastRel?: string;
	    lastNote?: string;
	    running: boolean;
	    next: number;
	
	    static createFrom(source: any = {}) {
	        return new CheckView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.sessions = source["sessions"];
	        this.commands = source["commands"];
	        this.mode = source["mode"];
	        this.times = source["times"];
	        this.everyMin = source["everyMin"];
	        this.enabled = source["enabled"];
	        this.ai = source["ai"];
	        this.lastRun = source["lastRun"];
	        this.lastStatus = source["lastStatus"];
	        this.lastRel = source["lastRel"];
	        this.lastNote = source["lastNote"];
	        this.running = source["running"];
	        this.next = source["next"];
	    }
	}
	export class ClaudeSetup {
	    cliFound: boolean;
	    registered: boolean;
	    skillPath: string;
	    skillKept: boolean;
	    output?: string;
	
	    static createFrom(source: any = {}) {
	        return new ClaudeSetup(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.cliFound = source["cliFound"];
	        this.registered = source["registered"];
	        this.skillPath = source["skillPath"];
	        this.skillKept = source["skillKept"];
	        this.output = source["output"];
	    }
	}
	export class FileEntry {
	    name: string;
	    size: number;
	    mode: string;
	    modTime: number;
	    isDir: boolean;
	    isLink: boolean;
	
	    static createFrom(source: any = {}) {
	        return new FileEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.size = source["size"];
	        this.mode = source["mode"];
	        this.modTime = source["modTime"];
	        this.isDir = source["isDir"];
	        this.isLink = source["isLink"];
	    }
	}
	export class DirListing {
	    path: string;
	    entries: FileEntry[];
	
	    static createFrom(source: any = {}) {
	        return new DirListing(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.entries = this.convertValues(source["entries"], FileEntry);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class ImportResult {
	    added: number;
	    skipped: number;
	
	    static createFrom(source: any = {}) {
	        return new ImportResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.added = source["added"];
	        this.skipped = source["skipped"];
	    }
	}
	export class ImportSource {
	    id: string;
	    name: string;
	    path: string;
	    count: number;
	
	    static createFrom(source: any = {}) {
	        return new ImportSource(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.path = source["path"];
	        this.count = source["count"];
	    }
	}
	export class LogFile {
	    rel: string;
	    session: string;
	    time: number;
	    size: number;
	    active: boolean;
	    summary: boolean;
	
	    static createFrom(source: any = {}) {
	        return new LogFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rel = source["rel"];
	        this.session = source["session"];
	        this.time = source["time"];
	        this.size = source["size"];
	        this.active = source["active"];
	        this.summary = source["summary"];
	    }
	}
	export class LogHit {
	    rel: string;
	    session: string;
	    time: number;
	    line: number;
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new LogHit(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rel = source["rel"];
	        this.session = source["session"];
	        this.time = source["time"];
	        this.line = source["line"];
	        this.text = source["text"];
	    }
	}
	export class LogSettings {
	    auto: boolean;
	    dir: string;
	    stamps: boolean;
	    defaultDir: string;
	
	    static createFrom(source: any = {}) {
	        return new LogSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.auto = source["auto"];
	        this.dir = source["dir"];
	        this.stamps = source["stamps"];
	        this.defaultDir = source["defaultDir"];
	    }
	}
	export class LogText {
	    text: string;
	    truncated: boolean;
	    summary: string;
	
	    static createFrom(source: any = {}) {
	        return new LogText(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.text = source["text"];
	        this.truncated = source["truncated"];
	        this.summary = source["summary"];
	    }
	}
	export class LogonStep {
	    id: string;
	    expect: string;
	    send: string;
	    hide: boolean;
	    secret?: string;
	    hasSecret: boolean;
	
	    static createFrom(source: any = {}) {
	        return new LogonStep(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.expect = source["expect"];
	        this.send = source["send"];
	        this.hide = source["hide"];
	        this.secret = source["secret"];
	        this.hasSecret = source["hasSecret"];
	    }
	}
	export class MCPInfo {
	    enabled: boolean;
	    running: boolean;
	    port: number;
	    url: string;
	    token: string;
	    command: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new MCPInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.running = source["running"];
	        this.port = source["port"];
	        this.url = source["url"];
	        this.token = source["token"];
	        this.command = source["command"];
	        this.error = source["error"];
	    }
	}
	export class Macro {
	    id: string;
	    name: string;
	    body: string;
	    delayMs: number;
	    bar?: boolean;
	    confirm?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Macro(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.body = source["body"];
	        this.delayMs = source["delayMs"];
	        this.bar = source["bar"];
	        this.confirm = source["confirm"];
	    }
	}
	export class RestoreResult {
	    added: number;
	    skipped: number;
	    macros: number;
	    passwords: number;
	    prefs: boolean;
	
	    static createFrom(source: any = {}) {
	        return new RestoreResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.added = source["added"];
	        this.skipped = source["skipped"];
	        this.macros = source["macros"];
	        this.passwords = source["passwords"];
	        this.prefs = source["prefs"];
	    }
	}
	
	export class SerialPortInfo {
	    name: string;
	    label: string;
	
	    static createFrom(source: any = {}) {
	        return new SerialPortInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.label = source["label"];
	    }
	}
	export class Session {
	    id: string;
	    name: string;
	    folder: string;
	    kind: string;
	    host: string;
	    port: number;
	    user: string;
	    keyPath: string;
	    legacy: boolean;
	    hasPassword: boolean;
	    comPort: string;
	    baud: number;
	    dataBits: number;
	    parity: string;
	    stopBits: string;
	    autoLogon: boolean;
	    logonCR: boolean;
	    logonSteps: LogonStep[];
	    log?: string;
	
	    static createFrom(source: any = {}) {
	        return new Session(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.folder = source["folder"];
	        this.kind = source["kind"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.keyPath = source["keyPath"];
	        this.legacy = source["legacy"];
	        this.hasPassword = source["hasPassword"];
	        this.comPort = source["comPort"];
	        this.baud = source["baud"];
	        this.dataBits = source["dataBits"];
	        this.parity = source["parity"];
	        this.stopBits = source["stopBits"];
	        this.autoLogon = source["autoLogon"];
	        this.logonCR = source["logonCR"];
	        this.logonSteps = this.convertValues(source["logonSteps"], LogonStep);
	        this.log = source["log"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TFTPInfo {
	    running: boolean;
	    root: string;
	    port: number;
	    write: boolean;
	    ips: string[];
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new TFTPInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.running = source["running"];
	        this.root = source["root"];
	        this.port = source["port"];
	        this.write = source["write"];
	        this.ips = source["ips"];
	        this.error = source["error"];
	    }
	}
	export class UpdateInfo {
	    available: boolean;
	    current: string;
	    latest: string;
	    page: string;
	    size: number;
	    notes: string;
	    managed?: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.available = source["available"];
	        this.current = source["current"];
	        this.latest = source["latest"];
	        this.page = source["page"];
	        this.size = source["size"];
	        this.notes = source["notes"];
	        this.managed = source["managed"];
	    }
	}

}

