<!-- Version: 0.2.2 -->
# Miner-Finder

**GitHub:** https://github.com/ben-soluna/Miner-Locator

Last updated: 2026-03-24 (v0.2.2)

Lightweight miner network scanner with a browser UI and real-time scan results over Server-Sent Events (SSE).

## Current Status

- Home tab scanning: active
- IP Ranges management: active (saved ranges, multi-select, combined expressions)
- Sidebar resize control in Settings: active

## Roadmap

See `public/TODO.md` for detailed feature tracking.

## Requirements

- Node.js 18+ recommended
- npm 9+ recommended

## Quick Start

```bash
npm install
npm start
```

Open: `http://localhost:3067`

## Scripts

- `npm start` — Starts `server.js` on port 3067.
- `npm run test:api` — API validation checks.
- `npm run test:ui-smoke` — UI clickthrough test with Selenium.
- `npm run build:exe` — Build OS-native executable to `dist/`.
- `npm run bundle:portable:win` — Create Windows portable bundle with launcher.
- `npm run bundle:node:win` — Create signed Node.js Windows package (SmartScreen-friendly).
- `npm run test:project` — Full verification: syntax + API + UI + build.

## Windows Validation

- Full project checks run on both Linux and Windows via GitHub Actions:
  - `.github/workflows/full-project.yml`
- Push or open a PR to execute the same `npm run test:project` pipeline on `windows-latest`.

## Portable Windows Usage

- Preferred artifact: `dist/miner-finder-v<version>-portable-win.zip`
- Build with: `npm run bundle:node:win`
- Extract the zip and run `start.bat` (or `run-from-usb.bat`).
- No Node.js install is required on the target machine (runtime is included as official signed `node.exe`).
- Admin rights are usually not required, but local policy controls (AppLocker/Defender/firewall) can still restrict execution or network scanning.

## USB Windows Usage

- Build package: `npm run bundle:usb:win`
- Copy `portable-win/` to USB.
- On target Windows machine, run `portable-win/run-from-usb.bat`.
- If USB execution is blocked by endpoint policy, copy the folder locally and run `portable-win/start.bat`.

## Project Structure

```text
server.js                # Express server + scan API
public/index.html        # Main UI (single-page HTML/CSS/JS)
scripts/run-api-check.js # Backend HTTP validation checks
scripts/run-ui-smoke.js  # Starts server if needed and runs UI clickthrough
scripts/selenium-clickthrough.js # Browser automation for core UI flows
scripts/build-exe.js     # Cross-platform pkg build wrapper
docs/API.md              # API contract and scan validation behavior
docs/OPERATIONS.md       # Backup, restore, release, and routine ops
```

## Scan Input Formats

Miner-Finder accepts these range formats:

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
- If project verification fails:
  - Ensure dependencies are installed: `npm install`.
  - Re-run: `npm run test:project`.

## Related Docs

- API details: `docs/API.md`
- Operational runbook: `docs/OPERATIONS.md`
- Implementation backlog: `public/TODO.md`
