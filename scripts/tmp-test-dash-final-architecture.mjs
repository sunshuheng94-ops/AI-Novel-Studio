import fs from 'node:fs/promises';
import path from 'node:path';
import { __testHooks } from '../server.js';

const dbPath = path.join(process.env.APPDATA || '', 'ai-novel-studio', 'data', 'db.json');
const outPath = path.join(process.cwd(), 'scripts', 'generated-chapter-preview.txt');
const reportPath = path.join(process.cwd(), 'scripts', 'generated-chapter-report.txt');
const inspiration = '杜震宇为了救人被卡车创死，转生成修仙世界的一个女婴身上，获得魔法少女系统（系统性格拟人化，类似于雌小鬼），通过自己的努力，奋斗和系统从草根逆袭到最强。文风搞笑、日常、热血，小说类型修仙、百合。';

const db = JSON.parse(await fs.readFile(dbPath, 'utf8'));
const settings = db.settings.find((item) => item.aiConfig?.apiKey) || db.settings[0];
const aiConfig = settings?.aiConfig || {};
if (!aiConfig.apiKey) throw new Error('未找到 DeepSeek API Key');

const project = {
  id: 'tmp-dash-test',
  ownerId: 'tmp',
  title: '转生成女婴后，魔法少女系统逼我修仙',
  genre: '修仙 / 百合 / 系统 / 搞笑日常 / 热血逆袭',
  targetAudience: '喜欢轻松吐槽、修仙成长、百合羁绊、系统互动和草根逆袭的网文读者',
  styleGuide: '搞笑、日常、热血；系统像雌小鬼，会嘲讽但也护短；主角有成年人灵魂但身体是女婴，笑点来自认知错位和修仙世界日常荒诞；热血来自努力、挨打、修炼和保护重要的人。',
  premise: inspiration,
  summary: inspiration,
  outline: '',
  characters: [],
  relations: [],
  timeline: [],
  volumes: [{ id: 'tmp-volume-1', title: '第一卷 女婴也要修仙', positioning: '转生开局、系统绑定、草根求生和第一段亲密羁绊', goal: '让主角接受新身份并找到修炼起点', endingHook: '主角第一次真正踏入修仙门槛' }],
  chapters: [],
  automation: {
    inspiration,
    minimumWords: 1500000,
    targetWords: 1500000,
    targetChapters: 600,
    averageChapterWords: 2400,
    platformStrategy: { mainPlatform: 'fanqie', auxiliaryPlatforms: ['qidian'], releaseTarget: 'fanqie' },
    chapterCards: [],
  },
};

async function callAi(prompt, temperature = 0.75, maxTokens = 8192) {
  return __testHooks.callDeepSeek({ apiKey: aiConfig.apiKey, model: 'deepseek-v4-flash', baseUrl: aiConfig.baseUrl || 'https://api.deepseek.com', temperature, maxTokens, userPrompt: prompt });
}

const { result, usage } = await __testHooks.withAiUsageTracking(async () => {
  const personaPrompt = ['请基于灵感为这本书生成作者人设卡。', __testHooks.buildHumanWritingSystemGuide({ project, automation: project.automation, scope: '作者人设生成' }), `灵感：${inspiration}`, '直接输出，不要解释。'].join('\n');
  const blueprintPrompt = ['请基于以下灵感，为中文网络小说规划一部长篇连载方案。', '包含题材定位、核心卖点、主线副线、成长线、至少8卷分卷规划、长线伏笔、商业化建议、主要人物卡。', `作品名：${project.title}`, `题材：${project.genre}`, `文风：${project.styleGuide}`, `灵感：${inspiration}`, __testHooks.buildHumanWritingSystemGuide({ project, automation: project.automation, scope: '长篇蓝图规划' }), '直接输出详细策划。'].join('\n');
  const [authorPersona, masterPlan] = await Promise.all([callAi(personaPrompt, 0.82, 4096), callAi(blueprintPrompt, 0.9, 8192)]);
  const plannedProject = { ...project, automation: { ...project.automation, authorPersona, masterPlan, status: 'planned' } };
  const cardPrompt = ['请根据长篇蓝图，为第1章生成一张章节卡。', '章节卡只安排剧情事件，不要写正文写法。', '输出格式：### 第1章 标题\n卷：第一卷 女婴也要修仙\n蓝图阶段：...\n本章目标：...\n核心事件：...\n出场人物：...\n关键物件/线索：...\n本章结果：...\n进度锁：...\n本章只允许：...\n本章禁止：...\n读者预期：...\n上一章遗留动作：...\n伏笔规划：...\n本章爽点：...\n平台适配：...\n系统规则：...\n摘要：...\n关键钩子：...', '第1章从死亡/转生/女婴身体错位/系统绑定切入；系统像雌小鬼但只给短讯和限制。', __testHooks.buildHumanWritingSystemGuide({ project: plannedProject, automation: plannedProject.automation, scope: '第1章章节卡' }), '长篇蓝图：', masterPlan].join('\n');
  const cardText = await callAi(cardPrompt, 0.82, 4096);
  const section = __testHooks.extractGeneratedSections(cardText)[0] || cardText;
  const card = __testHooks.parseGeneratedChapterCardSection({ section, order: 1, project: plannedProject });
  const writingProject = { ...plannedProject, automation: { ...plannedProject.automation, chapterCards: [card] } };
  const compiled = __testHooks.compileChapterForGeneration({ project: writingProject, automation: writingProject.automation, card, chapterNumber: 1 });
  const chapterResult = await __testHooks.generateAutomationChapter({ apiKey: aiConfig.apiKey, model: 'deepseek-v4-flash', baseUrl: aiConfig.baseUrl || 'https://api.deepseek.com', project: writingProject, automation: writingProject.automation, card, nextCard: null, chapterNumber: 1, defaultVolumeId: writingProject.volumes[0].id });
  return { card, compiled, chapterResult };
});

const chapter = result.chapterResult.chapter;
const content = chapter.content || '';
const issues = [...__testHooks.findNaturalnessIssues(content), ...__testHooks.findDialogueIssues(content, result.card)];
const severity = __testHooks.classifyNaturalnessIssues(issues, content);
const dashCount = (content.match(/[—-]{1,2}/g) || []).length;
const words = content.replace(/\s+/g, '').length;
const report = [`作品：${project.title}`, `章节：${chapter.title}`, `生成模式：${result.chapterResult.generationMode || 'fallback'}（复杂度${result.compiled.executionPack.complexityScore}）`, `字数：${words}`, `破折号数量：${dashCount}`, __testHooks.formatAiUsageReport(usage), `终检等级：${severity}`, `问题数：${issues.length}`, issues.length ? `问题：${issues.map((issue) => issue.label).join('；')}` : '问题：无', result.chapterResult.warnings?.length ? `场景包/逐拍警告：${result.chapterResult.warnings.join('；')}` : '场景包/逐拍警告：无'].join('\n');

await fs.writeFile(outPath, content, 'utf8');
await fs.writeFile(reportPath, report, 'utf8');
console.log(report);
console.log(outPath);
