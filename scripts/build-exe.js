const { spawnSync } = require('child_process');

const pkgJson = require('../package.json');
const version = String(pkgJson.version || '0.0.0');

const platform = process.platform;
const target = platform === 'win32' ? 'node20-win-x64' : 'node20-linux-x64';
const suffix = platform === 'win32' ? 'win.exe' : 'linux';
const output = `dist/miner-finder-v${version}-${suffix}`;

const args = ['.', '--compress', 'GZip', '--target', target, '--output', output];
const result = spawnSync('pkg', args, { stdio: 'inherit', shell: true });

if (result.status !== 0) {
  process.exit(result.status || 1);
}

console.log(`BUILD_EXE_OK: ${output}`);
