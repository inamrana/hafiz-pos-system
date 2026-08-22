const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const isDev = !app.isPackaged;
let serverProcess = null;
let mainWindow = null;

function waitForServer(url) {
  return new Promise((resolve) => {
    const check = () => {
      http
        .get(url, (res) => {
          res.resume();
          resolve();
        })
        .on('error', () => setTimeout(check, 300));
    };
    check();
  });
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL(url);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  if (isDev) {
    createWindow('http://localhost:3000');
    return;
  }

  // This app is now multi-tenant (see /signup): shop data lives under DATA_DIR rather
  // than a single hardcoded file. Pointing DATA_DIR at userData keeps this Electron
  // shell usable as a self-hosted single-machine server if you don't want the hosted
  // web version — every shop that signs up still gets its own isolated database.
  const dataDir = path.join(app.getPath('userData'), 'pos-data');
  const port = 3777;
  const nextBin = path.join(__dirname, 'node_modules', 'next', 'dist', 'bin', 'next');

  serverProcess = spawn(process.execPath, [nextBin, 'start', '-p', String(port)], {
    cwd: __dirname,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      DATA_DIR: dataDir,
      NODE_ENV: 'production',
    },
    stdio: 'inherit',
  });

  await waitForServer(`http://127.0.0.1:${port}`);
  createWindow(`http://127.0.0.1:${port}`);
});

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill();
});
