# Scanner

Last updated: 2026-03-17 (session 2)

Lightweight miner network scanner with a browser UI and real-time scan results over Server-Sent Events (SSE).

## Current Status

- Home tab scanning: active
- IP Ranges management: active (saved ranges, multi-select, combined expressions)
- Site Map: intentionally disabled — pending redesign
- Sidebar resize control in Settings: planned

## Roadmap Snapshot

Source of truth: `public/TODO.md`

Frontend next:

- Add a Settings control to resize the sidebar width.
- Reintroduce a production-ready Site Map view after redesign.

Backend (completed):

- Sends `summary+stats+pools+version+devs` as a single joined CGMiner command per host.
- `devdetails` deferred to a conditional extra pass — not fetched unless fields are missing.
- `MINER_API_TIMEOUT_MS` env variable (default `1200` ms) controls per-host socket timeout.
- Lightweight fallback enrichment for MAC address, hostname, and OS hints.

## Requirements

- Node.js 18+ recommended
- npm 9+ recommended

## Quick Start

```bash
npm install
npm start
```

Open:

- `http://localhost:3000`

## Scripts

- `npm start`
  - Starts `server.js` on port `3000`.
- `npm run build:minify`
  - Minifies inline client JavaScript from `public/index.html` and writes output to `public/index.min.html`.

## Project Structure

```text
server.js                # Express server + scan API
public/index.html        # Main UI (single-page HTML/CSS/JS)
public/index.min.html    # Generated minified build output
scripts/minify-client.js # Minify pipeline for inline client JS
docs/API.md              # API contract and scan validation behavior
docs/OPERATIONS.md       # Backup, restore, release, and routine ops
```

## Scan Input Formats

The scanner accepts these range formats:

- Single IP: `10.10.1.14`
- Dash range: `10.10.1.1-10.10.1.254`
- CIDR: `10.10.2.0/24`
- Combined (comma-separated): `10.10.1.10-10.10.1.20,10.10.2.0/24,10.10.3.8`

Validation is enforced server-side in `server.js`.

## Security Notes

- Frontend minification is for friction, not security.
- Do not place secrets in client code (`public/index.html`).
- Sensitive validation and scan limits are enforced on the backend.

## Troubleshooting

- If scan does not start:
  - Verify input format in the Home tab.
  - Check backend logs from `npm start`.
- If minify build fails:
  - Ensure dependencies are installed: `npm install`.
  - Re-run: `npm run build:minify`.

## Related Docs

- API details: `docs/API.md`
- Operational runbook: `docs/OPERATIONS.md`
- Implementation backlog: `public/TODO.md`
