import fs from 'node:fs/promises';
import path from 'node:path';
import { __testHooks } from '../server.js';

const dbPath = 'D:/小说/AI小说工作台-data/db.json';
const outputPath = path.join(process.cwd(), 'scripts', 'chapter-1-lightweight-preview-1.6.5.txt');

const db = JSON.parse(await fs.readFile(dbPath, 'utf8'));
const project = db.projects.find((item) => item.title === '我在明日方舟搜打撤');
if (!project) throw new Error('未找到项目：我在明日方舟搜打撤');

const automation = project.automation || {};
const card = automation.chapterCards?.[0];
const nextCard = automation.chapterCards?.[1] || null;
if (!card) throw new Error('缺少第一章章节卡');

const settings = db.settings?.[0]?.aiConfig || {};
const { apiKey, model, baseUrl, profile } = __testHooks.resolveAiModelConfig(settings, 'writing');
if (!apiKey) throw new Error('缺少写作模型 API Key');

const projectForPreview = {
  ...project,
  chapters: [],
};

const startedAt = new Date().toISOString();
const result = await __testHooks.generateLightweightAutomationChapter({
  apiKey,
  model,
  baseUrl,
  project: projectForPreview,
  automation,
  card,
  nextCard,
  chapterNumber: 1,
  defaultVolumeId: project.volumes?.[0]?.id || '',
});

const content = [
  `预览生成时间：${startedAt}`,
  `数据源：${dbPath}`,
  `模型配置：${profile || 'unknown'} / ${model} / ${baseUrl}`,
  `章节卡：${card.title}`,
  '',
  '=== 解析后的章节正文 ===',
  result.chapter ? `### ${result.chapter.title}\n摘要：${result.chapter.summary}\n正文：\n${result.chapter.content}` : '未解析出章节',
  '',
  '=== 原始生成/解析报告 ===',
  result.text || '',
  '',
  '=== 警告 ===',
  ...(result.warnings || []),
].join('\n');

await fs.writeFile(outputPath, content, 'utf8');
console.log(JSON.stringify({ outputPath, title: result.chapter?.title || '', contentLength: result.chapter?.content?.length || 0, warnings: result.warnings || [] }, null, 2));
