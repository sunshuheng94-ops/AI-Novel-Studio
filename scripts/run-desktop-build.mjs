import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const cacheRoot = path.join(root, '.cache');
const env = {
  ...process.env,
  npm_config_cache: path.join(cacheRoot, 'npm'),
  ELECTRON_CACHE: path.join(cacheRoot, 'electron'),
  ELECTRON_BUILDER_CACHE: path.join(cacheRoot, 'electron-builder'),
  TEMP: path.join(cacheRoot, 'temp'),
  TMP: path.join(cacheRoot, 'temp'),
};

await fs.mkdir(env.npm_config_cache, { recursive: true });
await fs.mkdir(env.ELECTRON_CACHE, { recursive: true });
await fs.mkdir(env.ELECTRON_BUILDER_CACHE, { recursive: true });
await fs.mkdir(env.TEMP, { recursive: true });

const child = process.platform === 'win32'
  ? spawn('cmd.exe', ['/d', '/s', '/c', 'npx electron-builder'], {
      cwd: root,
      env,
      stdio: 'inherit',
      shell: false,
    })
  : spawn('npx', ['electron-builder'], {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: false,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
