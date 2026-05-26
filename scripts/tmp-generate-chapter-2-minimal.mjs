import fs from 'node:fs/promises';
import path from 'node:path';
import { __testHooks } from '../server.js';

const dbPath = path.join(process.env.APPDATA, 'ai-novel-studio', 'data', 'db.json');
const db = JSON.parse(await fs.readFile(dbPath, 'utf8'));
const projectIndex = db.projects.findIndex((project) => project.title.includes('明日方舟'));
if (projectIndex < 0) throw new Error('找不到明日方舟项目');

const project = db.projects[projectIndex];
const settings = db.settings?.find((item) => item.userId === project.ownerId)?.aiConfig;
const writeConfig = __testHooks.resolveAiModelConfig(settings || {}, 'writing');
if (!writeConfig.apiKey) throw new Error('缺少写作模型 API Key');

const automation = project.automation || {};
const card = automation.chapterCards?.[1];
const previousChapter = project.chapters?.[0];
if (!card) throw new Error('缺少第2章章节卡');
if (!previousChapter?.content) throw new Error('缺少第1章正文');

const characterText = (project.characters || [])
  .map((character) => [
    `- ${character.name}`,
    character.role ? `身份：${character.role}` : '',
    character.goal ? `目标：${character.goal}` : '',
    character.traits ? `性格：${character.traits}` : '',
    character.arc ? `弧光：${character.arc}` : '',
  ].filter(Boolean).join('；'))
  .join('\n');

const cardText = [
  `标题：${card.title || '第2章'}`,
  `摘要：${card.summary || ''}`,
  `本章目标：${card.chapterGoal || ''}`,
  `核心事件：${card.coreEvent || ''}`,
  `出场人物：${card.cast || ''}`,
  `本章结果：${card.chapterResult || ''}`,
  `钩子：${card.hook || ''}`,
].filter((line) => !line.endsWith('：')).join('\n');

const prompt = [
  '你是中文网文作者。请直接写《我在明日方舟搜打撤》第2章。',
  '只写小说正文需要的内容，不要解释，不要输出写作分析，不要提“蓝图/章节卡/提示词”。',
  '保留剧情连续性：承接第1章结尾，只推进第2章章节卡事件，不提前写第3章。',
  '人物要像真人在现场行动和说话；系统可以嘴欠，但不要长篇说明。',
  '字数目标：2500-3500字。',
  '输出格式：',
  '### 第2章 标题',
  '摘要：一句话摘要',
  '正文：',
  '正文内容',
  '',
  `作品名：${project.title}`,
  `题材：${project.genre}`,
  `文风：${project.styleGuide}`,
  '作者人设：',
  automation.authorPersona || '',
  '主要角色：',
  characterText || '无',
  '长篇蓝图摘录：',
  (automation.masterPlan || '').slice(0, 3500),
  '第2章章节卡：',
  cardText,
  '第1章结尾：',
  previousChapter.content.slice(-1800),
].join('\n\n');

const text = await __testHooks.callDeepSeek({
  apiKey: writeConfig.apiKey,
  model: writeConfig.model,
  baseUrl: writeConfig.baseUrl,
  temperature: 0.78,
  maxTokens: 4096,
  userPrompt: prompt,
  timeoutMs: 240000,
});

const sections = __testHooks.extractGeneratedSections(text);
const chapter = __testHooks.makeGeneratedChapter(sections[0] || text, project.volumes?.[0]?.id || '');
const content = __testHooks.cleanStoredChapterContent(chapter.content || '');
if (content.replace(/\s+/g, '').length < 1200) throw new Error(`第2章正文过短：${content.replace(/\s+/g, '').length}字`);

const now = new Date().toISOString();
const nextChapter = __testHooks.createChapter({
  ...chapter,
  title: chapter.title?.startsWith('第2章') ? chapter.title : `第2章 ${chapter.title || '新章节'}`,
  summary: chapter.summary || card.summary || '',
  content,
  volumeId: chapter.volumeId || project.volumes?.[0]?.id || '',
  status: 'draft',
  createdAt: now,
  updatedAt: now,
});

const chapters = [...(project.chapters || [])];
chapters[1] = nextChapter;
db.projects[projectIndex] = __testHooks.createChapter
  ? {
      ...project,
      chapters,
      automation: {
        ...automation,
        progressNotes: '已用最小提示词生成第2章',
        status: 'writing',
      },
      updatedAt: now,
    }
  : project;

await fs.writeFile(dbPath, JSON.stringify(db, null, 2), 'utf8');

console.log(JSON.stringify({
  model: writeConfig.model,
  title: nextChapter.title,
  summary: nextChapter.summary,
  words: content.replace(/\s+/g, '').length,
  preview: content.slice(0, 500),
}, null, 2));
