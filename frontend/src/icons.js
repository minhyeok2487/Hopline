// Small stroke icon set (24x24 grid, currentColor) so the UI doesn't depend on emoji fonts.
const P = {
    terminal: '<path d="M4 17l6-5-6-5"/><path d="M12 19h8"/>',
    serial: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 11h.01M11 11h.01M15 11h.01M9 14h.01M13 14h.01"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    folderOpen: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1"/><path d="M3 9h18l-2 9H5z"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.8-4.2L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.8 4.2L20 16"/><path d="M20 20v-4h-4"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    import: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    multi: '<rect x="3" y="4" width="8" height="7" rx="1"/><rect x="13" y="4" width="8" height="7" rx="1"/><rect x="3" y="13" width="8" height="7" rx="1"/><rect x="13" y="13" width="8" height="7" rx="1"/>',
    record: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
    logs: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    bolt: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>',
    bot: '<rect x="4" y="8" width="16" height="11" rx="2"/><path d="M12 4v4M9 13h.01M15 13h.01M9 16h6"/>',
    chevDown: '<path d="M6 9l6 6 6-6"/>',
    chevRight: '<path d="M9 6l6 6-6 6"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    arrowUp: '<path d="M18 15l-6-6-6 6"/>',
    arrowDown: '<path d="M6 9l6 6 6-6"/>',
    play: '<path d="M7 5l12 7-12 7z"/>',
};

export function icon(name, cls = '') {
    return `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

// Hopline mark: a hop arc between a source node (green) and a destination node (accent).
export function logoMark(cls = '') {
    return `<svg class="i logo ${cls}" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5.5 15a6.5 6.5 0 0 1 13 0" fill="none" stroke="var(--acc)" stroke-width="2.6" stroke-linecap="round"/>
        <circle cx="5.5" cy="15" r="3" fill="var(--ok)"/>
        <circle cx="18.5" cy="15" r="2.4" fill="var(--bg2)" stroke="var(--acc)" stroke-width="1.8"/></svg>`;
}

// Replace <i data-icon="name"></i> placeholders in static HTML ("logo" = the Hopline mark).
export function hydrateIcons(root = document) {
    root.querySelectorAll('i[data-icon]').forEach((el) => {
        el.outerHTML = el.dataset.icon === 'logo' ? logoMark(el.className) : icon(el.dataset.icon, el.className);
    });
}
