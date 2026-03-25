// --- Low-level utility helpers (depend only on state.js) ---

function getEl(id) {
    if (!Object.prototype.hasOwnProperty.call(domCache, id)) {
        domCache[id] = document.getElementById(id);
    }
    return domCache[id];
}

function readStoredJson(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (_err) {
        return fallback;
    }
}

function writeStoredJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function setStatus(message, color = 'var(--status-color)') {
    const statusEl = getEl('status');
    if (!statusEl) return;
    statusEl.innerText = message;
    statusEl.style.color = color;
}

function normalizeMinerRecord(item) {
    const source = item && typeof item === 'object' ? item : {};
    return {
        ip: String(source.ip || 'N/A'),
        status: source.status || 'online',
        hashrate: source.hashrate || 'N/A',
        hasDebugPayload: Boolean(source.hasDebugPayload || source.data),
        temp: source.temp || 'N/A',
        fans: source.fans || 'N/A',
        fanStatus: source.fanStatus || 'N/A',
        voltage: source.voltage || 'N/A',
        frequencyMHz: source.frequencyMHz || 'N/A',
        hostname: source.hostname || 'N/A',
        mac: source.mac || 'N/A',
        ipMode: source.ipMode || 'N/A',
        os: source.os || 'N/A',
        osVersion: source.osVersion || 'N/A',
        minerType: source.minerType || 'N/A',
        cbType: source.cbType || 'N/A',
        psuInfo: source.psuInfo || 'N/A',
        activeHashboards: source.activeHashboards || 'N/A',
        hashboards: source.hashboards || 'N/A',
        pools: source.pools || 'N/A'
    };
}

function getSelectedSavedRanges() {
    const selectedIds = new Set(selectedSavedRangeIds);
    return savedRanges.filter((range) => selectedIds.has(range.id));
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function ipToNum(ip) {
    const parts = String(ip).trim().split('.');
    if (parts.length !== 4) return NaN;
    let value = 0;

    for (const part of parts) {
        if (!/^\d+$/.test(part)) return NaN;
        const octet = parseInt(part, 10);
        if (octet < 0 || octet > 255) return NaN;
        value = (value << 8) + octet;
    }

    return value >>> 0;
}

function numToIp(num) {
    return [(num >>> 24) & 0xFF, (num >>> 16) & 0xFF, (num >>> 8) & 0xFF, num & 0xFF].join('.');
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
