const { app, BrowserWindow, dialog } = require('electron');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');

let mainWindow = null;
let serverStarted = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
const appIconPath = path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

if (process.platform === 'win32') {
  app.setAppUserModelId('com.local.ainovelstudio');
}

if (!gotSingleInstanceLock) {
  app.quit();
}

function getLogFilePath() {
  return path.join(getExternalDataDir(), 'desktop.log');
}

function getExternalDataDir() {
  if (process.env.APP_DATA_DIR) return process.env.APP_DATA_DIR;
  if (!app.isPackaged) return path.join(__dirname, '..', 'data');
  return path.join(path.dirname(process.execPath), '..', 'AI小说工作台-data');
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function migrateLegacyUserData(targetDataDir) {
  const legacyDataDir = path.join(app.getPath('userData'), 'data');
  const legacyDb = path.join(legacyDataDir, 'db.json');
  const targetDb = path.join(targetDataDir, 'db.json');
  if (!(await pathExists(legacyDb)) || await pathExists(targetDb)) return;
  await fs.mkdir(targetDataDir, { recursive: true });
  await fs.cp(legacyDataDir, targetDataDir, { recursive: true, force: false, errorOnExist: false });
}

async function writeLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    await fs.mkdir(getExternalDataDir(), { recursive: true });
    await fs.appendFile(getLogFilePath(), line, 'utf8');
  } catch {}
}

function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    function probe() {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });

      request.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Server not ready: ${url}`));
          return;
        }
        setTimeout(probe, 300);
      });

      request.setTimeout(2000, () => {
        request.destroy();
      });
    }

    probe();
  });
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findAvailablePort(startPort = 3001, attempts = 40) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = startPort + offset;
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available local port found from ${startPort}`);
}

async function startEmbeddedServer() {
  if (serverStarted) return;
  serverStarted = true;

  const serverPath = path.join(__dirname, '..', 'server.js');
  const port = await findAvailablePort(Number(process.env.PORT) || 3001);
  const dataDir = getExternalDataDir();
  try {
    await migrateLegacyUserData(dataDir);
    await fs.mkdir(dataDir, { recursive: true });
    fsSync.accessSync(dataDir, fsSync.constants.W_OK);
  } catch (error) {
    throw new Error(`数据目录不可写：${dataDir}。请把软件安装到可写目录，或设置 APP_DATA_DIR。${error?.message || ''}`);
  }
  process.env.APP_DATA_DIR = dataDir;
  process.env.PORT = String(port);
  await writeLog(`Starting embedded server from ${serverPath} on port ${port}, dataDir=${dataDir}`);
  const serverModule = await import(pathToFileURL(serverPath).href);
  const started = await serverModule.startServer({ port, maxAttempts: 40 });
  await writeLog(`Embedded server listening on ${started.url}`);
  return started.url;
}

async function createWindow() {
  let startUrl = process.env.ELECTRON_START_URL || '';
  if (!process.env.ELECTRON_START_URL) {
    startUrl = await startEmbeddedServer();
  }
  await writeLog(`Waiting for ${startUrl}`);
  await waitForServer(startUrl);
  await writeLog(`Server ready ${startUrl}`);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1200,
    minHeight: 760,
    autoHideMenuBar: true,
    icon: appIconPath,
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.webContents.on('did-fail-load', async (_event, code, description, validatedUrl) => {
    await writeLog(`did-fail-load code=${code} description=${description} url=${validatedUrl}`);
  });

  mainWindow.webContents.on('console-message', async (event) => {
    await writeLog(
      `console level=${event.level} source=${event.sourceId}:${event.lineNumber} message=${event.message}`,
    );
  });

  mainWindow.webContents.on('render-process-gone', async (_event, details) => {
    await writeLog(`render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
  });

  await mainWindow.loadURL(startUrl);
  await writeLog(`Window loaded ${startUrl}`);
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  try {
    await createWindow();
  } catch (error) {
    console.error(error);
    writeLog(`Startup failure ${String(error?.stack || error)}`);
    dialog.showErrorBox('AI小说工作台启动失败', String(error?.message || error));
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
