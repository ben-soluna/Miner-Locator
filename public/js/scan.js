// --- IP range parsing, validation, scan control, range builder ---

const MAX_IPS_PER_SCAN = 65536;

function parseOctetToken(token) {
    const text = String(token || '').trim();
    if (!text) return null;

    if (!text.includes('-')) {
        const value = parseInt(text, 10);
        if (!Number.isInteger(value) || value < 0 || value > 255) return null;
        return { start: value, end: value };
    }

    const [startText, endText] = text.split('-').map(v => v.trim());
    if (!startText || !endText) return null;

    const start = parseInt(startText, 10);
    const end = parseInt(endText, 10);
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    if (start < 0 || start > 255 || end < 0 || end > 255 || start > end) return null;

    return { start, end };
}

function expandOctetRanges(part) {
    const octetTokens = String(part || '').split('.').map(v => v.trim());
    if (octetTokens.length !== 4) return { error: `Invalid range entry: ${part}` };

    const octets = octetTokens.map(parseOctetToken);
    if (octets.some(o => !o)) return { error: `Invalid range entry: ${part}` };

    const hasOctetRange = octets.some(o => o.start !== o.end);
    if (!hasOctetRange) {
        const ip = octetTokens.join('.');
        const value = ipToNum(ip);
        if (isNaN(value)) return { error: `Invalid entry: ${part}` };
        return { ranges: [{ start: value, end: value }] };
    }

    const total = octets.reduce((acc, o) => acc * (o.end - o.start + 1), 1);
    if (total > MAX_IPS_PER_SCAN) {
        return { error: `Range too large. Limit is ${MAX_IPS_PER_SCAN} IPs.` };
    }

    const ranges = [];
    for (let a = octets[0].start; a <= octets[0].end; a += 1) {
        for (let b = octets[1].start; b <= octets[1].end; b += 1) {
            for (let c = octets[2].start; c <= octets[2].end; c += 1) {
                const start = ipToNum(`${a}.${b}.${c}.${octets[3].start}`);
                const end = ipToNum(`${a}.${b}.${c}.${octets[3].end}`);
                if (isNaN(start) || isNaN(end) || start > end) {
                    return { error: `Invalid range entry: ${part}` };
                }
                ranges.push({ start, end });
            }
        }
    }

    return { ranges };
}

// Parse input supporting: single IP, dash ranges, comma-separated ranges, CIDR
function parseIPRangeInput(input) {
    if (!input || !input.trim()) return { error: 'Empty range' };
    const parts = input.split(',').map(p => p.trim()).filter(Boolean);
    const ranges = [];

    for (const part of parts) {
        // CIDR
        if (part.includes('/')) {
            const [ip, prefixStr] = part.split('/');
            const prefix = parseInt(prefixStr, 10);
            if (!ip || isNaN(prefix) || prefix < 0 || prefix > 32) return { error: `Invalid CIDR: ${part}` };
            const base = ipToNum(ip);
            const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
            const network = base & mask;
            const broadcast = network | (~mask >>> 0);
            ranges.push({ start: network >>> 0, end: broadcast >>> 0 });
            continue;
        }

        // Full IP-to-IP dash range
        const fullRangeMatch = part.match(/^(\d{1,3}(?:\.\d{1,3}){3})\s*-\s*(\d{1,3}(?:\.\d{1,3}){3})$/);
        if (fullRangeMatch) {
            const start = ipToNum(fullRangeMatch[1]);
            const end = ipToNum(fullRangeMatch[2]);
            if (isNaN(start) || isNaN(end)) return { error: `Invalid range entry: ${part}` };
            if (start > end) return { error: `Start > end in range: ${part}` };
            ranges.push({ start, end });
            continue;
        }

        // Per-octet range shorthand, e.g. 10.31-39.1.1-255
        if (part.includes('-')) {
            const expanded = expandOctetRanges(part);
            if (expanded.error) return expanded;
            ranges.push(...expanded.ranges);
            continue;
        }

        // Single IP
        const v = ipToNum(part);
        if (isNaN(v)) return { error: `Invalid entry: ${part}` };
        ranges.push({ start: v, end: v });
    }

    ranges.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const range of ranges) {
        const prev = merged[merged.length - 1];
        if (!prev || range.start > prev.end + 1) {
            merged.push({ ...range });
            continue;
        }
        prev.end = Math.max(prev.end, range.end);
    }

    return { ranges: merged };
}

function totalIPsInRanges(ranges) {
    return ranges.reduce((sum, r) => sum + (r.end - r.start + 1), 0);
}

function updateRangeInfo() {
    const input = getCurrentRangeExpression();
    const scanBtn = getEl('scanBtn');
    const saveQuickRangeBtn = getEl('saveQuickRangeBtn');
    if (!scanBtn) return;

    if (!input || !input.trim()) {
        scanBtn.disabled = true;
        if (saveQuickRangeBtn) saveQuickRangeBtn.disabled = true;
        return;
    }

    const parsed = parseIPRangeInput(input);
    if (parsed.error) {
        scanBtn.disabled = true;
        if (saveQuickRangeBtn) saveQuickRangeBtn.disabled = true;
        return;
    }

    if (saveQuickRangeBtn) saveQuickRangeBtn.disabled = !quickRangeOverrideActive;

    const count = totalIPsInRanges(parsed.ranges);
    if (count > 65536) {
        scanBtn.disabled = true;
        return;
    }

    scanBtn.disabled = false;
}

function getBuiltRangeExpression() {
    const expression = getEl('directRangeInput').value.trim();
    if (!expression) return { hint: 'Examples: 10.10.1.10-10.10.1.200, 10.10.2.0/24, 10.10.3.14' };
    return { expression };
}

function updateRangeBuilderPreview() {
    const preview = getEl('rangeBuilderPreview');
    const built = getBuiltRangeExpression();

    if (built.hint) {
        preview.innerText = built.hint;
        preview.style.color = '#6b7280';
        return;
    }

    if (built.error) {
        preview.innerText = built.error;
        preview.style.color = 'var(--error-color)';
        return;
    }

    const parsed = parseIPRangeInput(built.expression);
    if (parsed.error) {
        preview.innerText = parsed.error;
        preview.style.color = 'var(--error-color)';
        return;
    }

    const count = totalIPsInRanges(parsed.ranges);
    preview.innerText = `Preview: ${built.expression} (${count} IP${count === 1 ? '' : 's'})`;
    preview.style.color = 'var(--status-color)';
}

function applyRangeBuilderToScanner() {
    const built = getBuiltRangeExpression();
    if (built.error) {
        setStatus(built.error, 'var(--error-color)');
        return;
    }

    const rangeInput = getEl('rangeInput');
    if (rangeInput) rangeInput.value = built.expression;
    updateRangeInfo();
    setStatus('Applied range to scanner input.');
}

// Loads local mock miner rows for frontend-only testing
function loadTestData() {
    resetClearTableButton();
    if (eventSource) { eventSource.close(); eventSource = null; }
    scanInProgress = false;
    const btn = getEl('scanBtn');
    const stopBtn = getEl('stopScanBtn');
    if (!btn) return;
    btn.disabled = false;
    btn.innerText = 'Scan Network';
    if (stopBtn) stopBtn.disabled = true;

    minersData = [
        { ip: '10.10.1.14', status: 'online', hashrate: '134.72', temp: '68',  hostname: 'antminer-01', mac: 'A4:56:02:3C:11:0A', os: 'AntMiner',  minerType: 'Antminer S19 Pro',   cbType: 'BM1362', hashboards: '3/3', pools: 'stratum+tcp://pool.example.com:3333' },
        { ip: '10.10.1.15', status: 'online', hashrate: '110.05', temp: '71',  hostname: 'antminer-02', mac: 'A4:56:02:3C:11:0B', os: 'AntMiner',  minerType: 'Antminer S19',       cbType: 'BM1362', hashboards: '3/3', pools: 'stratum+tcp://pool.example.com:3333' },
        { ip: '10.10.2.8',  status: 'online', hashrate: '198.44', temp: '65',  hostname: 'whatsminer-01', mac: 'B0:19:C6:7A:22:FF', os: 'WhatsMiner', minerType: 'WhatsMiner M50S', cbType: 'SJ346',  hashboards: '4/4', pools: 'stratum+tcp://pool.example.com:3333' },
        { ip: '10.10.2.9',  status: 'online', hashrate: '201.10', temp: '63',  hostname: 'whatsminer-02', mac: 'B0:19:C6:7A:22:FE', os: 'WhatsMiner', minerType: 'WhatsMiner M50S', cbType: 'SJ346',  hashboards: '4/4', pools: 'stratum+tcp://pool.example.com:3333' },
        { ip: '10.10.3.22', status: 'online', hashrate: '84.00',  temp: '74',  hostname: 'antminer-03', mac: 'A4:56:02:3C:22:1C', os: 'AntMiner',  minerType: 'Antminer S17 Pro',   cbType: 'BM1397', hashboards: '3/3', pools: 'stratum+tcp://pool.example.com:3333' },
        { ip: '10.10.3.23', status: 'online', hashrate: '56.33',  temp: '79',  hostname: 'antminer-04', mac: 'A4:56:02:3C:22:1D', os: 'AntMiner',  minerType: 'Antminer T17+',      cbType: 'BM1397', hashboards: '2/3', pools: 'stratum+tcp://pool.example.com:3333' },
        { ip: '10.10.4.5',  status: 'online', hashrate: '335.00', temp: '60',  hostname: 'antminer-05', mac: 'A4:56:02:4D:33:AA', os: 'AntMiner',  minerType: 'Antminer S21 Pro',   cbType: 'BM1368', hashboards: '4/4', pools: 'stratum+tcp://pool.example.com:3333' },
        { ip: '10.10.4.6',  status: 'online', hashrate: '329.88', temp: '61',  hostname: 'antminer-06', mac: 'A4:56:02:4D:33:AB', os: 'AntMiner',  minerType: 'Antminer S21 Pro',   cbType: 'BM1368', hashboards: '4/4', pools: 'stratum+tcp://pool.example.com:3333' },
        { ip: '10.10.5.11', status: 'online', hashrate: '145.00', temp: '70',  hostname: 'avalon-01',   mac: 'C4:7F:51:9B:44:BC', os: 'cgminer',   minerType: 'Avalon 1246',        cbType: 'A3206',  hashboards: '3/3', pools: 'stratum+tcp://pool.example.com:3333' },
        { ip: '10.10.5.12', status: 'online', hashrate: '0.00',   temp: 'N/A', hostname: 'avalon-02',   mac: 'C4:7F:51:9B:44:BD', os: 'cgminer',   minerType: 'Avalon 1246',        cbType: 'A3206',  hashboards: '0/3', pools: 'N/A' },
    ];

    minersData = minersData.map((miner) => normalizeMinerRecord({
        ...miner,
        ipMode: miner.ip.endsWith('.12') ? 'DHCP' : 'Static',
        osVersion: miner.os === 'cgminer' ? '4.11.1' : 'N/A',
        psuInfo: 'N/A',
        fans: '5200/5300/5250/5280',
        fanStatus: '4/4',
        voltage: '12.40',
        frequencyMHz: '540',
        activeHashboards: String(parseInt(String(miner.hashboards).split('/')[0] || '0', 10) || 0)
    }));

    setStatus(`Done. Total: ${minersData.length}`, 'var(--success-color)');
    persistCachedMinerData();
    renderTable();
}

// Stops the active SSE scan stream.
function stopScan() {
    if (!scanInProgress) return;

    scanInProgress = false;
    flushPendingScanUiUpdate(true);
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }

    const scanBtn = getEl('scanBtn');
    const stopBtn = getEl('stopScanBtn');
    if (!scanBtn) return;

    scanBtn.innerText = 'Scan Network';
    updateRangeInfo();
    if (stopBtn) stopBtn.disabled = true;
    setStatus(`Scan stopped. Found ${minersData.length}.`);
}

function renderLiveScanStatus(liveState) {
    if (!liveState || !scanInProgress) return;

    if (liveState.phase === 'probe') {
        if (Number.isFinite(liveState.targetCount)) {
            setStatus(`Phase 0/2 Probe: checking ${liveState.targetCount} hosts for open miner API port...`);
            return;
        }
        setStatus('Phase 0/2 Probe: checking hosts for open miner API port...');
        return;
    }

    if (liveState.phase === 'recovery') {
        const scanned = Number.isFinite(liveState.targetCount) ? liveState.targetCount : 'unknown';
        const rescued = Number.isFinite(liveState.recoveryFoundCount) ? liveState.recoveryFoundCount : 0;
        setStatus(`Phase 1.5/2 Recovery: found ${rescued} additional miners while re-checking ${scanned} missed hosts.`);
        return;
    }

    if (liveState.discoveryComplete) {
        const responsiveText = Number.isFinite(liveState.responsiveTargetCount)
            ? `${liveState.responsiveTargetCount}`
            : 'unknown';
        const enrichmentText = Number.isFinite(liveState.enrichmentTargetCount)
            ? `${liveState.enrichedCount}/${liveState.enrichmentTargetCount}`
            : `${liveState.enrichedCount}`;
        const ipText = liveState.lastEnrichedIp ? ` Latest: ${liveState.lastEnrichedIp}.` : '';
        setStatus(`Discovery complete: ${liveState.foundCount} found from ${responsiveText} responsive hosts. Enrichment: ${enrichmentText}.${ipText}`);
        return;
    }

    if (liveState.phase === 'enrichment') {
        const targetText = Number.isFinite(liveState.enrichmentTargetCount)
            ? `${liveState.enrichedCount}/${liveState.enrichmentTargetCount}`
            : `${liveState.enrichedCount}`;
        const ipText = liveState.lastEnrichedIp ? ` Latest: ${liveState.lastEnrichedIp}.` : '';
        setStatus(`Phase 2/2 Enrichment: ${targetText}. Found: ${liveState.foundCount}.${ipText}`);
        return;
    }

    const discovered = Number.isFinite(liveState.foundCount) ? liveState.foundCount : minersData.length;
    if (Number.isFinite(liveState.targetCount) && Number.isFinite(liveState.responsiveTargetCount)) {
        setStatus(`Phase 1/2 Discovery: found ${discovered} online miners while scanning ${liveState.targetCount} responsive hosts (${liveState.responsiveTargetCount} after probe).`);
        return;
    }

    if (Number.isFinite(liveState.targetCount)) {
        setStatus(`Phase 1/2 Discovery: found ${discovered} online miners while scanning ${liveState.targetCount} hosts.`);
        return;
    }

    setStatus(`Phase 1/2 Discovery: found ${discovered} online miners.`);
}

// Starts backend scan stream and updates rows as events arrive
function startScan() {
    const ipRange = getCurrentRangeExpression();
    resetClearTableButton();
    // Final validation before starting
    const parsed = parseIPRangeInput(ipRange);
    if (parsed.error) {
        setStatus(`Invalid range: ${parsed.error}`, 'var(--error-color)');
        return;
    }
    const btn = getEl('scanBtn');
    const stopBtn = getEl('stopScanBtn');
    if (!btn) return;

    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }

    scanInProgress = true;
    btn.disabled = true;
    btn.innerText = 'Scanning...';
    if (stopBtn) stopBtn.disabled = false;
    minersData = [];
    persistCachedMinerData();
    renderTable();

    const liveState = {
        phase: 'probe',
        targetCount: null,
        responsiveTargetCount: null,
        foundCount: 0,
        recoveryFoundCount: 0,
        enrichedCount: 0,
        enrichmentTargetCount: null,
        discoveryComplete: false,
        lastEnrichedIp: ''
    };

    renderLiveScanStatus(liveState);

    eventSource = new EventSource(`/api/scan?range=${encodeURIComponent(ipRange)}&concurrency=${scanConcurrency}`);

    eventSource.addEventListener('scan-progress', function(event) {
        if (!scanInProgress) return;
        const progress = JSON.parse(event.data);
        if (progress && typeof progress === 'object') {
            if (progress.phase) liveState.phase = String(progress.phase);
            if (Number.isFinite(progress.targetCount)) liveState.targetCount = progress.targetCount;
            if (Number.isFinite(progress.responsiveTargetCount)) liveState.responsiveTargetCount = progress.responsiveTargetCount;
            if (Number.isFinite(progress.foundCount)) liveState.foundCount = progress.foundCount;
            if (Number.isFinite(progress.recoveryFoundCount)) liveState.recoveryFoundCount = progress.recoveryFoundCount;
            if (Number.isFinite(progress.enrichedCount)) liveState.enrichedCount = progress.enrichedCount;
            if (Number.isFinite(progress.enrichmentTargetCount)) liveState.enrichmentTargetCount = progress.enrichmentTargetCount;
            if (progress.lastEnrichedIp) liveState.lastEnrichedIp = String(progress.lastEnrichedIp);
        }
        renderLiveScanStatus(liveState);
    });

    eventSource.addEventListener('discovery-done', function(event) {
        if (!scanInProgress) return;
        const data = JSON.parse(event.data);
        liveState.discoveryComplete = true;
        liveState.phase = 'enrichment';
        if (data && typeof data === 'object') {
            if (Number.isFinite(data.foundCount)) liveState.foundCount = data.foundCount;
            if (Number.isFinite(data.responsiveTargetCount)) liveState.responsiveTargetCount = data.responsiveTargetCount;
            if (Number.isFinite(data.recoveryFoundCount)) liveState.recoveryFoundCount = data.recoveryFoundCount;
            if (Number.isFinite(data.enrichmentTargetCount)) liveState.enrichmentTargetCount = data.enrichmentTargetCount;
        }
        renderLiveScanStatus(liveState);
    });

    eventSource.onmessage = function(event) {
        if (!scanInProgress) return;
        const miner = JSON.parse(event.data);

        minersData.push(normalizeMinerRecord({
            ...miner,
            status: 'online'
        }));

        liveState.foundCount = minersData.length;
        renderLiveScanStatus(liveState);
        scheduleScanUiUpdate();
    };

    eventSource.addEventListener('enriched', function(event) {
        if (!scanInProgress) return;
        const miner = JSON.parse(event.data);
        const normalized = normalizeMinerRecord({
            ...miner,
            status: 'online'
        });

        const existingIndex = minersData.findIndex((item) => item && item.ip === normalized.ip);
        if (existingIndex >= 0) {
            minersData[existingIndex] = normalized;
        } else {
            minersData.push(normalized);
        }

        liveState.phase = 'enrichment';
        liveState.discoveryComplete = true;
        liveState.foundCount = Math.max(liveState.foundCount, minersData.length);
        liveState.enrichedCount += 1;
        liveState.lastEnrichedIp = normalized.ip;
        if (!Number.isFinite(liveState.enrichmentTargetCount)) {
            liveState.enrichmentTargetCount = liveState.foundCount;
        }
        renderLiveScanStatus(liveState);
        scheduleScanUiUpdate();
    });

    eventSource.addEventListener('done', function() {
        if (!scanInProgress) return;
        scanInProgress = false;
        flushPendingScanUiUpdate(true);
        eventSource.close();
        eventSource = null;
        btn.innerText = 'Scan Network';
        updateRangeInfo();
        if (stopBtn) stopBtn.disabled = true;
        setStatus(`Done. Found: ${minersData.length}. Enriched: ${liveState.enrichedCount}.`, 'var(--success-color)');
    });

    eventSource.onerror = function() {
        if (!scanInProgress) return;
        scanInProgress = false;
        flushPendingScanUiUpdate(true);
        eventSource.close();
        eventSource = null;
        btn.innerText = 'Scan Network';
        updateRangeInfo();
        if (stopBtn) stopBtn.disabled = true;
        setStatus('Connection lost.', 'var(--error-color)');
    };
}
