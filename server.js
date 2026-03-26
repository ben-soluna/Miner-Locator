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
const SCAN_CONCURRENCY = Math.max(1, parseInt(process.env.SCAN_CONCURRENCY || '48', 10) || 48);
const HTTP_FALLBACK_CONCURRENCY = Math.max(1, parseInt(process.env.HTTP_FALLBACK_CONCURRENCY || '6', 10) || 6);
const PER_HOST_COMMAND_CONCURRENCY = Math.max(1, parseInt(process.env.PER_HOST_COMMAND_CONCURRENCY || '2', 10) || 2);
const MINER_API_TIMEOUT_MS = Math.max(200, parseInt(process.env.MINER_API_TIMEOUT_MS || '1200', 10) || 1200);
const MIN_SCAN_CONCURRENCY = 1;
const MAX_SCAN_CONCURRENCY = 128;
const GLOBAL_CHECK_CONCURRENCY = Math.max(1, parseInt(process.env.GLOBAL_CHECK_CONCURRENCY || '96', 10) || 96);
const ARP_CACHE_TTL_MS = Math.max(200, parseInt(process.env.ARP_CACHE_TTL_MS || '1500', 10) || 1500);
const AUTO_OPEN_BROWSER = !['0', 'false', 'no', 'off'].includes(String(process.env.AUTO_OPEN_BROWSER || '1').trim().toLowerCase());
const ENABLE_ENRICHMENT_FALLBACK = ['1', 'true', 'yes', 'on'].includes(String(process.env.ENABLE_ENRICHMENT_FALLBACK || '0').trim().toLowerCase());

let activeHttpFallback = 0;
const httpFallbackQueue = [];
let activeGlobalChecks = 0;
const globalCheckQueue = [];
let arpCacheByIp = null;
let arpCacheUpdatedAt = 0;
let lastScanSnapshot = null;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

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

function checkMiner(ip) {
    return new Promise((resolve) => {
        const client = new net.Socket();
        let data = '';
        client.setTimeout(1500);

        client.connect(4028, ip, () => {
            client.write(JSON.stringify({ command: 'summary' }));
        });

        client.on('data', (chunk) => { data += chunk.toString(); });

        client.on('end', () => {
            try {
                const cleanData = data.replace(/\0/g, ''); 
                resolve({ ip, status: 'online', data: JSON.parse(cleanData) });
            } catch (e) {
                resolve({ ip, status: 'error', error: 'Invalid JSON' });
            }
        });

        client.on('timeout', () => { client.destroy(); resolve({ ip, status: 'offline' }); });
        client.on('error', () => { resolve({ ip, status: 'offline' }); });
    });
}

function requestMinerCommand(ip, command) {
    return new Promise((resolve) => {
        const client = new net.Socket();
        let data = '';
        let settled = false;

        function finish(result) {
            if (settled) return;
            settled = true;
            resolve(result);
        }

        client.setTimeout(MINER_API_TIMEOUT_MS);
        client.setNoDelay(true);

        client.connect(4028, ip, () => {
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

async function requestMinerCommands(ip, commands) {
    const list = Array.isArray(commands)
        ? commands.map(c => String(c || '').trim()).filter(Boolean)
        : [];
    if (!list.length) return {};

    const joined = list.join('+');
    const response = await requestMinerCommand(ip, joined);
    if (response && typeof response === 'object') {
        const responseKeys = new Set(Object.keys(response).map(key => String(key).toLowerCase()));
        const hasAnyRequestedPayload = list.some(cmd => responseKeys.has(String(cmd).toLowerCase()));
        const statusList = Array.isArray(response.STATUS) ? response.STATUS : [];
        const hasInvalidCommandStatus = statusList.some((entry) => {
            const status = String((entry && entry.STATUS) || '').toUpperCase();
            const msg = String((entry && entry.Msg) || '').toLowerCase();
            return status === 'E' || msg.includes('invalid command');
        });

        if (hasAnyRequestedPayload && !hasInvalidCommandStatus) {
            return response;
        }
    }

    // Fallback for non-join-capable firmware variants.
    const out = {};
    await runWithConcurrency(list, Math.max(1, Math.min(PER_HOST_COMMAND_CONCURRENCY, list.length)), async (cmd) => {
        out[cmd] = await requestMinerCommand(ip, cmd);
    });
    return out;
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

function runGlobalCheckTask(task) {
    return new Promise((resolve) => {
        const execute = async () => {
            activeGlobalChecks += 1;
            try {
                resolve(await task());
            } catch (_err) {
                resolve(null);
            } finally {
                activeGlobalChecks -= 1;
                const next = globalCheckQueue.shift();
                if (next) next();
            }
        };

        if (activeGlobalChecks < GLOBAL_CHECK_CONCURRENCY) {
            execute();
        } else {
            globalCheckQueue.push(execute);
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

function deriveHashboards(statsRecords) {
    const totalStat = pickFieldFromRecords(statsRecords, ['hashboard', 'hashboards', 'chainnum', 'chain num']);
    const activeStat = pickFieldFromRecords(statsRecords, ['activehashboard', 'active hashboards', 'chainacn', 'chain acn']);
    const total = parseInt(totalStat, 10);
    const active = parseInt(activeStat, 10);

    if (!Number.isFinite(total) && !Number.isFinite(active)) {
        return { hashboards: 'N/A', activeHashboards: 'N/A' };
    }

    const resolvedActive = Number.isFinite(active) && active >= 0 ? active : null;
    const resolvedTotal = Number.isFinite(total) && total >= 0 ? total : null;
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
    const hashboardData = deriveHashboards(statsRecords);

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

    return {
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

    if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    console.log(`Starting real-time scan for ${parsed.total} IP(s): ${range}`);
    
    let foundCount = 0;
    let aborted = false;
    const targets = [];
    const startedAt = new Date().toISOString();

    lastScanSnapshot = {
        startedAt,
        finishedAt: null,
        aborted: false,
        range: String(range || ''),
        requestedTotal: parsed.total,
        targetCount: 0,
        scanConcurrency,
        foundCount: 0,
        results: []
    };

    req.on('close', () => {
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

    await runWithConcurrency(targets, scanConcurrency, async (ipStr) => {
        if (aborted) return;

        const result = await runGlobalCheckTask(() => checkMinerDetailed(ipStr));
        if (aborted) return;
        if (result && result.status === 'online') {
            foundCount++;
            if (lastScanSnapshot) {
                lastScanSnapshot.foundCount = foundCount;
                // Preserve full miner payload for post-scan debugging.
                lastScanSnapshot.results.push(result);
            }
            res.write(`data: ${JSON.stringify(result)}\n\n`);
        }
    });

    console.log(`Scan complete. Found ${foundCount} miners.`);
    if (lastScanSnapshot) {
        lastScanSnapshot.foundCount = foundCount;
        lastScanSnapshot.aborted = aborted;
        lastScanSnapshot.finishedAt = new Date().toISOString();
    }
    if (aborted) return;
    res.write(`event: done\ndata: {}\n\n`);
    res.end();
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
                foundCount: lastScanSnapshot.foundCount,
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
            foundCount: lastScanSnapshot.foundCount,
            scanConcurrency: lastScanSnapshot.scanConcurrency,
            returned: results.length,
            totalResults: lastScanSnapshot.results.length
        },
        results
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