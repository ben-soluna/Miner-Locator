const { spawn } = require('child_process');
const http = require('http');

const HOST = '127.0.0.1';
const PORT = 3067;
const BASE_URL = `http://${HOST}:${PORT}`;

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

function request(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE_URL}${pathname}`, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode || 0, body });
      });
    });

    req.on('error', reject);
    req.setTimeout(4000, () => {
      req.destroy(new Error(`Request timeout for ${pathname}`));
    });
  });
}

function fail(message) {
  console.error(`API_CHECK_FAILED: ${message}`);
  process.exitCode = 1;
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
        fail('server did not become ready in time');
        return;
      }
    }

    const homepage = await request('/');
    if (homepage.statusCode !== 200) {
      fail(`GET / expected 200, received ${homepage.statusCode}`);
      return;
    }

    const invalidScan = await request('/api/scan');
    if (invalidScan.statusCode !== 400) {
      fail(`GET /api/scan expected 400 without range, received ${invalidScan.statusCode}`);
      return;
    }

    if (!/range/i.test(invalidScan.body)) {
      fail('GET /api/scan error response did not mention range validation');
      return;
    }

    console.log('API_CHECK_OK');
    console.log('- GET / returned 200');
    console.log('- GET /api/scan without range returned 400 validation error');
  } catch (err) {
    fail(err && err.stack ? err.stack : String(err));
  } finally {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
    }
  }
}

main();
