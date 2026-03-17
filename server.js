const express = require('express');
const net = require('net');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

function ipToInt(ip) {
    return ip.split('.').reduce((int, oct) => (int << 8) + parseInt(oct, 10), 0) >>> 0;
}

function intToIp(int) {
    return [ (int >>> 24) & 255, (int >>> 16) & 255, (int >>> 8) & 255, int & 255 ].join('.');
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
    
    if (!range || !range.includes('-')) {
        return res.status(400).json({ error: 'Invalid range format.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const [startIp, endIp] = range.split('-');
    const startInt = ipToInt(startIp.trim());
    const endInt = ipToInt(endIp.trim());

    console.log(`Starting real-time scan from ${startIp} to ${endIp}...`);
    
    let currentBatch = [];
    const batchSize = 256; 
    let foundCount = 0;

    for (let i = startInt; i <= endInt; i++) {
        const ipStr = intToIp(i);
        if (ipStr.endsWith('.0') || ipStr.endsWith('.255')) continue;

        const pingPromise = checkMiner(ipStr).then(result => {
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

    if (currentBatch.length > 0) {
        await Promise.all(currentBatch);
    }

    console.log(`Scan complete. Found ${foundCount} miners.`);
    res.write(`event: done\ndata: {}\n\n`);
    res.end();
});

// CHANGED: The console message now matches the official name!
app.listen(PORT, () => {
    console.log(`The Miner Finder is running! Open http://localhost:${PORT} in your browser.`);
});