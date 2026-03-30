<!-- Version: 0.2.2 -->
# API Documentation

Last updated: 2026-03-30

## Overview

The backend exposes one scan endpoint that streams live scan results using Server-Sent Events (SSE).

Base URL (local):

- `http://localhost:3067`

## Endpoint: `GET /api/scan`

Starts a scan across one or more validated IP ranges.

### Query Parameters

- `range` (required): string range expression.
- `concurrency` (optional): integer worker count for this scan request.
  - default: server `SCAN_CONCURRENCY` (env, default `48`)
  - allowed range: `1..128` (values are clamped server-side)

Supported expression formats:

- Single IP: `10.10.1.14`
- Dash range: `10.10.1.1-10.10.1.254`
- CIDR: `10.10.2.0/24`
- Comma-separated mixed expression:
  - `10.10.1.10-10.10.1.20,10.10.2.0/24,10.10.3.8`

### Validation Rules (Server-Side)

Implemented in `server.js` via `parseRangeExpression()`.

- `range` must be present and non-empty.
- IP octets must be numeric and in `[0..255]`.
- CIDR prefix must be in `[0..32]`.
- Dash ranges must have `start <= end`.
- Multiple ranges are sorted and merged when overlapping/adjacent.
- Max scan size is limited to `65536` IPs total.

If validation fails:

- HTTP `400`
- JSON body:

```json
{ "error": "<reason>" }
```

### Response Type

- `Content-Type: text/event-stream`
- Connection stays open while scan is in progress.

### SSE Messages

Default `message` events:

- `data: { ...result }`

Each online miner result is streamed as JSON payload:

```json
{
  "ip": "10.10.1.14",
  "status": "online",
  "hostname": "N/A",
  "mac": "N/A",
  "ipMode": "Static",
  "osType": "CGMiner",
  "osVersion": "4.11.1",
  "minerType": "Antminer S19 Pro",
  "controlBoard": "N/A",
  "pools": "stratum+tcp://pool.example.com:3333",
  "temperatureC": "67.8",
  "fans": "5340/5420/5360/5410",
  "voltage": "12.42",
  "frequencyMHz": "540",
  "psuInfo": "N/A",
  "hashrateTHs": "132.44",
  "hashboards": "3/3",
  "activeHashboards": "3",
  "data": {
    "summary": { "...": "raw summary payload" },
    "stats": { "...": "raw stats payload" },
    "pools": { "...": "raw pools payload" },
    "devs": { "...": "raw devs payload" },
    "version": { "...": "raw version payload" }
  }
}
```

Completion event:

- `event: done`
- `data: {}`

### Notes on Scan Behavior

- Miner-Finder probes miner API port `4028`.
- Per online miner, a **single joined CGMiner request** is sent for `summary+stats+pools+version+devs` (one TCP round-trip per host).
- `devdetails`, `edevs`, and `config` are fetched in a second pass only when miner fields are still missing after the base pass.
- If the firmware does not support joined commands, the helper falls back to requesting each command individually.
- Socket timeout is controlled by the `MINER_API_TIMEOUT_MS` env variable (default `1200` ms, min `200` ms).
- `client.setNoDelay(true)` is set on every connection to reduce TCP Nagle latency.
- Miner-Finder uses bounded worker concurrency (default `48`, env `SCAN_CONCURRENCY`) to avoid large burst traffic on switches.
- Targets ending in `.0` and `.255` are skipped.
- If the client disconnects, server marks scan as aborted and stops writing SSE events.

### Column Provenance Metadata

Each miner result now includes a `columnProvenance` object that explains where each table column came from.

Example:

```json
"columnProvenance": {
  "hashrate": { "source": "summary", "commands": ["summary"] },
  "voltage": { "source": "devdetails", "commands": ["devdetails"] },
  "cbType": { "source": "config", "commands": ["config"] }
}
```

This is used by backend validation and can also help troubleshoot missing values.

## Endpoint: `GET /api/scan/last`

Returns the most recent scan snapshot (including raw payloads and all mapped columns).

### Query Parameters

- `ip` (optional): return one miner by IP.
- `limit` (optional): maximum number of results to return (default `200`).

## Endpoint: `GET /api/scan/last/columns/validate`

Builds a per-column validation report from the latest scan snapshot.

### Query Parameters

- `ip` (optional): validate one miner by IP.
- `limit` (optional): maximum number of miners to validate (default `200`).

### Response Shape

- `meta`: scan metadata and validation scope.
- `summary`: per-column aggregate counts (`ok`, `missing`, `invalid`).
- `reports`: one report per miner, including:
  - per-column `status` (`ok`, `missing`, `invalid`)
  - `source` and `sourceCommands`
  - whether source command payload was present (`sourceCommandPresent`)
  - validation `reason` when invalid/missing

### Field Coverage Notes

- Enriched fields now include miner inventory and telemetry where exposed by miner firmware:
  - IP, miner identity, pools, hashrate, temperatures, fans, voltage, frequency,
    control board hints, hashboard totals/active counts, OS type/version, PSU hints.
- Some values may remain `N/A` for models/firmware that do not expose a field over port `4028`.
- `MAC`/`hostname`/OS hints use lightweight fallback enrichment when missing:
  - Linux ARP cache (`/proc/net/arp`) for MAC
  - reverse DNS for hostname
  - best-effort HTTP probe (`/cgi-bin/get_system_info.cgi`) with short timeout and low concurrency

## Example Requests

Single range:

```bash
curl -N "http://localhost:3067/api/scan?range=10.10.1.1-10.10.1.10"
```

CIDR:

```bash
curl -N "http://localhost:3067/api/scan?range=10.10.2.0/24"
```

Mixed expression:

```bash
curl -N "http://localhost:3067/api/scan?range=10.10.1.8,10.10.2.0/30,10.10.3.10-10.10.3.20"
```
