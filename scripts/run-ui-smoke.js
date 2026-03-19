const { spawn } = require('child_process');
const http = require('http');

const HOST = '127.0.0.1';
const PORT = 3000;
const BASE_URL = `http://${HOST}:${PORT}`;
const CLICKTHROUGH_SCRIPT = 'scripts/selenium-clickthrough.js';

function checkServerOnce() {
  return new Promise((resolve) => {
    const req = http.get(`${BASE_URL}/`, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });

    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkServerOnce()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function runNodeScript(scriptPath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code || 0));
    child.on('error', () => resolve(1));
  });
}

async function main() {
  let serverProcess = null;

  try {
    const serverAlreadyRunning = await checkServerOnce();

    if (!serverAlreadyRunning) {
      serverProcess = spawn(process.execPath, ['server.js'], {
        stdio: 'inherit',
        env: {
          ...process.env,
          AUTO_OPEN_BROWSER: '0'
        }
      });

      const ready = await waitForServer(10000);
      if (!ready) {
        console.error('UI smoke: server did not become ready in time.');
        process.exitCode = 1;
        return;
      }
    }

    const exitCode = await runNodeScript(CLICKTHROUGH_SCRIPT);
    process.exitCode = exitCode;
  } finally {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
    }
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
