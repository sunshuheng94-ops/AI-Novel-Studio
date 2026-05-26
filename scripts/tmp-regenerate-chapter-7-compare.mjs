import fs from 'node:fs/promises';
import path from 'node:path';
import { __testHooks } from '../server.js';

const workspace = process.cwd();
const dbPath = path.join(process.env.APPDATA || '', 'ai-novel-studio', 'data', 'db.json');
const newPath = path.join(workspace, 'scripts', 'chapter-7-new-human-style.txt');
const oldPath = path.join(workspace, 'scripts', 'chapter-7-old-existing.txt');
const reportPath = path.join(workspace, 'scripts', 'chapter-7-fanqie-comparison.md');

function countChars(text = '') {
  return String(text).replace(/\s+/g, '').length;
}

function pickSettings(db, project) {
  return (db.settings || []).find((item) => item.userId === project.ownerId)?.aiConfig || db.settings?.[0]?.aiConfig || {};
}

function evaluateAsFanqieReader({ oldChapter, newChapter, card }) {
  const oldText = oldChapter.content || '';
  const newText = newChapter.content || '';
  const oldChars = countChars(oldText);
  const newChars = countChars(newText);
  const oldDialogue = (oldText.match(/“/g) || []).length;
  const newDialogue = (newText.match(/“/g) || []).length;
  const oldParagraphs = oldText.split(/\n+/).filter((line) => line.trim()).length;
  const newParagraphs = newText.split(/\n+/).filter((line) => line.trim()).length;
  const oldNot = (oldText.match(/不是|不对|没有/g) || []).length;
  const newNot = (newText.match(/不是|不对|没有/g) || []).length;
  const cardKeywords = [card.summary, card.hook, card.coreEvent, card.chapterGoal].join('\n');
  const oldHits = ['林奇', '伤员', '排水口', '学校', '罗德岛', '整合运动', '侧门', '门卫室', '弩箭'].filter((word) => oldText.includes(word));
  const newHits = ['林奇', '伤员', '排水口', '学校', '罗德岛', '整合运动', '侧门', '门卫室', '弩箭'].filter((word) => newText.includes(word));
  return [
    '# 第7章番茄读者视角对比',
    '',
    `章节卡：${card.title || '第7章'}`,
    '',
    '## 数据对比',
    '',
    '| 项目 | 已有第7章 | 新生成第7章 |',
    '|---|---:|---:|',
    `| 字数估算 | ${oldChars} | ${newChars} |`,
    `| 段落数 | ${oldParagraphs} | ${newParagraphs} |`,
    `| 对话引号数 | ${oldDialogue} | ${newDialogue} |`,
    `| “不是/不对/没有”计数 | ${oldNot} | ${newNot} |`,
    `| 章节卡关键词命中 | ${oldHits.join('、') || '少'} | ${newHits.join('、') || '少'} |`,
    '',
    '## 番茄读者直观感受',
    '',
    `已有第7章：${oldChars > 4200 ? '篇幅偏长，手机阅读容易觉得拖。' : oldChars < 2400 ? '篇幅偏短，可能爽点不够。' : '篇幅在可读区间。'}${oldDialogue < 8 ? '对话偏少，现场互动感可能不足。' : '对话量能支撑现场感。'}${oldNot > 18 ? '否定判断偏多，会有一点 AI 式反复确认感。' : '否定判断密度尚可。'}`,
    `新生成第7章：${newChars > 4200 ? '篇幅偏长，手机阅读容易觉得拖。' : newChars < 2400 ? '篇幅偏短，可能爽点不够。' : '篇幅在可读区间。'}${newDialogue < 8 ? '对话偏少，现场互动感可能不足。' : '对话量能支撑现场感。'}${newNot > 18 ? '否定判断偏多，会有一点 AI 式反复确认感。' : '否定判断密度尚可。'}`,
    '',
    '## 章节卡贴合度',
    '',
    `章节卡核心要求：${card.summary || ''}`,
    '',
    `已有第7章命中：${oldHits.join('、') || '无明显关键词命中'}`,
    `新生成第7章命中：${newHits.join('、') || '无明显关键词命中'}`,
    '',
    '## 文件',
    '',
    `已有第7章：${oldPath}`,
    `新生成第7章：${newPath}`,
  ].join('\n');
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

if (!result.chapter?.content) throw new Error('第7章新稿生成失败');

const newChapter = {
  ...result.chapter,
  title: result.chapter.title || card.title || '第7章',
  summary: __testHooks.resolveStoredChapterSummary(card, result.chapter.content),
};

await fs.writeFile(oldPath, [`### ${oldChapter.title}`, `摘要：${oldChapter.summary || ''}`, '', oldChapter.content || ''].join('\n'), 'utf8');
await fs.writeFile(newPath, [`### ${newChapter.title}`, `摘要：${newChapter.summary || ''}`, '', newChapter.content || ''].join('\n'), 'utf8');
await fs.writeFile(reportPath, evaluateAsFanqieReader({ oldChapter, newChapter, card }), 'utf8');

console.log(JSON.stringify({
  model: aiConfig.model,
  oldTitle: oldChapter.title,
  oldChars: countChars(oldChapter.content || ''),
  newTitle: newChapter.title,
  newChars: countChars(newChapter.content || ''),
  oldPath,
  newPath,
  reportPath,
}, null, 2));
