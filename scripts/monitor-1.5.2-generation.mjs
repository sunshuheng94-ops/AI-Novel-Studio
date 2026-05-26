import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const workspace = path.resolve('D:/xiangmu/ai小说');
const dbPath = path.join(process.env.APPDATA || '', 'ai-novel-studio', 'data', 'db.json');
const jsonReportPath = path.join(workspace, 'scripts', 'generation-monitor-report.json');
const mdReportPath = path.join(workspace, 'scripts', 'generation-monitor-report.md');
const fetchCalls = [];
const originalFetch = globalThis.fetch;

function nowIso() {
  return new Date().toISOString();
}

function countChars(text = '') {
  return String(text).replace(/\s+/g, '').length;
}

function formatMs(ms = 0) {
  if (!Number.isFinite(ms)) return '0.0s';
  return `${(ms / 1000).toFixed(1)}s`;
}

function isBlankStarterChapter(chapter, index) {
  return index === 0
    && countChars(chapter?.content || '') === 0
    && !String(chapter?.summary || '').trim()
    && /^第\s*1\s*章\s*(开场|新章节)?$/.test(String(chapter?.title || '').trim());
}

function getWriteState(project) {
  const chapters = Array.isArray(project?.chapters) ? project.chapters : [];
  const replaceBlankStarter = chapters.length === 1 && isBlankStarterChapter(chapters[0], 0);
  const writtenCount = replaceBlankStarter ? 0 : chapters.length;
  return {
    replaceBlankStarter,
    writtenCount,
    nextChapterStart: writtenCount + 1,
  };
}

function pickProject(db, projectNameArg) {
  const projects = Array.isArray(db.projects) ? db.projects : [];
  if (projectNameArg) {
    const matched = projects.find((project) => String(project.title || '').includes(projectNameArg));
    if (matched) return matched;
  }
  return projects.find((project) => project?.automation?.masterPlan && Array.isArray(project?.automation?.chapterCards) && project.automation.chapterCards.length)
    || projects.find((project) => Array.isArray(project?.automation?.chapterCards) && project.automation.chapterCards.length)
    || projects[0];
}

function resolveSettings(db, project) {
  const settings = Array.isArray(db.settings) ? db.settings : [];
  return settings.find((item) => item.userId === project?.ownerId)?.aiConfig || settings[0]?.aiConfig || {};
}

function parseRequestBody(init) {
  try {
    return JSON.parse(init?.body || '{}');
  } catch {
    return {};
  }
}

function parseResponseBody(text) {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return {};
  }
}

globalThis.fetch = async (url, init = {}) => {
  const requestBody = parseRequestBody(init);
  const startedAt = performance.now();
  const startedIso = nowIso();
  const call = {
    index: fetchCalls.length + 1,
    startedAt: startedIso,
    url: String(url),
    model: requestBody.model || '',
    maxTokens: requestBody.max_tokens || requestBody.maxTokens || null,
    temperature: requestBody.temperature ?? null,
    promptChars: countChars((requestBody.messages || []).map((message) => message.content).join('\n')),
    ok: false,
    status: 0,
    durationMs: 0,
    completionChars: 0,
    usage: null,
    error: '',
  };
  fetchCalls.push(call);

  try {
    const response = await originalFetch(url, init);
    const text = await response.text();
    const body = parseResponseBody(text);
    call.ok = response.ok;
    call.status = response.status;
    call.durationMs = performance.now() - startedAt;
    call.usage = body.usage || null;
    call.completionChars = countChars((body.choices || []).map((choice) => choice?.message?.content || '').join('\n'));
    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    call.durationMs = performance.now() - startedAt;
    call.error = error instanceof Error ? error.message : String(error);
    throw error;
  }
};

const startedAt = performance.now();
let report;

try {
  const db = JSON.parse(await fs.readFile(dbPath, 'utf8'));
  const project = pickProject(db, process.argv[2] || '');
  if (!project) throw new Error('未找到可监测的作品');

  const { __testHooks } = await import(pathToFileURL(path.join(workspace, 'server.js')).href);
  const settings = resolveSettings(db, project);
  const aiConfig = __testHooks.resolveAiModelConfig(settings, 'writing');
  if (!aiConfig.apiKey) throw new Error('未找到写作模型 API Key');

  const automation = project.automation || {};
  const writeState = getWriteState(project);
  const card = (automation.chapterCards || [])[writeState.writtenCount];
  const nextCard = (automation.chapterCards || [])[writeState.writtenCount + 1] || null;
  if (!card) throw new Error(`章节卡不足：下一章第${writeState.nextChapterStart}章没有章节卡`);

  const result = await __testHooks.generateAutomationChapter({
    apiKey: aiConfig.apiKey,
    model: aiConfig.model,
    baseUrl: aiConfig.baseUrl,
    project,
    automation,
    card,
    nextCard,
    chapterNumber: writeState.nextChapterStart,
    defaultVolumeId: project.volumes?.[0]?.id || '',
  });

  report = {
    ok: true,
    generatedAt: nowIso(),
    totalDurationMs: performance.now() - startedAt,
    project: {
      id: project.id,
      title: project.title,
      existingChapters: Array.isArray(project.chapters) ? project.chapters.length : 0,
      nextChapter: writeState.nextChapterStart,
      cardTitle: card.title || '',
    },
    model: {
      baseUrl: aiConfig.baseUrl,
      model: aiConfig.model,
    },
    result: {
      title: result.chapter?.title || '',
      contentChars: countChars(result.chapter?.content || ''),
      warnings: result.warnings || [],
      aiUsage: result.aiUsage || null,
    },
    fetchCalls,
  };
} catch (error) {
  report = {
    ok: false,
    generatedAt: nowIso(),
    totalDurationMs: performance.now() - startedAt,
    error: error instanceof Error ? error.stack || error.message : String(error),
    fetchCalls,
  };
}

const slowest = [...fetchCalls].sort((a, b) => b.durationMs - a.durationMs).slice(0, 5);
const lines = [
  '# 1.5.2 章节生成耗时监测',
  '',
  `生成时间：${report.generatedAt}`,
  `结果：${report.ok ? '成功' : '失败'}`,
  `总耗时：${formatMs(report.totalDurationMs)}`,
  report.project ? `作品：${report.project.title}` : '',
  report.project ? `监测章节：第${report.project.nextChapter}章 ${report.project.cardTitle || ''}` : '',
  report.model ? `模型：${report.model.model}` : '',
  report.result ? `正文字数估算：${report.result.contentChars}` : '',
  report.result?.aiUsage ? `AI调用统计：${report.result.aiUsage.calls} 次 / 输入 ${report.result.aiUsage.promptTokens} / 输出 ${report.result.aiUsage.completionTokens} / 总 ${report.result.aiUsage.totalTokens}` : '',
  report.error ? `错误：\n\n\`\`\`\n${report.error}\n\`\`\`` : '',
  '',
  '## AI 请求明细',
  '',
  '| # | 耗时 | 状态 | 模型 | maxTokens | 输入字符 | 输出字符 | tokens |',
  '|---:|---:|---:|---|---:|---:|---:|---:|',
  ...fetchCalls.map((call) => `| ${call.index} | ${formatMs(call.durationMs)} | ${call.ok ? call.status : call.error || call.status} | ${call.model} | ${call.maxTokens ?? ''} | ${call.promptChars} | ${call.completionChars} | ${call.usage?.total_tokens ?? ''} |`),
  '',
  '## 最慢请求',
  '',
  ...slowest.map((call) => `- #${call.index}: ${formatMs(call.durationMs)}，模型 ${call.model}，输入 ${call.promptChars} 字，输出 ${call.completionChars} 字，tokens ${call.usage?.total_tokens ?? '未知'}`),
  '',
  '## 说明',
  '',
  '- 此脚本只读数据库并调用生成链路，不会写入章节。',
  '- 如果 AI 请求次数很多，通常说明 1.5.2 进入了节奏谱、叙事拍、整章组装、自然感检测或审校重写链路。',
  '- 如果某一次请求耗时异常长，优先检查该请求的输入字符数、maxTokens、模型和网络。',
].filter(Boolean);

await fs.writeFile(jsonReportPath, JSON.stringify(report, null, 2), 'utf8');
await fs.writeFile(mdReportPath, lines.join('\n'), 'utf8');

console.log(JSON.stringify({
  ok: report.ok,
  totalDurationMs: Math.round(report.totalDurationMs),
  calls: fetchCalls.length,
  report: mdReportPath,
  json: jsonReportPath,
  error: report.error || '',
}, null, 2));

if (!report.ok) process.exitCode = 1;
