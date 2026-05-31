import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const installedDataDir = 'D:\\小说\\AI小说工作台-data';
const legacyDataDir = 'C:\\Users\\孙树珩\\AppData\\Roaming\\ai-novel-studio\\data';
const sharedDataDir = process.env.APP_DATA_DIR || (fs.existsSync(installedDataDir) ? installedDataDir : legacyDataDir);
const vitePort = process.env.VITE_PORT || '5173';
const backendPort = process.env.PORT || '3001';

function spawnHidden(command, args, extraEnv = {}) {
  const isCmdScript = /\.cmd$/i.test(command);
  const child = spawn(isCmdScript ? 'cmd.exe' : command, isCmdScript ? ['/d', '/s', '/c', `"${command}" ${args.map((arg) => `"${String(arg).replace(/"/g, '\\"')}"`).join(' ')}`] : args, {
    cwd: rootDir,
    env: {
      ...process.env,
      ...extraEnv,
      APP_DATA_DIR: sharedDataDir,
      PORT: backendPort,
    },
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
  });
  child.unref();
  return child;
}

function waitFor(url, timeoutMs = 30000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const probe = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });
      request.on('error', () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Server not ready: ${url}`));
          return;
        }
        setTimeout(probe, 300);
      });
      request.setTimeout(2000, () => request.destroy());
    };
    probe();
  });
}

spawnHidden(process.execPath, ['server.js']);
spawnHidden(process.execPath, [path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', vitePort], {
  VITE_PORT: vitePort,
});

await waitFor(`http://localhost:${vitePort}`);

spawnHidden(process.execPath, [path.join(rootDir, 'node_modules', 'electron', 'cli.js'), '.'], {
  ELECTRON_START_URL: `http://localhost:${vitePort}`,
  NODE_ENV: 'development',
});
