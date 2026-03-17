const express = require('express');
const net = require('net');
const path = require('path');

const app = express();
const PORT = 3000;
const MAX_IPS_PER_SCAN = 65536;

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

        if (part.includes('-')) {
            const [startIp, endIp] = part.split('-').map(x => x.trim());
            const start = ipToInt(startIp);
            const end = ipToInt(endIp);

            if (Number.isNaN(start) || Number.isNaN(end)) {
                return { error: `Invalid range: ${part}` };
            }
            if (start > end) {
                return { error: `Range start is greater than end: ${part}` };
            }

            ranges.push({ start, end });
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

// REAL-TIME STREAMING API
app.get('/api/scan', async (req, res) => {
    const range = req.query.range;
    const parsed = parseRangeExpression(range);

    if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    console.log(`Starting real-time scan for ${parsed.total} IP(s): ${range}`);
    
    let currentBatch = [];
    const batchSize = 256; 
    let foundCount = 0;
    let aborted = false;

    req.on('close', () => {
        aborted = true;
    });

    for (const interval of parsed.ranges) {
        for (let i = interval.start; i <= interval.end; i++) {
            if (aborted) break;

            const ipStr = intToIp(i);
            if (ipStr.endsWith('.0') || ipStr.endsWith('.255')) continue;

            const pingPromise = checkMiner(ipStr).then(result => {
                if (aborted) return;
                if (result.status === 'online') {
                    foundCount++;
                    res.write(`data: ${JSON.stringify(result)}\n\n`);
                }
            });

            currentBatch.push(pingPromise);

            if (currentBatch.length >= batchSize) {
                await Promise.all(currentBatch);
                currentBatch = [];
            }
        }
        if (aborted) break;
    }

    if (!aborted && currentBatch.length > 0) {
        await Promise.all(currentBatch);
    }

    console.log(`Scan complete. Found ${foundCount} miners.`);
    if (aborted) return;
    res.write(`event: done\ndata: {}\n\n`);
    res.end();
});

// CHANGED: The console message now matches the official name!
app.listen(PORT, () => {
    console.log(`The Miner Finder is running! Open http://localhost:${PORT} in your browser.`);
});