import fs from 'node:fs/promises';
import path from 'node:path';
import { __testHooks } from '../server.js';

const dbPath = 'D:/小说/AI小说工作台-data/db.json';
const startChapter = Number(process.argv[2]) || 1;
const endChapter = Number(process.argv[3]) || 5;
const outputPath = path.join(process.cwd(), 'scripts', `chapters-${startChapter}-${endChapter}-lightweight-preview-1.6.5.txt`);

const db = JSON.parse(await fs.readFile(dbPath, 'utf8'));
const project = db.projects.find((item) => item.title === '我在明日方舟搜打撤');
if (!project) throw new Error('未找到项目：我在明日方舟搜打撤');

const automation = project.automation || {};
const cards = (automation.chapterCards || []).slice(startChapter - 1, endChapter);
if (cards.length < endChapter - startChapter + 1) throw new Error(`章节卡不足：${cards.length}/${endChapter - startChapter + 1}`);

const settings = db.settings?.[0]?.aiConfig || {};
const { apiKey, model, baseUrl, profile } = __testHooks.resolveAiModelConfig(settings, 'writing');
if (!apiKey) throw new Error('缺少写作模型 API Key');

let workingProject = { ...project, chapters: [] };
if (startChapter > 1) {
  const previousPreviewPath = path.join(process.cwd(), 'scripts', `chapters-1-${startChapter - 1}-lightweight-preview-1.6.5.txt`);
  let previousPreview = '';
  try {
    previousPreview = await fs.readFile(previousPreviewPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const previousSections = previousPreview ? previousPreview.split(/=== 第\d+章 \/ 章节卡：/).slice(1) : [];
  const previewChapters = previousSections.map((section, index) => {
    const title = section.match(/### ([^\n]+)/)?.[1] || `第${index + 1}章`;
    const summary = section.match(/摘要：([^\n]+)/)?.[1] || '';
    const content = (section.split('\n正文：\n')[1] || '').split('\n\n警告：')[0]?.trim() || '';
    return __testHooks.createChapter({ title, summary, content, volumeId: project.volumes?.[0]?.id || '' });
  });
  const storedChapters = (project.chapters || []).slice(0, startChapter - 1);
  workingProject.chapters = previewChapters.length ? previewChapters : storedChapters;
}
const generated = [];
const startedAt = new Date().toISOString();

for (let index = 0; index < cards.length; index += 1) {
  const chapterNumber = startChapter + index;
  const card = cards[index];
  const nextCard = cards[index + 1] || null;
  const result = await __testHooks.generateLightweightAutomationChapter({
    apiKey,
    model,
    baseUrl,
    project: workingProject,
    automation,
    card,
    nextCard,
    chapterNumber,
    defaultVolumeId: project.volumes?.[0]?.id || '',
  });
  if (!result.chapter) throw new Error(`第${chapterNumber}章未解析出章节`);
  generated.push({ result, card });
  workingProject = { ...workingProject, chapters: [...workingProject.chapters, result.chapter] };
  console.log(JSON.stringify({ chapterNumber, title: result.chapter.title, contentLength: result.chapter.content?.length || 0, warnings: result.warnings || [] }));
}

const content = [
  `预览生成时间：${startedAt}`,
  `数据源：${dbPath}`,
  `模型配置：${profile || 'unknown'} / ${model} / ${baseUrl}`,
  `生成范围：第${startChapter}-${endChapter}章`,
  '',
  ...generated.flatMap(({ result, card }, index) => [
    `=== 第${startChapter + index}章 / 章节卡：${card.title} ===`,
    `### ${result.chapter.title}`,
    `摘要：${result.chapter.summary}`,
    '正文：',
    result.chapter.content,
    '',
    result.warnings?.length ? `警告：${result.warnings.join('；')}` : '警告：无',
    '',
  ]),
].join('\n');

await fs.writeFile(outputPath, content, 'utf8');
console.log(JSON.stringify({ outputPath, chapters: generated.length }, null, 2));
