import fs from 'node:fs/promises';
import path from 'node:path';
import { __testHooks } from '../server.js';

const dbPath = path.join(process.env.APPDATA || '', 'ai-novel-studio', 'data', 'db.json');
const outPath = path.join(process.cwd(), 'scripts', 'generated-chapter-preview.txt');
const reportPath = path.join(process.cwd(), 'scripts', 'generated-chapter-report.txt');
const inspiration = '杜震宇为了救人被卡车创死，转生成修仙世界的一个将死的萝莉身上，获得魔法少女系统（系统性格拟人化，类似于雌小鬼），通过自己的努力，奋斗和系统从草根逆袭到最强。文风搞笑、日常、热血，小说类型修仙、百合文、废萌。';

const db = JSON.parse(await fs.readFile(dbPath, 'utf8'));
const settings = db.settings.find((item) => item.aiConfig?.apiKey) || db.settings[0];
const useGpt55Relay = process.env.USE_GPT55_RELAY === '1';
const relayConfig = useGpt55Relay ? JSON.parse(await fs.readFile(path.join(process.cwd(), '1.txt'), 'utf8')) : null;
const savedConfig = settings?.aiConfig || {};
const activeProfile = savedConfig.profiles?.[savedConfig.activeProfile];
const aiConfig = useGpt55Relay ? relayConfig : activeProfile ? { ...savedConfig, ...activeProfile } : savedConfig;
if (!aiConfig.apiKey) throw new Error(useGpt55Relay ? '未找到 GPT-5.5 中转站 API Key' : '未找到 DeepSeek API Key');
const deepSeekConfig = savedConfig.profiles?.deepseek ? { ...savedConfig, ...savedConfig.profiles.deepseek } : savedConfig;
const gpt55Config = useGpt55Relay ? relayConfig : savedConfig.profiles?.gpt55 ? { ...savedConfig, ...savedConfig.profiles.gpt55 } : aiConfig;
if (!deepSeekConfig.apiKey) throw new Error('未找到 DeepSeek API Key');
if (!gpt55Config.apiKey) throw new Error('未找到 GPT-5.5 中转站 API Key');

const project = {
  id: 'tmp-loli-test',
  ownerId: 'tmp',
  title: '转生成将死萝莉后，魔法少女系统逼我修仙',
  genre: '修仙 / 百合 / 系统 / 搞笑日常 / 热血逆袭 / 废萌',
  targetAudience: '喜欢轻松吐槽、废萌错位、修仙成长、百合羁绊、系统互动和草根逆袭的网文读者',
  styleGuide: '搞笑、日常、热血、废萌；系统像雌小鬼，会嘲讽但也护短；主角有成年人灵魂但身体是将死萝莉，笑点来自认知错位、身体限制和修仙日常荒诞；热血来自努力、挨打、修炼和保护重要的人。',
  premise: inspiration,
  summary: inspiration,
  outline: '',
  characters: [],
  relations: [],
  timeline: [],
  volumes: [{ id: 'tmp-volume-1', title: '第一卷 将死萝莉也要修仙', positioning: '转生开局、系统绑定、将死身体求生和第一段亲密羁绊', goal: '让主角接受新身份并找到活下去和修炼的起点', endingHook: '主角第一次真正踏入修仙门槛' }],
  chapters: [],
  automation: {
    inspiration,
    minimumWords: 1500000,
    targetWords: 1500000,
    targetChapters: 600,
    averageChapterWords: 2400,
    platformStrategy: { mainPlatform: 'fanqie', auxiliaryPlatforms: ['ciweimao', 'qidian'], releaseTarget: 'fanqie' },
    chapterCards: [],
  },
};

async function callAi(prompt, temperature = 0.75, maxTokens = 8192) {
  return __testHooks.callDeepSeek({ apiKey: aiConfig.apiKey, model: aiConfig.model || 'deepseek-v4-flash', baseUrl: aiConfig.baseUrl || 'https://api.deepseek.com', temperature, maxTokens, userPrompt: prompt });
}

async function callWithConfig(config, prompt, temperature = 0.75, maxTokens = 8192) {
  return __testHooks.callDeepSeek({ apiKey: config.apiKey, model: config.model || 'deepseek-v4-flash', baseUrl: config.baseUrl || 'https://api.deepseek.com', temperature, maxTokens, userPrompt: prompt });
}

const { result, usage } = await __testHooks.withAiUsageTracking(async () => {
  const personaPrompt = ['请基于灵感为这本书生成作者人设卡。', __testHooks.buildHumanWritingSystemGuide({ project, automation: project.automation, scope: '作者人设生成' }), `灵感：${inspiration}`, '直接输出，不要解释。'].join('\n');
  const blueprintPrompt = ['请基于以下灵感，为中文网络小说规划一部长篇连载方案。', '包含题材定位、核心卖点、主线副线、成长线、8卷分卷规划、长线伏笔、主要人物卡。保持精炼但可执行。', `作品名：${project.title}`, `题材：${project.genre}`, `文风：${project.styleGuide}`, `灵感：${inspiration}`, __testHooks.buildHumanWritingSystemGuide({ project, automation: project.automation, scope: '长篇蓝图规划' }), '直接输出策划，不要解释。'].join('\n');
  const [authorPersona, masterPlan] = await Promise.all([
    callWithConfig(deepSeekConfig, personaPrompt, 0.82, 4096),
    callWithConfig(deepSeekConfig, blueprintPrompt, 0.9, 8192),
  ]);
  const plannedProject = { ...project, automation: { ...project.automation, authorPersona, masterPlan, status: 'planned' } };
  const cardPrompt = ['请根据长篇蓝图，为第1章生成一张章节卡。', '章节卡只安排剧情事件，不要写正文写法。', '输出格式：### 第1章 标题\n卷：第一卷 将死萝莉也要修仙\n蓝图阶段：...\n本章目标：...\n核心事件：...\n出场人物：...\n关键物件/线索：...\n本章结果：...\n进度锁：...\n本章只允许：...\n本章禁止：...\n读者预期：...\n上一章遗留动作：...\n伏笔规划：...\n本章爽点：...\n平台适配：...\n系统规则：...\n摘要：...\n关键钩子：...', '第1章必须从救人车祸死亡、转生将死萝莉、身体濒死错位、魔法少女系统绑定切入；系统像雌小鬼但只给短讯、嘲讽和限制。', __testHooks.buildHumanWritingSystemGuide({ project: plannedProject, automation: plannedProject.automation, scope: '第1章章节卡' }), '长篇蓝图：', masterPlan].join('\n');
  const cardText = await callWithConfig(gpt55Config, cardPrompt, 0.82, 4096);
  const section = __testHooks.extractGeneratedSections(cardText)[0] || cardText;
  const card = __testHooks.parseGeneratedChapterCardSection({ section, order: 1, project: plannedProject });
  const writingProject = { ...plannedProject, automation: { ...plannedProject.automation, chapterCards: [card] } };
  const compiled = __testHooks.compileChapterForGeneration({ project: writingProject, automation: writingProject.automation, card, chapterNumber: 1 });
  const chapterResult = await __testHooks.generateAutomationChapter({ apiKey: gpt55Config.apiKey, model: gpt55Config.model || 'gpt-5.5', baseUrl: gpt55Config.baseUrl || 'https://www.cctq.ai/v1', project: writingProject, automation: writingProject.automation, card, nextCard: null, chapterNumber: 1, defaultVolumeId: writingProject.volumes[0].id });
  return { card, compiled, chapterResult };
});

const chapter = result.chapterResult.chapter;
const content = chapter.content || '';
const issues = [...__testHooks.findNaturalnessIssues(content), ...__testHooks.findDialogueIssues(content, result.card)];
const severity = __testHooks.classifyNaturalnessIssues(issues, content);
const dashCount = (content.match(/[—-]{1,2}/g) || []).length;
const words = content.replace(/\s+/g, '').length;
const report = [`作品：${project.title}`, `蓝图模型：${deepSeekConfig.model || 'deepseek-v4-flash'}`, `章节模型：${gpt55Config.model || 'gpt-5.5'}`, `章节：${chapter.title}`, `生成模式：${result.chapterResult.generationMode || 'fallback'}（复杂度${result.compiled.executionPack.complexityScore}）`, `字数：${words}`, `破折号数量：${dashCount}`, __testHooks.formatAiUsageReport(usage), `终检等级：${severity}`, `问题数：${issues.length}`, issues.length ? `问题：${issues.map((issue) => issue.label).join('；')}` : '问题：无', result.chapterResult.warnings?.length ? `场景包/逐拍警告：${result.chapterResult.warnings.join('；')}` : '场景包/逐拍警告：无'].join('\n');

await fs.writeFile(outPath, content, 'utf8');
await fs.writeFile(reportPath, report, 'utf8');
console.log(report);
console.log(outPath);
