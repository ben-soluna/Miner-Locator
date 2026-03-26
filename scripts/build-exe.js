const { spawnSync } = require('child_process');

const pkgJson = require('../package.json');
const version = String(pkgJson.version || '0.0.0');

const targetArg = String(process.argv[2] || '').trim();
const platform = process.platform;

function targetFromPlatform(currentPlatform) {
  return currentPlatform === 'win32' ? 'node20-win-x64' : 'node20-linux-x64';
}

function suffixFromTarget(targetName) {
  if (targetName.includes('win')) return 'win.exe';
  if (targetName.includes('linux')) return 'linux';
  if (targetName.includes('macos') || targetName.includes('darwin')) return 'macos';
  return platform === 'win32' ? 'win.exe' : 'linux';
}

const target = targetArg || targetFromPlatform(platform);
const suffix = suffixFromTarget(target);
const output = `dist/miner-finder-v${version}-${suffix}`;

const args = ['.', '--compress', 'GZip', '--target', target, '--output', output];
const result = spawnSync('pkg', args, { stdio: 'inherit', shell: true });

if (result.status !== 0) {
  process.exit(result.status || 1);
}

console.log(`BUILD_EXE_OK: ${output}`);
