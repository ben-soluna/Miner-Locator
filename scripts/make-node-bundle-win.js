'use strict';

/**
 * make-node-bundle-win.js
 *
 * Builds a portable Windows zip bundle that uses the official signed node.exe
 * from nodejs.org instead of a pkg-compiled exe.  Users extract the zip and
 * double-click start.bat — no install, no SmartScreen warning.
 *
 * Usage:  node scripts/make-node-bundle-win.js
 *         npm run bundle:node:win
 *
 * To refresh the cached node.exe, delete node-bundle-win/.cache/ and re-run.
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

// ─── Config ──────────────────────────────────────────────────────────────────
// Pin to a specific LTS release.  Update this to pick up new Node 20 patches.
const NODE_VERSION = 'v20.20.1';
const NODE_EXE_URL = `https://nodejs.org/dist/${NODE_VERSION}/win-x64/node.exe`;
// ─────────────────────────────────────────────────────────────────────────────

const pkgJson    = require('../package.json');
const version    = String(pkgJson.version || '0.0.0');
const BUNDLE_NAME = `miner-finder-v${version}-portable-win`;

const rootDir    = path.resolve(__dirname, '..');
const buildDir   = path.join(rootDir, 'node-bundle-win');
const cacheDir   = path.join(buildDir, '.cache');
const cachedNode = path.join(cacheDir, `node-${NODE_VERSION}.exe`);
const bundleRoot = path.join(buildDir, BUNDLE_NAME);
const distDir    = path.join(rootDir, 'dist');
const distZip    = path.join(distDir, `${BUNDLE_NAME}.zip`);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = (u) => {
      https.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return get(res.headers.location);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          reject(new Error(`HTTP ${res.statusCode} downloading ${u}`));
          return;
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (total) {
            const pct = Math.round(downloaded / total * 100);
            process.stdout.write(`\r  Progress: ${pct}%  (${(downloaded / 1024 / 1024).toFixed(1)} MB)`);
          }
        });
        res.pipe(file);
        file.on('finish', () => {
          process.stdout.write('\n');
          file.close(resolve);
        });
      }).on('error', (err) => {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        reject(err);
      });
    };
    get(url);
  });
}

function checkZip() {
  try {
    execSync('which zip', { stdio: 'ignore' });
  } catch {
    console.error('Error: `zip` command not found. Install it with: sudo apt install zip');
    process.exit(1);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  checkZip();

  console.log(`\nBuilding portable Node.js bundle: ${BUNDLE_NAME}`);
  console.log('────────────────────────────────────────────────────');

  // 1. Clean bundle output dir, keep cache
  fs.rmSync(bundleRoot, { recursive: true, force: true });
  fs.mkdirSync(bundleRoot, { recursive: true });
  fs.mkdirSync(cacheDir,   { recursive: true });
  fs.mkdirSync(distDir,    { recursive: true });

  // 2. Fetch node.exe (download once, reuse from cache)
  if (fs.existsSync(cachedNode)) {
    console.log(`node.exe: using cached ${NODE_VERSION}`);
  } else {
    console.log(`node.exe: downloading ${NODE_VERSION} from nodejs.org ...`);
    await download(NODE_EXE_URL, cachedNode);
    console.log(`node.exe: cached at ${cachedNode}`);
  }
  fs.copyFileSync(cachedNode, path.join(bundleRoot, 'node.exe'));
  console.log('node.exe: copied to bundle');

  // 3. Copy app source
  console.log('Source:  copying server.js, package.json, public/ ...');
  fs.copyFileSync(path.join(rootDir, 'server.js'),    path.join(bundleRoot, 'server.js'));
  fs.copyFileSync(path.join(rootDir, 'package.json'), path.join(bundleRoot, 'package.json'));
  copyDir(path.join(rootDir, 'public'), path.join(bundleRoot, 'public'));

  // 4. Install production-only dependencies inside the bundle
  //    express has no native modules so it installs fine cross-platform
  console.log('npm:     installing production dependencies ...');
  execSync('npm install --omit=dev --no-audit --no-fund', {
    cwd: bundleRoot,
    stdio: 'inherit'
  });

  // 5. Write launchers
  console.log('Writing: launcher scripts and README ...');

  const startBat = [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    'echo Starting Miner-Finder on http://localhost:3000 ...',
    '"%~dp0node.exe" server.js',
    'set EXIT_CODE=%ERRORLEVEL%',
    'if not "%EXIT_CODE%"=="0" (',
    '  echo.',
    '  echo Miner-Finder exited with code %EXIT_CODE%.',
    '  pause',
    ')',
    'exit /b %EXIT_CODE%'
  ].join('\r\n') + '\r\n';

  const runFromUsbBat = [
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    'set "AUTO_OPEN_BROWSER=0"',
    'echo Starting Miner-Finder from USB on http://localhost:3000 ...',
    'start "" http://localhost:3000',
    '"%~dp0node.exe" server.js',
    'set EXIT_CODE=%ERRORLEVEL%',
    'if not "%EXIT_CODE%"=="0" (',
    '  echo.',
    '  echo Miner-Finder exited with code %EXIT_CODE%.',
    '  pause',
    ')',
    'exit /b %EXIT_CODE%'
  ].join('\r\n') + '\r\n';

  const readmeTxt = [
    `Miner-Finder v${version} - Portable Windows Bundle`,
    '====================================================',
    '',
    'No install required.  Uses the official signed Node.js runtime from',
    'nodejs.org — no SmartScreen warning.',
    '',
    'Files:',
    '  node.exe            Official signed Node.js ' + NODE_VERSION + ' runtime',
    '  server.js           Miner-Finder server',
    '  start.bat           Standard launcher',
    '  run-from-usb.bat    USB launcher (opens browser automatically)',
    '  public/             Web UI files',
    '  node_modules/       Pre-installed dependencies (no npm needed)',
    '',
    'How to run:',
    '  1. Extract this zip to any folder (USB drive, Desktop, Documents, etc.)',
    '  2. Double-click run-from-usb.bat',
    '  3. Your browser will open to http://localhost:3000',
    '  4. Close the command window when done',
    '',
    'Notes:',
    '  - Node.js or npm are NOT required on the target machine',
    '  - Admin rights are NOT required',
    '  - If your browser does not open, navigate to http://localhost:3000 manually',
  ].join('\r\n') + '\r\n';

  fs.writeFileSync(path.join(bundleRoot, 'start.bat'),         startBat,    'utf8');
  fs.writeFileSync(path.join(bundleRoot, 'run-from-usb.bat'),  runFromUsbBat, 'utf8');
  fs.writeFileSync(path.join(bundleRoot, 'README.txt'),        readmeTxt,   'utf8');

  // 6. Zip  (from buildDir so the zip contains the folder at its root)
  console.log('Zip:     creating archive ...');
  if (fs.existsSync(distZip)) fs.unlinkSync(distZip);
  execSync(`zip -r "${distZip}" "${BUNDLE_NAME}" --exclude "*.DS_Store"`, {
    cwd: buildDir,
    stdio: 'inherit'
  });

  const sizeMb = (fs.statSync(distZip).size / 1024 / 1024).toFixed(1);
  console.log(`\nNODE_BUNDLE_WIN_OK: ${distZip}  (${sizeMb} MB)`);
}

main().catch(err => {
  console.error(`\nBuild failed: ${err.message}`);
  process.exit(1);
});
