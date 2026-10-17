// Terminal color schemes. `auto` follows the app theme (dark → Hopline Dark, light → One Light).

export const SCHEMES = {
    'Hopline Dark': {
        background: '#16181d', foreground: '#d7dae0', cursor: '#4fa3ff', cursorAccent: '#16181d', selectionBackground: '#33476a',
        black: '#1e2127', red: '#e06c75', green: '#98c379', yellow: '#e5c07b', blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#d7dae0',
        brightBlack: '#5c6370', brightRed: '#ff7b86', brightGreen: '#b5e890', brightYellow: '#ffd68a', brightBlue: '#7cc2ff', brightMagenta: '#de9bf0', brightCyan: '#7fd6e0', brightWhite: '#ffffff',
    },
    'One Light': {
        background: '#fbfbfc', foreground: '#383a42', cursor: '#526fff', cursorAccent: '#fbfbfc', selectionBackground: '#d7dcef',
        black: '#383a42', red: '#d1453b', green: '#3f8f3e', yellow: '#a86d00', blue: '#3a6fe0', magenta: '#a626a4', cyan: '#0184bc', white: '#9da0a8',
        brightBlack: '#6b6e78', brightRed: '#e45649', brightGreen: '#50a14f', brightYellow: '#c18401', brightBlue: '#4078f2', brightMagenta: '#b84bb6', brightCyan: '#0997b3', brightWhite: '#2b2d33',
    },
    Dracula: {
        background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', cursorAccent: '#282a36', selectionBackground: '#44475a',
        black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
        brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff',
    },
    'Solarized Dark': {
        background: '#002b36', foreground: '#93a1a1', cursor: '#93a1a1', cursorAccent: '#002b36', selectionBackground: '#0b4553',
        black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
        brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#9fb30a', brightYellow: '#d4a31a', brightBlue: '#5aa7e0', brightMagenta: '#6c71c4', brightCyan: '#4cbdb4', brightWhite: '#fdf6e3',
    },
    'Gruvbox Dark': {
        background: '#282828', foreground: '#ebdbb2', cursor: '#ebdbb2', cursorAccent: '#282828', selectionBackground: '#504945',
        black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921', blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984',
        brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26', brightYellow: '#fabd2f', brightBlue: '#83a598', brightMagenta: '#d3869b', brightCyan: '#8ec07c', brightWhite: '#ebdbb2',
    },
    Nord: {
        background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9', cursorAccent: '#2e3440', selectionBackground: '#434c5e',
        black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
        brightBlack: '#4c566a', brightRed: '#d08770', brightGreen: '#b3cf9c', brightYellow: '#f0d399', brightBlue: '#8fb2d4', brightMagenta: '#c39fc0', brightCyan: '#8fbcbb', brightWhite: '#eceff4',
    },
    Campbell: {
        background: '#0c0c0c', foreground: '#cccccc', cursor: '#ffffff', cursorAccent: '#0c0c0c', selectionBackground: '#3a3a3a',
        black: '#0c0c0c', red: '#c50f1f', green: '#13a10e', yellow: '#c19c00', blue: '#0037da', magenta: '#881798', cyan: '#3a96dd', white: '#cccccc',
        brightBlack: '#767676', brightRed: '#e74856', brightGreen: '#16c60c', brightYellow: '#f9f1a5', brightBlue: '#3b78ff', brightMagenta: '#b4009e', brightCyan: '#61d6d6', brightWhite: '#f2f2f2',
    },
};

export const FONTS = ['D2Coding', 'Cascadia Mono', 'Consolas', 'JetBrains Mono', 'Fira Code', 'Courier New'];

export function resolveScheme(name, appIsDark) {
    if (name === 'auto' || !SCHEMES[name]) return SCHEMES[appIsDark ? 'Hopline Dark' : 'One Light'];
    return SCHEMES[name];
}

// Font stack: the chosen face first, then reliable Windows monospace + Korean fallbacks.
export const fontStack = (f) => `"${f}", "Cascadia Mono", Consolas, "Malgun Gothic", monospace`;
