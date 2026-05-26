import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const dataDir = path.join(process.env.APPDATA || '', 'ai-novel-studio', 'data');
const dbPath = path.join(dataDir, 'db.json');
const aiLogPath = path.join(dataDir, 'ai-debug.log');
const workspace = path.resolve('D:/xiangmu/ai小说');
const reportPath = path.join(workspace, 'scripts', 'real-writing-watch-report.md');
const jsonPath = path.join(workspace, 'scripts', 'real-writing-watch-report.json');
const projectNameArg = process.argv[2] || '';
const maxMinutes = Number(process.argv[3]) || 120;
const intervalMs = 2000;
const startedAt = performance.now();
const startedWall = new Date();
const events = [];
let lastSnapshot = null;
let lastDbMtimeMs = 0;
let lastLogSize = 0;

function countChars(text = '') {
  return String(text).replace(/\s+/g, '').length;
}

function formatMs(ms = 0) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatClock(date = new Date()) {
  return date.toLocaleString('zh-CN', { hour12: false });
}

async function safeStat(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function readDb() {
  const text = await fs.readFile(dbPath, 'utf8');
  return JSON.parse(text);
}

function pickProject(db) {
  const projects = Array.isArray(db.projects) ? db.projects : [];
  if (projectNameArg) {
    const matched = projects.find((project) => String(project.title || '').includes(projectNameArg));
    if (matched) return matched;
  }
  return projects.find((project) => project?.automation?.status === 'writing')
    || projects.find((project) => project?.automation?.targetProgress)
    || projects.find((project) => Array.isArray(project?.chapters) && project.chapters.length)
    || projects[0];
}

function snapshotProject(project) {
  const chapters = Array.isArray(project?.chapters) ? project.chapters : [];
  const latest = chapters.at(-1) || null;
  const automation = project?.automation || {};
  return {
    projectId: project?.id || '',
    title: project?.title || '',
    chapterCount: chapters.length,
    latestTitle: latest?.title || '',
    latestChars: countChars(latest?.content || ''),
    latestUpdatedAt: latest?.updatedAt || '',
    status: automation.status || '',
    targetProgress: automation.targetProgress || null,
    progressNotes: automation.progressNotes || '',
    waitingForReview: Boolean(automation.waitingForReview),
    totalGeneratedWords: automation.totalGeneratedWords || 0,
  };
}

async function readNewLogLines() {
  const stat = await safeStat(aiLogPath);
  if (!stat) return [];
  if (lastLogSize === 0) {
    lastLogSize = stat.size;
    return [];
  }
  if (stat.size < lastLogSize) {
    lastLogSize = 0;
    return [];
  }
  if (stat.size === lastLogSize) return [];
  const handle = await fs.open(aiLogPath, 'r');
  try {
    const length = stat.size - lastLogSize;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, lastLogSize);
    lastLogSize = stat.size;
    return buffer.toString('utf8').split(/\r?\n/).filter(Boolean);
  } finally {
    await handle.close();
  }
}

function addEvent(type, detail = {}) {
  events.push({
    type,
    at: new Date().toISOString(),
    elapsedMs: Math.round(performance.now() - startedAt),
    ...detail,
  });
}

async function writeReport(current = lastSnapshot) {
  const chapterEvents = events.filter((event) => event.type === 'chapter-count-changed');
  const dbEvents = events.filter((event) => event.type === 'db-write');
  const logEvents = events.filter((event) => event.type === 'ai-log');
  const lines = [
    '# 1.5.2 真实写作监测报告',
    '',
    `开始时间：${formatClock(startedWall)}`,
    `当前时间：${formatClock(new Date())}`,
    `已监测：${formatMs(performance.now() - startedAt)}`,
    current ? `作品：${current.title}` : '',
    current ? `当前章节数：${current.chapterCount}` : '',
    current ? `最新章节：${current.latestTitle}（约 ${current.latestChars} 字）` : '',
    current ? `自动状态：${current.status || '空'}；目标：${current.targetProgress || '空'}；等待复盘：${current.waitingForReview ? '是' : '否'}` : '',
    current?.progressNotes ? `进度备注：${current.progressNotes}` : '',
    '',
    '## 章节落库事件',
    '',
    chapterEvents.length ? '| 时间 | 已用时 | 章节数变化 | 最新章节 | 字数 | 状态 | 备注 |' : '暂无章节数变化。',
    chapterEvents.length ? '|---|---:|---:|---|---:|---|---|' : '',
    ...chapterEvents.map((event) => `| ${formatClock(new Date(event.at))} | ${formatMs(event.elapsedMs)} | ${event.from} -> ${event.to} | ${event.latestTitle || ''} | ${event.latestChars || 0} | ${event.status || ''} | ${String(event.progressNotes || '').replace(/\|/g, '/')} |`),
    '',
    '## 数据库写入事件',
    '',
    dbEvents.length ? '| 时间 | 已用时 | 文件大小 | 章节数 | 状态 |' : '暂无数据库写入。',
    dbEvents.length ? '|---|---:|---:|---:|---|' : '',
    ...dbEvents.map((event) => `| ${formatClock(new Date(event.at))} | ${formatMs(event.elapsedMs)} | ${event.size || 0} | ${event.chapterCount ?? ''} | ${event.status || ''} |`),
    '',
    '## AI 日志新增',
    '',
    logEvents.length ? '```text' : '暂无新增 AI 日志。',
    ...logEvents.slice(-80).map((event) => `[+${formatMs(event.elapsedMs)}] ${event.line}`),
    logEvents.length ? '```' : '',
    '',
    '## 判断方法',
    '',
    '- 如果长时间只有数据库不变，说明真实生成仍在一个请求中等待 AI 链路完成。',
    '- 如果一次落库写入多章，说明软件仍是批量生成完成后统一保存。',
    '- 如果 AI 日志没有新增，不代表没有 AI 请求；1.5.2 只记录部分自动规划日志，不记录每个正文子请求。',
  ].filter((line) => line !== '');

  await fs.writeFile(reportPath, lines.join('\n'), 'utf8');
  await fs.writeFile(jsonPath, JSON.stringify({
    startedAt: startedWall.toISOString(),
    updatedAt: new Date().toISOString(),
    elapsedMs: Math.round(performance.now() - startedAt),
    current,
    events,
  }, null, 2), 'utf8');
}

async function tick() {
  const dbStat = await safeStat(dbPath);
  if (dbStat && dbStat.mtimeMs !== lastDbMtimeMs) {
    lastDbMtimeMs = dbStat.mtimeMs;
    const db = await readDb();
    const project = pickProject(db);
    const nextSnapshot = snapshotProject(project);
    addEvent('db-write', {
      size: dbStat.size,
      chapterCount: nextSnapshot.chapterCount,
      status: nextSnapshot.status,
    });
    if (lastSnapshot && nextSnapshot.chapterCount !== lastSnapshot.chapterCount) {
      addEvent('chapter-count-changed', {
        from: lastSnapshot.chapterCount,
        to: nextSnapshot.chapterCount,
        latestTitle: nextSnapshot.latestTitle,
        latestChars: nextSnapshot.latestChars,
        status: nextSnapshot.status,
        targetProgress: nextSnapshot.targetProgress,
        progressNotes: nextSnapshot.progressNotes,
      });
    }
    lastSnapshot = nextSnapshot;
  }

  const newLogLines = await readNewLogLines();
  for (const line of newLogLines) addEvent('ai-log', { line });
  await writeReport(lastSnapshot);
}

console.log(`真实写作监测已启动，不会调用 AI，不会写数据库。报告：${reportPath}`);
console.log(`现在可以在软件里点击“写到指定进度”。监测最长 ${maxMinutes} 分钟，Ctrl+C 可停止。`);

await tick();
const deadline = startedAt + maxMinutes * 60 * 1000;
while (performance.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
  await tick();
}

console.log(`监测结束。报告：${reportPath}`);
