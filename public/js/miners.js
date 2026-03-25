// --- Miner data: cache, flagging, clear table ---

function initFlaggedMiners() {
    const parsed = readStoredJson(flaggedMinerStorageKey, []);
    flaggedMinerIps = Array.isArray(parsed)
        ? Array.from(new Set(parsed
            .map(ip => String(ip || '').trim())
            .filter(Boolean)))
        : [];
    // Flagged miner table will render when main table renders.
}

function initCachedMinerData() {
    const parsed = readStoredJson(minerDataStorageKey, null);
    if (!Array.isArray(parsed)) {
        minersData = [];
        minerDataLastUpdatedAt = null;
        return;
    }

    minersData = parsed
        .filter((item) => item && typeof item === 'object' && item.ip)
        .map((item) => normalizeMinerRecord(item));

    const rawUpdatedAt = parseInt(localStorage.getItem(minerDataUpdatedAtStorageKey) || '', 10);
    minerDataLastUpdatedAt = Number.isFinite(rawUpdatedAt) ? rawUpdatedAt : null;
}

function persistCachedMinerData() {
    try {
        minerDataLastUpdatedAt = Date.now();
        writeStoredJson(minerDataStorageKey, minersData);
        localStorage.setItem(minerDataUpdatedAtStorageKey, String(minerDataLastUpdatedAt));
    } catch (_err) {
        // Ignore storage quota/write errors.
    }

    updateMinerCacheStatus();
}

function formatMinerCacheTimestamp(timestampMs) {
    if (!Number.isFinite(timestampMs)) return 'Unknown';
    return new Date(timestampMs).toLocaleString();
}

function updateMinerCacheStatus() {
    const statusEl = getEl('minerCacheStatus');
    const frontTimestampEl = getEl('lastUpdatedDisplay');

    if (!minerDataLastUpdatedAt || !minersData.length) {
        if (statusEl) statusEl.innerText = 'Cache status: No cached miner data.';
        if (frontTimestampEl) frontTimestampEl.innerText = 'Last updated: --';
        return;
    }

    const formatted = formatMinerCacheTimestamp(minerDataLastUpdatedAt);
    if (statusEl) statusEl.innerText = `Cache status: ${minersData.length} miner${minersData.length === 1 ? '' : 's'} cached. Last updated: ${formatted}.`;
    if (frontTimestampEl) frontTimestampEl.innerText = `Last updated: ${formatted}`;
}

function syncClearTableButton() {
    const clearBtn = getEl('clearTableBtn');
    if (!clearBtn) return;

    clearBtn.classList.toggle('pending-clear', pendingClearMinerTable);
    clearBtn.innerText = pendingClearMinerTable ? 'Confirm Clear' : 'Clear Table';
}

function resetClearTableButton() {
    if (!pendingClearMinerTable) return;
    pendingClearMinerTable = false;
    syncClearTableButton();
}

function handleClearTableAction() {
    if (!pendingClearMinerTable) {
        pendingClearMinerTable = true;
        syncClearTableButton();
        return;
    }

    clearMinerTable();
}

function clearMinerTable(showStatusMessage = true) {
    flushPendingScanUiUpdate(true);
    minersData = [];
    minerDataLastUpdatedAt = null;
    pendingFlaggedRemovalIps = [];
    pendingClearMinerTable = false;
    localStorage.removeItem(minerDataStorageKey);
    localStorage.removeItem(minerDataUpdatedAtStorageKey);
    updateMinerCacheStatus();
    syncClearTableButton();
    renderTable();

    if (showStatusMessage) setStatus('Cleared miner table.');
}

function scheduleScanUiUpdate() {
    if (!scanRenderRafId) {
        scanRenderRafId = requestAnimationFrame(() => {
            scanRenderRafId = null;
            renderTable();
        });
    }

    if (cachePersistTimerId) return;
    cachePersistTimerId = setTimeout(() => {
        cachePersistTimerId = null;
        persistCachedMinerData();
    }, cachePersistDebounceMs);
}

function flushPendingScanUiUpdate(forcePersist = false) {
    if (scanRenderRafId) {
        cancelAnimationFrame(scanRenderRafId);
        scanRenderRafId = null;
        renderTable();
    }

    if (cachePersistTimerId) {
        clearTimeout(cachePersistTimerId);
        cachePersistTimerId = null;
        persistCachedMinerData();
        return;
    }

    if (forcePersist) {
        persistCachedMinerData();
    }
}

function clearCachedMinerData() {
    clearMinerTable(false);
    setStatus('Cleared cached miner data.');
}

function persistFlaggedMiners() {
    writeStoredJson(flaggedMinerStorageKey, flaggedMinerIps);
}

function isMinerFlagged(ip) {
    return flaggedMinerIps.includes(String(ip || '').trim());
}

function isFlaggedMinerPendingRemoval(ip) {
    return pendingFlaggedRemovalIps.includes(String(ip || '').trim());
}

function handleFlagButtonAction(ip, viewId) {
    const normalizedIp = String(ip || '').trim();
    if (!normalizedIp) return;

    if (viewId !== 'flaggedMinersView') {
        if (!isMinerFlagged(normalizedIp)) {
            toggleFlaggedMiner(normalizedIp);
        }
        return;
    }

    if (!isMinerFlagged(normalizedIp)) {
        toggleFlaggedMiner(normalizedIp);
        return;
    }

    if (isFlaggedMinerPendingRemoval(normalizedIp)) {
        toggleFlaggedMiner(normalizedIp);
        return;
    }

    pendingFlaggedRemovalIps = [normalizedIp];
    renderTable();
}

function openMinerDebugJson(ip) {
    const normalizedIp = String(ip || '').trim();
    if (!normalizedIp) return;
    const url = `/api/scan/last?ip=${encodeURIComponent(normalizedIp)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
}

function toggleFlaggedMiner(ip) {
    const normalizedIp = String(ip || '').trim();
    if (!normalizedIp) return;

    const currentIndex = flaggedMinerIps.indexOf(normalizedIp);
    if (currentIndex >= 0) {
        flaggedMinerIps.splice(currentIndex, 1);
    } else {
        flaggedMinerIps.unshift(normalizedIp);
    }

    pendingFlaggedRemovalIps = pendingFlaggedRemovalIps.filter((item) => item !== normalizedIp);

    persistFlaggedMiners();
    renderTable();
}
