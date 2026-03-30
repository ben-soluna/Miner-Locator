const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = process.env.SCAN_HOST || '127.0.0.1';
const PORT = parseInt(process.env.SCAN_PORT || '3067', 10) || 3067;
const LIMIT = Math.max(1, parseInt(process.env.SCAN_SNAPSHOT_LIMIT || '10000', 10) || 10000);
const OUTPUT_DIR = process.env.SCAN_SNAPSHOT_DIR || path.join(__dirname, '..', 'regression', 'column-snapshots');

function requestJson(pathname) {
    return new Promise((resolve, reject) => {
        const req = http.get({
            host: HOST,
            port: PORT,
            path: pathname,
            timeout: 5000
        }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
                    return reject(new Error(`HTTP ${res.statusCode}: ${body}`));
                }

                try {
                    resolve(JSON.parse(body));
                } catch (err) {
                    reject(new Error(`Invalid JSON from server: ${err.message}`));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy(new Error('Request timeout while fetching /api/scan/last'));
        });
    });
}

function timestampSlug(date = new Date()) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

async function main() {
    const pathname = `/api/scan/last?limit=${LIMIT}`;
    const snapshot = await requestJson(pathname);

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const fileName = `scan-last-${timestampSlug()}.json`;
    const outputPath = path.join(OUTPUT_DIR, fileName);

    fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

    const count = Array.isArray(snapshot.results) ? snapshot.results.length : 0;
    console.log(`SNAPSHOT_CAPTURED: ${outputPath}`);
    console.log(`- host: ${HOST}:${PORT}`);
    console.log(`- results saved: ${count}`);
}

main().catch((err) => {
    console.error(`SNAPSHOT_CAPTURE_FAILED: ${err && err.message ? err.message : String(err)}`);
    process.exit(1);
});
