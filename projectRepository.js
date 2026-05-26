import fs from 'node:fs/promises';
import path from 'node:path';

export function createProjectRepository({ dataDir, dataFile = path.join(dataDir, 'db.json') }) {
  async function ensureStorage() {
    await fs.mkdir(dataDir, { recursive: true });
    try {
      await fs.access(dataFile);
    } catch {
      await fs.writeFile(
        dataFile,
        JSON.stringify({ users: [], sessions: [], projects: [] }, null, 2),
        'utf8',
      );
    }
  }

  async function readDb() {
    await ensureStorage();
    const content = await fs.readFile(dataFile, 'utf8');
    return JSON.parse(content);
  }

  async function writeDb(db) {
    await ensureStorage();
    await fs.writeFile(dataFile, JSON.stringify(db, null, 2), 'utf8');
  }

  return {
    dataDir,
    dataFile,
    ensureStorage,
    readDb,
    writeDb,
  };
}
