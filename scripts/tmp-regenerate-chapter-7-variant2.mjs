import fs from 'node:fs/promises';
import path from 'node:path';
import { __testHooks } from '../server.js';

const workspace = process.cwd();
const dbPath = path.join(process.env.APPDATA || '', 'ai-novel-studio', 'data', 'db.json');
const variant1Path = path.join(workspace, 'scripts', 'chapter-7-new-human-style.txt');
const variant2Path = path.join(workspace, 'scripts', 'chapter-7-new-human-style-v2.txt');
const reportPath = path.join(workspace, 'scripts', 'chapter-7-three-way-comparison.md');

function countChars(text = '') {
  return String(text).replace(/\s+/g, '').length;
}

function readBody(text = '') {
  return String(text).replace(/^###.*\n摘要：.*\n\n/s, '').trim();
}

function stats(label, text = '') {
  const body = readBody(text);
  return {
    label,
    chars: countChars(body),
    paragraphs: body.split(/\n+/).filter((line) => line.trim()).length,
    dialogue: (body.match(/“/g) || []).length,
    negatives: (body.match(/不是|不对|没有/g) || []).length,
    keywords: ['林奇', '伤员', '排水口', '学校', '罗德岛', '整合运动', '侧门', '门卫室', '弩箭'].filter((word) => body.includes(word)),
  };
}

function pickSettings(db, project) {
  return (db.settings || []).find((item) => item.userId === project.ownerId)?.aiConfig || db.settings?.[0]?.aiConfig || {};
}

const db = JSON.parse(await fs.readFile(dbPath, 'utf8'));
const project = db.projects.find((item) => String(item.title || '').includes('明日方舟')) || db.projects[0];
if (!project) throw new Error('未找到项目');
const settings = pickSettings(db, project);
const aiConfig = __testHooks.resolveAiModelConfig(settings, 'writing');
if (!aiConfig.apiKey) throw new Error('未找到写作模型 API Key');

const oldChapter = project.chapters?.[6];
const card = project.automation?.chapterCards?.[6];
if (!oldChapter) throw new Error('未找到已有第7章');
if (!card) throw new Error('未找到第7章章节卡');

const previousChapters = (project.chapters || []).slice(0, 6);
const writingProject = { ...project, chapters: previousChapters };
const nextCard = project.automation?.chapterCards?.[7] || null;

const result = await __testHooks.generateAutomationChapter({
  apiKey: aiConfig.apiKey,
  model: aiConfig.model,
  baseUrl: aiConfig.baseUrl,
  project: writingProject,
  automation: project.automation || {},
  card,
  nextCard,
  chapterNumber: 7,
  defaultVolumeId: project.volumes?.[0]?.id || '',
});

if (!result.chapter?.content) throw new Error('第7章第二版生成失败');

const newChapter = {
  ...result.chapter,
  title: result.chapter.title || card.title || '第7章',
  summary: __testHooks.resolveStoredChapterSummary(card, result.chapter.content),
};
const oldText = [`### ${oldChapter.title}`, `摘要：${oldChapter.summary || ''}`, '', oldChapter.content || ''].join('\n');
const variant1Text = await fs.readFile(variant1Path, 'utf8').catch(() => '');
const variant2Text = [`### ${newChapter.title}`, `摘要：${newChapter.summary || ''}`, '', newChapter.content || ''].join('\n');

await fs.writeFile(variant2Path, variant2Text, 'utf8');

const rows = [stats('原第7章', oldText), stats('新稿1', variant1Text), stats('新稿2', variant2Text)];
const report = [
  '# 第7章三版对比',
  '',
  '| 版本 | 字数 | 段落 | 对话引号 | 不是/不对/没有 | 关键词命中 |',
  '|---|---:|---:|---:|---:|---|',
  ...rows.map((row) => `| ${row.label} | ${row.chars} | ${row.paragraphs} | ${row.dialogue} | ${row.negatives} | ${row.keywords.join('、') || '少'} |`),
  '',
  '## 文件',
  '',
  `原第7章：scripts/chapter-7-old-existing.txt`,
  `新稿1：scripts/chapter-7-new-human-style.txt`,
  `新稿2：${variant2Path}`,
].join('\n');
await fs.writeFile(reportPath, report, 'utf8');

console.log(JSON.stringify({
  model: aiConfig.model,
  variant2Title: newChapter.title,
  variant2Chars: countChars(newChapter.content || ''),
  variant2Path,
  reportPath,
}, null, 2));
