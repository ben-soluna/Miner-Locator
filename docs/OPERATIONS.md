<!-- Version: 0.2.2 -->
# Operations Runbook

Last updated: 2026-03-30

## Routine Commands

Install dependencies:

```bash
npm install
```

Start app:

```bash
npm start
```

Build minified client artifact:

```bash
npm run build:minify
```

Build Windows portable bundle:

```bash
npm run bundle:portable:win
```

Build Windows SmartScreen-friendly bundle (zip with official `node.exe`):

```bash
npm run bundle:node:win
```

Capture latest scan snapshot for regression fixtures:

```bash
npm run capture:snapshot
```

Run column regression checks against saved snapshots:

```bash
npm run test:column-regression
```

## Release / Checkpoint Flow

1. Verify app runs and key paths work.
2. Build minified output:

```bash
npm run build:minify
```

2a. Build/update Windows portable distribution folder:

```bash
npm run bundle:portable:win
```

2b. Build/update Windows zip bundle that avoids custom `.exe` distribution:

```bash
npm run bundle:node:win
```

3. Review changes:

```bash
git status --short
git diff --stat
```

4. Sync docs and roadmap:

```bash
# Ensure docs reflect current status and next steps
sed -n '1,220p' public/TODO.md
```

5. Commit and push:

```bash
git add -A
git commit -m "Checkpoint: <summary>"
git push origin main
```

## Backlog Source of Truth

- Use `public/TODO.md` as the implementation roadmap.
- Keep these docs aligned when roadmap items are completed or reprioritized:
  - `README.md`
  - `docs/API.md`
  - `docs/OPERATIONS.md`

## Local Backup Strategy

Use both a Git bundle and a compressed project archive.

### Create Backup

```bash
TS=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR=/home/ben/Scanner-backups
mkdir -p "$BACKUP_DIR"

git -C /home/ben/Scanner bundle create "$BACKUP_DIR/Scanner-$TS.bundle" --all
tar -C /home/ben -czf "$BACKUP_DIR/Scanner-$TS.tar.gz" \
  --exclude='Scanner/.git' \
  --exclude='Scanner/node_modules' \
  Scanner
```

Artifacts:

- `Scanner-<timestamp>.bundle` (full Git history snapshot)
- `Scanner-<timestamp>.tar.gz` (working tree archive)
- `portable-win/` (portable Windows distribution: `miner-finder.exe`, `start.bat`, `README.txt`)
- `dist/miner-finder-v<version>-portable-win.zip` (portable Windows zip with official `node.exe`, launchers, and app files)

## Restore Procedures

### Restore from `.bundle` (best for full Git history)

```bash
git clone /home/ben/Scanner-backups/Scanner-<timestamp>.bundle Scanner-restored
cd Scanner-restored
git remote add origin <your-github-repo-url>
```

### Restore from `.tar.gz` (working files)

```bash
mkdir -p /home/ben/restore-target
tar -C /home/ben/restore-target -xzf /home/ben/Scanner-backups/Scanner-<timestamp>.tar.gz
cd /home/ben/restore-target/Scanner
npm install
```

## Production Caution Notes

- Minification is not a security boundary.
- Keep sensitive logic and checks in backend (`server.js`).
- Do not store credentials in `public/index.html`.

## Current Feature Flags / Operational State

- Site Map is intentionally disabled in UI — pending redesign.
- Scanning and range management are active.
- Saved IP ranges support multi-select and combined expressions.
- Scan concurrency is configurable from the Settings tab (persisted to `localStorage`).
- Pending: sidebar resize control under Settings.

## Env Variables

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3067` | HTTP server port |
| `SCAN_CONCURRENCY` | `48` | Max parallel host probes |
| `MINER_API_TIMEOUT_MS` | `1200` | Per-host CGMiner socket timeout (ms, min 200) |
| `HTTP_FALLBACK_CONCURRENCY` | `6` | Max parallel HTTP enrichment requests |
| `PER_HOST_COMMAND_CONCURRENCY` | `2` | Fallback per-host command concurrency (non-join path) |

## Health Checks

Basic syntax checks:

```bash
node --check server.js
node --check scripts/minify-client.js
node --check scripts/capture-scan-snapshot.js
node --check scripts/run-column-regression.js
```

## Column Regression Workflow

1. Run a representative network scan from the UI.
2. Capture the latest `/api/scan/last` payload:

```bash
npm run capture:snapshot
```

3. Run regression checks on all fixtures in `regression/column-snapshots/`:

```bash
npm run test:column-regression
```

Regression policy:

- Hard-fail checks: contract columns (`ip`, `status`) and provenance structure.
- Warning-only checks: all remaining data columns (quality visibility without failing builds on firmware/protocol differences).

4. Optional: test one fixture file only:

```bash
node scripts/run-column-regression.js regression/column-snapshots/scan-last-YYYYMMDD-HHMMSS.json
```

Expected outcomes:

- No syntax errors printed
- Minify build writes `public/index.min.html`
