'use strict';

const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');

const DEFAULT_PORT = 3067;
const SERVER_BOOT_TIMEOUT_MS = 20000;
const SERVER_POLL_INTERVAL_MS = 250;

let mainWindow = null;
let serverProcess = null;
let serverPort = null;
let serverStarted = false;
let quitting = false;

function getServerEntryPath() {
    return path.join(__dirname, '..', 'server.js');
}

function getBaseUrl(port) {
    return `http://127.0.0.1:${port}`;
}

function isPortAvailable(port) {
    return new Promise((resolve) => {
        const tester = net.createServer();

        tester.once('error', () => {
            resolve(false);
        });

        tester.once('listening', () => {
            tester.close(() => resolve(true));
        });

        tester.listen(port, '127.0.0.1');
    });
}

async function findAvailablePort(startPort) {
    for (let port = startPort; port < startPort + 50; port += 1) {
        if (await isPortAvailable(port)) return port;
    }

    throw new Error(`Unable to find an open localhost port starting at ${startPort}.`);
}

function waitForServer(port, timeoutMs) {
    const url = `${getBaseUrl(port)}/`;
    const deadline = Date.now() + timeoutMs;

    return new Promise((resolve, reject) => {
        function tryConnect() {
            const req = http.get(url, (res) => {
                res.resume();
                resolve();
            });

            req.on('error', () => {
                if (Date.now() >= deadline) {
                    reject(new Error(`Timed out waiting for ${url}`));
                    return;
                }

                setTimeout(tryConnect, SERVER_POLL_INTERVAL_MS);
            });

            req.setTimeout(SERVER_POLL_INTERVAL_MS, () => {
                req.destroy();
            });
        }

        tryConnect();
    });
}

function attachServerLogging(child) {
    if (child.stdout) {
        child.stdout.on('data', (chunk) => {
            process.stdout.write(`[server] ${chunk}`);
        });
    }

    if (child.stderr) {
        child.stderr.on('data', (chunk) => {
            process.stderr.write(`[server] ${chunk}`);
        });
    }
}

async function startServer() {
    if (serverStarted && serverPort !== null) return serverPort;

    serverPort = await findAvailablePort(DEFAULT_PORT);
    const childEnv = {
        ...process.env,
        AUTO_OPEN_BROWSER: '0',
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: app.isPackaged ? 'production' : (process.env.NODE_ENV || 'development'),
        PORT: String(serverPort)
    };

    serverProcess = spawn(process.execPath, [getServerEntryPath()], {
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    attachServerLogging(serverProcess);

    const exitPromise = new Promise((_, reject) => {
        serverProcess.once('exit', (code, signal) => {
            serverStarted = false;
            serverProcess = null;
            reject(new Error(`Server exited before startup completed (code=${code}, signal=${signal || 'none'})`));
        });
    });

    await Promise.race([
        waitForServer(serverPort, SERVER_BOOT_TIMEOUT_MS),
        exitPromise
    ]);

    serverStarted = true;
    return serverPort;
}

function stopServer() {
    if (!serverProcess) return;

    const child = serverProcess;
    serverProcess = null;
    serverStarted = false;

    if (!child.killed) {
        child.kill();
    }
}

async function createMainWindow() {
    const port = await startServer();

    mainWindow = new BrowserWindow({
        width: 1440,
        height: 920,
        minWidth: 1024,
        minHeight: 700,
        autoHideMenuBar: true,
        backgroundColor: '#111827',
        show: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow.once('ready-to-show', () => {
        if (mainWindow) {
            mainWindow.show();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    await mainWindow.loadURL(getBaseUrl(port));
}

async function bootstrap() {
    try {
        await createMainWindow();
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await dialog.showMessageBox({
            type: 'error',
            title: 'Miner-Finder failed to start',
            message: 'The Electron shell could not start the local server.',
            detail,
            buttons: ['Close']
        });
        app.quit();
    }
}

app.whenReady().then(bootstrap);

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        bootstrap();
    }
});

app.on('before-quit', () => {
    quitting = true;
    stopServer();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        if (!quitting) stopServer();
        app.quit();
    }
});