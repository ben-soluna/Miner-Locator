const fs = require('fs');
const path = require('path');

const DEFAULT_FIXTURE_DIR = path.join(__dirname, '..', 'regression', 'column-snapshots');

const COLUMN_SPECS = [
    { id: 'ip', required: true, warnOnly: false },
    { id: 'status', required: true, warnOnly: false },
    { id: 'mac', required: false, warnOnly: true },
    { id: 'ipMode', required: false, warnOnly: true },
    { id: 'os', required: false, warnOnly: true },
    { id: 'osVersion', required: false, warnOnly: true },
    { id: 'minerType', required: false, warnOnly: true },
    { id: 'cbType', required: false, warnOnly: true },
    { id: 'psuInfo', required: false, warnOnly: true },
    { id: 'temp', required: false, warnOnly: true },
    { id: 'fans', required: false, warnOnly: true },
    { id: 'fanStatus', required: false, warnOnly: true },
    { id: 'voltage', required: false, warnOnly: true },
    { id: 'frequencyMHz', required: false, warnOnly: true },
    { id: 'hashrate', required: false, warnOnly: true },
    { id: 'activeHashboards', required: false, warnOnly: true },
    { id: 'hashboards', required: false, warnOnly: true },
    { id: 'pools', required: false, warnOnly: true }
];

function isMissing(value) {
    const text = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
    return !text || text === 'n/a' || text === 'na' || text === 'unknown';
}

function ipToInt(ip) {
    const parts = String(ip).trim().split('.');
    if (parts.length !== 4) return NaN;
    let n = 0;
    for (const p of parts) {
        if (!/^\d+$/.test(p)) return NaN;
        const v = Number(p);
        if (!Number.isFinite(v) || v < 0 || v > 255) return NaN;
        n = (n << 8) + v;
    }
    return n >>> 0;
}

function validateColumnValue(columnId, value) {
    if (columnId === 'status') {
        return String(value || '').toLowerCase() === 'online'
            ? { valid: true }
            : { valid: false, reason: 'Expected online status.' };
    }

    if (isMissing(value)) {
        return { valid: false, reason: 'Value is missing.' };
    }

    const raw = String(value).trim();

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

function listJsonFiles(inputPath) {
    const resolved = path.resolve(inputPath || DEFAULT_FIXTURE_DIR);
    if (!fs.existsSync(resolved)) return [];

    const stats = fs.statSync(resolved);
    if (stats.isFile()) return resolved.endsWith('.json') ? [resolved] : [];

    return fs.readdirSync(resolved)
        .filter((name) => name.toLowerCase().endsWith('.json'))
        .map((name) => path.join(resolved, name))
        .sort();
}

function parseSnapshotMiners(snapshot) {
    if (Array.isArray(snapshot)) return snapshot;
    if (!snapshot || typeof snapshot !== 'object') return [];
    if (Array.isArray(snapshot.results)) return snapshot.results;
    if (Array.isArray(snapshot.miners)) return snapshot.miners;
    return [];
}

function validateProvenance(miner, columnId) {
    const provenance = miner && miner.columnProvenance && typeof miner.columnProvenance === 'object'
        ? miner.columnProvenance
        : null;
    if (!provenance) {
        return { valid: false, reason: 'columnProvenance object missing.' };
    }

    const col = provenance[columnId];
    if (!col || typeof col !== 'object') {
        return { valid: false, reason: `columnProvenance.${columnId} missing.` };
    }

    if (typeof col.source !== 'string' || !col.source.trim()) {
        return { valid: false, reason: `columnProvenance.${columnId}.source missing.` };
    }

    if (!Array.isArray(col.commands)) {
        return { valid: false, reason: `columnProvenance.${columnId}.commands must be an array.` };
    }

    return { valid: true };
}

function runFileRegression(filePath) {
    const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const miners = parseSnapshotMiners(json);

    const result = {
        filePath,
        minerCount: miners.length,
        requiredFailures: 0,
        optionalFailures: 0,
        provenanceFailures: 0,
        errors: []
    };

    miners.forEach((miner, index) => {
        const minerIp = String(miner && miner.ip ? miner.ip : `index-${index}`);

        COLUMN_SPECS.forEach((spec) => {
            const value = miner ? miner[spec.id] : null;
            const validity = validateColumnValue(spec.id, value);
            if (!validity.valid) {
                const line = `${minerIp} ${spec.id}: ${validity.reason}`;
                if (spec.required && !spec.warnOnly) {
                    result.requiredFailures += 1;
                    result.errors.push(`REQUIRED ${line}`);
                } else {
                    result.optionalFailures += 1;
                }
            }

            const provenance = validateProvenance(miner, spec.id);
            if (!provenance.valid) {
                result.provenanceFailures += 1;
                result.errors.push(`PROVENANCE ${minerIp} ${spec.id}: ${provenance.reason}`);
            }
        });
    });

    return result;
}

function printReport(results) {
    let totalMiners = 0;
    let totalRequiredFailures = 0;
    let totalOptionalFailures = 0;
    let totalProvenanceFailures = 0;

    for (const r of results) {
        totalMiners += r.minerCount;
        totalRequiredFailures += r.requiredFailures;
        totalOptionalFailures += r.optionalFailures;
        totalProvenanceFailures += r.provenanceFailures;

        console.log(`COLUMN_REGRESSION_FILE: ${r.filePath}`);
        console.log(`- miners: ${r.minerCount}`);
        console.log(`- required failures: ${r.requiredFailures}`);
        console.log(`- optional failures: ${r.optionalFailures}`);
        console.log(`- provenance failures: ${r.provenanceFailures}`);

        const sample = r.errors.slice(0, 10);
        sample.forEach((line) => console.log(`  * ${line}`));
        if (r.errors.length > sample.length) {
            console.log(`  * ... ${r.errors.length - sample.length} more`);
        }
    }

    console.log('COLUMN_REGRESSION_SUMMARY');
    console.log(`- files: ${results.length}`);
    console.log(`- miners: ${totalMiners}`);
    console.log(`- required failures: ${totalRequiredFailures}`);
    console.log(`- optional failures: ${totalOptionalFailures}`);
    console.log(`- provenance failures: ${totalProvenanceFailures}`);

    return {
        totalRequiredFailures,
        totalProvenanceFailures
    };
}

function main() {
    const targetPath = process.argv[2] || DEFAULT_FIXTURE_DIR;
    const files = listJsonFiles(targetPath);

    if (!files.length) {
        console.error(`COLUMN_REGRESSION_FAILED: no JSON snapshot files found at ${targetPath}`);
        process.exit(1);
    }

    const results = files.map(runFileRegression);
    const summary = printReport(results);

    if (summary.totalRequiredFailures > 0 || summary.totalProvenanceFailures > 0) {
        console.error('COLUMN_REGRESSION_FAILED: required/provenance regressions detected');
        process.exit(1);
    }

    console.log('COLUMN_REGRESSION_OK');
}

main();
