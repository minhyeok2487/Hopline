export namespace main {
	
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
	
	    static createFrom(source: any = {}) {
	        return new Macro(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.body = source["body"];
	        this.delayMs = source["delayMs"];
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

}

