// Version: 0.2.2
const express = require('express');
const net = require('net');
const path = require('path');
const dns = require('dns').promises;
const fs = require('fs');
const http = require('http');
const { execFile } = require('child_process');

const app = express();
const PORT = parseInt(process.env.PORT || '3067', 10) || 3067;
const MAX_IPS_PER_SCAN = 65536;
const API_PORT_CGMINER = 4028;
const API_PORT_ANTMINER_6060 = 6060;
const SCAN_CONCURRENCY = Math.max(1, parseInt(process.env.SCAN_CONCURRENCY || '192', 10) || 192);
const HTTP_FALLBACK_CONCURRENCY = Math.max(1, parseInt(process.env.HTTP_FALLBACK_CONCURRENCY || '6', 10) || 6);
const PER_HOST_COMMAND_CONCURRENCY = Math.max(1, parseInt(process.env.PER_HOST_COMMAND_CONCURRENCY || '2', 10) || 2);
const MINER_API_TIMEOUT_MS = Math.max(200, parseInt(process.env.MINER_API_TIMEOUT_MS || '1200', 10) || 1200);
const PROBE_TIMEOUT_MS = Math.max(100, parseInt(process.env.PROBE_TIMEOUT_MS || '900', 10) || 900);
const DISCOVERY_API_TIMEOUT_MS = Math.max(150, parseInt(process.env.DISCOVERY_API_TIMEOUT_MS || '1800', 10) || 1800);
const ENRICHMENT_API_TIMEOUT_MS = Math.max(200, parseInt(process.env.ENRICHMENT_API_TIMEOUT_MS || String(MINER_API_TIMEOUT_MS), 10) || MINER_API_TIMEOUT_MS);
const MIN_SCAN_CONCURRENCY = 1;
const MAX_SCAN_CONCURRENCY = 2000;
const PROBE_PASS_CONCURRENCY = Math.max(1, parseInt(process.env.PROBE_PASS_CONCURRENCY || '512', 10) || 512);
const BASE_PASS_CONCURRENCY = Math.max(1, parseInt(process.env.BASE_PASS_CONCURRENCY || '128', 10) || 128);
const EARLY_DISCOVERY_CONCURRENCY = Math.max(1, parseInt(process.env.EARLY_DISCOVERY_CONCURRENCY || '24', 10) || 24);
const EARLY_DISCOVERY_MAX_HOSTS = Math.max(0, parseInt(process.env.EARLY_DISCOVERY_MAX_HOSTS || '64', 10) || 64);
const ENRICHMENT_PASS_CONCURRENCY = Math.max(1, parseInt(process.env.ENRICHMENT_PASS_CONCURRENCY || '96', 10) || 96);
const ARP_CACHE_TTL_MS = Math.max(200, parseInt(process.env.ARP_CACHE_TTL_MS || '1500', 10) || 1500);
const AUTO_OPEN_BROWSER = !['0', 'false', 'no', 'off'].includes(String(process.env.AUTO_OPEN_BROWSER || '1').trim().toLowerCase());
const ENABLE_ENRICHMENT_FALLBACK = ['1', 'true', 'yes', 'on'].includes(String(process.env.ENABLE_ENRICHMENT_FALLBACK || '0').trim().toLowerCase());
const ENABLE_ENRICHMENT_PASS = ['1', 'true', 'yes', 'on'].includes(String(process.env.ENABLE_ENRICHMENT_PASS || '0').trim().toLowerCase());
const ENABLE_DISCOVERY_PASS = ['1', 'true', 'yes', 'on'].includes(String(process.env.ENABLE_DISCOVERY_PASS || '1').trim().toLowerCase());
const CAPABILITY_CACHE_TTL_MS = Math.max(1000, parseInt(process.env.CAPABILITY_CACHE_TTL_MS || '600000', 10) || 600000);
const PROTOCOL_CACHE_TTL_MS = Math.max(1000, parseInt(process.env.PROTOCOL_CACHE_TTL_MS || '300000', 10) || 300000);
const ICMP_SWEEP_MODE = String(process.env.ICMP_SWEEP_MODE || 'off').trim().toLowerCase(); // off | prioritize | strict
const ICMP_PING_TIMEOUT_MS = Math.max(100, parseInt(process.env.ICMP_PING_TIMEOUT_MS || '250', 10) || 250);
const ICMP_PING_CONCURRENCY = Math.max(1, parseInt(process.env.ICMP_PING_CONCURRENCY || '2048', 10) || 2048);

let activeHttpFallback = 0;
const httpFallbackQueue = [];
let activeBaseChecks = 0;
const baseCheckQueue = [];
let activeEnrichmentChecks = 0;
const enrichmentCheckQueue = [];
let arpCacheByIp = null;
let arpCacheUpdatedAt = 0;
let lastScanSnapshot = null;
let lastCapabilityCachePurgeAt = 0;
let lastProtocolCachePurgeAt = 0;
let scanActive = false;
const commandCapabilityCacheByIp = new Map();
const apiProtocolCacheByIp = new Map();

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'self'"
    );
    next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '100kb' }));

function ipToInt(ip) {
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

function intToIp(int) {
    return [ (int >>> 24) & 255, (int >>> 16) & 255, (int >>> 8) & 255, int & 255 ].join('.');
}

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

function parsePerOctetRange(part) {
    const octetTokens = String(part || '').split('.').map(v => v.trim());
    if (octetTokens.length !== 4) return { error: `Invalid range: ${part}` };

    const octets = octetTokens.map(parseOctetToken);
    if (octets.some(o => !o)) return { error: `Invalid range: ${part}` };

    const hasOctetRange = octets.some(o => o.start !== o.end);
    if (!hasOctetRange) {
        const single = ipToInt(octetTokens.join('.'));
        if (Number.isNaN(single)) return { error: `Invalid IP: ${part}` };
        return { ranges: [{ start: single, end: single }] };
    }

    const total = octets.reduce((sum, octet) => sum * (octet.end - octet.start + 1), 1);
    if (total > MAX_IPS_PER_SCAN) {
        return { error: `Range too large. Limit is ${MAX_IPS_PER_SCAN} IPs.` };
    }

    const ranges = [];
    for (let a = octets[0].start; a <= octets[0].end; a += 1) {
        for (let b = octets[1].start; b <= octets[1].end; b += 1) {
            for (let c = octets[2].start; c <= octets[2].end; c += 1) {
                const start = (((a << 24) >>> 0) + (b << 16) + (c << 8) + octets[3].start) >>> 0;
                const end = (((a << 24) >>> 0) + (b << 16) + (c << 8) + octets[3].end) >>> 0;
                ranges.push({ start, end });
            }
        }
    }

    return { ranges };
}

function parseRangeExpression(expression) {
    const input = String(expression || '').trim();
    if (!input) return { error: 'Range is required.' };

    const parts = input.split(',').map(part => part.trim()).filter(Boolean);
    if (!parts.length) return { error: 'Range is required.' };

    const ranges = [];

    for (const part of parts) {
        if (part.includes('/')) {
            const [ip, prefixStr] = part.split('/').map(x => x.trim());
            const base = ipToInt(ip);
            const prefix = parseInt(prefixStr, 10);

            if (Number.isNaN(base) || Number.isNaN(prefix) || prefix < 0 || prefix > 32) {
                return { error: `Invalid CIDR: ${part}` };
            }

            const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
            const network = (base & mask) >>> 0;
            const broadcast = (network | (~mask >>> 0)) >>> 0;
            ranges.push({ start: network, end: broadcast });
            continue;
        }

        const fullRangeMatch = part.match(/^(\d{1,3}(?:\.\d{1,3}){3})\s*-\s*(\d{1,3}(?:\.\d{1,3}){3})$/);
        if (fullRangeMatch) {
            const start = ipToInt(fullRangeMatch[1]);
            const end = ipToInt(fullRangeMatch[2]);

            if (Number.isNaN(start) || Number.isNaN(end)) {
                return { error: `Invalid range: ${part}` };
            }
            if (start > end) {
                return { error: `Range start is greater than end: ${part}` };
            }

            ranges.push({ start, end });
            continue;
        }

        if (part.includes('-')) {
            const parsedPerOctet = parsePerOctetRange(part);
            if (parsedPerOctet.error) return parsedPerOctet;
            ranges.push(...parsedPerOctet.ranges);
            continue;
        }

        const single = ipToInt(part);
        if (Number.isNaN(single)) {
            return { error: `Invalid IP: ${part}` };
        }

        ranges.push({ start: single, end: single });
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

    const total = merged.reduce((sum, range) => sum + (range.end - range.start + 1), 0);
    if (total > MAX_IPS_PER_SCAN) {
        return { error: `Range too large. Limit is ${MAX_IPS_PER_SCAN} IPs.` };
    }

    return { ranges: merged, total };
}

function parseScanConcurrency(input) {
    if (input === undefined || input === null || String(input).trim() === '') {
        return SCAN_CONCURRENCY;
    }

    const parsed = parseInt(String(input).trim(), 10);
    if (!Number.isFinite(parsed)) return SCAN_CONCURRENCY;
    return Math.max(MIN_SCAN_CONCURRENCY, Math.min(MAX_SCAN_CONCURRENCY, parsed));
}

function parsePositiveLimit(input, fallback = 200) {
    const parsed = parseInt(String(input || ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function requestMinerCommand(ip, command, timeoutMs = MINER_API_TIMEOUT_MS) {
    return new Promise((resolve) => {
        const client = new net.Socket();
        let data = '';
        let settled = false;

        function finish(result) {
            if (settled) return;
            settled = true;
            resolve(result);
        }

        client.setTimeout(Math.max(100, parseInt(timeoutMs, 10) || MINER_API_TIMEOUT_MS));
        client.setNoDelay(true);

        client.connect(API_PORT_CGMINER, ip, () => {
            client.write(JSON.stringify({ command }));
        });

        client.on('data', (chunk) => {
            data += chunk.toString();
        });

        client.on('end', () => {
            const cleanData = data.replace(/\0/g, '');
            if (!cleanData.trim()) return finish(null);

            try {
                finish(JSON.parse(cleanData));
            } catch (_err) {
                finish(null);
            }
        });

        client.on('timeout', () => {
            client.destroy();
            finish(null);
        });

        client.on('error', () => {
            finish(null);
        });
    });
}

async function requestMinerCommands(ip, commands, options = {}) {
    const list = Array.isArray(commands)
        ? commands.map(c => String(c || '').trim()).filter(Boolean)
        : [];
    if (!list.length) return {};
    const timeoutMs = Math.max(100, parseInt(options.timeoutMs, 10) || MINER_API_TIMEOUT_MS);

    function findCommandPayload(payload, commandName) {
        if (!payload || typeof payload !== 'object') return null;
        const wanted = normKey(commandName);
        for (const [key, value] of Object.entries(payload)) {
            if (normKey(key) === wanted) return value;
        }
        return null;
    }

    function sectionHasError(sectionPayload) {
        if (!sectionPayload || typeof sectionPayload !== 'object') return false;
        const statusRecords = sectionArray(sectionPayload, ['status']);
        if (!statusRecords.length) return false;
        return statusRecords.some((entry) => {
            const status = String((entry && entry.STATUS) || '').trim().toUpperCase();
            const msg = String((entry && entry.Msg) || '').trim().toLowerCase();
            return status === 'E' || status === 'F' || msg.includes('invalid command') || msg.includes('access denied');
        });
    }

    const joined = list.join('+');
    const response = await requestMinerCommand(ip, joined, timeoutMs);
    const out = {};
    const missingOrFailed = [];

    if (response && typeof response === 'object') {
        for (const cmd of list) {
            const sectionPayload = findCommandPayload(response, cmd);
            if (!sectionPayload || sectionHasError(sectionPayload)) {
                missingOrFailed.push(cmd);
                continue;
            }
            out[cmd] = sectionPayload;
        }

        if (missingOrFailed.length === 0) return out;
    } else {
        missingOrFailed.push(...list);
    }

    // Partial fallback: only retry missing/failed commands individually.
    await runWithConcurrency(missingOrFailed, Math.max(1, Math.min(PER_HOST_COMMAND_CONCURRENCY, missingOrFailed.length || 1)), async (cmd) => {
        out[cmd] = await requestMinerCommand(ip, cmd, timeoutMs);
    });
    return out;
}

function purgeExpiredCapabilityCache(now = Date.now()) {
    if (now - lastCapabilityCachePurgeAt < 1000) return;
    lastCapabilityCachePurgeAt = now;
    for (const [ip, entry] of commandCapabilityCacheByIp.entries()) {
        if (!entry || !entry.checkedAt || (now - entry.checkedAt) > CAPABILITY_CACHE_TTL_MS) {
            commandCapabilityCacheByIp.delete(ip);
        }
    }
}

function parseCheckCapability(checkPayload) {
    if (!checkPayload || typeof checkPayload !== 'object') return null;

    const statusRecords = sectionArray(checkPayload, ['status']);
    const hasHardError = statusRecords.some((entry) => {
        const status = String((entry && entry.STATUS) || '').trim().toUpperCase();
        const msg = String((entry && entry.Msg) || '').trim().toLowerCase();
        return status === 'F' || msg.includes('invalid command') || msg.includes('access denied');
    });
    if (hasHardError) return false;

    const checkRecords = sectionArray(checkPayload, ['check']);
    for (const record of checkRecords) {
        const exists = String(pickField(record, ['exists']) || '').trim().toUpperCase();
        const access = String(pickField(record, ['access']) || '').trim().toUpperCase();
        if (exists) {
            if (exists === 'N') return false;
            if (access && access === 'N') return false;
            return true;
        }
    }

    return null;
}

async function getCommandCapabilities(ip, commands, timeoutMs = DISCOVERY_API_TIMEOUT_MS) {
    const wanted = Array.from(new Set((commands || []).map(cmd => String(cmd || '').trim()).filter(Boolean)));
    if (!wanted.length) return {};

    const now = Date.now();
    purgeExpiredCapabilityCache(now);

    const existing = commandCapabilityCacheByIp.get(ip);
    const cachedMap = existing && typeof existing.capabilities === 'object' ? existing.capabilities : {};
    const missing = wanted.filter((cmd) => !Object.prototype.hasOwnProperty.call(cachedMap, cmd));

    const nextMap = { ...cachedMap };
    if (missing.length) {
        await runWithConcurrency(missing, Math.min(4, missing.length), async (cmd) => {
            const payload = await requestMinerCommand(ip, `check|${cmd}`, timeoutMs);
            const capability = parseCheckCapability(payload);
            // null means uncertain; keep command enabled by default.
            nextMap[cmd] = capability !== false;
        });
    }

    commandCapabilityCacheByIp.set(ip, {
        checkedAt: now,
        capabilities: nextMap
    });

    const result = {};
    for (const cmd of wanted) {
        result[cmd] = nextMap[cmd] !== false;
    }
    return result;
}

async function planSupportedCommands(ip, commands, timeoutMs = DISCOVERY_API_TIMEOUT_MS) {
    const wanted = Array.from(new Set((commands || []).map(cmd => String(cmd || '').trim()).filter(Boolean)));
    if (!wanted.length) return [];
    const caps = await getCommandCapabilities(ip, wanted, timeoutMs);
    return wanted.filter((cmd) => caps[cmd] !== false);
}

function probeMinerApiPort(ip, timeoutMs = PROBE_TIMEOUT_MS) {
    return probeTcpPort(ip, API_PORT_CGMINER, timeoutMs);
}

function probeTcpPortDetailed(ip, port, timeoutMs) {
    return new Promise((resolve) => {
        const client = new net.Socket();
        const startedAt = Date.now();
        let settled = false;

        function finish(open, reason) {
            if (settled) return;
            settled = true;
            resolve({
                open: Boolean(open),
                reason: String(reason || (open ? 'connected' : 'unknown')),
                latencyMs: Math.max(0, Date.now() - startedAt)
            });
        }

        client.setTimeout(Math.max(100, parseInt(timeoutMs, 10) || PROBE_TIMEOUT_MS));
        client.connect(port, ip, () => {
            client.destroy();
            finish(true, 'connected');
        });
        client.on('timeout', () => {
            client.destroy();
            finish(false, 'timeout');
        });
        client.on('error', (err) => {
            const code = err && err.code ? String(err.code).toLowerCase() : 'unknown';
            finish(false, `error:${code}`);
        });
        client.on('close', () => {
            finish(false, 'closed');
        });
    });
}

function probeTcpPort(ip, port, timeoutMs) {
    return probeTcpPortDetailed(ip, port, timeoutMs).then((result) => Boolean(result && result.open));
}

function purgeExpiredProtocolCache(now = Date.now()) {
    if (now - lastProtocolCachePurgeAt < 1000) return;
    lastProtocolCachePurgeAt = now;
    for (const [ip, entry] of apiProtocolCacheByIp.entries()) {
        if (!entry || !entry.checkedAt || (now - entry.checkedAt) > PROTOCOL_CACHE_TTL_MS) {
            apiProtocolCacheByIp.delete(ip);
        }
    }
}

async function probeApiProtocol(ip, timeoutMs = PROBE_TIMEOUT_MS) {
    const detail = await probeApiProtocolDetailed(ip, timeoutMs);
    return detail.protocol;
}

async function probeApiProtocolDetailed(ip, timeoutMs = PROBE_TIMEOUT_MS) {
    const now = Date.now();
    purgeExpiredProtocolCache(now);

    const cached = apiProtocolCacheByIp.get(ip);
    if (cached) {
        return {
            protocol: cached.protocol || null,
            cacheHit: true,
            reasonCode: cached.protocol ? `cache-${cached.protocol}` : 'cache-none',
            attempts: []
        };
    }

    const attempts = [];

    const probe4028 = await probeTcpPortDetailed(ip, API_PORT_CGMINER, timeoutMs);
    attempts.push({ protocol: '4028', ...probe4028 });
    if (probe4028.open) {
        apiProtocolCacheByIp.set(ip, { checkedAt: now, protocol: '4028' });
        return {
            protocol: '4028',
            cacheHit: false,
            reasonCode: 'connected-4028',
            attempts
        };
    }

    const probe6060 = await probeTcpPortDetailed(ip, API_PORT_ANTMINER_6060, timeoutMs);
    attempts.push({ protocol: '6060', ...probe6060 });
    if (probe6060.open) {
        apiProtocolCacheByIp.set(ip, { checkedAt: now, protocol: '6060' });
        return {
            protocol: '6060',
            cacheHit: false,
            reasonCode: 'connected-6060',
            attempts
        };
    }

    apiProtocolCacheByIp.set(ip, { checkedAt: now, protocol: null });
    return {
        protocol: null,
        cacheHit: false,
        reasonCode: `no-open-port:${probe4028.reason}|${probe6060.reason}`,
        attempts
    };
}

function request6060Command(ip, command, timeoutMs = DISCOVERY_API_TIMEOUT_MS) {
    return new Promise((resolve) => {
        const pathName = command.startsWith('/') ? command : `/${command}`;
        const req = http.request({
            host: ip,
            port: API_PORT_ANTMINER_6060,
            path: pathName,
            method: 'GET',
            timeout: Math.max(100, parseInt(timeoutMs, 10) || DISCOVERY_API_TIMEOUT_MS),
            headers: {
                'Connection': 'close'
            }
        }, (res) => {
            if (!res || res.statusCode >= 500) {
                res?.resume?.();
                return resolve(null);
            }

            let body = '';
            res.on('data', (chunk) => {
                body += chunk.toString();
                if (body.length > 32768) {
                    req.destroy();
                    resolve(null);
                }
            });
            res.on('end', () => {
                const trimmed = String(body || '').trim();
                if (!trimmed) return resolve(null);

                try {
                    resolve(JSON.parse(trimmed));
                } catch (_err) {
                    resolve(trimmed);
                }
            });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve(null);
        });
        req.on('error', () => resolve(null));
        req.end();
    });
}

function asTrimmedString(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
    try {
        return JSON.stringify(value).trim();
    } catch (_err) {
        return '';
    }
}

function parse6060RateToTHs(value) {
    const text = asTrimmedString(value).toLowerCase();
    if (!text) return 'N/A';

    const numberMatch = text.match(/(-?\d+(?:\.\d+)?)/);
    if (!numberMatch) return 'N/A';

    const raw = parseFloat(numberMatch[1]);
    if (!Number.isFinite(raw) || raw < 0) return 'N/A';

    if (text.includes('gh')) return (raw / 1000).toFixed(2);
    if (text.includes('mh')) return (raw / 1000000).toFixed(2);
    if (text.includes('kh')) return (raw / 1000000000).toFixed(2);
    if (text.includes('th')) return raw.toFixed(2);

    // Most 6060 endpoints report hashrate in GH/s unless explicitly stated.
    return (raw / 1000).toFixed(2);
}

function parse6060Voltage(value) {
    const text = asTrimmedString(value).toLowerCase();
    if (!text) return 'N/A';

    const feedbackMatch = text.match(/feedback\s*[:=]\s*(-?\d+(?:\.\d+)?)/);
    if (feedbackMatch) {
        const num = parseFloat(feedbackMatch[1]);
        if (Number.isFinite(num) && num >= 0) return num.toFixed(2);
    }

    const voltageMatch = text.match(/voltage\s*[:=]\s*(-?\d+(?:\.\d+)?)/);
    if (voltageMatch) {
        const num = parseFloat(voltageMatch[1]);
        if (Number.isFinite(num) && num >= 0) {
            // Some 6060 firmware reports millivolts as integer (e.g. 1300).
            return num > 200 ? (num / 100).toFixed(2) : num.toFixed(2);
        }
    }

    return 'N/A';
}

function parse6060BoardCount(value) {
    const text = asTrimmedString(value).toLowerCase();
    if (!text) return null;

    const countMatch = text.match(/(\d+)\s*(?:board|chain|hashboard|asc)/);
    if (countMatch) {
        const count = parseInt(countMatch[1], 10);
        if (Number.isFinite(count) && count >= 0) return count;
    }

    return null;
}

function buildProfileFrom6060Payload(ip, payloads, baseProfile = null) {
    const productName = asTrimmedString(payloads.productName || payloads.productname || payloads.product);
    const boardType = asTrimmedString(payloads.board_type || payloads.boardType);
    const minerStatus = asTrimmedString(payloads.miner_status || payloads.minerStatus);
    const rate = payloads.rate;
    const idealRate = payloads.ideal_rate;
    const maxRate = payloads.max_rate;
    const readvol = payloads.readvol;

    const hashrate = parse6060RateToTHs(rate || idealRate || maxRate);
    const voltage = parse6060Voltage(readvol);
    const activeBoards = parse6060BoardCount(boardType || minerStatus);
    const activeHashboards = activeBoards === null ? 'N/A' : String(activeBoards);
    const hashboards = activeBoards === null ? 'N/A' : `${activeBoards}/${activeBoards}`;

    const hasAnySignal = Boolean(
        productName || boardType || minerStatus ||
        hashrate !== 'N/A' || voltage !== 'N/A'
    );
    if (!hasAnySignal) return { ip, status: 'offline' };

    const profile = {
        ip,
        status: 'online',
        hostname: baseProfile?.hostname || 'N/A',
        mac: baseProfile?.mac || 'N/A',
        osType: baseProfile?.osType || 'N/A',
        osVersion: baseProfile?.osVersion || 'N/A',
        minerType: productName || baseProfile?.minerType || 'N/A',
        controlBoard: boardType || baseProfile?.controlBoard || 'N/A',
        pools: baseProfile?.pools || 'N/A',
        temperatureC: baseProfile?.temperatureC || 'N/A',
        fans: baseProfile?.fans || 'N/A',
        fanStatus: baseProfile?.fanStatus || 'N/A',
        voltage: voltage !== 'N/A' ? voltage : (baseProfile?.voltage || 'N/A'),
        frequencyMHz: baseProfile?.frequencyMHz || 'N/A',
        psuInfo: baseProfile?.psuInfo || 'N/A',
        ipMode: baseProfile?.ipMode || 'N/A',
        hashrateTHs: hashrate !== 'N/A' ? hashrate : (baseProfile?.hashrateTHs || 'N/A'),
        hashboards: hashboards !== 'N/A' ? hashboards : (baseProfile?.hashboards || 'N/A'),
        activeHashboards: activeHashboards !== 'N/A' ? activeHashboards : (baseProfile?.activeHashboards || 'N/A'),
        os: baseProfile?.os || baseProfile?.osType || 'N/A',
        cbType: boardType || baseProfile?.cbType || baseProfile?.controlBoard || 'N/A',
        temp: baseProfile?.temp || baseProfile?.temperatureC || 'N/A',
        hashrate: hashrate !== 'N/A' ? hashrate : (baseProfile?.hashrate || baseProfile?.hashrateTHs || 'N/A'),
        apiProtocol: '6060',
        data: {
            source: '6060',
            miner_status: payloads.miner_status || null,
            productName: payloads.productName || null,
            board_type: payloads.board_type || null,
            rate: payloads.rate || null,
            ideal_rate: payloads.ideal_rate || null,
            max_rate: payloads.max_rate || null,
            readvol: payloads.readvol || null,
            warning: payloads.warning || null,
            get_sn: payloads.get_sn || null,
            summary: baseProfile?.data?.summary || null,
            stats: baseProfile?.data?.stats || null,
            pools: baseProfile?.data?.pools || null,
            devs: baseProfile?.data?.devs || null,
            version: baseProfile?.data?.version || null
        }
    };

    profile.columnProvenance = build6060ColumnProvenance(profile.data, profile);

    return profile;
}

async function checkMinerBaseVia6060(ip, timeoutMs = DISCOVERY_API_TIMEOUT_MS) {
    const [rate, productName, boardType, minerStatus] = await Promise.all([
        request6060Command(ip, '/rate', timeoutMs),
        request6060Command(ip, '/productName', timeoutMs),
        request6060Command(ip, '/board_type', timeoutMs),
        request6060Command(ip, '/miner_status', timeoutMs)
    ]);

    return buildProfileFrom6060Payload(ip, {
        rate,
        productName,
        board_type: boardType,
        miner_status: minerStatus
    });
}

async function enrichMinerVia6060(baseProfile, timeoutMs = ENRICHMENT_API_TIMEOUT_MS) {
    const ip = baseProfile.ip;
    const [readvol, warning, idealRate, maxRate, serialNumber] = await Promise.all([
        request6060Command(ip, '/readvol', timeoutMs),
        request6060Command(ip, '/warning', timeoutMs),
        request6060Command(ip, '/ideal_rate', timeoutMs),
        request6060Command(ip, '/max_rate', timeoutMs),
        request6060Command(ip, '/get_sn', timeoutMs)
    ]);

    return buildProfileFrom6060Payload(ip, {
        rate: baseProfile?.data?.rate,
        productName: baseProfile?.data?.productName,
        board_type: baseProfile?.data?.board_type,
        miner_status: baseProfile?.data?.miner_status,
        readvol,
        warning,
        ideal_rate: idealRate,
        max_rate: maxRate,
        get_sn: serialNumber
    }, baseProfile);
}

function withTimeout(promise, ms, fallback = null) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(fallback), ms);
        promise
            .then((value) => {
                clearTimeout(timer);
                resolve(value);
            })
            .catch(() => {
                clearTimeout(timer);
                resolve(fallback);
            });
    });
}

function normalizeIcmpSweepMode() {
    if (ICMP_SWEEP_MODE === 'strict') return 'strict';
    if (ICMP_SWEEP_MODE === 'prioritize' || ICMP_SWEEP_MODE === 'priority') return 'prioritize';
    return 'off';
}

function pingHostOnce(ip, timeoutMs = ICMP_PING_TIMEOUT_MS) {
    return new Promise((resolve) => {
        const waitSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
        execFile(
            'ping',
            ['-n', '-c', '1', '-W', String(waitSeconds), ip],
            { timeout: timeoutMs + 200 },
            (err) => {
                if (!err) return resolve({ ok: true, reason: 'reply' });
                if (err && err.code === 'ENOENT') return resolve({ ok: false, reason: 'ping-unavailable' });
                if (err && err.killed) return resolve({ ok: false, reason: 'timeout' });
                return resolve({ ok: false, reason: 'no-reply' });
            }
        );
    });
}

async function readLinuxArpCacheByIp() {
    const now = Date.now();
    if (arpCacheByIp && (now - arpCacheUpdatedAt) <= ARP_CACHE_TTL_MS) {
        return arpCacheByIp;
    }

    try {
        const arp = await fs.promises.readFile('/proc/net/arp', 'utf8');
        const map = new Map();
        for (const line of arp.split('\n').slice(1)) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 4) continue;
            const ip = String(parts[0] || '').trim();
            const mac = String(parts[3] || '').trim().toUpperCase();
            if (!ip || !mac || mac === '00:00:00:00:00:00') continue;
            map.set(ip, mac);
        }

        arpCacheByIp = map;
        arpCacheUpdatedAt = now;
        return arpCacheByIp;
    } catch (_err) {
        return null;
    }
}

async function readMacFromSystem(ip) {
    // Windows: use arp -a
    if (process.platform === 'win32') {
        return new Promise((resolve) => {
            execFile('arp', ['-a', ip], { timeout: 1000 }, (err, stdout) => {
                if (err || !stdout) return resolve('N/A');
                const match = String(stdout).match(/([0-9a-f]{2}[-:][0-9a-f]{2}[-:][0-9a-f]{2}[-:][0-9a-f]{2}[-:][0-9a-f]{2}[-:][0-9a-f]{2})/i);
                resolve(match ? match[1].replace(/-/g, ':').toUpperCase() : 'N/A');
            });
        });
    }

    // Linux: read directly from kernel ARP table — no subprocess needed
    const arpMap = await readLinuxArpCacheByIp();
    if (arpMap && arpMap.has(ip)) {
        return arpMap.get(ip);
    }

    // Fallback: ip neigh (handles container environments where /proc/net/arp may be absent)
    return new Promise((resolve) => {
        execFile('ip', ['neigh', 'show', ip], { timeout: 250 }, (err, stdout) => {
            if (err || !stdout) return resolve('N/A');
            const match = String(stdout).match(/lladdr\s+([0-9a-f:]{17})/i);
            resolve(match ? match[1].toUpperCase() : 'N/A');
        });
    });
}

function runBaseCheckTask(task) {
    return new Promise((resolve) => {
        const execute = async () => {
            activeBaseChecks += 1;
            try {
                resolve(await task());
            } catch (_err) {
                resolve(null);
            } finally {
                activeBaseChecks -= 1;
                const next = baseCheckQueue.shift();
                if (next) next();
            }
        };

        if (activeBaseChecks < BASE_PASS_CONCURRENCY) {
            execute();
        } else {
            baseCheckQueue.push(execute);
        }
    });
}

function runEnrichmentTask(task) {
    return new Promise((resolve) => {
        const execute = async () => {
            activeEnrichmentChecks += 1;
            try {
                resolve(await task());
            } catch (_err) {
                resolve(null);
            } finally {
                activeEnrichmentChecks -= 1;
                const next = enrichmentCheckQueue.shift();
                if (next) next();
            }
        };

        if (activeEnrichmentChecks < ENRICHMENT_PASS_CONCURRENCY) {
            execute();
        } else {
            enrichmentCheckQueue.push(execute);
        }
    });
}

function runHttpFallbackTask(task) {
    return new Promise((resolve) => {
        const execute = async () => {
            activeHttpFallback += 1;
            try {
                const value = await task();
                resolve(value);
            } catch (_err) {
                resolve(null);
            } finally {
                activeHttpFallback -= 1;
                const next = httpFallbackQueue.shift();
                if (next) next();
            }
        };

        if (activeHttpFallback < HTTP_FALLBACK_CONCURRENCY) {
            execute();
        } else {
            httpFallbackQueue.push(execute);
        }
    });
}

function requestHttpJson(ip, pathName) {
    return new Promise((resolve) => {
        const req = http.request({
            host: ip,
            port: 80,
            path: pathName,
            method: 'GET',
            timeout: 400,
            headers: {
                'Accept': 'application/json,text/plain,*/*',
                'Connection': 'close'
            }
        }, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                return resolve(null);
            }

            let body = '';
            res.on('data', (chunk) => {
                body += chunk.toString();
                if (body.length > 16384) {
                    req.destroy();
                    resolve(null);
                }
            });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (_err) {
                    resolve(null);
                }
            });
        });

        req.on('timeout', () => {
            req.destroy();
            resolve(null);
        });
        req.on('error', () => resolve(null));
        req.end();
    });
}

async function fetchHttpMinerHints(ip) {
    return runHttpFallbackTask(async () => {
        const endpointCandidates = [
            '/cgi-bin/get_system_info.cgi',
            '/cgi-bin/get_network_info.cgi',
            '/cgi-bin/get_miner_conf.cgi'
        ];

        for (const endpoint of endpointCandidates) {
            const payload = await requestHttpJson(ip, endpoint);
            if (payload && typeof payload === 'object') return payload;
        }

        return null;
    });
}

async function reverseDnsHostname(ip) {
    const names = await withTimeout(dns.reverse(ip), 350, []);
    if (Array.isArray(names) && names.length > 0) return String(names[0]);
    return 'N/A';
}

function normKey(input) {
    return String(input || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function pickField(obj, candidates) {
    if (!obj || typeof obj !== 'object') return undefined;
    const wanted = new Set(candidates.map(normKey));

    for (const [key, value] of Object.entries(obj)) {
        if (wanted.has(normKey(key))) return value;
    }

    return undefined;
}

function listNumbersByHints(obj, hints, options = {}) {
    if (!obj || typeof obj !== 'object') return [];

    const {
        min = Number.NEGATIVE_INFINITY,
        max = Number.POSITIVE_INFINITY,
        exclude = []
    } = options;
    const excludeHints = exclude.map(normKey);
    const hintKeys = hints.map(normKey);
    const values = [];

    for (const [key, value] of Object.entries(obj)) {
        const nk = normKey(key);
        const included = hintKeys.some(h => nk.includes(h));
        const blocked = excludeHints.some(h => nk.includes(h));
        if (!included || blocked) continue;

        const num = parseFloat(String(value));
        if (Number.isFinite(num) && num >= min && num <= max) values.push(num);
    }

    return values;
}

function formatMaybeNumber(value, digits = 2) {
    const num = parseFloat(String(value));
    if (!Number.isFinite(num)) return 'N/A';
    return num.toFixed(digits);
}

function firstRecord(payload, sectionNames) {
    if (!payload || typeof payload !== 'object') return null;

    const wanted = new Set(sectionNames.map(normKey));
    for (const [section, value] of Object.entries(payload)) {
        if (!wanted.has(normKey(section))) continue;
        if (Array.isArray(value) && value.length > 0 && value[0] && typeof value[0] === 'object') {
            return value[0];
        }
    }

    return null;
}

function sectionArray(payload, sectionNames) {
    const wanted = new Set(sectionNames.map(normKey));

    // Some miner responses are wrapped as an array of envelope objects, e.g.
    // [ { STATS: [...], STATUS: [...], id: 1 } ].
    if (Array.isArray(payload)) {
        for (const item of payload) {
            const found = sectionArray(item, sectionNames);
            if (found.length) return found;
        }
        return [];
    }

    if (!payload || typeof payload !== 'object') return [];

    for (const [section, value] of Object.entries(payload)) {
        if (!wanted.has(normKey(section))) continue;
        if (Array.isArray(value)) return value.filter(item => item && typeof item === 'object');
    }

    // Fallback for nested envelopes.
    for (const nested of Object.values(payload)) {
        const found = sectionArray(nested, sectionNames);
        if (found.length) return found;
    }

    return [];
}

function collectObjectRecords(value, bucket = []) {
    if (Array.isArray(value)) {
        for (const item of value) collectObjectRecords(item, bucket);
        return bucket;
    }

    if (!value || typeof value !== 'object') return bucket;

    bucket.push(value);
    for (const nested of Object.values(value)) {
        collectObjectRecords(nested, bucket);
    }
    return bucket;
}

function pickFieldFromRecords(records, candidates) {
    for (const record of records) {
        const value = pickField(record, candidates);
        if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return undefined;
}

function parseMacAddress(...records) {
    const macRegex = /([0-9a-f]{2}[:-]){5}[0-9a-f]{2}/i;

    for (const record of records) {
        if (!record || typeof record !== 'object') continue;

        const fromField = pickField(record, ['mac', 'macaddress', 'ethmac']);
        if (fromField && macRegex.test(String(fromField))) return String(fromField).toUpperCase();

        for (const value of Object.values(record)) {
            const match = String(value || '').match(macRegex);
            if (match) return match[0].toUpperCase();
        }
    }

    return 'N/A';
}

function deriveMacFromConfig(configRecords) {
    if (!Array.isArray(configRecords) || configRecords.length < 1) return 'N/A';

    const macRaw = pickField(configRecords[0], ['macaddr']);
    const match = String(macRaw || '').match(/([0-9a-f]{2}[:-]){5}[0-9a-f]{2}/i);
    if (!match) return 'N/A';
    return String(match[0]).toUpperCase();
}

function derivePoolString(poolsPayload) {
    const pools = sectionArray(poolsPayload, ['pools']);
    const urls = pools
        .map(pool => pickField(pool, ['url', 'stratum active', 'stratumurl']))
        .filter(Boolean)
        .map(value => String(value).trim())
        .filter(Boolean);

    if (!urls.length) return 'N/A';
    return Array.from(new Set(urls)).join(', ');
}

function deriveHashrateTHs(summaryRecords) {
    const ghs5s = pickFieldFromRecords(summaryRecords, ['ghs5s', 'ghs 5s']);
    const ghsAvg = pickFieldFromRecords(summaryRecords, ['ghsav', 'ghs av']);

    if (ghs5s !== undefined) {
        const num = parseFloat(String(ghs5s));
        if (Number.isFinite(num)) return (num / 1000).toFixed(2);
    }

    if (ghsAvg !== undefined) {
        const num = parseFloat(String(ghsAvg));
        if (Number.isFinite(num)) return (num / 1000).toFixed(2);
    }

    return 'N/A';
}

function isMissing(value) {
    const text = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
    return !text || text === 'n/a' || text === 'na' || text === 'unknown';
}

function hasCommandPayload(payload) {
    if (payload === undefined || payload === null) return false;
    if (Array.isArray(payload)) return payload.length > 0;
    if (typeof payload === 'object') return Object.keys(payload).length > 0;
    return String(payload).trim().length > 0;
}

function hasSourceCommandData(payloads, commandName) {
    if (!payloads || typeof payloads !== 'object') return false;

    const key = String(commandName || '').trim();
    if (!key) return false;

    if (hasCommandPayload(payloads[key])) return true;

    if (key.startsWith('/')) {
        const normalized = key.slice(1).trim();
        if (normalized && hasCommandPayload(payloads[normalized])) return true;
    }

    return false;
}

function makeColumnSource(source, commands) {
    return {
        source: String(source || 'unknown'),
        commands: Array.isArray(commands) ? commands : []
    };
}

function build4028ColumnProvenance(payloads, profile) {
    const hasSummary = hasCommandPayload(payloads.summary);
    const hasStats = hasCommandPayload(payloads.stats);
    const hasPools = hasCommandPayload(payloads.pools);
    const hasVersion = hasCommandPayload(payloads.version);
    const hasDevs = hasCommandPayload(payloads.devs);
    const hasConfig = hasCommandPayload(payloads.config);
    const hasDevdetails = hasCommandPayload(payloads.devdetails);

    return {
        ip: makeColumnSource('scan-target', []),
        status: makeColumnSource('scan-state', []),
        hostname: makeColumnSource(!isMissing(profile.hostname) && hasStats ? 'stats' : 'missing', ['stats']),
        mac: makeColumnSource(!isMissing(profile.mac) && hasConfig ? 'config' : 'missing', ['config']),
        ipMode: makeColumnSource(!isMissing(profile.ipMode) && hasConfig ? 'config' : 'missing', ['config']),
        os: makeColumnSource(!isMissing(profile.os) && hasVersion ? 'version' : 'missing', ['version']),
        osVersion: makeColumnSource(!isMissing(profile.osVersion) && hasVersion ? 'version' : 'missing', ['version']),
        minerType: makeColumnSource(!isMissing(profile.minerType) && hasStats ? 'stats' : 'missing', ['stats']),
        cbType: makeColumnSource(!isMissing(profile.cbType) && hasConfig ? 'config' : 'missing', ['config']),
        psuInfo: makeColumnSource(!isMissing(profile.psuInfo) && hasConfig ? 'config' : 'missing', ['config']),
        temp: makeColumnSource(!isMissing(profile.temp) && hasStats ? 'stats' : 'missing', ['stats']),
        fans: makeColumnSource(!isMissing(profile.fans) && hasStats ? 'stats' : 'missing', ['stats']),
        fanStatus: makeColumnSource(!isMissing(profile.fanStatus) && hasStats ? 'stats' : 'missing', ['stats']),
        voltage: makeColumnSource(!isMissing(profile.voltage) && hasDevdetails ? 'devdetails' : 'missing', ['devdetails']),
        frequencyMHz: makeColumnSource(!isMissing(profile.frequencyMHz) && hasStats ? 'stats' : 'missing', ['stats']),
        hashrate: makeColumnSource(!isMissing(profile.hashrate) && hasSummary ? 'summary' : 'missing', ['summary']),
        activeHashboards: makeColumnSource(!isMissing(profile.activeHashboards) && (hasStats || hasDevs) ? 'stats/devs' : 'missing', ['stats', 'devs']),
        hashboards: makeColumnSource(!isMissing(profile.hashboards) && (hasStats || hasDevs) ? 'stats/devs' : 'missing', ['stats', 'devs']),
        pools: makeColumnSource(!isMissing(profile.pools) && hasPools ? 'pools' : 'missing', ['pools'])
    };
}

function build6060ColumnProvenance(payloads, profile) {
    const hasRate = hasCommandPayload(payloads.rate) || hasCommandPayload(payloads.ideal_rate) || hasCommandPayload(payloads.max_rate);
    const hasBoardType = hasCommandPayload(payloads.board_type);
    const hasProductName = hasCommandPayload(payloads.productName);
    const hasReadvol = hasCommandPayload(payloads.readvol);
    const hasSummary = hasCommandPayload(payloads.summary);
    const hasStats = hasCommandPayload(payloads.stats);
    const hasPools = hasCommandPayload(payloads.pools);
    const hasVersion = hasCommandPayload(payloads.version);

    return {
        ip: makeColumnSource('scan-target', []),
        status: makeColumnSource('scan-state', []),
        hostname: makeColumnSource(!isMissing(profile.hostname) && hasStats ? 'stats' : 'missing', ['stats']),
        mac: makeColumnSource('missing', ['config']),
        ipMode: makeColumnSource('missing', ['config']),
        os: makeColumnSource(!isMissing(profile.os) && hasVersion ? 'version' : 'missing', ['version']),
        osVersion: makeColumnSource(!isMissing(profile.osVersion) && hasVersion ? 'version' : 'missing', ['version']),
        minerType: makeColumnSource(!isMissing(profile.minerType) && hasProductName ? '6060.productName' : 'missing', ['/productName']),
        cbType: makeColumnSource(!isMissing(profile.cbType) && hasBoardType ? '6060.board_type' : 'missing', ['/board_type']),
        psuInfo: makeColumnSource('missing', ['config']),
        temp: makeColumnSource(!isMissing(profile.temp) && hasStats ? 'stats' : 'missing', ['stats']),
        fans: makeColumnSource(!isMissing(profile.fans) && hasStats ? 'stats' : 'missing', ['stats']),
        fanStatus: makeColumnSource(!isMissing(profile.fanStatus) && hasStats ? 'stats' : 'missing', ['stats']),
        voltage: makeColumnSource(!isMissing(profile.voltage) && hasReadvol ? '6060.readvol' : 'missing', ['/readvol']),
        frequencyMHz: makeColumnSource(!isMissing(profile.frequencyMHz) && hasStats ? 'stats' : 'missing', ['stats']),
        hashrate: makeColumnSource(!isMissing(profile.hashrate) && hasRate ? '6060.rate' : 'missing', ['/rate', '/ideal_rate', '/max_rate']),
        activeHashboards: makeColumnSource(!isMissing(profile.activeHashboards) && hasBoardType ? '6060.board_type' : 'missing', ['/board_type']),
        hashboards: makeColumnSource(!isMissing(profile.hashboards) && hasBoardType ? '6060.board_type' : 'missing', ['/board_type']),
        pools: makeColumnSource(!isMissing(profile.pools) && hasPools ? 'pools' : 'missing', ['pools'])
    };
}

const COLUMN_VALIDATION_SPECS = [
    { id: 'ip', required: true },
    { id: 'status', required: true },
    { id: 'mac', required: false },
    { id: 'ipMode', required: false },
    { id: 'os', required: false },
    { id: 'osVersion', required: false },
    { id: 'minerType', required: true },
    { id: 'cbType', required: false },
    { id: 'psuInfo', required: false },
    { id: 'temp', required: true },
    { id: 'fans', required: false },
    { id: 'fanStatus', required: false },
    { id: 'voltage', required: false },
    { id: 'frequencyMHz', required: false },
    { id: 'hashrate', required: true },
    { id: 'activeHashboards', required: false },
    { id: 'hashboards', required: true },
    { id: 'pools', required: true }
];

function validateColumnValue(columnId, value) {
    if (columnId === 'status') {
        return String(value || '').toLowerCase() === 'online'
            ? { valid: true }
            : { valid: false, reason: 'Expected online status.' };
    }

    if (isMissing(value)) {
        return { valid: false, reason: 'Value is missing.' };
    }

    const raw = String(value || '').trim();

    if (columnId === 'ip') {
        return Number.isNaN(ipToInt(raw))
            ? { valid: false, reason: 'Invalid IPv4 format.' }
            : { valid: true };
    }

    if (columnId === 'mac') {
        return /([0-9a-f]{2}[:-]){5}[0-9a-f]{2}/i.test(raw)
            ? { valid: true }
            : { valid: false, reason: 'Invalid MAC format.' };
    }

    if (columnId === 'ipMode') {
        const normalized = raw.toLowerCase();
        return normalized === 'dhcp' || normalized === 'static'
            ? { valid: true }
            : { valid: false, reason: 'Expected DHCP or Static.' };
    }

    if (columnId === 'fanStatus') {
        const match = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
        if (!match) return { valid: false, reason: 'Expected fan status in running/total format.' };
        const running = parseInt(match[1], 10);
        const total = parseInt(match[2], 10);
        if (!Number.isFinite(running) || !Number.isFinite(total) || running > total) {
            return { valid: false, reason: 'Invalid running/total fan values.' };
        }
        return { valid: true };
    }

    if (columnId === 'hashboards') {
        const match = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
        if (!match) return { valid: false, reason: 'Expected hashboards in active/total format.' };
        const active = parseInt(match[1], 10);
        const total = parseInt(match[2], 10);
        if (!Number.isFinite(active) || !Number.isFinite(total) || active > total) {
            return { valid: false, reason: 'Invalid active/total hashboard values.' };
        }
        return { valid: true };
    }

    if (columnId === 'activeHashboards') {
        const num = parseInt(raw, 10);
        return Number.isFinite(num) && num >= 0
            ? { valid: true }
            : { valid: false, reason: 'Expected non-negative integer.' };
    }

    if (columnId === 'temp') {
        const num = parseFloat(raw);
        return Number.isFinite(num) && num >= -20 && num <= 200
            ? { valid: true }
            : { valid: false, reason: 'Temperature outside expected range (-20 to 200 C).' };
    }

    if (columnId === 'voltage') {
        const num = parseFloat(raw);
        return Number.isFinite(num) && num >= 0 && num <= 2000
            ? { valid: true }
            : { valid: false, reason: 'Voltage outside expected range (0 to 2000).' };
    }

    if (columnId === 'frequencyMHz') {
        const num = parseFloat(raw);
        return Number.isFinite(num) && num >= 10 && num <= 20000
            ? { valid: true }
            : { valid: false, reason: 'Frequency outside expected range (10 to 20000 MHz).' };
    }

    if (columnId === 'hashrate') {
        const num = parseFloat(raw);
        return Number.isFinite(num) && num >= 0
            ? { valid: true }
            : { valid: false, reason: 'Hashrate is not a valid number.' };
    }

    return { valid: true };
}

function buildMinerColumnValidation(miner) {
    const provenance = miner && typeof miner === 'object' ? (miner.columnProvenance || {}) : {};
    const payloads = miner && miner.data && typeof miner.data === 'object' ? miner.data : {};

    const columns = {};
    let okCount = 0;
    let missingCount = 0;
    let invalidCount = 0;

    for (const spec of COLUMN_VALIDATION_SPECS) {
        const value = miner ? miner[spec.id] : null;
        const sourceInfo = provenance[spec.id] || makeColumnSource('unknown', []);
        const sourceCommands = Array.isArray(sourceInfo.commands) ? sourceInfo.commands : [];
        const sourceCommandPresent = sourceCommands.length === 0
            ? true
            : sourceCommands.some((command) => hasSourceCommandData(payloads, command));

        const validity = validateColumnValue(spec.id, value);
        let status = 'ok';
        if (!validity.valid) status = isMissing(value) ? 'missing' : 'invalid';

        if (status === 'ok') okCount += 1;
        else if (status === 'missing') missingCount += 1;
        else invalidCount += 1;

        columns[spec.id] = {
            value,
            status,
            required: Boolean(spec.required),
            source: sourceInfo.source,
            sourceCommands,
            sourceCommandPresent,
            reason: validity.valid ? null : validity.reason
        };
    }

    return {
        ip: miner && miner.ip ? String(miner.ip) : 'N/A',
        apiProtocol: miner && miner.apiProtocol ? String(miner.apiProtocol) : 'unknown',
        summary: {
            okCount,
            missingCount,
            invalidCount
        },
        columns
    };
}

function summarizeColumnValidationReports(reports) {
    const columnSummary = {};

    for (const spec of COLUMN_VALIDATION_SPECS) {
        columnSummary[spec.id] = {
            required: Boolean(spec.required),
            ok: 0,
            missing: 0,
            invalid: 0
        };
    }

    for (const report of reports) {
        for (const spec of COLUMN_VALIDATION_SPECS) {
            const status = report.columns?.[spec.id]?.status || 'missing';
            if (status === 'ok') columnSummary[spec.id].ok += 1;
            else if (status === 'invalid') columnSummary[spec.id].invalid += 1;
            else columnSummary[spec.id].missing += 1;
        }
    }

    return columnSummary;
}

function normalizeIpMode(value) {
    if (value === undefined || value === null) return 'N/A';
    const text = String(value).trim().toLowerCase();
    if (!text) return 'N/A';

    if (['1', 'true', 'yes', 'on', 'dhcp', 'dynamic', 'auto'].includes(text)) return 'DHCP';
    if (['0', 'false', 'no', 'off', 'static', 'manual', 'fixed'].includes(text)) return 'Static';

    if (text.includes('dhcp') || text.includes('dynamic') || text.includes('auto')) return 'DHCP';
    if (text.includes('static') || text.includes('manual') || text.includes('fixed')) return 'Static';

    return 'N/A';
}

// Detect firmware brand from the raw CGminer/BMMiner/BOSminer/LUXMiner version keys.
// The VERSION command response exposes the SOFTWARE name as the key, e.g.:
//   { "BMMiner": "2.0.0" }  → Bitmain Stock
//   { "BOSminer": "..."}   → Braiins OS
//   { "LUXMiner": "..."}   → LuxOS
function normalizeFirmware(allRecords) {
    for (const rec of allRecords) {
        if (!rec || typeof rec !== 'object') continue;
        for (const key of Object.keys(rec)) {
            const k = key.toLowerCase();
            if (k === 'bosminer' || k === 'bosminer+' || k.startsWith('bosminer'))
                return 'Braiins OS';
            if (k === 'luxminer' || k.startsWith('luxminer') || k.startsWith('luxos'))
                return 'LuxOS';
        }
        // Check string values for embedded firmware identifiers
        for (const [key, val] of Object.entries(rec)) {
            const v = String(val || '').toLowerCase();
            if (v.includes('bosminer') || v.includes('braiins os') || v.includes('braiins firmware'))
                return 'Braiins OS';
            if (v.includes('luxos') || v.includes('luxminer'))
                return 'LuxOS';
        }
    }
    // BMMiner/CGMiner implies Bitmain stock
    for (const rec of allRecords) {
        if (!rec || typeof rec !== 'object') continue;
        for (const key of Object.keys(rec)) {
            const k = key.toLowerCase();
            if (k === 'bmminer' || k === 'cgminer') return 'Bitmain Stock';
        }
    }
    return 'N/A';
}

// Detect control board SoC purely from data returned by the miner API.
// Do NOT infer from model name — the same model can ship with different boards.
//
// Detection signals:
//   BeagleBone — stats key "BB Version" / "BB Ver" (BB = BeagleBone Black).
//                Also caught if any value contains "beaglebone".
//   Amlogic    — ControlBoardType/value contains "amlogic", "s905", "meson".
//   CVTek      — ControlBoardType/value contains "cvitek", "cvtek", "cv1800",
//                "sg2002", "sophgo".
function normalizeControlBoard(allRecords) {
    for (const rec of allRecords) {
        if (!rec || typeof rec !== 'object') continue;

        for (const [key, val] of Object.entries(rec)) {
            const k = normKey(key);
            const v = String(val || '').toLowerCase();

            // BeagleBone: the stats key "BB Version" is definitively BB Black
            if (k === 'bbversion' || k === 'bbver' || k.startsWith('bbver')) return 'BeagleBone';
            if (v.includes('beaglebone') || v.includes('beagle bone')) return 'BeagleBone';

            // Amlogic SoC variants
            if (v.includes('amlogic') || v.includes('s905') || v.includes('meson')) return 'Amlogic';

            // CVTek / Sophgo (CV1800B / SG2002)
            // Note: Bitmain uses "cvitek" (with i) as the canonical spelling in ControlBoardType
            if (v.includes('cvitek') || v.includes('cvtek') || v.includes('cv tek') ||
                v.includes('cv1800') || v.includes('sg2002') || v.includes('sophgo')) return 'CVTek';

            // Also catch by the specific key name Bitmain uses: ControlBoardType
            if (k === 'controlboardtype' || k === 'controlboard' || k === 'boardtype') {
                if (v.includes('amlogic') || v.includes('s905')) return 'Amlogic';
                if (v.includes('beagle') || v.includes('bbb')) return 'BeagleBone';
                if (v) return 'CVTek'; // any other explicit ControlBoardType value on modern Antminers
            }
        }
    }
    return 'N/A';
}

function deriveTempC(statsRecords) {
    // Strict mapping requirement: prefer STATS[1].temp_max.
    if (Array.isArray(statsRecords) && statsRecords.length > 1) {
        const tempMax = pickField(statsRecords[1], ['temp_max']);
        const num = parseFloat(String(tempMax));
        if (Number.isFinite(num) && num >= -20 && num <= 200) {
            return num.toFixed(1);
        }
    }

    const fromStats = [];
    for (const statsRecord of statsRecords) {
        fromStats.push(...listNumbersByHints(statsRecord, ['temp'], { min: -20, max: 200 }));
    }
    const all = [...fromStats];
    if (!all.length) return 'N/A';
    const avg = all.reduce((sum, n) => sum + n, 0) / all.length;
    return avg.toFixed(1);
}

function deriveFanSummary(statsRecords) {
    const fromStats = [];
    for (const statsRecord of statsRecords) {
        fromStats.push(...listNumbersByHints(statsRecord, ['fan'], { min: 200, max: 30000 }));
    }
    const fans = [...fromStats];
    if (!fans.length) return 'N/A';
    return fans.map(v => Math.round(v)).join('/');
}

// Derive running/total fan count.
// Priority:
//   1. Use `fan_num` / `Fan Num` (reported by cgminer/bmminer) as the running count,
//      and count individual Fan1…FanN RPM slots (including 0 RPM) as the total.
//   2. If fan_num is absent, fall back to counting slots > 200 RPM as running.
function deriveFanStatus(statsRecords) {
    // Count only explicit fan slot keys (fan1/fan2/...), not aggregate fields
    // like fan_num, fan_pwm, fan duty, etc. which would inflate totals.
    const collectFrom = (records) => {
        const fanSlots = new Map();
        const collectSlots = (record) => {
            if (!record || typeof record !== 'object') return;
            for (const [key, value] of Object.entries(record)) {
                const nk = normKey(key);
                // Accept fan1, fan2, fan01, fan_1, fan-1; reject fan_num and other fan* fields.
                if (!/^fan\d+$/.test(nk)) continue;
                const rpm = parseFloat(String(value));
                if (!Number.isFinite(rpm) || rpm < 0 || rpm > 30000) continue;
                fanSlots.set(nk, rpm);
            }
        };
        for (const rec of records) collectSlots(rec);
        return fanSlots;
    };

    const fanSlots = collectFrom(statsRecords);
    const allSlots = Array.from(fanSlots.values());
    if (!allSlots.length) return 'N/A';

    const total = allSlots.length;
    // User requirement: missing fan or 0 RPM must NOT count as functioning.
    const running = allSlots.filter(v => v > 0).length;

    return `${running}/${total}`;
}

function deriveVoltage(statsRecords) {
    const fromStats = [];
    for (const statsRecord of statsRecords) {
        fromStats.push(...listNumbersByHints(statsRecord, ['volt', 'voltage'], {
            min: 0,
            max: 2000,
            exclude: ['volatile']
        }));
    }
    const values = [...fromStats];
    if (!values.length) return 'N/A';
    const avg = values.reduce((sum, n) => sum + n, 0) / values.length;
    return formatMaybeNumber(avg, 2);
}

function deriveFrequencyMHz(statsRecords) {
    const fromStats = [];
    for (const statsRecord of statsRecords) {
        fromStats.push(...listNumbersByHints(statsRecord, ['freq', 'frequency'], { min: 10, max: 20000 }));
    }
    const values = [...fromStats];
    if (!values.length) return 'N/A';
    const avg = values.reduce((sum, n) => sum + n, 0) / values.length;
    return formatMaybeNumber(avg, 0);
}

function deriveActiveHashboardsFromDevsStatus(devsPayload) {
    const statusRecords = sectionArray(devsPayload, ['status']);
    for (const statusRecord of statusRecords) {
        const msgRaw = pickField(statusRecord, ['msg', 'message']);
        const msg = String(msgRaw || '').trim();
        if (!msg) continue;

        const ascMatch = msg.match(/(\d+)\s*asc/i);
        if (ascMatch) {
            const value = parseInt(ascMatch[1], 10);
            if (Number.isFinite(value) && value >= 0) return value;
        }

        const boardMatch = msg.match(/(\d+)\s*(?:chain|hashboard|board)/i);
        if (boardMatch) {
            const value = parseInt(boardMatch[1], 10);
            if (Number.isFinite(value) && value >= 0) return value;
        }
    }

    return null;
}

function deriveHashboards(statsRecords, devsPayload) {
    const totalStat = pickFieldFromRecords(statsRecords, ['hashboard', 'hashboards', 'chainnum', 'chain num']);
    const activeStat = pickFieldFromRecords(statsRecords, ['activehashboard', 'active hashboards', 'chainacn', 'chain acn']);
    const activeFromDevsStatus = deriveActiveHashboardsFromDevsStatus(devsPayload);
    const total = parseInt(totalStat, 10);
    const active = parseInt(activeStat, 10);

    if (!Number.isFinite(total) && !Number.isFinite(active) && activeFromDevsStatus === null) {
        return { hashboards: 'N/A', activeHashboards: 'N/A' };
    }

    const resolvedActive = Number.isFinite(active) && active >= 0
        ? active
        : (activeFromDevsStatus !== null ? activeFromDevsStatus : null);
    const resolvedTotal = Number.isFinite(total) && total >= 0 ? total : null;

    if (resolvedActive !== null && resolvedTotal === null) {
        return { hashboards: 'N/A', activeHashboards: String(resolvedActive) };
    }

    if (resolvedActive === null || resolvedTotal === null) {
        return { hashboards: 'N/A', activeHashboards: 'N/A' };
    }

    return {
        hashboards: `${resolvedActive}/${resolvedTotal}`,
        activeHashboards: String(resolvedActive)
    };
}

function deriveProfile(ip, payloads) {
    const summaryRecords = sectionArray(payloads.summary, ['summary']);
    const statsRecords = sectionArray(payloads.stats, ['stats']);
    const versionRecords = sectionArray(payloads.version, ['version']);
    const devs = sectionArray(payloads.devs, ['devs']);
    const configRecords = sectionArray(payloads.config, ['config']);

    const devdetailsRecords = sectionArray(payloads.devdetails, ['devdetails']);

    // Strict-source mapping: Miner Type is only sourced from STATS.Type.
    // If STATS does not provide it, return N/A.
    const statsRecordsForType = sectionArray(payloads.stats, ['stats']);
    const minerType = pickFieldFromRecords(statsRecordsForType, ['type']) || 'N/A';

    const controlBoard = normalizeControlBoard(configRecords);

    const osType = normalizeFirmware(versionRecords);

    const osVersion =
        pickFieldFromRecords(versionRecords, ['api', 'fwversion', 'osversion', 'firmwareversion', 'version', 'compiletime']) ||
        'N/A';

    const hostname =
        pickFieldFromRecords(statsRecords, ['hostname', 'host', 'miner_name']) ||
        'N/A';

    const hashrateTHs = deriveHashrateTHs(summaryRecords);
    const temperatureC = deriveTempC(statsRecords);
    const fans = deriveFanSummary(statsRecords);
    const fanStatus = deriveFanStatus(statsRecords);
    const voltage = deriveVoltage(devdetailsRecords);
    const frequencyMHz = deriveFrequencyMHz(statsRecords);
    const pools = derivePoolString(payloads.pools);
    const hashboardData = deriveHashboards(statsRecords, payloads.devs);

    const psuInfo =
        pickFieldFromRecords(configRecords, ['psulabel', 'psu label', 'psu_label', 'psuid', 'psumodel', 'psu model']) ||
        'N/A';

    const ipModeRaw = pickFieldFromRecords(configRecords, [
        'dhcp',
        'dhcpstatus',
        'dhcp4',
        'usedhcp',
        'ipmode',
        'ip mode',
        'networkmode',
        'network mode',
        'bootproto',
        'protocol',
        'ipassign',
        'ipassignment'
    ]);
    const ipMode = normalizeIpMode(ipModeRaw);

    const profile = {
        ip,
        status: 'online',
        hostname: String(hostname || 'N/A'),
        mac: deriveMacFromConfig(configRecords),
        osType: String(osType || 'N/A'),
        osVersion: String(osVersion || 'N/A'),
        minerType: String(minerType || 'N/A'),
        controlBoard: String(controlBoard || 'N/A'),
        pools,
        temperatureC,
        fans,
        fanStatus,
        voltage,
        frequencyMHz,
        psuInfo: String(psuInfo || 'N/A'),
        ipMode,
        hashrateTHs,
        hashboards: hashboardData.hashboards,
        activeHashboards: hashboardData.activeHashboards,
        // Backward-compatible aliases for current frontend columns.
        os: String(osType || 'N/A'),
        cbType: String(controlBoard || 'N/A'),
        temp: temperatureC,
        hashrate: hashrateTHs,
        data: {
            summary: payloads.summary,
            stats: payloads.stats,
            pools: payloads.pools,
            devs: payloads.devs,
            edevs: payloads.edevs,
            config: payloads.config,
            devdetails: payloads.devdetails,
            version: payloads.version,
            SUMMARY: sectionArray(payloads.summary, ['summary'])
        }
    };

    profile.columnProvenance = build4028ColumnProvenance(payloads, profile);

    return profile;
}

async function enrichMissingFields(profile) {
    const enriched = { ...profile };

    // Very lightweight fallbacks only when fields are still missing.
    if (isMissing(enriched.mac)) {
        enriched.mac = await readMacFromSystem(enriched.ip);
    }

    if (isMissing(enriched.hostname)) {
        const reverseName = await reverseDnsHostname(enriched.ip);
        if (!isMissing(reverseName)) enriched.hostname = reverseName;
    }

    // Antminer CGI endpoints (get_system_info.cgi, get_network_info.cgi) only help for
    // Bitmain stock firmware. Braiins OS and LuxOS use a different HTTP API entirely,
    // so attempting these endpoints wastes a full request timeout per miner.
    // controlBoard and psuInfo come from CGMiner config command; voltage comes from CGMiner stats — the CGI won't have them.
    const isKnownNonBitmain = enriched.osType === 'Braiins OS' || enriched.osType === 'LuxOS';
    const needsHttpHints =
        !isKnownNonBitmain && (
            isMissing(enriched.mac) ||
            isMissing(enriched.hostname) ||
            isMissing(enriched.osVersion) ||
            isMissing(enriched.osType) ||
            isMissing(enriched.ipMode)
        );

    if (needsHttpHints) {
        const httpHints = await fetchHttpMinerHints(enriched.ip);
        if (httpHints && typeof httpHints === 'object') {
            const host = pickField(httpHints, ['hostname', 'host', 'miner_name']);
            const mac = pickField(httpHints, ['macaddr', 'mac', 'ethmac']);
            const fw = pickField(httpHints, ['firmwareversion', 'fwversion', 'systemversion', 'version']);
            const os = pickField(httpHints, ['os', 'platform', 'system', 'miner_type']);
            const ipModeRaw = pickField(httpHints, ['dhcp', 'dhcpstatus', 'dhcp4', 'usedhcp', 'ipmode', 'networkmode', 'bootproto', 'protocol']);

            if (isMissing(enriched.hostname) && !isMissing(host)) enriched.hostname = String(host);
            if (isMissing(enriched.mac)) {
                const macFromField = !isMissing(mac) ? String(mac).toUpperCase() : null;
                const macFromScan = parseMacAddress(...collectObjectRecords(httpHints));
                const resolved = macFromField || (!isMissing(macFromScan) ? macFromScan : null);
                if (resolved) enriched.mac = resolved;
            }
            if (isMissing(enriched.osVersion) && !isMissing(fw)) enriched.osVersion = String(fw);
            if (isMissing(enriched.osType) && !isMissing(os)) {
                enriched.osType = String(os);
                enriched.os = String(os);
            }
            // psuInfo: CGMiner config command (PSULabel) is the sole source; HTTP hints are not used.
            // controlBoard/cbType: CGMiner config command is the sole source; HTTP hints are not used.
            // voltage: CGMiner devdetails (DEVDETAILS.Voltage) is the sole source; HTTP hints are not used.
            // ipMode: CGMiner config command is the sole source; HTTP hints are not used for ipMode.
        }
    }

    return enriched;
}

async function checkMinerDetailed(ip) {
    const basePayloads = await requestMinerCommands(ip, ['summary', 'stats', 'pools', 'version', 'devs']);
    const summary = basePayloads.summary;
    if (!summary) return { ip, status: 'offline' };

    const stats = basePayloads.stats;
    const pools = basePayloads.pools;
    const version = basePayloads.version;
    const devs = basePayloads.devs;
    let devdetails = null;

    let edevs = null;
    let config = null;

    let base = deriveProfile(ip, {
        summary,
        stats,
        pools,
        devs,
        devdetails,
        edevs,
        config,
        version
    });

    // Strict-source mapping: only fields sourced from CONFIG justify extra commands.
    const needsExtra =
        isMissing(base.mac) ||
        isMissing(base.ipMode) ||
        isMissing(base.cbType) ||
        isMissing(base.psuInfo) ||
        isMissing(base.voltage);

    if (needsExtra) {
        const extraPayloads = await requestMinerCommands(ip, ['edevs', 'config', 'devdetails']);
        edevs = extraPayloads.edevs;
        config = extraPayloads.config;
        devdetails = extraPayloads.devdetails;

        base = deriveProfile(ip, {
            summary,
            stats,
            pools,
            devs,
            devdetails,
            edevs,
            config,
            version
        });
    }

    if (!ENABLE_ENRICHMENT_FALLBACK) {
        return base;
    }

    return enrichMissingFields(base);
}

async function checkMinerBase(ip, timeoutMs = DISCOVERY_API_TIMEOUT_MS, protocol = '4028') {
    if (protocol === '6060') {
        return checkMinerBaseVia6060(ip, timeoutMs);
    }

    const baseCommands = ENABLE_ENRICHMENT_PASS
        ? ['summary', 'stats']
        : ['summary', 'stats', 'pools', 'version', 'devs', 'config', 'devdetails'];

    const basePayloads = await requestMinerCommands(ip, baseCommands, {
        timeoutMs
    });
    const summary = basePayloads.summary;
    if (!summary) return { ip, status: 'offline' };

    const profile = deriveProfile(ip, {
        summary,
        stats: basePayloads.stats,
        pools: basePayloads.pools || null,
        devs: basePayloads.devs || null,
        devdetails: basePayloads.devdetails || null,
        edevs: null,
        config: basePayloads.config || null,
        version: basePayloads.version || null
    });

    profile.apiProtocol = '4028';

    return profile;
}

function needsEnrichmentPass(profile) {
    return isMissing(profile.mac) ||
        isMissing(profile.pools) ||
        isMissing(profile.osType) ||
        isMissing(profile.osVersion) ||
        isMissing(profile.hashboards) ||
        isMissing(profile.activeHashboards) ||
        isMissing(profile.ipMode) ||
        isMissing(profile.cbType) ||
        isMissing(profile.psuInfo) ||
        isMissing(profile.voltage);
}

function getEnrichmentCommandPlan(profile) {
    const commands = new Set();

    if (isMissing(profile.pools)) {
        commands.add('pools');
    }

    if (isMissing(profile.osType) || isMissing(profile.osVersion) || isMissing(profile.os)) {
        commands.add('version');
    }

    if (isMissing(profile.hashboards) || isMissing(profile.activeHashboards)) {
        commands.add('devs');
    }

    if (isMissing(profile.mac) || isMissing(profile.ipMode) || isMissing(profile.cbType) || isMissing(profile.psuInfo)) {
        commands.add('config');
    }

    if (isMissing(profile.voltage)) {
        commands.add('devdetails');
    }

    return Array.from(commands);
}

async function enrichMinerProfile(baseProfile) {
    if (baseProfile?.apiProtocol === '6060') {
        return enrichMinerVia6060(baseProfile, ENRICHMENT_API_TIMEOUT_MS);
    }

    const desiredCommands = getEnrichmentCommandPlan(baseProfile);
    if (!desiredCommands.length) {
        if (ENABLE_ENRICHMENT_FALLBACK) {
            return enrichMissingFields(baseProfile);
        }
        return baseProfile;
    }

    const enrichCommands = await planSupportedCommands(
        baseProfile.ip,
        desiredCommands,
        DISCOVERY_API_TIMEOUT_MS
    );

    const extraPayloads = await requestMinerCommands(baseProfile.ip, enrichCommands, {
        timeoutMs: ENRICHMENT_API_TIMEOUT_MS
    });

    let enriched = deriveProfile(baseProfile.ip, {
        summary: baseProfile?.data?.summary,
        stats: baseProfile?.data?.stats,
        pools: extraPayloads.pools,
        devs: extraPayloads.devs,
        devdetails: extraPayloads.devdetails,
        edevs: extraPayloads.edevs,
        config: extraPayloads.config,
        version: extraPayloads.version
    });

    if (ENABLE_ENRICHMENT_FALLBACK) {
        enriched = await enrichMissingFields(enriched);
    }

    return enriched;
}

async function runWithConcurrency(items, limit, worker) {
    const concurrency = Math.max(1, Math.min(limit, items.length || 1));
    let cursor = 0;

    async function next() {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            await worker(items[index], index);
        }
    }

    const runners = [];
    for (let i = 0; i < concurrency; i += 1) {
        runners.push(next());
    }
    await Promise.all(runners);
}

// DEBUG ENDPOINT — always enabled in normal local runtime; queries every command
// against a single IP and returns raw payloads.
// plus a flat list of every key/value seen across all responses.
// Usage: GET /api/debug/192.168.1.5
app.get('/api/debug/:ip', async (req, res) => {
    const ip = req.params.ip;
    if (Number.isNaN(ipToInt(ip))) {
        return res.status(400).json({ error: 'Invalid IP address.' });
    }

    const commands = ['summary', 'stats', 'pools', 'devs', 'version', 'devdetails', 'edevs', 'config'];
    const payloads = {};
    for (const cmd of commands) {
        try {
            payloads[cmd] = await requestMinerCommand(ip, cmd);
        } catch (e) {
            payloads[cmd] = { error: e.message };
        }
    }

    // Collect every key/value across all payloads for easy inspection
    const allRecords = [];
    for (const val of Object.values(payloads)) {
        collectObjectRecords(val, allRecords);
    }
    const keyIndex = {};
    for (const rec of allRecords) {
        if (!rec || typeof rec !== 'object') continue;
        for (const [k, v] of Object.entries(rec)) {
            if (typeof v === 'object') continue; // skip nested — already traversed
            if (!keyIndex[k]) keyIndex[k] = [];
            const s = String(v);
            if (!keyIndex[k].includes(s)) keyIndex[k].push(s);
        }
    }

    res.json({ ip, payloads, allKeys: keyIndex });
});

// REAL-TIME STREAMING API
app.get('/api/scan', async (req, res) => {
    const range = req.query.range;
    const scanConcurrency = parseScanConcurrency(req.query.concurrency);
    const parsed = parseRangeExpression(range);
    const icmpSweepMode = normalizeIcmpSweepMode();

    if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
    }

    if (scanActive) {
        return res.status(409).json({ error: 'A scan is already in progress.' });
    }
    scanActive = true;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    console.log(`Starting real-time scan for ${parsed.total} IP(s): ${range}`);
    res.write(`event: scan-start\ndata: ${JSON.stringify({ total: parsed.total, range: String(range || '') })}\n\n`);

    try {
    let foundCount = 0;
    let enrichedCount = 0;
    let aborted = false;
    let scanCompleted = false;
    const targets = [];
    let probeTargets = [];
    const responsiveTargets = [];
    const protocolByIp = new Map();
    const protocolDetailByIp = new Map();
    const baseOnlineResults = [];
    const foundIps = new Set();
    let icmpRespondedCount = 0;
    let icmpSkippedCount = 0;
    let icmpUnavailableCount = 0;
    let protocol4028Count = 0;
    let protocol6060Count = 0;
    const probeDiagnostics = {
        protocolCacheHits: 0,
        protocolCacheMisses: 0,
        probeTimeoutCount: 0,
        probeErrorCount: 0,
        probeClosedCount: 0,
        probeConnected4028: 0,
        probeConnected6060: 0
    };
    const startedAt = new Date().toISOString();

    function trackProbeReason(reason) {
        const normalized = String(reason || '').toLowerCase();
        if (normalized === 'timeout') probeDiagnostics.probeTimeoutCount += 1;
        else if (normalized === 'closed') probeDiagnostics.probeClosedCount += 1;
        else if (normalized.startsWith('error:')) probeDiagnostics.probeErrorCount += 1;
    }

    function trackProtocolDetail(detail) {
        if (!detail) return;
        if (detail.cacheHit) probeDiagnostics.protocolCacheHits += 1;
        else probeDiagnostics.protocolCacheMisses += 1;

        for (const attempt of (detail.attempts || [])) {
            if (attempt && attempt.open) {
                if (attempt.protocol === '4028') probeDiagnostics.probeConnected4028 += 1;
                else if (attempt.protocol === '6060') probeDiagnostics.probeConnected6060 += 1;
            } else {
                trackProbeReason(attempt && attempt.reason);
            }
        }
    }

    function attachProtocolDetail(profile) {
        if (!profile || !profile.ip) return profile;
        const detail = protocolDetailByIp.get(profile.ip);
        if (!detail) return profile;

        return {
            ...profile,
            protocolAttemptReason: detail.reasonCode || 'unknown',
            protocolAttemptCacheHit: Boolean(detail.cacheHit),
            protocolAttempts: Array.isArray(detail.attempts) ? detail.attempts : []
        };
    }

    lastScanSnapshot = {
        startedAt,
        finishedAt: null,
        aborted: false,
        range: String(range || ''),
        requestedTotal: parsed.total,
        targetCount: 0,
        probeTargetCount: 0,
        responsiveTargetCount: 0,
        protocol4028Count: 0,
        protocol6060Count: 0,
        scanConcurrency,
        probePassConcurrency: PROBE_PASS_CONCURRENCY,
        basePassConcurrency: BASE_PASS_CONCURRENCY,
        enrichmentPassConcurrency: ENRICHMENT_PASS_CONCURRENCY,
        enrichmentEnabled: ENABLE_ENRICHMENT_PASS,
        icmpSweepMode,
        icmpRespondedCount: 0,
        icmpSkippedCount: 0,
        icmpUnavailableCount: 0,
        foundCount: 0,
        enrichedCount: 0,
        protocolCacheHits: 0,
        protocolCacheMisses: 0,
        probeTimeoutCount: 0,
        probeErrorCount: 0,
        probeClosedCount: 0,
        probeConnected4028: 0,
        probeConnected6060: 0,
        protocolHitRate: 0,
        probeFailureRate: 0,
        results: []
    };

    req.on('close', () => {
        // `close` also fires after a normal SSE completion; only mark aborted for early disconnects.
        if (scanCompleted) return;
        aborted = true;
        if (lastScanSnapshot) {
            lastScanSnapshot.aborted = true;
            lastScanSnapshot.finishedAt = new Date().toISOString();
        }
    });

    for (const interval of parsed.ranges) {
        for (let i = interval.start; i <= interval.end; i++) {
            const ipStr = intToIp(i);
            if (ipStr.endsWith('.0') || ipStr.endsWith('.255')) continue;
            targets.push(ipStr);
        }
    }

    if (lastScanSnapshot) {
        lastScanSnapshot.targetCount = targets.length;
    }

    probeTargets = targets;
    if (icmpSweepMode !== 'off' && targets.length > 0) {
        const icmpResponsiveTargets = [];
        const icmpNonResponsiveTargets = [];
        const icmpPingUnavailableTargets = [];
        const icmpConcurrency = Math.max(1, Math.min(scanConcurrency, ICMP_PING_CONCURRENCY, MAX_SCAN_CONCURRENCY));

        res.write(`event: scan-progress\ndata: ${JSON.stringify({
            phase: 'icmp',
            mode: icmpSweepMode,
            targetCount: targets.length,
            pingedCount: 0,
            pingResponsiveCount: 0,
            pingNonResponsiveCount: 0,
            pingUnavailableCount: 0,
            icmpPingConcurrency: icmpConcurrency,
            icmpPingTimeoutMs: ICMP_PING_TIMEOUT_MS
        })}\n\n`);

        await runWithConcurrency(targets, icmpConcurrency, async (ipStr, index) => {
            if (aborted) return;
            const pingResult = await pingHostOnce(ipStr, ICMP_PING_TIMEOUT_MS);
            if (pingResult.ok) {
                icmpResponsiveTargets.push(ipStr);
            } else if (pingResult.reason === 'ping-unavailable') {
                icmpPingUnavailableTargets.push(ipStr);
            } else {
                icmpNonResponsiveTargets.push(ipStr);
            }

            if ((index + 1) % 256 === 0 || (index + 1) === targets.length) {
                res.write(`event: scan-progress\ndata: ${JSON.stringify({
                    phase: 'icmp',
                    mode: icmpSweepMode,
                    targetCount: targets.length,
                    pingedCount: index + 1,
                    pingResponsiveCount: icmpResponsiveTargets.length,
                    pingNonResponsiveCount: icmpNonResponsiveTargets.length,
                    pingUnavailableCount: icmpPingUnavailableTargets.length,
                    icmpPingConcurrency: icmpConcurrency,
                    icmpPingTimeoutMs: ICMP_PING_TIMEOUT_MS
                })}\n\n`);
            }
        });

        icmpRespondedCount = icmpResponsiveTargets.length;
        icmpUnavailableCount = icmpPingUnavailableTargets.length;

        if (icmpSweepMode === 'strict') {
            probeTargets = icmpResponsiveTargets;
            icmpSkippedCount = icmpNonResponsiveTargets.length + icmpPingUnavailableTargets.length;
        } else {
            // Prioritize ping responders first, then probe everything else.
            probeTargets = [
                ...icmpResponsiveTargets,
                ...icmpNonResponsiveTargets,
                ...icmpPingUnavailableTargets
            ];
            icmpSkippedCount = 0;
        }
    }

    if (lastScanSnapshot) {
        lastScanSnapshot.probeTargetCount = probeTargets.length;
        lastScanSnapshot.icmpSweepMode = icmpSweepMode;
        lastScanSnapshot.icmpRespondedCount = icmpRespondedCount;
        lastScanSnapshot.icmpSkippedCount = icmpSkippedCount;
        lastScanSnapshot.icmpUnavailableCount = icmpUnavailableCount;
    }

    const probePassConcurrency = Math.max(1, Math.min(scanConcurrency, PROBE_PASS_CONCURRENCY, MAX_SCAN_CONCURRENCY));
    const basePassConcurrency = Math.max(1, Math.min(scanConcurrency, BASE_PASS_CONCURRENCY, MAX_SCAN_CONCURRENCY));
    const earlyDiscoveryConcurrency = Math.max(1, Math.min(basePassConcurrency, EARLY_DISCOVERY_CONCURRENCY));
    const earlyDiscoveryMaxHosts = Math.max(0, EARLY_DISCOVERY_MAX_HOSTS);
    const enrichmentPassConcurrency = Math.max(1, Math.min(scanConcurrency, ENRICHMENT_PASS_CONCURRENCY));
    const earlyDiscoveryQueue = [];
    const earlyDiscoveryQueuedIps = new Set();
    let earlyDiscoveryStartedCount = 0;
    let activeEarlyDiscoveryChecks = 0;

    function canQueueEarlyDiscovery() {
        return ENABLE_DISCOVERY_PASS && earlyDiscoveryMaxHosts > 0 && (earlyDiscoveryStartedCount + earlyDiscoveryQueue.length) < earlyDiscoveryMaxHosts;
    }

    function recordOnlineDiscoveryResult(result) {
        if (!result || result.status !== 'online' || foundIps.has(result.ip)) return;

        const decoratedResult = attachProtocolDetail(result);
        foundIps.add(result.ip);
        foundCount += 1;
        baseOnlineResults.push(decoratedResult);
        if (lastScanSnapshot) {
            lastScanSnapshot.foundCount = foundCount;
            // Preserve full miner payload for post-scan debugging.
            lastScanSnapshot.results.push(decoratedResult);
        }
        res.write(`data: ${JSON.stringify(decoratedResult)}\n\n`);
    }

    function drainEarlyDiscoveryQueue() {
        if (aborted || !ENABLE_DISCOVERY_PASS || earlyDiscoveryMaxHosts <= 0) return;

        while (activeEarlyDiscoveryChecks < earlyDiscoveryConcurrency && earlyDiscoveryQueue.length > 0) {
            const ipStr = earlyDiscoveryQueue.shift();
            activeEarlyDiscoveryChecks += 1;
            earlyDiscoveryStartedCount += 1;

            (async () => {
                try {
                    const protocol = protocolByIp.get(ipStr) || '4028';
                    const result = await runBaseCheckTask(() => checkMinerBase(ipStr, DISCOVERY_API_TIMEOUT_MS, protocol));
                    if (aborted) return;
                    recordOnlineDiscoveryResult(result);
                } catch (_err) {
                    // Ignore per-host early-discovery errors; full discovery pass still runs.
                } finally {
                    activeEarlyDiscoveryChecks -= 1;
                    if (!aborted) drainEarlyDiscoveryQueue();
                }
            })();
        }
    }

    function queueEarlyDiscovery(ipStr) {
        if (!canQueueEarlyDiscovery()) return;
        if (earlyDiscoveryQueuedIps.has(ipStr)) return;
        if (foundIps.has(ipStr)) return;

        earlyDiscoveryQueuedIps.add(ipStr);
        earlyDiscoveryQueue.push(ipStr);
        drainEarlyDiscoveryQueue();
    }

    async function waitForEarlyDiscoveryToSettle() {
        while (!aborted && activeEarlyDiscoveryChecks > 0) {
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
    }

    res.write(`event: scan-progress\ndata: ${JSON.stringify({
        phase: 'probe',
        targetCount: probeTargets.length,
        requestedTargetCount: targets.length,
        responsiveTargetCount: 0,
        foundCount: 0,
        enrichedCount: 0,
        icmpSweepMode,
        icmpRespondedCount,
        icmpSkippedCount,
        icmpUnavailableCount,
        earlyDiscoveryConcurrency,
        earlyDiscoveryMaxHosts,
        probePassConcurrency,
        basePassConcurrency,
        enrichmentPassConcurrency
    })}\n\n`);

    await runWithConcurrency(probeTargets, probePassConcurrency, async (ipStr) => {
        if (aborted) return;
        const probeDetail = await probeApiProtocolDetailed(ipStr, PROBE_TIMEOUT_MS);
        protocolDetailByIp.set(ipStr, probeDetail);
        trackProtocolDetail(probeDetail);
        const protocol = probeDetail.protocol;
        if (protocol) {
            responsiveTargets.push(ipStr);
            protocolByIp.set(ipStr, protocol);
            if (protocol === '4028') protocol4028Count += 1;
            else if (protocol === '6060') protocol6060Count += 1;
            queueEarlyDiscovery(ipStr);
        }
    });

    if (lastScanSnapshot) {
        lastScanSnapshot.responsiveTargetCount = responsiveTargets.length;
        lastScanSnapshot.protocol4028Count = protocol4028Count;
        lastScanSnapshot.protocol6060Count = protocol6060Count;
    }

    if (aborted) return;

    if (!ENABLE_DISCOVERY_PASS) {
        res.write(`event: discovery-done\ndata: ${JSON.stringify({
            targetCount: targets.length,
            probeTargetCount: probeTargets.length,
            responsiveTargetCount: responsiveTargets.length,
            foundCount,
            enrichmentEnabled: false,
            enrichmentTargetCount: 0,
            discoveryEnabled: false
        })}\n\n`);
    } else {

    await waitForEarlyDiscoveryToSettle();

    res.write(`event: scan-progress\ndata: ${JSON.stringify({
        phase: 'discovery',
        targetCount: responsiveTargets.length,
        responsiveTargetCount: responsiveTargets.length,
        foundCount: 0,
        enrichedCount: 0,
        probePassConcurrency,
        basePassConcurrency,
        protocol4028Count,
        protocol6060Count,
        enrichmentPassConcurrency
    })}\n\n`);

    await runWithConcurrency(responsiveTargets, basePassConcurrency, async (ipStr) => {
        if (aborted) return;
        if (foundIps.has(ipStr)) return;

        const protocol = protocolByIp.get(ipStr) || '4028';
        const result = await runBaseCheckTask(() => checkMinerBase(ipStr, DISCOVERY_API_TIMEOUT_MS, protocol));
        if (aborted) return;
        recordOnlineDiscoveryResult(result);
    });

    // Re-check passes were removed by request: no recovery/completeness sweep.

    if (!aborted) {
        res.write(`event: discovery-done\ndata: ${JSON.stringify({
            targetCount: targets.length,
            probeTargetCount: probeTargets.length,
            responsiveTargetCount: responsiveTargets.length,
            foundCount,
            enrichmentEnabled: ENABLE_ENRICHMENT_PASS,
            enrichmentTargetCount: ENABLE_ENRICHMENT_PASS ? baseOnlineResults.length : 0
        })}\n\n`);
    }

    if (!aborted && ENABLE_ENRICHMENT_PASS) {
        res.write(`event: scan-progress\ndata: ${JSON.stringify({
            phase: 'enrichment',
            targetCount: responsiveTargets.length,
            responsiveTargetCount: responsiveTargets.length,
            foundCount,
            enrichedCount: 0,
            enrichmentTargetCount: baseOnlineResults.length,
            probePassConcurrency,
            basePassConcurrency,
            protocol4028Count,
            protocol6060Count,
            enrichmentPassConcurrency
        })}\n\n`);

        await runWithConcurrency(baseOnlineResults, enrichmentPassConcurrency, async (baseProfile) => {
            if (aborted) return;
            if (!baseProfile || !baseProfile.ip) return;
            if (!needsEnrichmentPass(baseProfile) && !ENABLE_ENRICHMENT_FALLBACK) return;

            const enriched = await runEnrichmentTask(() => enrichMinerProfile(baseProfile));
            if (aborted || !enriched || enriched.status !== 'online') return;

            const decoratedEnriched = attachProtocolDetail(enriched);

            enrichedCount += 1;
            if (lastScanSnapshot) {
                lastScanSnapshot.enrichedCount = enrichedCount;
                const existingIndex = lastScanSnapshot.results.findIndex((item) => item && item.ip === decoratedEnriched.ip);
                if (existingIndex >= 0) {
                    lastScanSnapshot.results[existingIndex] = decoratedEnriched;
                } else {
                    lastScanSnapshot.results.push(decoratedEnriched);
                }
            }

            res.write(`event: enriched\ndata: ${JSON.stringify(decoratedEnriched)}\n\n`);
            res.write(`event: scan-progress\ndata: ${JSON.stringify({
                phase: 'enrichment',
                targetCount: responsiveTargets.length,
                responsiveTargetCount: responsiveTargets.length,
                foundCount,
                enrichedCount,
                enrichmentTargetCount: baseOnlineResults.length,
                lastEnrichedIp: decoratedEnriched.ip,
                probePassConcurrency,
                basePassConcurrency,
                protocol4028Count,
                protocol6060Count,
                enrichmentPassConcurrency
            })}\n\n`);
        });
    }
    }

    console.log(`Scan complete. Found ${foundCount} miners.`);
    const probeAttemptCount =
        probeDiagnostics.probeTimeoutCount +
        probeDiagnostics.probeErrorCount +
        probeDiagnostics.probeClosedCount +
        probeDiagnostics.probeConnected4028 +
        probeDiagnostics.probeConnected6060;
    const probeFailureCount =
        probeDiagnostics.probeTimeoutCount +
        probeDiagnostics.probeErrorCount +
        probeDiagnostics.probeClosedCount;
    const protocolHitRate = probeTargets.length > 0 ? responsiveTargets.length / probeTargets.length : 0;
    const probeFailureRate = probeAttemptCount > 0 ? probeFailureCount / probeAttemptCount : 0;

    if (lastScanSnapshot) {
        lastScanSnapshot.foundCount = foundCount;
        lastScanSnapshot.enrichedCount = enrichedCount;
        lastScanSnapshot.protocol4028Count = protocol4028Count;
        lastScanSnapshot.protocol6060Count = protocol6060Count;
        lastScanSnapshot.protocolCacheHits = probeDiagnostics.protocolCacheHits;
        lastScanSnapshot.protocolCacheMisses = probeDiagnostics.protocolCacheMisses;
        lastScanSnapshot.icmpSweepMode = icmpSweepMode;
        lastScanSnapshot.icmpRespondedCount = icmpRespondedCount;
        lastScanSnapshot.icmpSkippedCount = icmpSkippedCount;
        lastScanSnapshot.icmpUnavailableCount = icmpUnavailableCount;
        lastScanSnapshot.probeTimeoutCount = probeDiagnostics.probeTimeoutCount;
        lastScanSnapshot.probeErrorCount = probeDiagnostics.probeErrorCount;
        lastScanSnapshot.probeClosedCount = probeDiagnostics.probeClosedCount;
        lastScanSnapshot.probeConnected4028 = probeDiagnostics.probeConnected4028;
        lastScanSnapshot.probeConnected6060 = probeDiagnostics.probeConnected6060;
        lastScanSnapshot.protocolHitRate = Number(protocolHitRate.toFixed(4));
        lastScanSnapshot.probeFailureRate = Number(probeFailureRate.toFixed(4));
        lastScanSnapshot.aborted = aborted;
        lastScanSnapshot.finishedAt = new Date().toISOString();
    }
    if (aborted) return;
    scanCompleted = true;
    res.write(`event: done\ndata: ${JSON.stringify({
        targetCount: targets.length,
        probeTargetCount: probeTargets.length,
        responsiveTargetCount: responsiveTargets.length,
        foundCount,
        enrichedCount,
        enrichmentEnabled: ENABLE_ENRICHMENT_PASS,
        icmpSweepMode,
        icmpRespondedCount,
        icmpSkippedCount,
        icmpUnavailableCount,
        protocol4028Count,
        protocol6060Count,
        protocolCacheHits: probeDiagnostics.protocolCacheHits,
        protocolCacheMisses: probeDiagnostics.protocolCacheMisses,
        probeTimeoutCount: probeDiagnostics.probeTimeoutCount,
        probeErrorCount: probeDiagnostics.probeErrorCount,
        probeClosedCount: probeDiagnostics.probeClosedCount,
        probeConnected4028: probeDiagnostics.probeConnected4028,
        probeConnected6060: probeDiagnostics.probeConnected6060,
        protocolHitRate: Number((probeTargets.length > 0 ? (responsiveTargets.length / probeTargets.length) : 0).toFixed(4)),
        probeFailureRate: Number(probeFailureRate.toFixed(4))
    })}\n\n`);
    res.end();
    } finally {
        scanActive = false;
    }
});

// Returns the full payloads captured during the most recent scan for debugging.
// Query params:
//   ip=<address>   return only one miner result if present
//   limit=<n>      return at most n results (default 200)
app.get('/api/scan/last', (req, res) => {
    if (!lastScanSnapshot) {
        return res.status(404).json({ error: 'No scan snapshot is available yet.' });
    }

    const ip = String(req.query.ip || '').trim();
    if (ip) {
        if (Number.isNaN(ipToInt(ip))) {
            return res.status(400).json({ error: 'Invalid IP address.' });
        }
        const match = lastScanSnapshot.results.find(item => String(item.ip || '') === ip);
        if (!match) {
            return res.status(404).json({
                error: `No miner found for IP ${ip} in the latest scan snapshot.`
            });
        }

        return res.json({
            meta: {
                startedAt: lastScanSnapshot.startedAt,
                finishedAt: lastScanSnapshot.finishedAt,
                aborted: lastScanSnapshot.aborted,
                range: lastScanSnapshot.range,
                requestedTotal: lastScanSnapshot.requestedTotal,
                targetCount: lastScanSnapshot.targetCount,
                probeTargetCount: lastScanSnapshot.probeTargetCount || lastScanSnapshot.targetCount || 0,
                responsiveTargetCount: lastScanSnapshot.responsiveTargetCount || 0,
                enrichmentEnabled: lastScanSnapshot.enrichmentEnabled !== false,
                icmpSweepMode: lastScanSnapshot.icmpSweepMode || 'off',
                icmpRespondedCount: lastScanSnapshot.icmpRespondedCount || 0,
                icmpSkippedCount: lastScanSnapshot.icmpSkippedCount || 0,
                icmpUnavailableCount: lastScanSnapshot.icmpUnavailableCount || 0,
                protocol4028Count: lastScanSnapshot.protocol4028Count || 0,
                protocol6060Count: lastScanSnapshot.protocol6060Count || 0,
                foundCount: lastScanSnapshot.foundCount,
                enrichedCount: lastScanSnapshot.enrichedCount || 0,
                protocolCacheHits: lastScanSnapshot.protocolCacheHits || 0,
                protocolCacheMisses: lastScanSnapshot.protocolCacheMisses || 0,
                probeTimeoutCount: lastScanSnapshot.probeTimeoutCount || 0,
                probeErrorCount: lastScanSnapshot.probeErrorCount || 0,
                probeClosedCount: lastScanSnapshot.probeClosedCount || 0,
                probeConnected4028: lastScanSnapshot.probeConnected4028 || 0,
                probeConnected6060: lastScanSnapshot.probeConnected6060 || 0,
                protocolHitRate: lastScanSnapshot.protocolHitRate || 0,
                probeFailureRate: lastScanSnapshot.probeFailureRate || 0,
                scanConcurrency: lastScanSnapshot.scanConcurrency
            },
            result: match
        });
    }

    const limit = parsePositiveLimit(req.query.limit, 200);
    const results = lastScanSnapshot.results.slice(0, limit);

    return res.json({
        meta: {
            startedAt: lastScanSnapshot.startedAt,
            finishedAt: lastScanSnapshot.finishedAt,
            aborted: lastScanSnapshot.aborted,
            range: lastScanSnapshot.range,
            requestedTotal: lastScanSnapshot.requestedTotal,
            targetCount: lastScanSnapshot.targetCount,
            probeTargetCount: lastScanSnapshot.probeTargetCount || lastScanSnapshot.targetCount || 0,
            responsiveTargetCount: lastScanSnapshot.responsiveTargetCount || 0,
            enrichmentEnabled: lastScanSnapshot.enrichmentEnabled !== false,
            icmpSweepMode: lastScanSnapshot.icmpSweepMode || 'off',
            icmpRespondedCount: lastScanSnapshot.icmpRespondedCount || 0,
            icmpSkippedCount: lastScanSnapshot.icmpSkippedCount || 0,
            icmpUnavailableCount: lastScanSnapshot.icmpUnavailableCount || 0,
            protocol4028Count: lastScanSnapshot.protocol4028Count || 0,
            protocol6060Count: lastScanSnapshot.protocol6060Count || 0,
            foundCount: lastScanSnapshot.foundCount,
            enrichedCount: lastScanSnapshot.enrichedCount || 0,
            protocolCacheHits: lastScanSnapshot.protocolCacheHits || 0,
            protocolCacheMisses: lastScanSnapshot.protocolCacheMisses || 0,
            probeTimeoutCount: lastScanSnapshot.probeTimeoutCount || 0,
            probeErrorCount: lastScanSnapshot.probeErrorCount || 0,
            probeClosedCount: lastScanSnapshot.probeClosedCount || 0,
            probeConnected4028: lastScanSnapshot.probeConnected4028 || 0,
            probeConnected6060: lastScanSnapshot.probeConnected6060 || 0,
            protocolHitRate: lastScanSnapshot.protocolHitRate || 0,
            probeFailureRate: lastScanSnapshot.probeFailureRate || 0,
            scanConcurrency: lastScanSnapshot.scanConcurrency,
            returned: results.length,
            totalResults: lastScanSnapshot.results.length
        },
        results
    });
});

// Returns per-column validation/provenance report from the latest scan snapshot.
// Query params:
//   ip=<address>   validate only one miner
//   limit=<n>      validate at most n results (default 200)
app.get('/api/scan/last/columns/validate', (req, res) => {
    if (!lastScanSnapshot) {
        return res.status(404).json({ error: 'No scan snapshot is available yet.' });
    }

    const ip = String(req.query.ip || '').trim();
    const limit = parsePositiveLimit(req.query.limit, 200);
    let miners = lastScanSnapshot.results || [];

    if (ip) {
        if (Number.isNaN(ipToInt(ip))) {
            return res.status(400).json({ error: 'Invalid IP address.' });
        }

        const match = miners.find((item) => String(item.ip || '') === ip);
        if (!match) {
            return res.status(404).json({
                error: `No miner found for IP ${ip} in the latest scan snapshot.`
            });
        }
        miners = [match];
    } else {
        miners = miners.slice(0, limit);
    }

    const reports = miners.map(buildMinerColumnValidation);

    return res.json({
        meta: {
            startedAt: lastScanSnapshot.startedAt,
            finishedAt: lastScanSnapshot.finishedAt,
            aborted: lastScanSnapshot.aborted,
            range: lastScanSnapshot.range,
            foundCount: lastScanSnapshot.foundCount,
            totalResults: lastScanSnapshot.results.length,
            validatedResults: reports.length
        },
        summary: summarizeColumnValidationReports(reports),
        reports
    });
});

// CHANGED: The console message now matches the official name!
app.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`Miner-Finder is running! Opening ${url} ...`);

    if (!AUTO_OPEN_BROWSER) {
        console.log('AUTO_OPEN_BROWSER is disabled; not launching a browser.');
        return;
    }

    // Best-effort browser launch only; failures should not affect server startup.
    if (process.platform === 'win32') {
        execFile('cmd', ['/c', 'start', '', url], () => {});
    } else if (process.platform === 'darwin') {
        execFile('open', [url], () => {});
    } else {
        execFile('xdg-open', [url], () => {});
    }
});