const { app, BrowserWindow, dialog } = require('electron');
const http = require('http');

let mainWindow = null;
let serverBootstrapped = false;
let usingExternalServer = false;

const APP_PORT = String(process.env.PORT || '3067');
const APP_URL = `http://127.0.0.1:${APP_PORT}`;

function pingServer(url) {
    return new Promise((resolve) => {
        const req = http.get(url, (res) => {
            res.resume();
            resolve(true);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(500, () => {
            req.destroy();
            resolve(false);
        });
    });
}

async function waitForServer(url, timeoutMs = 20000) {
    const started = Date.now();
    while ((Date.now() - started) < timeoutMs) {
        // eslint-disable-next-line no-await-in-loop
        const ok = await pingServer(url);
        if (ok) return true;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
}

function showStartupError(message) {
    if (!mainWindow) return;
    const escaped = String(message || 'Unknown error')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    mainWindow.loadURL(`data:text/html;charset=utf-8,
        <html>
          <body style="font-family: sans-serif; background: #111; color: #eee; padding: 24px;">
            <h2>Miner-Finder Startup Error</h2>
            <p>The embedded server did not start correctly.</p>
            <pre style="white-space: pre-wrap; background: #1b1b1b; padding: 12px; border-radius: 8px;">${escaped}</pre>
          </body>
        </html>
    `);
}

function bootstrapEmbeddedServer() {
    if (serverBootstrapped) return;
    process.env.AUTO_OPEN_BROWSER = '0';
    process.env.PORT = APP_PORT;
    // Load server in-process to avoid child-process + asar path issues in packaged Linux builds.
    // server.js starts Express immediately on require.
    // eslint-disable-next-line global-require
    require('./server.js');
    serverBootstrapped = true;
}

function isAddressInUseError(err) {
    if (!err) return false;
    const msg = String(err.message || '').toLowerCase();
    return err.code === 'EADDRINUSE' || msg.includes('eaddrinuse') || msg.includes('address already in use');
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 700,
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    app.isQuitting = true;
});

app.whenReady().then(async () => {
    createWindow();

    // If something is already serving the local URL (e.g. user started node server.js),
    // reuse it instead of failing with EADDRINUSE when trying to bootstrap again.
    const alreadyRunning = await pingServer(APP_URL);
    if (alreadyRunning) {
        usingExternalServer = true;
    }

    if (!usingExternalServer) {
        try {
            bootstrapEmbeddedServer();
        } catch (err) {
            // Port-race guard: if another process started in parallel, use it.
            if (isAddressInUseError(err)) {
                const externalNowRunning = await pingServer(APP_URL);
                if (externalNowRunning) {
                    usingExternalServer = true;
                } else {
                    const msg = 'Port 3067 is already in use by another process. Stop the other app and relaunch Miner-Finder.';
                    dialog.showErrorBox('Miner-Finder Startup Error', msg);
                    showStartupError(msg);
                    return;
                }
            } else {
                const msg = err && err.message ? String(err.message) : String(err);
                dialog.showErrorBox('Miner-Finder Server Bootstrap Failed', msg);
                showStartupError(msg);
                return;
            }
        }
    }

    const ready = await waitForServer(APP_URL);
    if (!ready) {
        const msg = `Server did not start within timeout at ${APP_URL}.`;
        dialog.showErrorBox('Miner-Finder Startup Error', msg);
        showStartupError(msg);
        return;
    }

    if (mainWindow) {
        mainWindow.loadURL(APP_URL);
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
            if (mainWindow) mainWindow.loadURL(APP_URL);
        }
    });
});
