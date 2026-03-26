const fs = require('fs');
const path = require('path');

const pkgJson = require('../package.json');
const version = String(pkgJson.version || '0.0.0');

const rootDir = path.resolve(__dirname, '..');
const distExe = path.join(rootDir, 'dist', `miner-finder-v${version}-win.exe`);
const portableDir = path.join(rootDir, 'portable-win');
const portableExe = path.join(portableDir, 'miner-finder.exe');
const startBat = path.join(portableDir, 'start.bat');
const runFromUsbBat = path.join(portableDir, 'run-from-usb.bat');
const readmeTxt = path.join(portableDir, 'README.txt');

if (!fs.existsSync(distExe)) {
  console.error(`Missing Windows executable: ${distExe}`);
  console.error('Run `npm run build:exe:win` first.');
  process.exit(1);
}

fs.mkdirSync(portableDir, { recursive: true });
fs.copyFileSync(distExe, portableExe);

const startBatContent = [
  '@echo off',
  'setlocal',
  'cd /d "%~dp0"',
  'echo Starting Miner-Finder on http://localhost:3067 ...',
  '"%~dp0miner-finder.exe"',
  'set EXIT_CODE=%ERRORLEVEL%',
  'if not "%EXIT_CODE%"=="0" (',
  '  echo.',
  '  echo Miner-Finder exited with code %EXIT_CODE%.',
  '  pause',
  ')',
  'exit /b %EXIT_CODE%'
].join('\r\n') + '\r\n';

const runFromUsbBatContent = [
  '@echo off',
  'setlocal',
  'cd /d "%~dp0"',
  'set "AUTO_OPEN_BROWSER=0"',
  'echo Starting Miner-Finder from USB on http://localhost:3067 ...',
  'start "" http://localhost:3067',
  '"%~dp0miner-finder.exe"',
  'set EXIT_CODE=%ERRORLEVEL%',
  'if not "%EXIT_CODE%"=="0" (',
  '  echo.',
  '  echo Miner-Finder exited with code %EXIT_CODE%.',
  '  pause',
  ')',
  'exit /b %EXIT_CODE%'
].join('\r\n') + '\r\n';

const readmeContent = [
  'Miner-Finder Portable (Windows)',
  '===============================',
  '',
  'Files in this folder:',
  '  - miner-finder.exe   (portable app binary)',
  '  - start.bat          (standard launcher)',
  '  - run-from-usb.bat   (USB-first launcher)',
  '',
  'How to run:',
  '  1. Copy this folder to your USB drive (or keep it where it is).',
  '  2. On Windows, double-click run-from-usb.bat to run directly from USB.',
  '  3. If USB execution is blocked by policy, copy folder to Desktop/Documents and use start.bat.',
  '  4. Open http://localhost:3067 if your browser does not open automatically.',
  '',
  'Notes:',
  '  - Node.js is not required for this portable package.',
  '  - Admin rights are typically not required.',
  '  - Enterprise policy tools (SmartScreen/AppLocker/Defender/firewall) may still block execution or scanning.'
].join('\r\n') + '\r\n';

fs.writeFileSync(startBat, startBatContent, 'utf8');
fs.writeFileSync(runFromUsbBat, runFromUsbBatContent, 'utf8');
fs.writeFileSync(readmeTxt, readmeContent, 'utf8');

console.log(`PORTABLE_WIN_OK: ${portableDir}`);
console.log(`PORTABLE_WIN_EXE: ${portableExe}`);
