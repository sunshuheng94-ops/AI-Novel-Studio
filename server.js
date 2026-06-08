import express from 'express';
import cors from 'cors';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createProjectRepository } from './projectRepository.js';
import {
  classifyNaturalnessIssues,
  detailFlowIssueTypes,
  isDetailFlowIssue,
  isLocalNaturalnessRepairIssue,
  isStructuralDetailIssue,
  pickNaturalnessRepairIssue,
  structuralDetailIssueTypes,
} from './naturalnessGate.js';
import { createPromptComposer } from './promptComposer.js';
import { createAutomationEngine } from './automationEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = process.env.APP_DATA_DIR || path.join(__dirname, 'data');
const dataFile = path.join(dataDir, 'db.json');
const aiDebugFile = path.join(dataDir, 'ai-debug.log');
const distDir = path.join(__dirname, 'web-dist');
const projectRepository = createProjectRepository({ dataDir, dataFile });
let promptComposer;
let automationEngine;
const aiUsageStorage = new AsyncLocalStorage();

const app = express();
app.use(cors());
app.use(express.json({ limit: '4mb' }));

const sensitiveKeywords = [
  '国家机密',
  '恐怖袭击',
  '制作炸药',
  '仇恨屠杀',
  '邪教仪式',
  '毒品交易细节',
  '血腥肢解',
  '未成年人性行为',
  '强奸细节',
  '自杀教程',
  '赌博盘口',
  '洗钱流程',
];

const tomatoRules = [
  { key: 'introHook', label: '简介前两句要有明确冲突和钩子' },
  { key: 'earlyPayoff', label: '前三章需要完成主角诉求和首轮爽点' },
  { key: 'namingConsistency', label: '角色名、地名、境界体系保持一致' },
  { key: 'mobileReading', label: '章节切分适合移动端阅读，段落不要过长' },
  { key: 'regulatedContent', label: '避免明显违规、过线、平台高风险内容' },
];

function now() {
  return new Date().toISOString();
}

async function writeAiDebugLog(message, details = {}) {
  try {
    await fs.mkdir(dataDir, { recursive: true });
    const safeDetails = Object.fromEntries(
      Object.entries(details).filter(([key]) => !/key|token|authorization|password/i.test(key)),
    );
    await fs.appendFile(aiDebugFile, `[${now()}] ${message} ${JSON.stringify(safeDetails)}\n`, 'utf8');
  } catch {}
}

function normalizeText(value) {
  return typeof value === 'string' ? value : '';
}

function createCharacter(payload = {}) {
  return {
    id: payload.id || crypto.randomUUID(),
    name: normalizeText(payload.name),
    role: normalizeText(payload.role),
    goal: normalizeText(payload.goal),
    secret: normalizeText(payload.secret),
    traits: normalizeText(payload.traits),
    arc: normalizeText(payload.arc),
  };
}

function createRelation(payload = {}) {
  return {
    id: payload.id || crypto.randomUUID(),
    from: payload.from || '',
    to: payload.to || '',
    type: payload.type || '',
    detail: payload.detail || '',
  };
}

function createTimelineEvent(payload = {}) {
  return {
    id: payload.id || crypto.randomUUID(),
    title: payload.title || '',
    phase: payload.phase || '',
    impact: payload.impact || '',
    order: typeof payload.order === 'number' ? payload.order : 1,
  };
}

function createChapter(payload = {}) {
  return {
    id: payload.id || crypto.randomUUID(),
    title: normalizeText(payload.title) || '新章节',
    summary: normalizeText(payload.summary),
    content: cleanStoredChapterContent(payload.content),
    status: payload.status || 'draft',
    volumeId: payload.volumeId || '',
    updatedAt: payload.updatedAt || now(),
  };
}

function createVolume(payload = {}) {
  return {
    id: payload.id || crypto.randomUUID(),
    title: payload.title || '第一卷',
    positioning: payload.positioning || '',
    goal: payload.goal || '',
    endingHook: payload.endingHook || '',
  };
}

function normalizePlatformStrategy(strategy = {}, project = {}) {
  const text = [project.genre, project.premise, project.targetAudience, project.styleGuide].map(normalizeText).join('\n');
  const primary = normalizeText(strategy.primary || strategy.main || '').trim() || (/同人|方舟|二次元|宅|综漫|动漫|游戏/.test(text) ? 'ciweimao' : 'fanqie');
  return {
    primary,
    pace: normalizeText(strategy.pace || '').trim() || 'fanqie',
    structure: normalizeText(strategy.structure || '').trim() || 'qidian',
    publishTarget: normalizeText(strategy.publishTarget || '').trim() || 'fanqie',
    tags: Array.isArray(strategy.tags) && strategy.tags.length
      ? strategy.tags.map(normalizeText).filter(Boolean).slice(0, 12)
      : ['同人', '系统', '长篇', '幽默史诗'].filter((tag) => (tag !== '同人' || /同人|方舟|二次元|动漫|游戏/.test(text))),
  };
}

function normalizeLedger(value, limit = 80) {
  return Array.isArray(value) ? value.filter(Boolean).slice(-limit) : [];
}

const automationLedgerLimits = {
  foreshadowingLedger: 240,
  readerExpectations: 160,
  commercialBeatLedger: 160,
  characterStateMemory: 300,
  characterLongTermSummary: 80,
  powerSystemLedger: 200,
  chapterFunctionCalendar: 240,
};

const checkpointIntervals = {
  standard: 20,
  major: 100,
};

function normalizeAutomationLedger(key, value) {
  return normalizeLedger(value, automationLedgerLimits[key] || 80);
}

function createProjectTemplate(payload = {}, ownerId) {
  const createdAt = now();
  const defaultVolume = createVolume({ title: '第一卷', positioning: '开篇立钩子', goal: '建立主角诉求与第一轮冲突' });
  const firstChapter = createChapter({ title: '第1章 开场', volumeId: defaultVolume.id });

  return {
    id: payload.id || crypto.randomUUID(),
    ownerId,
    title: payload.title || '未命名作品',
    genre: payload.genre || '女频 / 都市',
    premise: payload.premise || '',
    targetAudience: payload.targetAudience || '',
    styleGuide: payload.styleGuide || '',
    summary: payload.summary || '',
    worldSetting: payload.worldSetting || '',
    characterProfiles: payload.characterProfiles || '',
    outline: payload.outline || '',
    notes: payload.notes || '',
    tags: payload.tags || [],
    volumes: Array.isArray(payload.volumes) && payload.volumes.length ? payload.volumes.map(createVolume) : [defaultVolume],
    characters: Array.isArray(payload.characters) ? payload.characters.map(createCharacter) : [],
    relations: Array.isArray(payload.relations) ? payload.relations.map(createRelation) : [],
    timeline: Array.isArray(payload.timeline) ? payload.timeline.map(createTimelineEvent) : [],
    chapters: Array.isArray(payload.chapters) && payload.chapters.length ? payload.chapters.map(createChapter) : [firstChapter],
    publishConfig: {
      platform: '番茄小说',
      penName: '',
      coverBrief: '',
      blurb: '',
      contentWarnings: '',
      releasePlan: '',
      sellingPoints: '',
      ...payload.publishConfig,
    },
    automation: {
      inspiration: payload.automation?.inspiration || '',
      minimumWords: payload.automation?.minimumWords || 1500000,
      targetWords: payload.automation?.targetWords || 1500000,
      targetChapters: payload.automation?.targetChapters || 600,
      averageChapterWords: payload.automation?.averageChapterWords || 2400,
      totalGeneratedWords: payload.automation?.totalGeneratedWords || 0,
      status: payload.automation?.status || 'idle',
      masterPlan: payload.automation?.masterPlan || '',
      volumeBlueprint: payload.automation?.volumeBlueprint || '',
      chapterCards: Array.isArray(payload.automation?.chapterCards) ? payload.automation.chapterCards : [],
      lightweightGeneration: Boolean(payload.automation?.lightweightGeneration),
      authorPersona: normalizeText(payload.automation?.authorPersona),
      toneSettings: normalizeToneSettings(payload.automation?.toneSettings),
      toneProtocol: normalizeText(payload.automation?.toneProtocol),
      toneDriftEnabled: payload.automation?.toneDriftEnabled !== false,
      toneDriftReport: normalizeText(payload.automation?.toneDriftReport),
      toneDriftReports: trimToneDriftReports(payload.automation || {}),
      lastToneDriftAt: Number(payload.automation?.lastToneDriftAt) || 0,
      platformStrategy: normalizePlatformStrategy(payload.automation?.platformStrategy, payload),
      foreshadowingLedger: normalizeAutomationLedger('foreshadowingLedger', payload.automation?.foreshadowingLedger),
      readerExpectations: normalizeAutomationLedger('readerExpectations', payload.automation?.readerExpectations),
      commercialBeatLedger: normalizeAutomationLedger('commercialBeatLedger', payload.automation?.commercialBeatLedger),
      characterStateMemory: normalizeAutomationLedger('characterStateMemory', payload.automation?.characterStateMemory),
      characterLongTermSummary: normalizeLedger(payload.automation?.characterLongTermSummary, 80),
      powerSystemLedger: normalizeAutomationLedger('powerSystemLedger', payload.automation?.powerSystemLedger),
      chapterFunctionCalendar: normalizeAutomationLedger('chapterFunctionCalendar', payload.automation?.chapterFunctionCalendar),
      targetProgress: payload.automation?.targetProgress || 0,
      lastCheckpointAt: payload.automation?.lastCheckpointAt || 0,
      checkpointReport: payload.automation?.checkpointReport || '',
      lastRepairReport: payload.automation?.lastRepairReport || '',
      waitingForReview: Boolean(payload.automation?.waitingForReview),
      progressNotes: payload.automation?.progressNotes || '',
    },
    compliance: {
      lastCheckedAt: '',
      flaggedKeywords: [],
      riskLevel: 'unknown',
      suggestions: [],
      tomatoRules: tomatoRules.map((rule) => ({ ...rule, pass: false, note: '' })),
      ...payload.compliance,
    },
    checklistState: Array.isArray(payload.checklistState) ? payload.checklistState : [],
    createdAt,
    updatedAt: createdAt,
  };
}

async function ensureStorage() {
  return projectRepository.ensureStorage();
}

async function readDb() {
  return projectRepository.readDb();
}

async function writeDb(db) {
  return projectRepository.writeDb(db);
}

async function ensureUserSettings(db, userId) {
  if (!Array.isArray(db.settings)) {
    db.settings = [];
  }

  let settings = db.settings.find((item) => item.userId === userId);
  if (!settings) {
    settings = {
      userId,
      aiConfig: {
          apiKey: '',
          model: 'deepseek-v4-flash',
          baseUrl: 'https://api.deepseek.com',
          activeProfile: 'deepseek',
          modelRouting: 'mixed',
          profiles: {
          deepseek: { label: 'DeepSeek', apiKey: '', model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com' },
          gpt55: { label: 'GPT-5.5 中转站', apiKey: '', model: 'gpt-5.5', baseUrl: '' },
        },
      },
      updatedAt: now(),
    };
    db.settings.push(settings);
  }

  return settings;
}

function normalizeAiSettingsPayload(payload = {}) {
  const fallbackProfiles = {
    deepseek: { label: 'DeepSeek', apiKey: '', model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com' },
    gpt55: { label: 'GPT-5.5 中转站', apiKey: '', model: 'gpt-5.5', baseUrl: '' },
  };
  const profiles = { ...fallbackProfiles, ...(payload.profiles || {}) };
  Object.keys(profiles).forEach((key) => {
    const profile = profiles[key] || {};
    profiles[key] = {
      label: normalizeText(profile.label) || fallbackProfiles[key]?.label || key,
      apiKey: normalizeText(profile.apiKey),
      model: normalizeText(profile.model) || fallbackProfiles[key]?.model || 'deepseek-v4-flash',
      baseUrl: normalizeText(profile.baseUrl) || fallbackProfiles[key]?.baseUrl || '',
    };
  });
  const requestedProfile = normalizeText(payload.activeProfile) || 'deepseek';
  const activeProfile = profiles[requestedProfile] ? requestedProfile : 'deepseek';
  const active = profiles[activeProfile] || profiles.deepseek;
  return {
    apiKey: active.apiKey || normalizeText(payload.apiKey),
    model: active.model || normalizeText(payload.model) || 'deepseek-v4-flash',
    baseUrl: active.baseUrl || normalizeText(payload.baseUrl) || 'https://api.deepseek.com',
    activeProfile,
    modelRouting: normalizeText(payload.modelRouting) === 'active' ? 'active' : 'mixed',
    profiles,
  };
}

function resolveAiModelConfig(payload = {}, stage = 'active') {
  const normalized = normalizeAiSettingsPayload(payload);
  if (normalized.modelRouting === 'active') {
    return {
      apiKey: normalizeText(normalized.apiKey),
      model: normalizeText(normalized.model) || 'deepseek-v4-flash',
      baseUrl: normalizeText(normalized.baseUrl) || 'https://api.deepseek.com',
      profile: normalized.activeProfile,
    };
  }
  const preferredProfile = stage === 'planning' || stage === 'structure'
    ? 'deepseek'
    : stage === 'writing' || stage === 'chapter-card'
      ? 'gpt55'
      : normalized.activeProfile;
  const preferred = normalized.profiles?.[preferredProfile];
  const active = normalized.profiles?.[normalized.activeProfile];
  const deepseek = normalized.profiles?.deepseek;
  const candidates = [preferred, active, normalized, deepseek].filter(Boolean);
  const selected = candidates.find((profile) => profile.apiKey && profile.model && profile.baseUrl) || normalized;
  return {
    apiKey: normalizeText(selected.apiKey),
    model: normalizeText(selected.model) || 'deepseek-v4-flash',
    baseUrl: normalizeText(selected.baseUrl) || 'https://api.deepseek.com',
    profile: selected === normalized.profiles?.gpt55 ? 'gpt55' : selected === normalized.profiles?.deepseek ? 'deepseek' : normalized.activeProfile,
  };
}

function isAiHttpStatus(error, status) {
  return error instanceof Error && new RegExp(`AI 请求失败（HTTP\\s*${status}）`).test(error.message);
}

function isRecoverableChapterCardError(error) {
  return error instanceof Error && (
    isAiHttpStatus(error, 524)
    || /AI 未返回可解析的章节卡|未返回可解析的章节卡|章节卡解析失败|未解析到章节卡/.test(error.message)
  );
}

function cleanAutomationLedgersAfterChapterDelete(automation = {}, deletedChapterNumbers = []) {
  const deleted = [...new Set(deletedChapterNumbers.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))].sort((a, b) => a - b);
  if (!deleted.length) return automation;
  const deletedSet = new Set(deleted);
  const remapChapter = (chapter) => {
    const current = Number(chapter);
    if (!Number.isFinite(current) || current <= 0) return chapter;
    if (deletedSet.has(current)) return null;
    const removedBefore = deleted.filter((deletedChapter) => deletedChapter < current).length;
    return Math.max(1, current - removedBefore);
  };
  const cleanLedger = (items = [], key = '') => normalizeLedger(items, automationLedgerLimits[key] || 80)
    .map((item) => ({ ...item, chapter: remapChapter(item.chapter) }))
    .filter((item) => item.chapter !== null);

  return {
    ...automation,
    foreshadowingLedger: cleanLedger(automation.foreshadowingLedger, 'foreshadowingLedger'),
    readerExpectations: cleanLedger(automation.readerExpectations, 'readerExpectations'),
    commercialBeatLedger: cleanLedger(automation.commercialBeatLedger, 'commercialBeatLedger'),
    characterStateMemory: cleanLedger(automation.characterStateMemory, 'characterStateMemory'),
    characterLongTermSummary: buildCharacterLongTermSummary(cleanLedger(automation.characterStateMemory, 'characterStateMemory'), automation.characterLongTermSummary),
    powerSystemLedger: cleanLedger(automation.powerSystemLedger, 'powerSystemLedger'),
    chapterFunctionCalendar: cleanLedger(automation.chapterFunctionCalendar, 'chapterFunctionCalendar'),
  };
}

function createToken() {
  return crypto.randomBytes(24).toString('hex');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = normalizeText(storedHash).split(':');
  if (!salt || !hash) return false;
  const nextHash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(nextHash, 'hex'));
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    createdAt: user.createdAt,
  };
}

async function auth(req, res, next) {
  const authorization = normalizeText(req.headers.authorization);
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';

  if (!token) {
    return res.status(401).json({ message: '未登录' });
  }

  const db = await readDb();
  const session = db.sessions.find((item) => item.token === token);
  const user = session ? db.users.find((item) => item.id === session.userId) : null;

  if (!session || !user) {
    return res.status(401).json({ message: '登录已失效' });
  }

  req.db = db;
  req.user = user;
  req.token = token;
  next();
}

function buildProjectPayload(project) {
  const chapters = Array.isArray(project.chapters) ? project.chapters : [];
  const checkpointReports = trimCheckpointReports(project.automation || {}, project.automation?.checkpointRetentionCount || 20);
  return {
    ...project,
    title: normalizeText(project.title),
    genre: normalizeText(project.genre),
    premise: normalizeText(project.premise),
    targetAudience: normalizeText(project.targetAudience),
    styleGuide: normalizeText(project.styleGuide),
    summary: normalizeText(project.summary),
    worldSetting: normalizeText(project.worldSetting),
    characterProfiles: normalizeText(project.characterProfiles),
    outline: normalizeText(project.outline),
    notes: normalizeText(project.notes),
    tags: Array.isArray(project.tags) ? project.tags : [],
    volumes: Array.isArray(project.volumes) ? project.volumes.map(createVolume) : [],
    characters: Array.isArray(project.characters) ? project.characters.map(createCharacter) : [],
    relations: Array.isArray(project.relations) ? project.relations.map(createRelation) : [],
    timeline: Array.isArray(project.timeline) ? project.timeline.map(createTimelineEvent) : [],
    chapters: chapters.map(createChapter),
    publishConfig: {
      platform: '番茄小说',
      penName: '',
      coverBrief: '',
      blurb: '',
      contentWarnings: '',
      releasePlan: '',
      sellingPoints: '',
      ...(project.publishConfig || {}),
    },
    automation: {
      inspiration: normalizeText(project.automation?.inspiration),
      minimumWords: Number(project.automation?.minimumWords) || 1500000,
      targetWords: Number(project.automation?.targetWords) || 1500000,
      targetChapters: Number(project.automation?.targetChapters) || 600,
      averageChapterWords: Number(project.automation?.averageChapterWords) || 2400,
      totalGeneratedWords: calculateProjectWords({ chapters }),
      status: normalizeText(project.automation?.status) || 'idle',
      masterPlan: normalizeText(project.automation?.masterPlan),
      volumeBlueprint: normalizeText(project.automation?.volumeBlueprint),
      chapterCards: Array.isArray(project.automation?.chapterCards) ? project.automation.chapterCards : [],
      lightweightGeneration: Boolean(project.automation?.lightweightGeneration),
      continuityMemory: normalizeText(project.automation?.continuityMemory),
      authorPersona: normalizeText(project.automation?.authorPersona),
      toneSettings: normalizeToneSettings(project.automation?.toneSettings),
      toneProtocol: normalizeText(project.automation?.toneProtocol),
      toneDriftEnabled: project.automation?.toneDriftEnabled !== false,
      toneDriftReport: normalizeText(project.automation?.toneDriftReport),
      toneDriftReports: trimToneDriftReports(project.automation || {}),
      lastToneDriftAt: Number(project.automation?.lastToneDriftAt) || 0,
      platformStrategy: normalizePlatformStrategy(project.automation?.platformStrategy, project),
      foreshadowingLedger: normalizeAutomationLedger('foreshadowingLedger', project.automation?.foreshadowingLedger),
      readerExpectations: normalizeAutomationLedger('readerExpectations', project.automation?.readerExpectations),
      commercialBeatLedger: normalizeAutomationLedger('commercialBeatLedger', project.automation?.commercialBeatLedger),
      characterStateMemory: normalizeAutomationLedger('characterStateMemory', project.automation?.characterStateMemory),
      characterLongTermSummary: normalizeLedger(project.automation?.characterLongTermSummary, 80),
      powerSystemLedger: normalizeAutomationLedger('powerSystemLedger', project.automation?.powerSystemLedger),
      chapterFunctionCalendar: normalizeAutomationLedger('chapterFunctionCalendar', project.automation?.chapterFunctionCalendar),
      targetProgress: Number(project.automation?.targetProgress) || 0,
      lastCheckpointAt: Number(project.automation?.lastCheckpointAt) || 0,
      checkpointReport: normalizeText(project.automation?.checkpointReport) || checkpointReports.at(-1)?.report || '',
      checkpointReports,
      checkpointRetentionCount: Number(project.automation?.checkpointRetentionCount) || 20,
      lastRepairReport: normalizeText(project.automation?.lastRepairReport),
      waitingForReview: Boolean(project.automation?.waitingForReview),
      progressNotes: normalizeText(project.automation?.progressNotes),
    },
    compliance: {
      lastCheckedAt: '',
      flaggedKeywords: [],
      riskLevel: 'unknown',
      suggestions: [],
      tomatoRules: tomatoRules.map((rule) => ({ ...rule, pass: false, note: '' })),
      ...(project.compliance || {}),
    },
    checklistState: Array.isArray(project.checklistState) ? project.checklistState : [],
    updatedAt: now(),
  };
}

function resetAutomationRuntimeState(automation = {}, progressNotes = '已清空自动写作运行态台账', { preserveChapterCards = true } = {}) {
  return {
    ...automation,
    chapterCards: preserveChapterCards ? (Array.isArray(automation.chapterCards) ? automation.chapterCards : []) : [],
    continuityMemory: '',
    foreshadowingLedger: [],
    readerExpectations: [],
    commercialBeatLedger: [],
    characterStateMemory: [],
    characterLongTermSummary: [],
    powerSystemLedger: [],
    chapterFunctionCalendar: [],
    targetProgress: 0,
    lastCheckpointAt: 0,
    checkpointReport: '',
    checkpointReports: [],
    toneDriftReport: '',
    toneDriftReports: [],
    toneDriftEnabled: automation.toneDriftEnabled !== false,
    lastToneDriftAt: 0,
    lastRepairReport: '',
    waitingForReview: false,
    totalGeneratedWords: 0,
    progressNotes,
  };
}

function inspectCompliance(project) {
  const textPool = [
    project.title,
    project.summary,
    project.worldSetting,
    project.characterProfiles,
    project.outline,
    project.notes,
    project.publishConfig?.blurb,
    ...(project.chapters || []).map((chapter) => `${chapter.title}\n${chapter.summary}\n${chapter.content}`),
  ]
    .filter(Boolean)
    .join('\n');

  const flaggedKeywords = sensitiveKeywords.filter((keyword) => textPool.includes(keyword));
  const chapterWordCount = (project.chapters || []).slice(0, 3).reduce((sum, chapter) => sum + normalizeText(chapter.content).replace(/\s+/g, '').length, 0);
  const tomatoChecks = tomatoRules.map((rule) => {
    if (rule.key === 'introHook') {
      const blurb = normalizeText(project.publishConfig?.blurb);
      return { ...rule, pass: blurb.length >= 30, note: blurb.length >= 30 ? '简介长度基本够用' : '简介偏短，前两句钩子不够明显' };
    }

    if (rule.key === 'earlyPayoff') {
      return { ...rule, pass: chapterWordCount >= 2500, note: chapterWordCount >= 2500 ? '前三章体量基本可用' : '前三章字数偏少，建议先铺设核心冲突与爽点' };
    }

    if (rule.key === 'namingConsistency') {
      return { ...rule, pass: Boolean(project.characters?.length), note: project.characters?.length ? '已录入角色库，便于一致性管理' : '建议先建立角色卡和命名表' };
    }

    if (rule.key === 'mobileReading') {
      const hasLongParagraph = (project.chapters || []).some((chapter) => normalizeText(chapter.content).split('\n').some((line) => line.length > 90));
      return { ...rule, pass: !hasLongParagraph, note: hasLongParagraph ? '部分段落过长，建议拆段' : '段落长度较适合移动端' };
    }

    return { ...rule, pass: flaggedKeywords.length === 0, note: flaggedKeywords.length ? '发现高风险关键词，请人工复核' : '未发现明显高风险词' };
  });

  const suggestions = [];
  if (flaggedKeywords.length) suggestions.push('删除或改写高风险关键词，避免直接触发平台审核。');
  if (chapterWordCount < 2500) suggestions.push('补强前三章体量，尽快给出主角诉求、反差与钩子。');
  if (!project.characters?.length) suggestions.push('建立角色库和关系图，减少人名、设定前后冲突。');
  if (!normalizeText(project.publishConfig?.sellingPoints)) suggestions.push('补充卖点提炼，明确爽点、反转和情感抓手。');

  return {
    lastCheckedAt: now(),
    flaggedKeywords,
    riskLevel: flaggedKeywords.length ? 'high' : suggestions.length > 1 ? 'medium' : 'low',
    suggestions,
    tomatoRules: tomatoChecks,
  };
}

function buildAiMessages(systemPrompt, userPrompt) {
  return [
    {
      role: 'system',
      content: systemPrompt || '你是专业中文网络小说策划编辑与写作助手，擅长长篇连载、爽点设计、节奏控制、人物弧光和移动端连载节奏。',
    },
    {
      role: 'user',
      content: userPrompt,
    },
  ];
}

function getRequestAbortSignal(req) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort(new Error('AI 请求已中断'));
  };
  req.on('aborted', abort);
  req.res?.on?.('close', () => {
    if (!req.res?.writableEnded) abort();
  });
  return controller.signal;
}

function createTimeoutSignal(timeoutMs, message = 'AI 请求超时，请稍后重试或切换模型') {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) return { signal: undefined, cleanup: () => {} };
  const controller = new AbortController();
  const timer = setTimeout(() => {
    const error = new Error(message);
    error.name = 'TimeoutError';
    controller.abort(error);
  }, ms);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

function combineAbortSignals(...signals) {
  const activeSignals = signals.filter(Boolean);
  if (!activeSignals.length) return { signal: undefined, cleanup: () => {} };
  if (activeSignals.some((signal) => signal.aborted)) {
    const controller = new AbortController();
    const aborted = activeSignals.find((signal) => signal.aborted);
    controller.abort(aborted?.reason);
    return { signal: controller.signal, cleanup: () => {} };
  }

  const controller = new AbortController();
  const abort = (event) => controller.abort(event?.target?.reason);
  activeSignals.forEach((signal) => signal.addEventListener('abort', abort, { once: true }));
  return {
    signal: controller.signal,
    cleanup: () => activeSignals.forEach((signal) => signal.removeEventListener('abort', abort)),
  };
}

function createAiUsageTracker() {
  return {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
}

function recordAiUsage(usage = {}) {
  const tracker = aiUsageStorage.getStore();
  if (!tracker || !usage) return;
  tracker.calls += 1;
  tracker.promptTokens += Number(usage.prompt_tokens || usage.promptTokens || 0);
  tracker.completionTokens += Number(usage.completion_tokens || usage.completionTokens || 0);
  tracker.totalTokens += Number(usage.total_tokens || usage.totalTokens || 0);
}

async function withAiUsageTracking(callback) {
  const tracker = createAiUsageTracker();
  const result = await aiUsageStorage.run(tracker, callback);
  return { result, usage: tracker };
}

function formatAiUsageReport(usage = {}) {
  return [
    `AI调用次数：${usage.calls || 0}`,
    `输入tokens：${usage.promptTokens || 0}`,
    `输出tokens：${usage.completionTokens || 0}`,
    `总tokens：${usage.totalTokens || 0}`,
  ].join('\n');
}

async function callDeepSeek({ apiKey, baseUrl = 'https://api.deepseek.com', model = 'deepseek-v4-flash', temperature = 0.9, systemPrompt, userPrompt, maxTokens = 8192, signal, timeoutMs = 180000 }) {
  const effectiveMaxTokens = model === 'gpt-5.5' ? Math.min(maxTokens, 4096) : maxTokens;
  const timeout = createTimeoutSignal(timeoutMs, `AI 请求超时（${Math.round(timeoutMs / 1000)}秒）：${model}`);
  const combined = combineAbortSignals(signal, timeout.signal);
  let response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: effectiveMaxTokens,
        messages: buildAiMessages(systemPrompt, userPrompt),
      }),
      signal: combined.signal,
    });
  } catch (error) {
    const reason = combined.signal?.reason || error;
    if (reason?.name === 'TimeoutError') throw new Error(reason.message || 'AI 请求超时，请稍后重试或切换模型');
    if (error?.name === 'AbortError') throw new Error('AI 请求已中断');
    throw new Error(`DeepSeek 网络请求失败：${error instanceof Error ? error.message : 'fetch failed'}`);
  } finally {
    combined.cleanup();
    timeout.cleanup();
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorText = result?.error?.message || result?.message || JSON.stringify(result).slice(0, 500) || 'DeepSeek 请求失败';
    throw new Error(`AI 请求失败（HTTP ${response.status}）：${errorText}`);
  }

  recordAiUsage(result?.usage || {});

  return result?.choices?.[0]?.message?.content || '';
}

async function callDeepSeekStream({ apiKey, baseUrl = 'https://api.deepseek.com', model = 'deepseek-v4-flash', temperature = 0.9, systemPrompt, userPrompt, maxTokens = 8192, signal, timeoutMs = 180000, onToken }) {
  const effectiveMaxTokens = model === 'gpt-5.5' ? Math.min(maxTokens, 4096) : maxTokens;
  const timeout = createTimeoutSignal(timeoutMs, `AI 请求超时（${Math.round(timeoutMs / 1000)}秒）：${model}`);
  const combined = combineAbortSignals(signal, timeout.signal);
  let response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature, max_tokens: effectiveMaxTokens, stream: true, messages: buildAiMessages(systemPrompt, userPrompt) }),
      signal: combined.signal,
    });
  } catch (error) {
    combined.cleanup();
    timeout.cleanup();
    const reason = combined.signal?.reason || error;
    if (reason?.name === 'TimeoutError') throw new Error(reason.message || 'AI 请求超时，请稍后重试或切换模型');
    if (error?.name === 'AbortError') throw new Error('AI 请求已中断');
    throw new Error(`DeepSeek 流式网络请求失败：${error instanceof Error ? error.message : 'fetch failed'}`);
  }

  if (!response.ok) {
    try {
      const result = await response.json().catch(() => ({}));
      const errorText = result?.error?.message || result?.message || JSON.stringify(result).slice(0, 500) || 'DeepSeek 请求失败';
      throw new Error(`AI 请求失败（HTTP ${response.status}）：${errorText}`);
    } finally {
      combined.cleanup();
      timeout.cleanup();
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    combined.cleanup();
    timeout.cleanup();
    throw new Error('当前模型接口未返回可读取的流');
  }
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        const parsed = JSON.parse(data);
        const token = parsed?.choices?.[0]?.delta?.content || '';
        if (token) {
          fullText += token;
          onToken?.(token);
        }
        recordAiUsage(parsed?.usage || {});
      }
    }
  } catch (error) {
    const reason = combined.signal?.reason || error;
    if (reason?.name === 'TimeoutError') throw new Error(reason.message || 'AI 请求超时，请稍后重试或切换模型');
    if (error?.name === 'AbortError') throw new Error('AI 请求已中断');
    throw error;
  } finally {
    reader.releaseLock?.();
    combined.cleanup();
    timeout.cleanup();
  }
  return fullText;
}

function startNdjsonStream(res) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  return (event) => res.write(`${JSON.stringify(event)}\n`);
}

function countWords(text = '') {
  return normalizeText(text).replace(/\s+/g, '').length;
}

function calculateProjectWords(project = {}) {
  return (project.chapters || []).reduce((sum, chapter) => sum + countWords(chapter.content), 0);
}

function extractLabeledField(section, labels, stopLabels = []) {
  const start = findFieldLabel(section, labels);
  if (!start) return '';
  const stop = stopLabels.length ? findFieldLabel(section, stopLabels, start.valueStart) : null;
  return cleanCardFieldText(section.slice(start.valueStart, stop?.labelStart ?? section.length));
}

function firstUsefulSentence(...values) {
  return values
    .map(normalizeText)
    .join('\n')
    .split(/[。！？\n]/)
    .map((item) => item.trim())
    .find((item) => item.length >= 6 && !/承接|继续推进|保留章末钩子|模板|不能为空/.test(item)) || '';
}

function cleanCardFieldText(value = '') {
  return normalizeText(value)
    .split('\n')
    .map((line) => line.replace(/^\s*[-*]\s+(?=\S)/, '').trimEnd())
    .join('\n')
    .replace(/^\s*[*_]{1,2}\s*/, '')
    .replace(/\s*[*_]{1,2}\s*$/g, '')
    .replace(/^\s*---\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const chapterTitleLabels = ['本章标题', '章节标题', '标题'];
const chapterSummaryLabels = ['本章摘要', '章节摘要', '章节简介', '本章简介', '摘要', '简介'];
const chapterHookLabels = ['关键钩子', '章末钩子', '钩子', '悬念'];
const chapterContentLabels = ['本章正文', '章节正文', '正文内容', '章节内容', '正文'];
const allChapterFieldLabels = [...chapterTitleLabels, ...chapterSummaryLabels, ...chapterHookLabels, ...chapterContentLabels, '开头方式', '开头锚点', '禁止开头', '叙事手法', '叙事目的', '开场方式', '开场锚点', '开场禁用'];

function makeLabelPattern(labels) {
  return labels.join('|');
}

function findFieldLabel(text, labels, startAt = 0) {
  const matcher = new RegExp(`(^|\\n)\\s*(?:[-*]\\s*)?(?:[*_]{1,2})?(?:【\\s*)?(?:${makeLabelPattern(labels)})(?:\\s*】)?(?:[*_]{1,2})?\\s*[:：]\\s*`, 'g');
  matcher.lastIndex = startAt;
  const match = matcher.exec(text);
  if (!match) return null;
  return {
    labelStart: match.index + (match[1] ? match[1].length : 0),
    valueStart: matcher.lastIndex,
  };
}

function extractChapterField(body, labels, stopLabels = allChapterFieldLabels) {
  const start = findFieldLabel(body, labels);
  if (!start) return '';
  const stop = findFieldLabel(body, stopLabels, start.valueStart);
  return body.slice(start.valueStart, stop?.labelStart ?? body.length).trim();
}

function isChapterMetadataLine(line = '') {
  const trimmed = normalizeText(line).trim();
  if (!trimmed) return false;
  if (new RegExp(`^(?:[-*]\s*)?(?:[*_]{1,2})?(?:【\s*)?(?:${makeLabelPattern(allChapterFieldLabels)})(?:\s*】)?(?:[*_]{1,2})?\s*[:：]`).test(trimmed)) return true;
  if (/^(FAIL|PASS|缺失|未生成|无正文|正文缺失|本章缺失|本章未生成)$/i.test(trimmed.replace(/\s+/g, ''))) return true;
  if (/^原因[:：].{0,120}$/.test(trimmed)) return true;
  return false;
}

function sanitizeImportedContent(value = '') {
  return normalizeText(value)
    .split('\n')
    .filter((line) => !isChapterMetadataLine(line))
    .join('\n')
    .trim();
}

function stripTrailingChapterMetadata(value = '') {
  const lines = normalizeText(value).split('\n');
  while (lines.length && isChapterMetadataLine(lines[lines.length - 1])) {
    lines.pop();
  }
  return lines.join('\n').trim();
}

function cleanImportedChapterTitle(rawTitle = '', fallbackTitle = '新章节') {
  const title = normalizeText(rawTitle)
    .replace(/^#+\s*/, '')
    .replace(new RegExp(`\\s*(?:/\\s*)?(?:${makeLabelPattern(allChapterFieldLabels)})[:：][\\s\\S]*$`), '')
    .trim();
  const fallback = normalizeText(fallbackTitle).trim() || '新章节';
  const suffix = stripChapterNumber(title);
  const fallbackSuffix = stripChapterNumber(fallback);
  if (!suffix && fallbackSuffix) return fallback;
  return title || fallback;
}

function cleanStoredChapterTitle(value = '') {
  return cleanImportedChapterTitle(value, '新章节');
}

function cleanStoredChapterSummary(value = '') {
  return takeSummaryLine(normalizeText(value));
}

function repairChapterMetaNarrationLocally(content = '') {
  return normalizeText(content)
    .replace(/(^|[^#\n])第\s*[一二三四五六七八九十百千万两〇零\d]+\s*章(?=\s*(?:顺手|摸|拿|塞|捡|发现|遇到|说过|提到|留下|得到|看过|给|用过|带着|拿到|收起|放进|装进|揣进))/g, '$1之前')
    .replace(/(^|[^#\n])第\s*[一二三四五六七八九十百千万两〇零\d]+\s*章里(?=\s*(?:顺手|摸|拿|塞|捡|发现|遇到|说过|提到|留下|得到|看过|给|用过|带着|拿到|收起|放进|装进|揣进))/g, '$1之前')
    .replace(/(^|[，。！？；\s])上一章里/g, '$1之前')
    .replace(/前文(?:里)?(?:提到|说过)的/g, '之前的')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanStoredChapterContent(value = '') {
  return repairChapterMetaNarrationLocally(value);
}

function stripMarkdownNoise(content = '') {
  return repairChapterMetaNarrationLocally(content)
    .replace(/^\s*---\s*$/gm, '')
    .replace(/^\s*\*{3,}\s*$/gm, '')
    .replace(/^\s*#{1,6}\s+第\s*[一二三四五六七八九十百千万两〇零\d]+\s*章[^\n]*$/gm, '')
    .replace(/^\s*#{2,6}\s+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function repairStandaloneTacticalLabelsLocally(content = '') {
  const normalized = normalizeText(content).trim();
  if (!normalized) return '';

  const triggerPattern = /【(?:搜|打|撤)|系统|提示|可利用|环境点|第一反应|视线|眼睛|扫过|看见|资源|机会|风险|目标|能用|能拿|能藏|能挡|能炸|能逃|玩家|红桶|爆炸物|控场/;
  const actionPattern = /^(?:拿|捡|翻|找|撬|推|拉|踹|砸|打|炸|堵|挡|藏|跑|撤|开|关|绕|钻|爬|抢|封|控|引|点|烧|切|砍|刺|拽|套|卡|撕|拆|拔|扔|接|救|拖|带|用|试|别|不要).{0,6}$/;
  const judgementPattern = /^(?:可|能|有|会|可用|能用|能拿|能藏|能挡|能炸|能逃|能撬|能开|能堵|能封|能控|危险|安全|资源|机会|目标|风险|钥匙|入口|出口|路线|爆炸物|可爆物|遮蔽物|掩体|武器|药|药品|食物|水|线索|证据|坐标|编号|机关|阵眼|核心|弱点|死路|活路|陷阱|诱饵|假货|真货|补给|材料|工具|通道|暗门|后门|缺口|破绽|控场神器).{0,4}$/;
  const protectedPattern = /^(?:ACE|Ace|博士|阿米娅|凯尔希|灰喉|霜星|W|系统|完了|等等|不行|糟了|疼|痛|冷|热|怕|跑|快跑|低头|趴下|别动|闭嘴|活着|是活人|不是|真的|假的|没有|不对|行|好|草|操|妈的)$/;
  const objectLikePattern = /^(?!.*[，,：:、])[^。！？!?\n“”]{2,8}$/;

  const isStandaloneLabel = (paragraph = '') => {
    const text = paragraph.replace(/[。！？!?]$/g, '').trim();
    if (!objectLikePattern.test(text)) return false;
    if (protectedPattern.test(text)) return false;
    return true;
  };

  const objectAnchorPattern = /(?:柜|门|瓶|车|箱|包|刀|剑|枪|弩|盾|药|灯|管|线|绳|符|阵|石|晶|钥匙|卡|牌|图|路|桥|洞|窗|墙|桌|椅|床|梯|井|船|锁|核心|阵眼|机关|通道|入口|出口|缺口|破绽|材料|工具|补给|资源|武器|线索)$/;

  const isObjectAnchor = (text = '') => objectAnchorPattern.test(text.replace(/[。！？!?]$/g, '').trim());

  const isShortJudgementParagraph = (paragraph = '') => {
    const text = paragraph.replace(/[。！？!?]$/g, '').trim();
    if (text.length < 3 || text.length > 16) return false;
    if (protectedPattern.test(text)) return false;
    return /^(?:懂了|明白了|有了|就是|这就是|可以|能|可|会|像是|应该是|原来是)?[，,、]?(?:可用|能用|能拿|能藏|能挡|能炸|能逃|能撬|能开|能堵|能封|能控|资源|机会|风险|目标|爆炸物|可爆物|武器|药|线索|入口|出口|通道|机关|阵眼|核心|弱点|破绽|陷阱|诱饵|补给|工具|材料)[！!。]?$/.test(text);
  };

  const isTacticalChain = (items = [], context = '') => {
    if (items.length < 2 || items.length > 4 || !triggerPattern.test(context)) return false;
    const texts = items.map((item) => item.replace(/[。！？!?]$/g, '').trim());
    if (texts.some((item) => protectedPattern.test(item))) return false;
    const hasJudgementOrAction = texts.slice(1).some((item) => judgementPattern.test(item) || actionPattern.test(item));
    const hasObjectAnchor = texts.slice(0, -1).some(isObjectAnchor);
    return hasObjectAnchor && hasJudgementOrAction;
  };

  const shouldSoftenSingleObjectPause = (item = '', context = '') => {
    const text = item.replace(/[。！？!?]$/g, '').trim();
    if (!isStandaloneLabel(item)) return false;
    if (!triggerPattern.test(context)) return false;
    if (/^(?:又是|还是|不是|真是|就是|原来|这下|确实|当然|果然)/.test(text)) return false;
    if (!isObjectAnchor(text)) return false;
    if (!/(?:等于|翻译成|第一反应|玩家|游戏|红桶|爆炸|可用|能用|能拿|能藏|能挡|能炸|能逃|资源|机会|风险|目标|武器|线索|入口|出口|通道|机关|阵眼|核心|弱点|破绽|陷阱|补给|工具)/.test(context)) return false;
    return text.length >= 2 && text.length <= 8;
  };

  const mergeChain = (items = []) => {
    const [object, ...rest] = items.map((item) => item.replace(/[。！？!?]$/g, '').trim());
    if (!rest.length) return `${object}。`;
    const last = rest.at(-1);
    if (actionPattern.test(last) && rest.length >= 2) {
      return `视线在${object}上停了一下，脑子里先跳出${rest.slice(0, -1).join('、')}，下一步就是${last}。`;
    }
    return `视线在${object}上停了一下，脑子里很快冒出${rest.join('、')}几个判断。`;
  };

  const parts = normalized.split(/(\n{2,})/);
  const paragraphs = [];
  for (let index = 0; index < parts.length; index += 2) {
    paragraphs.push({ text: parts[index], sep: parts[index + 1] || '\n\n' });
  }

  const repaired = [];
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index].text.trim();
    if (!isStandaloneLabel(paragraph)) {
      repaired.push(paragraph);
      continue;
    }

    const chain = [paragraph];
    let cursor = index + 1;
    while (cursor < paragraphs.length && chain.length < 4 && isStandaloneLabel(paragraphs[cursor].text.trim())) {
      chain.push(paragraphs[cursor].text.trim());
      cursor += 1;
    }
    if (chain.length >= 2 && chain.length < 4 && cursor < paragraphs.length && isShortJudgementParagraph(paragraphs[cursor].text.trim())) {
      chain.push(paragraphs[cursor].text.trim());
      cursor += 1;
    }

    const context = paragraphs.slice(Math.max(0, index - 2), Math.min(paragraphs.length, cursor + 1)).map((item) => item.text).join('\n');
    if (isTacticalChain(chain, context)) {
      repaired.push(mergeChain(chain));
      index = cursor - 1;
    } else if (chain.length === 1 && shouldSoftenSingleObjectPause(paragraph, context)) {
      repaired.push(`视线停在${paragraph.replace(/[。！？!?]$/g, '').trim()}上。`);
    } else {
      repaired.push(paragraph);
    }
  }

  return repaired.filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

function repairUrgentCommandBurstsLocally(content = '') {
  const protectedCommandPart = /^(?:ACE|Ace|博士|阿米娅|凯尔希|系统|完了|等等|不行|糟了|疼|痛|冷|怕|跑|快跑|低头|趴下|别动|闭嘴|活着|真的|假的|没有|不对|行|好|草|操|妈的)$/;
  const shortPart = '[^。”！？!?，,、：:；;“”]{1,8}';
  const rewriteCommand = (full = '', rawBody = '') => {
    const parts = rawBody.split('。').map((item) => item.trim()).filter(Boolean);
    if (parts.length < 2 || parts.length > 4) return full;
    if (parts.join('').length > 26) return full;
    if (parts.some((part) => protectedCommandPart.test(part))) return full;

    const [first, second, third = '', fourth = ''] = parts;
    const tail = fourth || third;
    if (/^(?:推|拉|挪|拖|搬)/.test(first) && /^卡/.test(second) && /^(?:快|快点|别停|马上|现在)$/.test(tail)) {
      const object = first.replace(/^(?:推|拉|挪|拖|搬)/, '') || '那个';
      const target = second.replace(/^卡(?:住)?/, '');
      return `“把${object}推过去，卡住${target}，${tail}。”`;
    }
    if (/^(?:看|盯|注意)/.test(first) && /^(?:别|不要)/.test(tail)) {
      const object = first.replace(/^(?:看|盯|注意)/, '');
      return `“往${object}${second}看，${tail}。”`;
    }
    if (/^听/.test(first) && /^(?:别|不要)/.test(tail)) {
      const object = first.replace(/^听/, '');
      return `“听${object}里的${second}，${tail}。”`;
    }
    if (/^(?:左|右|上|下|前|后|东|南|西|北|里面|外面|楼上|楼下|门口|窗边|墙后|角落)/.test(first) && /(?:门|路|楼梯|通道|出口|入口|窗|墙|洞|桥|梯)$/.test(second) && /^(?:走|跑|撤|躲|进|绕|钻|爬|退|冲)/.test(tail)) {
      return `“${tail}${first}${second}。”`;
    }
    if (/(?:门口|窗边|楼下|楼上|走廊|墙后|角落|外面|里面)/.test(first) && /(?:弩手|敌人|人影|脚步|火|烟|塌|动静|声音|风险|陷阱)/.test(second) && /^(?:趴下|低头|别动|别出声|躲开|后退|快跑|撤)/.test(tail)) {
      return `“${first}有${second}，${tail}。”`;
    }
    if (/(?:柜|箱|包|架|房|屋|洞|车|船|桌|床|药柜|书柜)$/.test(first) && /(?:药|食物|水|钥匙|线索|工具|武器|材料|补给|止血|绷带)/.test(second) && /^(?:拿|拿上|翻|找|带走|藏好|收好)/.test(tail)) {
      return `“${first}里有${second}，${tail}。”`;
    }
    return full;
  };

  return normalizeText(content)
    .replace(new RegExp(`“((${shortPart}。){1,3}${shortPart}。?)”`, 'g'), (full, body) => rewriteCommand(full, body.replace(/。?$/, '')))
    .trim();
}

function repairDenseRhetoricLocally(content = '') {
  return normalizeText(content)
    .replace(/当([^，。！？!?、]{1,10})、当([^，。！？!?、]{1,10})、当([^，。！？!?、]{1,14})/g, '当$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeVolumeName(volumeName, volumes = []) {
  const value = normalizeText(volumeName).trim();
  if (!value) return volumes[0]?.title || '';
  const exact = volumes.find((volume) => volume.title === value);
  if (exact) return exact.title;
  const partial = volumes.find((volume) => value.includes(volume.title) || volume.title.includes(value));
  return partial?.title || value;
}

function formatChapterCard(card = {}, fallbackNumber = 1, options = {}) {
  const includeWritingSignals = options.includeWritingSignals === true;
  const narrativeMode = normalizeText(card.narrativeMode).trim() || getNarrativeModeByOrder(fallbackNumber);
  const coreLines = [
    `${card.order || fallbackNumber}. ${card.title || `第${fallbackNumber}章`}`,
    `卷：${card.volumeName || ''}`,
    `蓝图阶段：${card.paceStage || ''}`,
    card.chapterGoal ? `本章目标：${card.chapterGoal}` : '',
    card.coreEvent ? `核心事件：${card.coreEvent}` : '',
    card.cast ? `出场人物：${card.cast}` : '',
    card.keyClue ? `关键物件/线索：${card.keyClue}` : '',
    card.chapterResult ? `本章结果：${card.chapterResult}` : '',
    `进度锁：${card.progressLock || `只能写第${fallbackNumber}章对应阶段`}`,
    `本章只允许：${card.allowedBeats || card.summary || ''}`,
    `本章禁止：${card.forbiddenBeats || '禁止提前写后期核心冲突、终局反派、下一卷高潮、跨越式关系变化'}`,
    `读者预期：${card.readerExpectation || card.readerExpectations || '本章需要回应读者最关心的一个问题，并制造下一步期待'}`,
    `上一章遗留动作：${card.openAction || '承接上一章未完成动作、未解释反应或未处理选择'}`,
    `伏笔规划：${card.foreshadowing || '至少推进或埋下一条可追踪伏笔，不能无意义堆设定'}`,
    card.commercialBeat ? `本章爽点：${card.commercialBeat}` : '',
    card.platformNotes ? `平台适配：${card.platformNotes}` : '',
    card.systemRule ? `系统规则：${card.systemRule}` : '',
    card.pressureLevel ? `压力等级：${card.pressureLevel}` : '',
    card.protagonistChoice ? `主角主动选择：${card.protagonistChoice}` : '',
    card.agencyRecovery ? `主角拿回的主动权：${card.agencyRecovery}` : '',
    card.chapterReward ? `本章小收获：${card.chapterReward}` : '',
    card.hookType ? `章末钩子类型：${card.hookType}` : '',
    `摘要：${card.summary || ''}`,
    `钩子：${card.hook || ''}`,
  ];

  if (!includeWritingSignals) return coreLines.filter(Boolean).join('\n');

  return [
    ...coreLines,
    '【旧卡写法信号，仅供真人写作模块弱参考，不得当作章节卡硬约束】',
    `开头方式：${card.openingType || '由真人写作模块按本章冲突选择'}`,
    `开头锚点：${card.openingAnchor || '由真人写作模块从本章事件中选择'}`,
    `禁止开头：${card.openingBan || '禁止默认使用“精确时间 + 地点 + 主角动作”的打卡式开头'}`,
    `叙事手法：${narrativeMode}`,
    `叙事目的：${card.narrativePurpose || getNarrativePurposeByMode(narrativeMode)}`,
    card.functionMode ? `章节功能：${card.functionMode}` : '',
    card.dialogueDensity ? `对话密度：${card.dialogueDensity}` : '',
    card.texturePlan ? `叙述质感：${card.texturePlan}` : '',
    card.humanTextureBeats ? `人味锚点：${card.humanTextureBeats}` : '',
    card.draftingBan ? `正文禁区：${card.draftingBan}` : '',
    card.endingDelivery ? `章末交付物：${card.endingDelivery}` : '',
  ].filter(Boolean).join('\n');
}

function getChapterOpeningText(chapter = '') {
  const content = typeof chapter === 'string' ? chapter : chapter.content || '';
  return normalizeText(content)
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) || '';
}

function detectChapterOpeningPattern(chapter = {}) {
  const opening = getChapterOpeningText(chapter);
  const compact = opening.replace(/\s+/g, '');
  if (!compact) return 'empty';
  if (/^[“"'「『《【]|^[^。！？!?]{1,24}[：:]/.test(opening)) return 'dialogue';
  if (/(三年前|多年以前|上一次|第一次|那年|很多年后|后来他才知道)/.test(compact)) return 'flashback';
  if (/(醒来时|醒来的时候|已经|只剩|尸体|血迹|废墟|名单被|门被锁|被铐|失踪|烧掉|塌了)/.test(compact)) return 'result/conflict';
  if (/(凌晨|清晨|早晨|上午|中午|下午|傍晚|晚上|深夜|午夜|黎明|黄昏|\d{1,2}[点时]|[一二三四五六七八九十]{1,3}点|\d{1,2}:\d{2}|零\d分|\d+分)/.test(compact)) return 'time';
  if (/(门|窗|桌|灯|车|枪|刀|杯|纸|徽章|名单|通讯器|屏幕|铁门|阴影|雪|雨|风|声音|响声|气味|温度)/.test(compact)) return 'object/scene';
  if (/(推开|坐起|站起|伸手|拿起|放下|走进|下车|抬头|转身|握住|按下|看向)/.test(compact)) return 'action';
  if (/(不对|没人|没有|不能|偏偏|除了|问题是|最糟|最安全|最危险)/.test(compact)) return 'misdirection';
  return 'scene';
}

function buildRecentOpeningPatternLedger(project = {}, limit = 10) {
  const chapters = (project.chapters || []).filter((chapter, idx) => !isBlankStarterChapter(chapter, idx)).slice(-limit);
  if (!chapters.length) return '';
  const counts = chapters.reduce((acc, chapter) => {
    const pattern = detectChapterOpeningPattern(chapter);
    acc[pattern] = (acc[pattern] || 0) + 1;
    return acc;
  }, {});
  return [
    `最近${chapters.length}章开头模式账本：`,
    ...chapters.map((chapter) => `${chapter.title}：${detectChapterOpeningPattern(chapter)}｜首句：${getChapterOpeningText(chapter).slice(0, 80)}`),
    `模式计数：${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join('；')}`,
    '使用要求：本章优先避开近5章最高频开头方式；time 开头近8章超过2次时，优先不用精确时间开头；如果上一章动作需要直接承接，可以使用相近开头，但要换具体压力或动作落点。',
  ].join('\n');
}

function buildOpeningNarrativeStrategyGuide(project = {}) {
  return [
    '章节开头与叙事策略：',
    '1. 连贯性靠上一章未完成动作、伤势、选择、关键物件、系统提示或冲突后果承接，不靠每章第一句报时定位。',
    '2. 不要默认用“精确时间 + 地点 + 主角动作”三段式开头；除非时间本身是倒计时、迟到、夜袭、交接班、任务窗口等剧情压力。',
    '3. 允许使用顺叙、插叙、倒叙、并行叙事、碎片回忆、延迟交代、误导式开头；非顺叙应服务本章冲突，通常在500字内让读者明白当前主线位置，情绪章或悬疑章可略延后但不能长期失去方向。',
    '4. 首段可以先给冲突、异常结果、对话、物件、身体反应或错误判断，再自然补足时间地点；不要每章前三句都完整交代时间、地点、主角在做什么。',
    '5. 插叙适合揭示旧伤、旧账、秘密来源；倒叙适合先给结果再回推原因；延迟交代适合先写异常再补任务背景；并行叙事适合敌我双方或主角行动与对手反应交错。',
    '6. 默认叙事手法是顺叙；每 10 章里只安排少量非顺叙章节，优先延迟交代、插叙、倒叙，避免一整段连续炫技。',
    buildRecentOpeningPatternLedger(project),
  ].filter(Boolean).join('\n');
}

function getNarrativeModeByOrder(order = 1) {
  const chapterNumber = Math.max(1, Number(order) || 1);
  if (chapterNumber <= 3) return 'linear';
  const block = Math.floor((chapterNumber - 4) / 10);
  const position = (chapterNumber - 4) % 10;
  const patterns = [
    ['delayed', 'linear', 'flashback', 'linear', 'reverse', 'linear', 'linear', 'linear', 'linear', 'linear'],
    ['linear', 'delayed', 'linear', 'flashback', 'linear', 'reverse', 'linear', 'linear', 'linear', 'linear'],
    ['linear', 'linear', 'delayed', 'linear', 'flashback', 'linear', 'reverse', 'linear', 'linear', 'linear'],
  ];
  return patterns[block % patterns.length][position] || 'linear';
}

function normalizeNarrativeMode(mode = '', order = 1) {
  const text = normalizeText(mode).trim().toLowerCase();
  if (!text || text === 'linear' || text === '顺叙' || text === '顺序') {
    return getNarrativeModeByOrder(order);
  }
  return text;
}

function getNarrativePurposeByMode(mode = '') {
  switch (normalizeText(mode).trim().toLowerCase()) {
    case 'flashback':
      return '补出人物旧伤、旧案或秘密来源，并服务当前冲突';
    case 'reverse':
      return '先给结果再回推原因，增强章首钩子与悬念';
    case 'delayed':
      return '先展示异常或结果，再延迟补背景，降低打卡感';
    case 'parallel':
      return '交错呈现主角与对手/另一条线的推进，制造信息差';
    case 'fragment':
      return '用碎片回忆补强情绪和信息，但不打断当前主线';
    case 'misdirection':
      return '先误导读者判断，再在本章内完成纠偏或反转';
    default:
      return '顺畅推进本章冲突与章末钩子';
  }
}

const openingTypeLabels = {
  conflict: '冲突切入',
  action: '动作切入',
  dialogue: '对话切入',
  result: '结果切入',
  object: '物件切入',
  sensory: '感官切入',
  inner: '内心切入',
  scene: '场景切入',
  time: '时间切入',
};

function adjustOpeningWeight(weights, key, delta) {
  weights[key] = Math.max(0, (weights[key] || 0) + delta);
}

function buildOpeningPersonaText(project = {}, automation = {}) {
  return [
    automation.authorPersona,
    project.styleGuide,
    project.genre,
    project.premise,
    project.targetAudience,
  ].filter(Boolean).join('\n');
}

function buildOpeningTypeWeights(project = {}, automation = {}) {
  const weights = {
    conflict: 18,
    action: 16,
    dialogue: 14,
    object: 13,
    sensory: 12,
    result: 10,
    inner: 8,
    scene: 6,
    time: 3,
  };
  const text = buildOpeningPersonaText(project, automation);

  if (/诙谐|幽默|吐槽|轻松|口语|好笑|玩梗/.test(text)) {
    adjustOpeningWeight(weights, 'dialogue', 6);
    adjustOpeningWeight(weights, 'inner', 4);
    adjustOpeningWeight(weights, 'action', 3);
    adjustOpeningWeight(weights, 'object', 2);
    adjustOpeningWeight(weights, 'time', -2);
  }
  if (/史诗|厚重|宏大|命运|文明|战争|群像/.test(text)) {
    adjustOpeningWeight(weights, 'result', 4);
    adjustOpeningWeight(weights, 'sensory', 4);
    adjustOpeningWeight(weights, 'scene', 3);
    adjustOpeningWeight(weights, 'object', 3);
    adjustOpeningWeight(weights, 'dialogue', -2);
    adjustOpeningWeight(weights, 'time', -1);
  }
  if (/悬疑|冷感|克制|留白|藏|压抑|诡异|谜/.test(text)) {
    adjustOpeningWeight(weights, 'object', 6);
    adjustOpeningWeight(weights, 'sensory', 5);
    adjustOpeningWeight(weights, 'result', 4);
    adjustOpeningWeight(weights, 'inner', 3);
    adjustOpeningWeight(weights, 'conflict', -3);
    adjustOpeningWeight(weights, 'time', -2);
  }
  if (/爽点|快节奏|热血|升级|逆袭|战斗|强节奏/.test(text)) {
    adjustOpeningWeight(weights, 'conflict', 5);
    adjustOpeningWeight(weights, 'action', 4);
    adjustOpeningWeight(weights, 'result', 3);
    adjustOpeningWeight(weights, 'dialogue', 2);
    adjustOpeningWeight(weights, 'scene', -2);
    adjustOpeningWeight(weights, 'time', -2);
  }
  if (/甜宠|恋爱|情绪|拉扯|暧昧|关系/.test(text)) {
    adjustOpeningWeight(weights, 'dialogue', 6);
    adjustOpeningWeight(weights, 'inner', 5);
    adjustOpeningWeight(weights, 'action', 2);
    adjustOpeningWeight(weights, 'conflict', -2);
    adjustOpeningWeight(weights, 'time', -2);
  }
  if (/感官|细节|物件|碎|随意|矛盾|自然|不工整/.test(text)) {
    adjustOpeningWeight(weights, 'sensory', 6);
    adjustOpeningWeight(weights, 'object', 5);
    adjustOpeningWeight(weights, 'inner', 4);
    adjustOpeningWeight(weights, 'dialogue', 3);
    adjustOpeningWeight(weights, 'conflict', -3);
    adjustOpeningWeight(weights, 'time', -2);
  }

  return weights;
}

function applyChapterFunctionWeights(weights, text = '') {
  if (/任务|出发|行动|潜入|撤离|搜打撤|清查|巡逻/.test(text)) {
    adjustOpeningWeight(weights, 'action', 4);
    adjustOpeningWeight(weights, 'dialogue', 3);
    adjustOpeningWeight(weights, 'object', 2);
  }
  if (/异常|线索|发现|信号|痕迹|徽章|名单|通讯|系统提示/.test(text)) {
    adjustOpeningWeight(weights, 'object', 5);
    adjustOpeningWeight(weights, 'sensory', 4);
    adjustOpeningWeight(weights, 'result', 2);
  }
  if (/战斗|追击|交火|冲突|包围|爆炸|突袭/.test(text)) {
    adjustOpeningWeight(weights, 'action', 6);
    adjustOpeningWeight(weights, 'conflict', 4);
    adjustOpeningWeight(weights, 'sensory', 3);
  }
  if (/揭开|秘密|真相|反转|旧案|回忆|身份|谜/.test(text)) {
    adjustOpeningWeight(weights, 'result', 5);
    adjustOpeningWeight(weights, 'object', 4);
    adjustOpeningWeight(weights, 'inner', 3);
  }
  if (/谈判|对话|争执|关系|试探|隐瞒|交易/.test(text)) {
    adjustOpeningWeight(weights, 'dialogue', 6);
    adjustOpeningWeight(weights, 'inner', 3);
    adjustOpeningWeight(weights, 'action', 2);
  }
}

function applyNarrativeOpeningWeights(weights, narrativeMode = '') {
  switch (normalizeText(narrativeMode).trim().toLowerCase()) {
    case 'delayed':
      adjustOpeningWeight(weights, 'object', 4);
      adjustOpeningWeight(weights, 'sensory', 3);
      adjustOpeningWeight(weights, 'result', 3);
      adjustOpeningWeight(weights, 'conflict', -2);
      break;
    case 'flashback':
      adjustOpeningWeight(weights, 'inner', 4);
      adjustOpeningWeight(weights, 'sensory', 3);
      adjustOpeningWeight(weights, 'object', 3);
      adjustOpeningWeight(weights, 'time', -2);
      break;
    case 'reverse':
      adjustOpeningWeight(weights, 'result', 6);
      adjustOpeningWeight(weights, 'conflict', 2);
      adjustOpeningWeight(weights, 'scene', -2);
      adjustOpeningWeight(weights, 'time', -3);
      break;
    case 'parallel':
      adjustOpeningWeight(weights, 'result', 3);
      adjustOpeningWeight(weights, 'scene', 2);
      adjustOpeningWeight(weights, 'dialogue', 2);
      break;
    default:
      break;
  }
}

function applyRecentOpeningPenalty(weights, previousTypes = []) {
  const recent = previousTypes.filter(Boolean);
  const last = recent.at(-1);
  if (last) adjustOpeningWeight(weights, last, -10);
  recent.slice(-3).forEach((type) => adjustOpeningWeight(weights, type, -5));
  const counts = recent.slice(-10).reduce((acc, type) => {
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});
  Object.entries(counts).forEach(([type, count]) => {
    if (count > 2) adjustOpeningWeight(weights, type, -8);
  });
  if ((counts.time || 0) >= 1) weights.time = 0;
  if ((counts.conflict || 0) > 2) adjustOpeningWeight(weights, 'conflict', -10);
}

function selectOpeningTypeByWeights(weights = {}, order = 1) {
  const entries = Object.entries(weights)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!entries.length) return 'action';
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  let cursor = ((Number(order) || 1) * 17) % total;
  for (const [type, value] of entries) {
    if (cursor < value) return type;
    cursor -= value;
  }
  return entries[0][0];
}

function getOpeningTypeByContext({ project = {}, automation = {}, order = 1, narrativeMode = 'linear', cardText = '', previousTypes = [] } = {}) {
  const weights = buildOpeningTypeWeights(project, automation);
  applyChapterFunctionWeights(weights, cardText);
  applyNarrativeOpeningWeights(weights, narrativeMode);
  applyRecentOpeningPenalty(weights, previousTypes);
  return selectOpeningTypeByWeights(weights, order);
}

function getOpeningBanByType(type = '') {
  const base = '禁止默认用“精确时间 + 地点 + 主角动作”打卡式开头，禁止写章节编号或前文元叙事。';
  if (type === 'time') return `${base} 时间切入只能使用弱时间或明确时间压力，禁止精确到分钟的日常打卡。`;
  if (type === 'conflict') return `${base} 冲突切入必须是本章独有矛盾，不能空泛写“新的危机出现”。`;
  if (type === 'scene') return `${base} 场景切入不能写成镜头扫景，必须带有异常状态或人物选择。`;
  return base;
}

function buildUnevenHumanStyleGuide() {
  return [
    '人类化不均匀表达要求：',
    '1. 不要让每段长度、句式和信息密度过于均匀；可以少量使用极短段、停顿句、不完整句和答非所问，但它们是强调工具，不是默认文风。',
    '2. 人物不要每次都立刻解释清楚；允许沉默、回避、动作先于回答、信息晚半拍揭露，但普通路线、动作安排和关键信息仍要让读者读得顺。',
    '3. 对话要有个人口吻，避免所有角色都像同一个理性旁白；强势角色少解释，谨慎角色多试探，疲惫角色可省略句子，但不能长期省掉对象、方向和条件。',
    '4. 每章通常应安排一次读者能感到“角色正在做选择”的动作；纯承接、过渡、修整章可以用伤势处理、关系反应或信息确认替代，不要只让主角听别人解释。',
    '5. 信息优先通过冲突、误会、代价、物件、系统反馈抛出，少用连续设定说明。',
  ].join('\n');
}

function buildHumanWebNovelReadabilityGuide() {
  return [
    '真人网文读感总纲：',
    '通用基础提示词：以真人网文作者口吻创作，文笔自然接地气，句式长短错落，杜绝机械排比、模板化话术。叙事节奏松弛有度，人物对话贴合性格口吻，心理描写细腻真实，剧情衔接顺滑无断层，用词日常不堆砌华丽辞藻，行文读起来和手写原创小说毫无区别。',
    '剧情叙事款：摒弃公式化叙事逻辑，按人的思维脉络推进情节，细节铺垫自然，转折过渡柔和，语句口语化适配阅读语感，无生硬拼接感。',
    '人物对话款：对话符合角色身份、年龄与心境，语气神态搭配自然，闲聊、争执、独白都贴合真人说话习惯，不刻板规整。',
    '整体去 AI 感强化款：手写原创风格创作，避免重复句式、固定套路表达，描写虚实结合，保留细微情绪留白，文字有烟火气，通篇读感连贯自然，看不出机器生成痕迹。',
    '软件内置说明：本工具模拟真人写手创作思维撰写小说，文字风格贴合手写原创，语句流畅自然，人物刻画、情节表述均贴合日常阅读观感，无机械生成生硬感。',
  ].join('\n');
}

function buildContinuityMemoryText(project = {}, automation = {}) {
  const chapters = (project.chapters || []).filter((chapter, idx) => !isBlankStarterChapter(chapter, idx));
  const recent = chapters.slice(-10);
  const previous = chapters.at(-1);
  return [
    '连续性记忆：',
    previous ? `上一章遗留动作：${previous.title} 结尾后，必须先承接其未完成动作、情绪余波、当前场景和人物选择，不能直接跳成无关新场景。` : '上一章遗留动作：暂无已写章节，开篇要直接建立主角动作、目标和问题。',
    previous ? `上一章摘要：${previous.summary || ''}` : '',
    previous ? `上一章末段：${normalizeText(previous.content).slice(-700)}` : '',
    '伏笔账本要求：写作时必须查看最近章节中的未解释信息、异常物件、系统提示、人物隐瞒和代价；本章至少推进一项，不要随手新增无法追踪的伏笔。',
    buildPlatformStrategyGuide(project, automation),
    buildAutomationMemoryGuide(project, automation),
    '最近10章摘要账本：',
    ...recent.map((chapter) => `${chapter.title}：${chapter.summary || takeSummaryLine(chapter.content)}`),
    automation.continuityMemory ? '最近自动提取的连续性/伏笔/口吻记忆：' : '',
    automation.continuityMemory || '',
  ].filter(Boolean).join('\n');
}

function buildVoiceDriftGuard(project = {}) {
  const characters = (project.characters || []).slice(0, 12);
  return [
    '角色口吻漂移检查：',
    '1. 主角不能突然变成只会听任务和解释设定的工具人，必须保留既有性格、身体状态、欲望和警惕。',
    '2. 配角不能只负责发布任务；说话方式要符合身份、关系和隐瞒程度。',
    '3. 系统、导师、反派、队友的语气不能趋同成同一个AI旁白。',
    '4. 最近10章里角色已经表现出的疲惫、怀疑、伤势、关系张力，本章应优先延续；如果本章不处理，至少不要写出明显矛盾。',
    characters.length ? '角色口吻参考：' : '',
    ...characters.map((character) => `${character.name}/${character.role}：目标=${character.goal || '未填'}；秘密=${character.secret || '未填'}；性格=${character.traits || '未填'}；弧光=${character.arc || '未填'}`),
  ].filter(Boolean).join('\n');
}

const platformModeLabels = {
  fanqie: '番茄',
  qidian: '起点',
  ciweimao: '刺猬猫',
};

function buildPlatformStrategyGuide(project = {}, automation = {}) {
  const strategy = normalizePlatformStrategy(automation.platformStrategy, project);
  return [
    '平台策略（影响章节卡、正文、审校，不要在正文中明说）：',
    `主平台口味：${platformModeLabels[strategy.primary] || strategy.primary}`,
    `阅读节奏适配：${platformModeLabels[strategy.pace] || strategy.pace}`,
    `长篇结构约束：${platformModeLabels[strategy.structure] || strategy.structure}`,
    `发布目标：${platformModeLabels[strategy.publishTarget] || strategy.publishTarget}`,
    strategy.tags.length ? `题材标签：${strategy.tags.join(' / ')}` : '',
    strategy.primary === 'ciweimao' ? '刺猬猫口味：重视同人梗、角色还原、宅味反差、原作遗憾推进；主角不能压扁原作角色，梗必须服务剧情。' : '',
    strategy.primary === 'fanqie' || strategy.pace === 'fanqie' ? '番茄节奏：开头快、冲突早、目标明确、每章有结果或奖励感，章末钩子要具体。节奏快不等于碎句多；普通信息仍要自然承接，避免把“解释少”写成缺词、短句链或分镜标签。' : '',
    strategy.structure === 'qidian' ? '起点结构：体系自洽、能力有代价、反派梯度清楚、伏笔可长线但必须阶段推进，禁止临时外挂。' : '',
  ].filter(Boolean).join('\n');
}

function formatLedgerItems(title, items = [], formatter = (item) => String(item), empty = '暂无') {
  const list = normalizeLedger(items, 12);
  return [title, ...(list.length ? list.map(formatter) : [empty])].join('\n');
}

function buildAutomationMemoryGuide(project = {}, automation = {}) {
  return [
    '自动写作策略记忆（写作前使用，正文不要输出）：',
    formatLedgerItems('角色长期摘要：', automation.characterLongTermSummary, (item) => `- ${item.character || '角色'}｜最近第${item.lastChapter || '?'}章｜${item.summary || item.state || item.text || ''}`, '暂无长期角色摘要'),
    formatLedgerItems('伏笔台账：', automation.foreshadowingLedger, (item) => `- 第${item.chapter || '?'}章｜${item.status || '记录'}｜${item.item || item.text || ''}｜建议：${item.next || item.payoff || '后续推进'}`),
    formatLedgerItems('读者期待账本：', automation.readerExpectations, (item) => `- 第${item.chapter || '?'}章｜${item.status || '待回应'}｜${item.expectation || item.text || ''}`),
    formatLedgerItems('爽点/奖励账本：', automation.commercialBeatLedger, (item) => `- 第${item.chapter || '?'}章｜${item.type || '爽点'}｜${item.beat || item.text || ''}`),
    formatLedgerItems('角色关系/口吻记忆：', automation.characterStateMemory, (item) => `- 第${item.chapter || '?'}章｜${item.character || '角色'}｜${item.state || item.text || ''}`),
    formatLedgerItems('系统规则/金手指账本：', automation.powerSystemLedger, (item) => `- 第${item.chapter || '?'}章｜${item.rule || item.text || ''}｜限制：${item.limit || '保持既有规则'}`),
    formatLedgerItems('章节功能日历：', automation.chapterFunctionCalendar, (item) => `- 第${item.chapter || '?'}章｜${item.functionMode || item.function || '未标注'}｜爽点=${item.beat || '未标注'}｜期待=${item.expectation || '未标注'}`),
  ].join('\n');
}

function inferCommercialBeat(chapter = {}, card = {}) {
  const text = [chapter.summary, chapter.content, card.summary, card.hook, card.endingDelivery].map(normalizeText).join('\n');
  if (/奖励|到账|获得|解锁|任务完成|新任务|系统提示|资源|装备|物资/.test(text)) return '系统奖励/获得爽';
  if (/反转|真相|破绽|发现|确认|线索|编号|协议|入口/.test(text)) return '线索反转/信息爽';
  if (/击败|反杀|压制|救下|撤离|突破|逃出/.test(text)) return '行动兑现/压迫释放';
  if (/信任|沉默|回避|和解|争吵|保护|并肩/.test(text)) return '关系推进爽';
  return '阶段推进爽';
}

function buildAutomationLedgerUpdate({ chapters = [], cards = [], startChapter = 1, previousAutomation = {}, projectCharacters = [] } = {}) {
  const foreshadowingLedger = normalizeAutomationLedger('foreshadowingLedger', previousAutomation.foreshadowingLedger);
  const readerExpectations = normalizeAutomationLedger('readerExpectations', previousAutomation.readerExpectations);
  const commercialBeatLedger = normalizeAutomationLedger('commercialBeatLedger', previousAutomation.commercialBeatLedger);
  const characterStateMemory = normalizeAutomationLedger('characterStateMemory', previousAutomation.characterStateMemory);
  const powerSystemLedger = normalizeAutomationLedger('powerSystemLedger', previousAutomation.powerSystemLedger);
  const chapterFunctionCalendar = normalizeAutomationLedger('chapterFunctionCalendar', previousAutomation.chapterFunctionCalendar);

  chapters.filter(Boolean).forEach((chapter, idx) => {
    const chapterNumber = startChapter + idx;
    const card = cards[idx] || {};
    const content = normalizeText(chapter.content || '');
    const summary = normalizeText(chapter.summary || takeSummaryLine(content));
    const foreshadowing = normalizeText(card.foreshadowing || '');
    if (foreshadowing || /伏笔|异常|编号|协议|戒指|信标|系统|K-|07/.test(`${summary}\n${content}`)) {
      foreshadowingLedger.push({ chapter: chapterNumber, status: /回收/.test(foreshadowing) ? '回收' : /推进/.test(foreshadowing) ? '推进' : '新增/待追踪', item: foreshadowing || summary.slice(0, 80), next: card.hook || card.readerExpectation || '后续章节继续追踪' });
    }
    readerExpectations.push({ chapter: chapterNumber, status: '新增/待回应', expectation: card.hook || card.readerExpectation || summary.slice(0, 90) });
    commercialBeatLedger.push({ chapter: chapterNumber, type: inferCommercialBeat(chapter, card), beat: card.endingDelivery || card.hook || summary.slice(0, 90) });
    const mentionedCharacters = extractLedgerCharacters({ content, summary, card, projectCharacters }).slice(0, 4);
    mentionedCharacters.forEach((character) => characterStateMemory.push({ chapter: chapterNumber, character, state: summary.slice(0, 90) }));
    if (/系统|任务|奖励|信标器|协议|搜打撤|物资|资源|装备/.test(`${summary}\n${content}`)) {
      powerSystemLedger.push({ chapter: chapterNumber, rule: summary.slice(0, 100), limit: '不得新增未铺垫能力，系统反馈必须推动人物动作' });
    }
    chapterFunctionCalendar.push({ chapter: chapterNumber, functionMode: card.functionMode || '未标注', beat: inferCommercialBeat(chapter, card), expectation: card.readerExpectation || card.hook || '' });
  });

  return {
    foreshadowingLedger: normalizeAutomationLedger('foreshadowingLedger', foreshadowingLedger),
    readerExpectations: normalizeAutomationLedger('readerExpectations', readerExpectations),
    commercialBeatLedger: normalizeAutomationLedger('commercialBeatLedger', commercialBeatLedger),
    characterStateMemory: normalizeAutomationLedger('characterStateMemory', characterStateMemory),
    characterLongTermSummary: buildCharacterLongTermSummary(characterStateMemory, previousAutomation.characterLongTermSummary),
    powerSystemLedger: normalizeAutomationLedger('powerSystemLedger', powerSystemLedger),
    chapterFunctionCalendar: normalizeAutomationLedger('chapterFunctionCalendar', chapterFunctionCalendar),
  };
}

function buildCharacterLongTermSummary(characterStateMemory = [], previousSummary = []) {
  const grouped = new Map();
  normalizeAutomationLedger('characterStateMemory', characterStateMemory).forEach((item) => {
    const character = normalizeText(item.character || '角色');
    if (!character) return;
    const list = grouped.get(character) || [];
    list.push(item);
    grouped.set(character, list);
  });
  const previousByName = new Map(normalizeLedger(previousSummary, 80).map((item) => [normalizeText(item.character), item]));
  const updatedNames = new Set(grouped.keys());
  const updated = [...grouped.entries()].map(([character, items]) => {
    const latest = items.at(-1) || {};
    const recent = items.slice(-6).map((item) => normalizeText(item.state || item.text || '').replace(/[。！？!?]$/g, '')).filter(Boolean);
    const compact = [...new Set(recent)].slice(-4).join('；');
    return {
      character,
      lastChapter: latest.chapter || previousByName.get(character)?.lastChapter || 0,
      summary: compact || previousByName.get(character)?.summary || '',
    };
  }).filter((item) => item.summary);
  const preserved = [...previousByName.values()].filter((item) => item.character && !updatedNames.has(normalizeText(item.character)));
  return [...preserved, ...updated].slice(-80);
}

function extractLedgerCharacters({ content = '', summary = '', card = {}, projectCharacters = [] } = {}) {
  const source = normalizeText([content, summary].join('\n'));
  const cardCast = normalizeText(card.cast || '');
  const candidates = new Set();
  (projectCharacters || []).forEach((character) => {
    const name = normalizeText(character?.name || character).replace(/[（(].*?[）)]/g, '').trim();
    if (name) candidates.add(name);
  });
  cardCast.split(/[\n；;]/).forEach((line) => {
    const head = normalizeText(line).split(/[：:]/)[0] || '';
    head.split(/[、,，/]/).forEach((name) => {
      const cleaned = name.replace(/[（(].*?[）)]/g, '').trim();
      if (cleaned && cleaned.length <= 8 && !/主角|系统|手下|跟班|帮手|村汉|少年|少女|老妇人|小孩|仅被提及|正式出场/.test(cleaned)) candidates.add(cleaned);
    });
  });
  let matched = [...candidates].filter((name) => source.includes(name) || cardCast.includes(name));
  if (!matched.length) {
    const addFallbackName = (rawName = '') => {
      const cleaned = normalizeText(rawName)
        .replace(/^(?:那个|这个|门外|屋里|桌下|村里|隔壁|少年|少女|老妇人|小孩)/, '')
        .replace(/(?:推|看|躲在|走|问|说|喊|骂|从|把|被|要|想|伸手|咬牙|沉默|进来|出去|过来|过去)$/g, '')
        .trim();
      if (cleaned.length < 2 || cleaned.length > 4) return;
      if (/^(系统|任务|奖励|正文|摘要|章节|本章|蓝图|灵气|魔法|少女|修仙|世界|村里|门外|屋里|桌下|门进|少年|老妇|小孩)$/.test(cleaned)) return;
      candidates.add(cleaned);
    };
    const actionNamePattern = /([\u4e00-\u9fa5]{2,5})(?:说|问|喊|骂|点头|摇头|推|看|躲|走|伸手|咬牙|沉默|从|把|被|要|想)/g;
    let actionMatch = null;
    while ((actionMatch = actionNamePattern.exec(source))) addFallbackName(actionMatch[1]);
    source.match(/[\u4e00-\u9fa5]{2,4}/g)?.forEach((name) => {
      if (source.split(name).length > 2 || /[一二三四五六七八九十]\b/.test(name)) addFallbackName(name);
    });
    matched = [...candidates].filter((name) => source.includes(name) || cardCast.includes(name));
  }
  return matched;
}

function buildReaderExpectationGuide() {
  return [
    '读者预期管理：',
    '1. 每张章节卡必须写“读者预期”，即读者打开本章最想得到回应的问题。',
    '2. 每章正文前500字优先出现明确问题、冲突、选择或异常；低压修整章可以用未解决后果、人物反应或具体目标替代，不能只寒暄和解释背景。',
    '3. 本章至少回应一个读者预期，同时制造一个新的下一章期待。',
    '4. 爽点可以是任务确认、奖励到账、线索反转、主角做出选择、敌人露出破绽、代价浮现，不必每章大战。',
  ].join('\n');
}

function hasCompleteMasterPlan(text = '') {
  const normalized = normalizeText(text);
  if (/【\s*蓝图完\s*】/.test(normalized)) return true;
  if (/先展示前\s*\d+\s*卷|如需.*(?:继续|补充|展开)|后续.*(?:再|另行).*展开/.test(normalized.slice(-1000))) return false;
  if (/[，、：；（(]$/.test(normalized.trim())) return false;
  return normalized.length >= 6000 && /主要人物卡|人物：/.test(normalized) && /长线伏笔|伏笔/.test(normalized) && /商业化连载建议|连载建议/.test(normalized);
}

async function completeMasterPlanIfNeeded({ apiKey, model, baseUrl, project, automation, prompt, currentText, signal }) {
  let text = normalizeText(currentText);
  const continuations = [];
  for (let attempt = 1; attempt <= 2 && !hasCompleteMasterPlan(text); attempt += 1) {
    const continuationPrompt = [
      '下面是一份被截断或未完整收尾的长篇小说蓝图。请从断点处继续补全，不要重写已有内容。',
      '必须补齐所有未完成部分，尤其是剩余分卷规划、长线伏笔、商业化连载建议和主要人物卡。',
      '如果前文说“先展示前8卷”或类似说法，本次必须继续写剩余卷，不要再说需要用户另行要求。',
      '全部补完后，最后单独输出一行：【蓝图完】。',
      '原始生成要求：',
      prompt.slice(0, 8000),
      '已生成蓝图全文：',
      text,
      '请只输出续写部分，不要复述已生成内容。',
    ].join('\n\n');
    const next = await callDeepSeek({ apiKey, model, baseUrl, temperature: 0.72, userPrompt: continuationPrompt, maxTokens: 8192, signal, timeoutMs: 300000 });
    const cleanedNext = normalizeText(next).trim();
    if (!cleanedNext) break;
    continuations.push(cleanedNext);
    text = `${text}\n\n${cleanedNext}`;
  }
  return { text, continuations, complete: hasCompleteMasterPlan(text) };
}

function buildChapterCardControlGuide() {
  return [
    '章节卡职责边界：',
    '1. 章节卡只负责剧情规划：这一章发生什么、谁出场、得到什么结果、留下什么钩子。',
    '2. 不要输出开头方式、叙事手法、对话密度、叙述质感、人味锚点、正文禁区、段落节奏、平台写法等写作控制字段。',
    '3. 写法由真人写作模块在正文生成前临时决定，章节卡不要像控制参数表。',
    '4. 每张卡必须具体，但只具体到剧情事件和交付结果，不要规定正文该怎么写。',
    '5. 章节卡只写剧情轨道，不规定正文口吻。可提示本章适合保留的角色压力、关系变化或系统规则，但不要要求每章固定出现吐槽、系统短讯、同人梗或史诗句。',
  ].join('\n');
}

function mergeControlText(...parts) {
  return parts.map(cleanCardFieldText).map((part) => part.trim()).filter(Boolean).join('；');
}

function getChapterCardCount(automation = {}) {
  return Array.isArray(automation.chapterCards) ? automation.chapterCards.length : 0;
}

function assertEnoughChapterCards({ automation = {}, startChapter = 1, batchCount = 1 } = {}) {
  const cardCount = getChapterCardCount(automation);
  const required = Math.max(0, (Number(startChapter) || 1) + (Number(batchCount) || 1) - 1);
  if (cardCount < required) {
    throw new Error(`章节卡不足：当前只有 ${cardCount} 张，需要至少排到第 ${required} 章。请先自动排章节卡。`);
  }
}

function parseGeneratedChapterCardSection({ section, order, plannedOpening = {}, project = {} } = {}) {
  const storyFieldLabels = ['本章目标', '目标', '核心事件', '出场人物', '关键物件/线索', '关键物件', '关键线索', '本章结果', '结果'];
  const parsedVolumeName = extractLabeledField(section, ['卷', '卷名', '所属卷', '所属分卷'], ['蓝图阶段', '阶段', '剧情阶段', ...storyFieldLabels, '开头方式', '开场方式', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const paceStage = extractLabeledField(section, ['蓝图阶段', '阶段', '剧情阶段'], [...storyFieldLabels, '开头方式', '开场方式', '首段方式', '开头类型', '进度锁', '本章只允许', '允许内容', '本章禁止', '禁止内容', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const chapterGoal = extractLabeledField(section, ['本章目标', '目标'], ['核心事件', '出场人物', '关键物件/线索', '关键物件', '关键线索', '本章结果', '结果', '进度锁', '本章只允许', '本章禁止', '读者预期', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const coreEvent = extractLabeledField(section, ['核心事件'], ['出场人物', '关键物件/线索', '关键物件', '关键线索', '本章结果', '结果', '进度锁', '本章只允许', '本章禁止', '读者预期', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const cast = extractLabeledField(section, ['出场人物'], ['关键物件/线索', '关键物件', '关键线索', '本章结果', '结果', '进度锁', '本章只允许', '本章禁止', '读者预期', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const keyClue = extractLabeledField(section, ['关键物件/线索', '关键物件', '关键线索'], ['本章结果', '结果', '进度锁', '本章只允许', '本章禁止', '读者预期', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const chapterResult = extractLabeledField(section, ['本章结果', '结果'], ['进度锁', '本章只允许', '本章禁止', '读者预期', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const parsedOpeningType = extractLabeledField(section, ['开头方式', '开场方式', '首段方式', '开头类型'], ['开头锚点', '禁止开头', '叙事手法', '叙事目的', '进度锁', '本章只允许', '本章禁止', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const openingAnchor = extractLabeledField(section, ['开头锚点', '开头抓手', '首句锚点', '首段锚点'], ['禁止开头', '叙事手法', '叙事目的', '进度锁', '本章只允许', '本章禁止', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const openingBan = extractLabeledField(section, ['禁止开头', '开头禁用', '首句禁用'], ['叙事手法', '叙事目的', '进度锁', '本章只允许', '本章禁止', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const functionMode = extractLabeledField(section, ['章节功能', '功能模式', '本章功能'], ['对话密度', '叙述质感', '人味锚点', '正文禁区', '章末交付物', '进度锁', '本章只允许', '允许内容', '本章禁止', '禁止内容', '读者预期', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const dialogueDensity = extractLabeledField(section, ['对话密度', '对话预算'], ['叙述质感', '人味锚点', '正文禁区', '章末交付物', '进度锁', '本章只允许', '本章禁止', '读者预期', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const texturePlan = extractLabeledField(section, ['叙述质感', '质感预算', '叙述预算'], ['人味锚点', '正文禁区', '章末交付物', '进度锁', '本章只允许', '本章禁止', '读者预期', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const humanTextureBeats = extractLabeledField(section, ['人味锚点', '人味细节', '身体生活锚点'], ['正文禁区', '章末交付物', '进度锁', '本章只允许', '本章禁止', '读者预期', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const draftingBan = extractLabeledField(section, ['正文禁区', '写法禁区', '正文禁止写法'], ['章末交付物', '进度锁', '本章只允许', '本章禁止', '读者预期', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const endingDelivery = extractLabeledField(section, ['章末交付物', '结尾交付物', '章末后果'], ['进度锁', '本章只允许', '本章禁止', '读者预期', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const progressLock = extractLabeledField(section, ['进度锁', '进度限制'], ['本章只允许', '允许内容', '本章禁止', '禁止内容', '读者预期', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const allowedBeats = extractLabeledField(section, ['本章只允许', '允许内容', '允许推进'], ['本章禁止', '禁止内容', '读者预期', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const forbiddenBeats = extractLabeledField(section, ['本章禁止', '禁止内容', '禁止推进'], ['读者预期', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const readerExpectation = extractLabeledField(section, ['读者预期', '读者期待', '本章读者预期'], ['上一章遗留动作', '遗留动作', '伏笔规划', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const openAction = extractLabeledField(section, ['上一章遗留动作', '遗留动作', '承接动作'], ['伏笔规划', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']) || (order === 1 ? '从开局直接进入本章局部冲突' : `承接第${order - 1}章的结果，推进第${order}章当前局部冲突`);
  const foreshadowing = extractLabeledField(section, ['伏笔规划', '伏笔账本', '伏笔'], ['本章爽点', '爽点', '爽点类型', '兑现方式', '平台适配', '平台策略', '平台口味', '系统规则', '金手指规则', '能力限制', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const commercialBeat = extractLabeledField(section, ['本章爽点', '爽点', '爽点类型', '兑现方式'], ['系统规则', '平台适配', '压力等级', '主角主动选择', '主角拿回的主动权', '本章小收获', '章末钩子类型', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const platformNotes = extractLabeledField(section, ['平台适配', '平台策略', '平台口味'], ['系统规则', '压力等级', '主角主动选择', '主角拿回的主动权', '本章小收获', '章末钩子类型', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const systemRule = extractLabeledField(section, ['系统规则', '金手指规则', '能力限制'], ['压力等级', '主角主动选择', '主角拿回的主动权', '本章小收获', '章末钩子类型', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const pressureLevel = extractLabeledField(section, ['压力等级', '章节压力', '压力预算'], ['主角主动选择', '主角拿回的主动权', '本章小收获', '章末钩子类型', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const protagonistChoice = extractLabeledField(section, ['主角主动选择', '主动选择', '本章主动选择'], ['主角拿回的主动权', '本章小收获', '章末钩子类型', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const agencyRecovery = extractLabeledField(section, ['主角拿回的主动权', '主动权回收', '拿回主动权'], ['本章小收获', '章末钩子类型', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const chapterReward = extractLabeledField(section, ['本章小收获', '本章获得感', '小收获', '获得感'], ['章末钩子类型', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const hookType = extractLabeledField(section, ['章末钩子类型', '钩子类型'], ['摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const openingType = plannedOpening.openingType || parsedOpeningType || 'scene';
  const narrativeMode = plannedOpening.narrativeMode || normalizeNarrativeMode(extractLabeledField(section, ['叙事手法', '叙事模式', '叙事方式'], ['叙事目的', '进度锁', '本章只允许', '本章禁止', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']), order);
  const parsedNarrativePurpose = extractLabeledField(section, ['叙事目的', '手法目的', '使用目的'], ['章节功能', '对话密度', '叙述质感', '人味锚点', '正文禁区', '章末交付物', '进度锁', '本章只允许', '本章禁止', '摘要', '本章摘要', '章节摘要', '关键钩子', '钩子']);
  const narrativePurpose = cleanCardFieldText(plannedOpening.narrativePurpose || parsedNarrativePurpose || getNarrativePurposeByMode(narrativeMode));
  const summary = extractLabeledField(section, ['摘要', '本章摘要', '章节摘要'], ['关键钩子', '钩子', '正文', '内容']);
  const fallbackHook = firstUsefulSentence(endingDelivery, readerExpectation, foreshadowing, commercialBeat, allowedBeats, summary) || `第${order}章末留下一个具体未解决动作、消息、物件异常或路线选择`;
  const hook = extractLabeledField(section, ['关键钩子', '章末钩子', '钩子', '悬念'], ['###']) || summary.split(/[。！？]/).filter(Boolean).at(-1) || fallbackHook;
  return {
    id: crypto.randomUUID(),
    order,
    title: `第${order}章 ${stripChapterNumber(section.match(/###\s*(.+)/)?.[1]?.trim() || '') || '未命名章节'}`,
    volumeName: normalizeVolumeName(parsedVolumeName, project.volumes || []),
    paceStage: paceStage || `${normalizeVolumeName(parsedVolumeName, project.volumes || [])}前段`,
    openingType,
    openingAnchor: cleanCardFieldText(openingAnchor) || summary || `抓住第${order}章最独有的冲突、异常、物件或结果`,
    openingBan: cleanCardFieldText(plannedOpening.openingBan || openingBan || getOpeningBanByType(openingType)),
    functionMode: cleanCardFieldText(functionMode),
    dialogueDensity: cleanCardFieldText(dialogueDensity),
    texturePlan: cleanCardFieldText(texturePlan),
    humanTextureBeats: cleanCardFieldText(humanTextureBeats),
    draftingBan: cleanCardFieldText(draftingBan),
    endingDelivery: cleanCardFieldText(endingDelivery),
    progressLock: progressLock || `第${order}章只允许推进当前章节卡事件，不得跨入后续大冲突`,
    chapterGoal: cleanCardFieldText(chapterGoal),
    coreEvent: cleanCardFieldText(coreEvent),
    cast: cleanCardFieldText(cast),
    keyClue: cleanCardFieldText(keyClue),
    chapterResult: cleanCardFieldText(chapterResult),
    allowedBeats: cleanCardFieldText(allowedBeats || firstUsefulSentence(chapterGoal, coreEvent, chapterResult, summary) || `推进第${order}章局部目标`),
    forbiddenBeats: cleanCardFieldText(forbiddenBeats || '禁止提前写后续卷高潮、终局反派、最终秘密、后期大战或跨越式升级'),
    readerExpectation: cleanCardFieldText(readerExpectation) || '读者想看到上一章问题如何被回应，以及本章会带出什么新选择',
    openAction: cleanCardFieldText(openAction),
    foreshadowing: cleanCardFieldText(foreshadowing) || '推进或埋下一条可追踪伏笔，暂不提前回收后期核心秘密',
    commercialBeat: cleanCardFieldText(commercialBeat) || '本章至少交付一个信息爽、关系爽、系统奖励、行动兑现或期待推进',
    platformNotes: cleanCardFieldText(platformNotes),
    systemRule: cleanCardFieldText(systemRule),
    pressureLevel: cleanCardFieldText(pressureLevel),
    protagonistChoice: cleanCardFieldText(protagonistChoice),
    agencyRecovery: cleanCardFieldText(agencyRecovery),
    chapterReward: cleanCardFieldText(chapterReward),
    hookType: cleanCardFieldText(hookType),
    narrativeMode,
    narrativePurpose,
    summary: cleanCardFieldText(summary) || `承接蓝图第${order}章规划，推进本阶段主线并保留章末钩子。`,
    hook: cleanCardFieldText(hook) || fallbackHook,
    status: 'planned',
  };
}

function buildAuthorPersonaPrompt({ project, inspiration, minimumWords, targetChapters }) {
  return [
    '请基于灵感为这本书生成一份“作者人设卡”，让后续所有章节保持统一的叙述人格。',
    '这不是角色卡，也不是读者简介，而是这本书最适合的写法说明。',
    buildHumanWritingEnginePrompt({ project, automation: project.automation || {}, scope: '作者人设规划' }),
    '输出格式必须严格如下：',
    '### 作者人设',
    '叙述口吻：...',
    '节奏习惯：...',
    '情绪表达：...',
    '对话风格：...',
    '细节偏好：...',
    '禁止风格：...',
    '系统提示风格：...',
    '灵感适配说明：...',
    `最低总字数要求：${minimumWords}`,
    `参考章节规模：${targetChapters}`,
    `作品名：${project.title}`,
    `题材：${project.genre}`,
    `目标读者：${project.targetAudience}`,
    `文风要求：${project.styleGuide}`,
    `灵感：${inspiration}`,
    buildToneProtocolGuide({ ...project, premise: [project.premise, inspiration].filter(Boolean).join('\n') }, project.automation || {}),
    '要求：',
    '1. 要从灵感反推最适合这本书的叙述人格，不要套模板。',
    '2. 作者人设应追求自然口语和人物反应的真实，不追求刻意碎句。可以有停顿、回避和留白，但普通观察、动作安排、信息确认要顺着人物处境自然写清。禁止模板化、口号化、过度工整，不禁止正常顺滑。',
    '3. 作者人设要能帮助这本书降低 AI 味，提升自然感、人物现场感和阅读流动性；不要把“碎”“断”“不顺滑”当成正向目标。',
    '4. 系统提示风格要说明是更偏完整面板、短讯、还是混合，并写出适合这本书的节奏。',
    '5. 直接输出，不要解释。',
  ].join('\n');
}

function buildAuthorPersonaGuide(persona = '') {
  const text = normalizeText(persona).trim();
  return [
    '作者人设卡：',
    text || '暂无作者人设，按灵感和章节卡自由生成；追求自然口语、人物现场反应和必要留白，但普通观察、动作安排、信息确认要顺着处境写清。避免模板化、口号化和过度工整，不禁止正常顺滑。',
  ].join('\n');
}

const toneModeProfiles = {
  daily: {
    label: '轻松日常',
    engine: '小目标 → 小麻烦 → 主角笨拙主动 → 小收获 → 关系升温',
    pressure: '多数章节保持低到中压力；危险可出现，但通常不要连续升级成生死求生。',
    agency: '主角的成长优先体现为生活能力、关系信任、小能力熟练度和主动选择变多。',
    rewards: '食物、住处、技能熟练度、被照顾、被允许靠近、可爱误会解除、关系软化。',
    hooks: '轻期待、关系变化、小收益、可爱误会、下一个生活目标。',
    avoid: '连续追杀、长期饥饿受冻、重伤濒危、每章都用更大危险压结尾。',
    cardFields: '本章日常小目标；本章小麻烦；主角主动尝试；本章小收获；关系升温；章末轻钩子；避免高压写法。',
  },
  comedy: {
    label: '轻喜反差',
    engine: '正常目标 → 世界观错位 → 主角用奇怪但有效的方式处理 → 旁人误解 → 反差收益',
    pressure: '压力可以存在，但通常要较快转成误会、笑点、收益或反差小爽。',
    agency: '主角把弱势、错位、羞耻技能、系统提示或话术变成筹码。',
    rewards: '旁人误判、奇怪能力有效、低配技能救场、系统互怼、资源或身份保护。',
    hooks: '新技能羞耻说明、道具失控、旁人误会、系统欠揍任务、下一次糊弄机会。',
    avoid: '连续审问、追捕、伤势恶化、主角长期只能被拖走或被搜查。',
    cardFields: '本章正常目标；本章错位点；主角奇怪但有效的处理；旁人误解/反应；本章反差收益；章末轻喜钩子。',
  },
  adventure: {
    label: '冒险成长',
    engine: '探索目标 → 阻碍 → 判断/能力尝试 → 阶段成果 → 新地图或新线索',
    pressure: '中等压力为主；危险服务探索和成长，不长期压成单纯逃命。',
    agency: '主角通过判断、技能练习、路线选择、同伴协作逐步扩大活动范围。',
    rewards: '新路线、可用资源、能力进步、同伴默契、线索确认、阶段性安全点。',
    hooks: '新区域、新物件、新伙伴、新规则、新选择。',
    avoid: '只逃跑不探索、只挨打不成长、连续新增无法收束的谜团。',
    cardFields: '探索目标；本章阻碍；能力/判断尝试；阶段成果；新线索或新区域；下一步选择。',
  },
  power: {
    label: '爽文升级',
    engine: '被低估 → 主角准备 → 能力/判断兑现 → 旁人改观 → 奖励或地位提升',
    pressure: '压力用于衬托兑现，不要长期只写主角吃亏。',
    agency: '主角最好每章拿回一点主动权，几章内有一次公开高光或结果替他说话。',
    rewards: '能力兑现、敌人吃亏、队友改观、资源奖励、权限提升、名声变化。',
    hooks: '扩大优势、下一次兑现、奖励后果、对手重新评估。',
    avoid: '主角长期被动、胜利只写成勉强活下来、旁人长期无反应。',
    cardFields: '主角被低估点；主角提前准备；能力/判断兑现；旁人态度变化；本章获得感；下一章可扩大优势。',
  },
  survival: {
    label: '高压求生',
    engine: '危机 → 取舍 → 代价 → 主角拿回一点主动权 → 短暂喘息或反打窗口',
    pressure: '可以高压，但连续高压后要给喘息、收益或主动权回收。',
    agency: '主角可以受伤和失败，但要用判断、取舍或代价换回局面。',
    rewards: '撤离窗口、救人结果、情报、物资、敌人误判、下一章反打条件。',
    hooks: '具体选择、路线变化、短暂喘息后的新问题、反打窗口。',
    avoid: '只挨打、只逃命、只补救、章末只追加更大危险。',
    cardFields: '本章危机；主角取舍；本章代价；主角拿回的主动权；短暂喘息点；撤离/反打窗口。',
  },
  ensemble: {
    label: '群像史诗',
    engine: '角色小线 → 阵营压力 → 个人选择 → 多线交汇 → 阶段性代价或胜利',
    pressure: '允许宏观压力，但每章仍要落在具体人物选择上，不把所有人写成设定传声筒。',
    agency: '主角和关键配角都要有阶段性主动选择；群像不是削弱主角，而是让主角选择影响更多人。',
    rewards: '阵营信任、角色改观、局部胜利、关键人物站队、伏笔交汇、阶段性秩序变化。',
    hooks: '角色立场变化、阵营动作、伏笔交汇、下一条人物线接棒。',
    avoid: '宏大旁白堆设定、主角工具人化、连续会议说明、配角只发布任务。',
    cardFields: '本章人物焦点；阵营压力；主角/关键角色选择；多线交汇点；阶段回报；下一条人物线钩子。',
  },
};

function normalizeToneSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const validModes = new Set(Object.keys(toneModeProfiles));
  const mixSource = source.mix && typeof source.mix === 'object' ? source.mix : {};
  const defaultMix = { daily: 30, adventure: 40, power: 20, comedy: 10, survival: 0 };
  const clamp = (number, fallback = 0) => Math.max(0, Math.min(100, Number.isFinite(Number(number)) ? Number(number) : fallback));
  return {
    primary: validModes.has(source.primary) ? source.primary : '',
    mix: {
      daily: clamp(mixSource.daily, defaultMix.daily),
      adventure: clamp(mixSource.adventure, defaultMix.adventure),
      power: clamp(mixSource.power, defaultMix.power),
      comedy: clamp(mixSource.comedy, defaultMix.comedy),
      survival: clamp(mixSource.survival, defaultMix.survival),
    },
  };
}

function buildToneMixText(settings = {}) {
  const mix = normalizeToneSettings(settings).mix;
  const labels = { daily: '日常', adventure: '冒险', power: '爽点', comedy: '反差', survival: '高压' };
  return Object.entries(mix)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `${labels[key] || key}${value}%`)
    .join(' / ');
}

function inferToneMode(project = {}, automation = {}) {
  const explicitSettings = normalizeToneSettings(automation.toneSettings);
  if (explicitSettings.primary && toneModeProfiles[explicitSettings.primary]) return explicitSettings.primary;
  const text = [project.title, project.genre, project.premise, project.targetAudience, project.styleGuide, automation.inspiration, automation.authorPersona, automation.masterPlan].map(normalizeText).join('\n');
  if (/轻松|日常|治愈|悠闲|温馨|陪伴|可爱|幼崽|种田|生活/.test(text)) return 'daily';
  if (/轻喜|沙雕|反差|吐槽|搞笑|欢脱|魔法少女|羞耻|互怼|误会流/.test(text)) return 'comedy';
  if (/爽文|升级|打脸|装逼|逆袭|无敌|奖励|变强|高光/.test(text)) return 'power';
  if (/末世|求生|逃杀|追杀|战场|战争|废墟|撤离|搜打撤|高压/.test(text)) return 'survival';
  if (/冒险|旅行|探索|秘境|宝可梦|异世界|修仙|历练|成长/.test(text)) return 'adventure';
  return 'adventure';
}

function resolveToneProfile(project = {}, automation = {}) {
  const explicit = normalizeText(automation.toneProtocol).trim();
  const mode = inferToneMode(project, automation);
  return { mode, profile: toneModeProfiles[mode] || toneModeProfiles.adventure, explicit };
}

function buildToneProtocolGuide(project = {}, automation = {}) {
  const { profile, explicit } = resolveToneProfile(project, automation);
  const mixText = buildToneMixText(automation.toneSettings);
  return [
    '【作品基调协议】',
    explicit ? `用户/项目基调补充：${explicit}` : '',
    `基调模式：${profile.label}`,
    mixText ? `混合比例：${mixText}` : '',
    `剧情发动机：${profile.engine}`,
    `压力预算：${profile.pressure}`,
    `主角主动权：${profile.agency}`,
    `获得感来源：${profile.rewards}`,
    `章末钩子偏好：${profile.hooks}`,
    `避免跑偏：${profile.avoid}`,
    '执行方式：这是软方向，不是机械模板。不要在正文里解释这些规则；让人物选择、现场反馈、旁人反应和小回报自然体现。',
  ].filter(Boolean).join('\n');
}

function buildToneChapterCardGuide(project = {}, automation = {}) {
  const { profile } = resolveToneProfile(project, automation);
  return [
    '章节卡基调自适应：',
    `本书按“${profile.label}”优先组织章节，不要把所有风格都写成危险升级。`,
    `本基调推荐补充字段：${profile.cardFields}`,
    '每张卡必须标出压力等级1-5、主角主动选择、主角拿回的主动权、本章小收获/获得感、章末钩子类型。',
    '这些字段写在既有字段里即可：本章目标/本章结果/本章爽点/读者预期/关键钩子/本章禁止都要体现它们；不要另写正文写法。',
    '压力等级含义：1松弛日常，2小麻烦，3明确冲突，4高压危机，5生死节点。轻松日常和轻喜反差通常不要连续两章4级以上。',
    '章末钩子优先按基调选择：可以是轻期待、关系变化、小收益、反差误会、能力兑现、路线选择或反打窗口；不要默认都写“更大危险来了”。',
  ].join('\n');
}

const toneDriftRetention = 4;

function trimToneDriftReports(automation = {}) {
  const reports = Array.isArray(automation.toneDriftReports) ? automation.toneDriftReports : [];
  return reports.slice(-toneDriftRetention).map((report) => ({
    chapterCount: Number(report.chapterCount) || 0,
    createdAt: report.createdAt || now(),
    summary: normalizeText(report.summary),
    issues: Array.isArray(report.issues) ? report.issues.map(normalizeText).filter(Boolean).slice(0, 5) : [],
    suggestions: Array.isArray(report.suggestions) ? report.suggestions.map(normalizeText).filter(Boolean).slice(0, 5) : [],
    metrics: report.metrics || {},
  }));
}

function parsePressureLevel(card = {}, chapter = {}) {
  const text = [card.pressureLevel, card.summary, card.hook, card.coreEvent, chapter.summary, chapter.content].map(normalizeText).join('\n');
  const explicit = normalizeText(card.pressureLevel).match(/[1-5]/)?.[0];
  if (explicit) return Number(explicit);
  if (/濒死|死亡|围杀|追杀|爆炸|重伤|审问|搜查|敌人逼近|生死|断气|血|山匪|战场|撤离|逃命/.test(text)) return 4;
  if (/冲突|威胁|危险|受伤|低吼|门外|靠近|包围|名单|警报|倒计时/.test(text)) return 3;
  if (/小麻烦|误会|练习|找|吃|住|休息|交换|整理|学习|尝试/.test(text)) return 2;
  return 2;
}

function isDangerHook(card = {}) {
  const text = [card.hookType, card.hook, card.readerExpectation, card.summary].map(normalizeText).join('\n');
  if (/轻期待|关系|小收益|可爱|误会|反差|生活目标|技能|收获|奖励|改观/.test(text)) return false;
  return /危险|追杀|敌人|门外|低吼|靠近|包围|搜查|审问|重伤|死亡|濒死|爆炸|警报|名单|陷阱|更大危机/.test(text);
}

function isPassiveChapterSignal(card = {}, chapter = {}) {
  const activeText = [card.protagonistChoice, card.agencyRecovery, card.chapterReward, card.commercialBeat].map(normalizeText).join('\n');
  if (/主动|尝试|判断|布置|发现|救下|换来|拿到|获得|学会|改观|信任|反打|误导|解决|完成|收获/.test(activeText)) return false;
  const text = [card.summary, chapter.summary, chapter.content].map(normalizeText).join('\n');
  return /被迫|被拖|被抬|被叼|被救|只能|不敢|没敢|等着|靠.*保护|勉强活|逃命|挨打|受伤|搜查|审问/.test(text)
    && !/主动|判断|布置|发现|救下|拿到|学会|换来|误导|反打|改观/.test(text);
}

function buildToneDriftSuggestions({ profile, highPressureCount, passiveCount, dangerHookCount } = {}) {
  const suggestions = [];
  if (highPressureCount >= 3) {
    suggestions.push(/轻松日常|轻喜反差/.test(profile.label)
      ? '后续5章降低压力：至少安排2章生活小目标/错位小麻烦，章末用小收获、误会或关系变化，不再连续追加敌人逼近。'
      : '后续5章保留压力但加入喘息：每2章至少给一次资源、情报、撤离窗口或反打条件。');
  }
  if (passiveCount >= 3) {
    suggestions.push('后续章节卡补强主角主动选择：让主角用判断、准备、话术、能力练习或代价改变局面，不只被保护、被拖走或补救。');
  }
  if (dangerHookCount >= 3) {
    suggestions.push(`章末钩子换型：优先使用${profile.hooks}，少用“门外又来人/更大危险靠近/伤势恶化”连续压结尾。`);
  }
  if (!suggestions.length) suggestions.push('基调暂未明显偏移，后续继续保持当前压力、主动权和章末钩子比例。');
  suggestions.push('建议只应用到后续3-5张章节卡，下一次5章诊断会自动覆盖旧建议。');
  return suggestions.slice(0, 4);
}

function buildToneDriftReport({ project = {}, automation = {}, chapterCount = 0 } = {}) {
  const written = (project.chapters || []).filter((chapter, idx) => !isBlankStarterChapter(chapter, idx));
  if (!chapterCount || chapterCount % 5 !== 0 || written.length < 5) return null;
  const recentChapters = written.slice(-5);
  const recentCards = (automation.chapterCards || []).slice(Math.max(0, chapterCount - 5), chapterCount);
  const { profile } = resolveToneProfile(project, automation);
  const rows = recentChapters.map((chapter, idx) => {
    const card = recentCards[idx] || {};
    return {
      pressure: parsePressureLevel(card, chapter),
      passive: isPassiveChapterSignal(card, chapter),
      dangerHook: isDangerHook(card),
    };
  });
  const highPressureCount = rows.filter((row) => row.pressure >= 4).length;
  const passiveCount = rows.filter((row) => row.passive).length;
  const dangerHookCount = rows.filter((row) => row.dangerHook).length;
  const issues = [
    highPressureCount >= 3 ? `最近5章高压章节偏多：${highPressureCount}/5。` : '',
    passiveCount >= 3 ? `最近5章主角主动权偏低：${passiveCount}/5。` : '',
    dangerHookCount >= 3 ? `最近5章危险钩子偏多：${dangerHookCount}/5。` : '',
  ].filter(Boolean);
  const suggestions = buildToneDriftSuggestions({ profile, highPressureCount, passiveCount, dangerHookCount });
  return {
    chapterCount,
    createdAt: now(),
    summary: issues.length ? `第${chapterCount}章基调偏移诊断：${issues.join('')}` : `第${chapterCount}章基调偏移诊断：近期基调稳定。`,
    issues,
    suggestions,
    metrics: { highPressureCount, passiveCount, dangerHookCount, sampleSize: recentChapters.length },
  };
}

function storeToneDriftReport(automation = {}, report = null) {
  if (!report) return automation;
  const reports = trimToneDriftReports({ ...automation, toneDriftReports: [...(automation.toneDriftReports || []), report] });
  return {
    ...automation,
    toneDriftReport: [report.summary, ...report.suggestions.map((item) => `- ${item}`)].join('\n'),
    toneDriftReports: reports,
    lastToneDriftAt: report.chapterCount,
  };
}

function maybeUpdateToneDriftAfterWrite({ project = {}, automation = {}, chapterCount = 0 } = {}) {
  if (automation.toneDriftEnabled === false) return automation;
  if (!chapterCount || chapterCount % 5 !== 0 || Number(automation.lastToneDriftAt) === chapterCount) return automation;
  const report = buildToneDriftReport({ project, automation, chapterCount });
  return storeToneDriftReport(automation, report);
}

function buildToneDriftGuide(automation = {}) {
  if (automation.toneDriftEnabled === false) return '';
  const report = normalizeText(automation.toneDriftReport).trim();
  if (!report) return '';
  return [
    '【最新基调偏移诊断】',
    report,
    '使用方式：只作为后续3-5章的轻提醒，优先修章节发动机和章末钩子，不要把诊断文字写进正文；下一次5章诊断会覆盖旧建议。',
  ].join('\n');
}

function buildHumanWritingPatternLibrary(project = {}) {
  const text = [project.title, project.genre, project.premise, project.styleGuide, project.targetAudience].map(normalizeText).join('\n');
  const isFanWork = /同人|方舟|明日方舟|二次元|原作|干员|博士|罗德岛/.test(text);
  const isSystemStory = /系统|金手指|面板|任务|奖励|搜打撤|加点|模拟|聊天群|模块/.test(text);
  const wantsHumor = /幽默|诙谐|吐槽|轻松|反差|玩梗/.test(text);
  const wantsEpic = /史诗|宏大|战争|文明|废墟|拯救世界/.test(text);
  return [
    '真人写作习惯库（从公开榜单、简介、章节入口与网文通行写法抽象；不复制任何原文）：',
    '1. 开局抓住一个已经发生的麻烦：醉酒坐错人、醒来发现局面不对、刚穿越就要活下去、任务还没搞懂危险已经来了；世界信息随后从动作里露出。',
    '2. 人物目标和错误行动要同时出现：主角先按自己的经验做一个动作，随后被现场反馈迫使改路；这比旁白解释设定更像真人作者。',
    '3. 信息释放靠“碰到/拿起/躲开/听见/被打断”露出，不靠百科段落；读者先得到能推动下一步的一点信息，剩下的留给后续。',
    '4. 爽点落在结果上：拿到东西、躲过一次、发现破绽、关系松动、系统给出可用但有限的反馈；不要由旁白宣布“很爽”。',
    '5. 章节标题和章末钩子都偏短、具体、可点击：一个人、一句话、一个动作、一个异常物、一个倒计时；不要抽象成“真正危机”。',
    '6. 段落不平均承担所有功能：有的只写狼狈，有的只写误会，有的只写一句对话造成关系错位，有的只写物件改变路线。',
    '7. 人物口吻比句子完美更重要：允许没反应过来、嘴硬、自嘲、答非所问、先跑再想；不要把主角写成实时战术报告机器。',
    '8. 热门简介常先给“身份错位/能力错配/处境反差”，再给承诺：这个人会怎么利用错位活下去、翻盘、搞事或改变原剧情。',
    isFanWork ? '同人适配：同人味来自角色认知差、原作名词的轻触、玩家知道但角色不敢笃定的错位；不要用百科解释原作设定。' : '',
    isSystemStory ? '系统文适配：系统只给目标、限制、奖励、异常和代价；提示通常应改变人物动作或选择，也可确认风险、打断判断或制造误判，不能替作者讲世界观。' : '',
    wantsHumor ? '幽默适配：幽默优先来自处境荒诞、人物压力和主角口吻，不是段子堆砌。吐槽要承担功能：遮掩害怕、暴露误判、缓冲关系尴尬、推动判断或显示立场；高压时通常更短更少，低压过渡和关系拉扯可多留一点口吻余味。' : '',
    wantsEpic ? '史诗适配：史诗感来自小人物在废墟、战争、阵营压力下仍做选择，不来自宏大词汇堆叠。' : '',
  ].filter(Boolean).join('\n');
}

function buildCharacterVoiceModel(project = {}) {
  const text = [project.title, project.premise, project.styleGuide, project.characterProfiles, ...(project.characters || []).map((character) => `${character.name} ${character.role} ${character.traits} ${character.goal}`)].map(normalizeText).join('\n');
  if (/魏杰|明日方舟|博士|罗德岛|搜打撤/.test(text)) {
    return [
      '魏杰口吻模型（优先级高于通用“冷静主角”）：',
      '1. 魏杰熟悉明日方舟，但现实冲击会不断打破玩家上帝视角；他可以认出名词，但不能因此变成百科解说员。',
      '2. 第一反应常是怕死、想骂、嘴硬或自嘲；第二反应才是利用玩家经验和系统信息找活路。',
      '3. 他可以怂，但脑子转得快；身体会先暴露害怕、疼痛和迟疑，嘴上偶尔用短吐槽遮一下，不能每个反应都抖梗。',
      '4. 看到原作物件/角色时，写“熟悉感和现实感冲突”：认识它，但它现在有重量、血味、距离和后果。',
      '5. 系统提示出现时，他先按游戏机制理解，马上被疼痛、脚步、资源短缺或角色不信任纠正。',
      '6. 台词和内心不要总完整解释：允许“我知道这个，但我现在没空感动/没空考据/先活下来”的短促判断。',
      '7. 幽默不是脱线，必须服务压力：越危险越少，像一句憋回去的吐槽；连续高压段优先写动作和代价，不要把主角写成抽象梗复述机器。',
    ].join('\n');
  }
  return [
    '主角口吻模型：',
    '1. 主角要有稳定的欲望、怕点、口头倾向和处理麻烦的习惯。',
    '2. 关键场景里先让身体、动作、迟疑或一句话暴露性格，再补必要信息。',
    '3. 不要让主角只负责接收任务和复述设定。',
  ].join('\n');
}

function resolveWritingStyle(project = {}, automation = {}) {
  const text = [project.title, project.genre, project.premise, project.styleGuide, project.targetAudience, automation.authorPersona].map(normalizeText).join('\n');
  const modes = [];
  if (/同人|方舟|明日方舟|二次元|原作|干员|罗德岛|博士/.test(text)) modes.push('fanwork');
  if (/系统|金手指|面板|任务|奖励|搜打撤|加点|模拟|聊天群|模块/.test(text)) modes.push('system');
  if (/幽默|诙谐|吐槽|轻松|反差|玩梗/.test(text)) modes.push('humor');
  if (/史诗|宏大|战争|废墟|文明|拯救世界/.test(text)) modes.push('epic');
  if (/悬疑|灵异|惊悚|诡异|推理|调查|线索/.test(text)) modes.push('suspense');
  if (/恋爱|言情|日常|关系|暧昧|情绪/.test(text)) modes.push('relationship');
  return {
    modes: modes.length ? modes : ['web-novel'],
    openingBias: modes.includes('suspense') ? '异常先行' : modes.includes('relationship') ? '关系错位先行' : '困境先行',
    informationStyle: modes.includes('system') ? '短讯改变动作' : modes.includes('suspense') ? '残缺线索推动验证' : '动作中露出信息',
    dialogueStyle: modes.includes('fanwork') ? '角色认知差和身份错位' : modes.includes('relationship') ? '话没说满和情绪回避' : '短句改变关系或选择',
    detailBudget: modes.includes('epic') ? '一个贴着动作的废墟尺度细节' : '一个改变动作的有效细节',
  };
}

function buildStyleResolverGuide(project = {}, automation = {}) {
  const style = resolveWritingStyle(project, automation);
  return [
    '风格解析器：',
    `模式：${style.modes.join(' / ')}`,
    `开场倾向：${style.openingBias}`,
    `信息释放：${style.informationStyle}`,
    `对话策略：${style.dialogueStyle}`,
    `细节预算：${style.detailBudget}`,
  ].join('\n');
}

function inferCharacterVoice(character = {}, project = {}, cardText = '') {
  const name = normalizeText(character.name || character).trim();
  const role = normalizeText(character.role || '');
  const traits = normalizeText(character.traits || '');
  const goal = normalizeText(character.goal || '');
  const combined = [name, role, traits, goal, cardText].join('\n');
  if (/魏杰/.test(name)) return `${name}：怕死但脑子快；熟悉原作但不敢全信；嘴硬、自嘲短促；身体先怂，行动跟得快。`;
  if (/灰喉/.test(name)) return `${name}：警惕、少解释、先判断威胁；台词短，质问多于说明；动作比情绪外露更快。`;
  if (/阿米娅/.test(name)) return `${name}：温柔但背着压力；担心会压成命令；给信息时会照顾对方情绪，但不会无底线解释。`;
  if (/凯尔希/.test(name)) return `${name}：审讯式冷静；信息给一半；句子像诊断和命令，情绪藏在停顿里。`;
  if (/ACE|Ace/.test(name)) return `${name}：老兵式稳重；少废话；把安慰藏在行动安排里。`;
  if (/W/.test(name)) return `${name}：挑衅、玩笑带刺；话里藏试探；很少直接交底。`;
  if (/霜星/.test(name)) return `${name}：冷、克制、疲惫；情绪不外放，立场和代价压在短句里。`;
  if (/系统|面板|协议/.test(combined)) return `${name || '系统'}：短讯式；只给目标、限制、奖励、异常和代价；通常应改变人物选择，也可确认风险、打断判断或制造误判。`;
  if (/队长|军人|干员|战士|狙击|近卫|护卫/.test(combined)) return `${name || '角色'}：行动优先，台词短，警惕时先控制局面再给信息。`;
  if (/导师|医生|研究|顾问|指挥/.test(combined)) return `${name || '角色'}：信息有保留，表达偏判断和安排，不轻易解释完整。`;
  if (/朋友|同伴|妹妹|学生|少女|少年/.test(combined)) return `${name || '角色'}：反应更生活化，会犹豫、追问、错开回答，用小动作露情绪。`;
  return `${name || '角色'}：根据目标和关系说话；不要变成任务说明员，至少保留一个欲望、顾虑或隐瞒。`;
}

function buildVoiceRoster({ project = {}, card = {} } = {}) {
  const cardText = [card.title, card.cast, card.summary, card.coreEvent, card.readerExpectation].map(normalizeText).join('\n');
  const names = new Set();
  (project.characters || []).forEach((character) => {
    if (character.name && (cardText.includes(character.name) || names.size < 6)) names.add(character.name);
  });
  for (const match of cardText.matchAll(/魏杰|灰喉|阿米娅|凯尔希|ACE|Ace|W|霜星|博士|系统/g)) {
    names.add(match[0]);
  }
  if (!names.size) names.add('主角');
  const characterMap = new Map((project.characters || []).map((character) => [character.name, character]));
  return [...names].slice(0, 8).map((name) => inferCharacterVoice(characterMap.get(name) || { name }, project, cardText));
}

function buildVoiceRosterGuide({ project = {}, card = {} } = {}) {
  return ['人物口吻表（本章出场人物按各自目标和关系说话）：', ...buildVoiceRoster({ project, card })].join('\n');
}

function sanitizeChapterCardForHumanEngine(card = {}, chapterNumber = 1) {
  const stripInstructionNoise = (value = '') => normalizeText(value)
    .replace(/第\d+章必须让真人写作引擎有空间运作[\s\S]*$/g, '')
    .replace(/必须让真人写作引擎[\s\S]*$/g, '')
    .replace(/核心要素[:：][\s\S]*$/g, '')
    .replace(/写法|开头方式|叙事手法|对话密度|正文禁区|段落节奏/g, '')
    .trim();
  return {
    order: card.order || chapterNumber,
    title: card.title || `第${chapterNumber}章`,
    volumeName: card.volumeName || '',
    paceStage: stripInstructionNoise(card.paceStage),
    chapterGoal: stripInstructionNoise(card.chapterGoal || card.allowedBeats || card.summary),
    coreEvent: stripInstructionNoise(card.coreEvent || card.summary),
    cast: stripInstructionNoise(card.cast),
    keyClue: stripInstructionNoise(card.keyClue || card.foreshadowing),
    chapterResult: stripInstructionNoise(card.chapterResult),
    progressLock: stripInstructionNoise(card.progressLock),
    allowedBeats: stripInstructionNoise(card.allowedBeats),
    forbiddenBeats: stripInstructionNoise(card.forbiddenBeats),
    readerExpectation: stripInstructionNoise(card.readerExpectation),
    foreshadowing: stripInstructionNoise(card.foreshadowing),
    commercialBeat: stripInstructionNoise(card.commercialBeat),
    systemRule: stripInstructionNoise(card.systemRule),
    pressureLevel: stripInstructionNoise(card.pressureLevel),
    protagonistChoice: stripInstructionNoise(card.protagonistChoice),
    agencyRecovery: stripInstructionNoise(card.agencyRecovery),
    chapterReward: stripInstructionNoise(card.chapterReward),
    hookType: stripInstructionNoise(card.hookType),
    summary: stripInstructionNoise(card.summary),
    hook: stripInstructionNoise(card.hook),
  };
}

function buildHumanWritingSystemGuide({ project = {}, automation = {}, card = {}, chapterNumber = 1, previousChapter = null, scope = 'draft' } = {}) {
  return [
    '真人写作模块总规则（写作习惯优先，检测规则只做边界）：',
    `适用阶段：${scope}`,
    buildHumanWebNovelReadabilityGuide(),
    buildHumanWritingPatternLibrary(project),
    buildCharacterVoiceModel(project),
    buildToneProtocolGuide(project, automation),
    buildToneDriftGuide(automation),
    buildAuthorPersonaGuide(automation.authorPersona),
    card && Object.keys(card).length ? '本章剧情卡只回答“发生什么”，不要把它改写成控制参数表：' : '',
    card && Object.keys(card).length ? formatChapterCard(card, chapterNumber) : '',
    previousChapter ? `承接方式：从“${previousChapter.title}”的未完动作、物件、伤势、误会或沉默继续，不用“上一章”字样。` : '开篇方式：直接给当前麻烦和人物反应，不先解释世界观。',
  ].filter(Boolean).join('\n\n');
}

function buildHumanRevisionDirective({ project = {}, automation = {}, card = {}, chapterNumber = 1, previousChapter = null, scope = 'revision' } = {}) {
  return [
    '真人修订导演（用于修订，不用于首稿恐吓模型）：',
    `适用阶段：${scope}`,
    '修订顺序：先看人物欲望和口吻是否成立，再看信息是否由动作露出，再看系统提示是否改变选择，最后才修句子。',
    buildHumanWritingEnginePrompt({ project, automation, card, chapterNumber, previousChapter, scope }),
    '句子修订方式：把解释性判断改成“证据出现 → 人物停顿/验证 → 下一步动作改变”；把承载过多的长句拆回“动作句 + 反馈句”。',
  ].filter(Boolean).join('\n\n');
}

function assembleStoryContext({ project = {}, automation = {}, card = {}, chapterNumber = 1, previousChapter = null, nextCard = null } = {}) {
  const cleanCard = sanitizeChapterCardForHumanEngine(card, chapterNumber);
  const recentChapters = (project.chapters || []).filter((chapter, idx) => !isBlankStarterChapter(chapter, idx)).slice(-5);
  const currentStage = cleanCard.paceStage || project.volumes?.[0]?.positioning || '开篇阶段';
  const tone = resolveToneProfile(project, automation);
  return {
    toneMode: tone.profile.label,
    toneEngine: tone.profile.engine,
    toneHooks: tone.profile.hooks,
    projectPromise: normalizeText(project.premise || project.summary || automation.inspiration || '').slice(0, 360),
    currentStage: normalizeText(currentStage).slice(0, 180),
    chapterGoal: normalizeText(cleanCard.chapterGoal || cleanCard.allowedBeats || cleanCard.summary || '').slice(0, 260),
    coreEvent: normalizeText(cleanCard.coreEvent || cleanCard.summary || '').slice(0, 360),
    cast: normalizeText(cleanCard.cast || '').slice(0, 180),
    keyClue: normalizeText(cleanCard.keyClue || cleanCard.foreshadowing || '').slice(0, 260),
    result: normalizeText(cleanCard.chapterResult || cleanCard.hook || '').slice(0, 260),
    readerQuestion: normalizeText(cleanCard.readerExpectation || cleanCard.hook || '').slice(0, 220),
    systemBoundary: normalizeText(cleanCard.systemRule || '').slice(0, 260),
    pressureLevel: normalizeText(cleanCard.pressureLevel || '').slice(0, 120),
    protagonistChoice: normalizeText(cleanCard.protagonistChoice || '').slice(0, 220),
    agencyRecovery: normalizeText(cleanCard.agencyRecovery || '').slice(0, 220),
    chapterReward: normalizeText(cleanCard.chapterReward || '').slice(0, 220),
    hookType: normalizeText(cleanCard.hookType || '').slice(0, 120),
    previousTail: previousChapter ? normalizeText(previousChapter.content).slice(-420) : '',
    nextDirection: nextCard ? normalizeText(nextCard.summary || nextCard.hook || '').slice(0, 220) : '',
    recentSummaries: recentChapters.map((chapter) => `${chapter.title}：${chapter.summary || takeSummaryLine(chapter.content)}`).join('\n').slice(0, 900),
  };
}

function buildSceneDramaturgyPlan({ project = {}, storyContext = {}, card = {}, previousChapter = null } = {}) {
  const text = [project.title, project.premise, project.styleGuide, card.summary, card.coreEvent, card.hook].map(normalizeText).join('\n');
  const isWeiJie = /魏杰|明日方舟|博士|罗德岛|搜打撤/.test(text);
  const isSoftTone = /轻松日常|轻喜反差/.test(storyContext.toneMode || '');
  return [
    '【场景戏剧计划】',
    previousChapter ? '开场：接住上一场遗留的动作、物件、关系余波或小麻烦，让人物已经在处理当前目标。' : (isSoftTone ? '开场：先给一个生活化目标、错位麻烦或可执行的小需求，不默认用生死危险压场。' : '开场：人物已经处在麻烦里，先给身体/声音/物件/对话压力，再让读者跟着人物补背景。'),
    `本书基调发动机：${storyContext.toneEngine || '按当前项目基调推进'}`,
    `本章欲望：${storyContext.chapterGoal || (isSoftTone ? '完成一个小目标，并换来一点安心、关系或能力回报' : '先活下来，并拿到一个能推动下一步的结果')}`,
    `主角主动选择：${storyContext.protagonistChoice || '让主角至少做一次会改变局面的小选择，不只被安排或被保护'}`,
    `第一尝试：主角按自己的经验、性格或当前资源做一个动作，现场反馈让他调整。`,
    `现实打断：${storyContext.keyClue || '声音、物件、伤势、系统短讯或角色质问打断解释'}`,
    `主动权回收：${storyContext.agencyRecovery || storyContext.result || '让主角用判断、行动或代价换回一点局面，不让本章只停在被动受压'}`,
    `本章小收获：${storyContext.chapterReward || storyContext.result || storyContext.readerQuestion || '只落地一个能改变路线、关系、能力熟练度或下一步选择的回报'}`,
    isWeiJie ? '魏杰处理方式：身体先怂，嘴上短促自嘲；认出原作信息后先利用，不在危险中考据。' : '主角处理方式：先露出性格，再做选择；不要只复述任务。',
    `章末停点：${card.hook || '停在一个必须马上选择或处理的动作前'}`,
    `钩子类型偏好：${storyContext.hookType || storyContext.toneHooks || '具体动作、关系变化、小收益或下一步选择'}`,
  ].join('\n');
}

function buildParagraphWeavePlan({ project = {}, storyContext = {}, card = {}, chapterNumber = 1 } = {}) {
  const mode = getNarrativeTextureMode(card);
  const wantsHumor = /幽默|诙谐|吐槽|轻松|玩梗/.test([project.styleGuide, project.premise].map(normalizeText).join('\n'));
  const wantsEpic = /史诗|宏大|废墟|战争|文明/.test([project.styleGuide, project.premise].map(normalizeText).join('\n'));
  const middle = mode.primary === 'dialogue_conflict'
    ? ['对话错位：一句话改变关系，动作承担停顿和不信任。', '信息留口：对方只透露能迫使主角行动的一半。']
    : mode.primary === 'investigation'
      ? ['触碰线索：人物碰到一个物件，只得出一个可行动结果。', '复核偏差：主角验证刚才的判断，发现路线或关系变窄。']
      : ['行动受阻：尝试推进当前目标，现场给出阻碍。', '短暂缓冲：身体不适、嘴硬或一句短吐槽，让人物像活人。'];
  const optionalCards = [
    '困境牌：一个感官/动作压力 + 人物即时反应；只让读者知道当前麻烦。',
    '错误行动牌：主角按经验处理，现场反馈让他调整。',
    middle[0],
    middle[1],
    wantsHumor ? '口吻牌：如果场景允许，用一句短促自嘲、嘴硬或回避暴露性格；不允许就省略。' : '反应牌：人物用动作、停顿、沉默或回避暴露情绪。',
    wantsEpic ? '压场牌：废墟/战争/阵营压力只贴着当前动作出现。' : '推进牌：拿到一个结果，代价或新问题随之出现。',
    '选择牌：人物在两个不完整选项之间做决定。',
    '钩子牌：停在具体动作、声音、物件变化、路线选择或一句未说完的话前。',
  ];
  return [
    '【段落功能牌组】',
    `第${chapterNumber}章只写一个主场景链，换场必须由人物选择或危险逼出来。`,
    '本章可从下列段落功能中选3-5种，不必按顺序，不必全部使用；优先让人物处境自然推动段落变化。',
    ...optionalCards.map((item) => `- ${item}`),
    '不要按牌组顺序机械排段；如果一段同时完成动作、信息和关系变化，就让它自然合并。',
    '句子承载：每句只服务一个动作或一个判断；细节跟着动作出现，系统短讯只改变下一步选择。',
  ].join('\n');
}

function buildHumanWritingEnginePrompt({ project = {}, automation = {}, card = {}, nextCard = null, chapterNumber = 1, previousChapter = null, scope = 'draft' } = {}) {
  const cleanCard = sanitizeChapterCardForHumanEngine(card, chapterNumber);
  const storyContext = assembleStoryContext({ project, automation, card: cleanCard, chapterNumber, previousChapter, nextCard });
  return [
    '真人写作引擎（本软件写作核心；蓝图、角色卡、作者设定、章节卡、平台策略都是输入，不是同级规则）：',
    `阶段：${scope}`,
    buildHumanWebNovelReadabilityGuide(),
    '工作顺序：先理解人物处境和欲望，再安排错误行动与现实打断，再让信息从动作中露出，最后停在具体选择前。',
    buildHumanWritingPatternLibrary(project),
    buildStyleResolverGuide(project, automation),
    buildToneProtocolGuide(project, automation),
    buildToneDriftGuide(automation),
    buildCharacterVoiceModel(project),
    buildVoiceRosterGuide({ project, card: cleanCard }),
    buildAuthorPersonaGuide(automation.authorPersona),
    '【自然读感偏好】',
    '否定对照句式极低频：像“第一反应不是A，也不是B”“没有A。也没有B。”“不A。不B。”“不是A，不是B，而是C”“不像A，也不像B”这类句式，默认几十章才偶尔保留一次，且只在身份确认、重大反转、死亡确认、人物崩溃、误判被现实打脸等节点使用。普通段落不要用它制造真实感、悬念或口吻，优先改成动作、停顿、触感、声音、物件反馈、人物迟疑或下一步选择。',
    '否定否定再解释要更稀有：像“它不再是A，也不是B。它变成了C”“不是A，也不是B，就是C”“不是A，而是B”“不是A，说明/意味着B”这类先否定再给意义、解释、转折或升格的句式，默认几十章内最多一次，且必须非常贴合当下剧情逻辑。只要不是强身份确认、关键误判纠正、死亡/牺牲确认或人物认知崩塌，就宁可不用；改成角色看见具体痕迹、身体反应、手上动作、物件反馈或下一步选择。',
    '三项名词排比默认不用：像“一条旧留言，一块金属牌，一个交接备注”“一枚签、一段录音、一扇门”这类三项名词列举会很容易显得作者在替读者升格意义。除非章内唯一一次、上下文确实需要把多个已出现物件压成一个关键认知，否则只保留最能改变行动的一项，其余并入动作或干脆删掉。',
    '环境描写优先服务行动。可以有氛围和比喻，但通常每个环境段只保留一个最有效的强细节；其余信息通过人物呼吸、视线受阻、脚下打滑、伤口被牵动、路线改变、掩体可用、敌人位置暴露或物件可利用带出。',
    '吐槽和比喻优先少而准：同一段通常只保留一句吐槽或一个比喻；比喻必须和前后动作逻辑一致，不能前半句像一个东西、后半句又跳到完全不搭的效果。危险、追逐、受伤、求援段宁可少吐槽，优先把选择和后果写清楚。',
    '主角不能像抽象梗复述机器。默认先写正常人的第一反应：怕、疼、犹豫、判断、护人、误判、改动作；吐槽、梗和夸张比喻只作为少量点缀，通常出现在动作受阻、现实打脸、关系尴尬或危险稍有空隙时。连续两段都靠吐槽收尾时，删掉后一处或改成动作、沉默、身体反应。',
    '正常对话优先级：主角和角色首先要像正常人说话，按当下处境、关系、目的、信息差、情绪和身体状态表达。需要求救就先求救，需要指挥就先指挥，需要安抚就先安抚，需要拒绝就先拒绝，需要害怕就允许说不完整的话。调侃、吐槽、梗、抽象比喻的优先级低于正常对话和行动信息；如果一句话既可以正常说清，也可以说成梗，默认选正常说清。只有正常表达已经完成，且吐槽能额外体现嘴硬、遮掩害怕、缓冲关系或推动行动时，才短促补一句。',
    '人设表达分层：降低吐槽不等于抹掉主角性格。人设优先通过说话长短、词气、停顿、回避、先动手后解释、用命令代替关心、骂半句又咽回去、害怕但仍选择救人等方式体现；玩梗和吐槽只是最后一层点缀。嘴硬角色可以少说梗但仍嘴硬，怕死角色可以不贫嘴但仍会先评估退路，毒舌角色可以少开玩笑但仍有刺。',
    '主角的幽默、吐槽、梗、夸张比喻不是默认反应，而是压力下的遮掩动作或性格泄露。每次出现都应尽量承担一个功能：遮掩害怕、暴露误判、缓冲关系尴尬、推动下一步判断、显示角色立场。没有功能的梗优先省略。幽默形式跟随主角人设：嘴硬型用短促自嘲，冷静型用克制反讽，热血型用硬撑式嘴硬，毒舌型用带刺但推动关系的台词，稳重型少用或不用。不要把所有主角都写成网络梗复述者。',
    '吐槽保留资格：调侃、吐槽、梗和夸张比喻只有在承担人物功能时才保留，例如遮掩害怕、缓冲尴尬、暴露误判、减轻队友恐慌、表达嘴硬、推动关系或帮助角色下决心。若只是给句子加趣味、给危险贴游戏梗、把严肃场面说轻，优先删掉或改成动作、停顿、身体反应、现实判断。保持主角人设不等于高频吐槽；嘴硬型角色也可以通过不解释、先动手、压住害怕、骂半句又吞回去、用命令替代关心来体现。高压连续动作、救人、伤情恶化、撤离、敌人逼近、门禁触发、队友失联时，吐槽应更短、更克制，通常放在判断完成后、动作间隙或危机暂缓后，不能插在发现问题、判断代价、安排动作之间。',
    '游戏化梗降级：主角可以有玩家经验和游戏化联想，但高压真实伤痛、救人、撤离、被追杀、队友失联时，不要频繁用“出生点、野怪、支线、存档点、集火、挂号、客服、VIP、差评”等词给现实危险贴游戏标签。只有当这些词明确暴露主角误判、缓解队友恐慌、推动行动选择或被现实打脸时才保留；否则改成身体反应、现场判断、嘴硬半句或沉默。',
    '幽默停留时间受当前剧情压力、人物状态、周围环境和关系氛围影响。高压连续动作段通常要尽快回到动作、身体反应、路线选择或外部压力；低压过渡、关系拉扯、日常修整、信息交换段可以多留一点口吻余味，但仍要服务人物性格、关系变化或下一步判断。',
    '文风优先级：用户文风里的“幽默、诙谐、轻松、玩梗”是口味，不是每段默认任务。它必须服从当前剧情压力、人物状态和场景功能。高压、受伤、撤离、救人、信息确认段优先写正常人的恐惧、疼痛、判断、误判、克制和行动；幽默只在遮掩害怕、缓冲尴尬、暴露误判或推动关系时短促出现。',
    '类型经验边界：主角的类型经验、游戏经验、原作认知、系统认知只用于形成初始误判或快速判断，不能成为每个压力点的解释框架。遇到真实伤痛、救人、撤离和关系冲突时，优先写现场证据和人物选择；游戏/原作/系统梗只在它改变行动、暴露误判或被现实打脸时出现。人物先像人，再像有梗的人。',
    '高压判断链保护：在高压撤离、救人、伤情恶化、倒计时、敌人逼近、门禁/陷阱触发等段落，幽默不能打断“看见问题 → 判断代价 → 做出安排/动作”的链条。先让人物完成判断和安排；如果这一小段已经完成，才允许补一句短促口吻。若吐槽会插在判断和行动之间，应删掉或改成身体反应、停顿、咽回话、手指发抖等正常反应。',
    '对话逻辑桥：汇报、远程通信、撤离安排、战斗指挥、价值判断这类台词，不要写成“能。状态。风险。我会处理。”的报告清单。角色可以说短句，但要按真人说话补出最小连接：转折、因果、让步、犹豫、改口或动作停顿，让“现在怎样 → 所以怎么办 → 为什么这么选”自然连上。',
    '对话必要成分：人物台词可以急、短、被打断，但如果一句话少了主语、谓语、对象、方向、条件或承接词会让读者停顿回推，就优先补足。不要让台词长期写成“快。”“行。”“继续走。”“别回门。”“可以。”这类孤立口令或状态播报；可改成“你们先往前走”“行，我来开维护气闸”“沿这条手动轨道继续推”“先别回那扇门”“可以，我只开维护项”。',
    '对话承接词要看上下文：所以、但是、那、行、嗯、好、现在、先、再、就这类词只在回应上一句话、现场动作或明确选择时使用。不要为了顺滑硬塞连接词；如果上下文不是因果、转折或让步，就改成动作、称呼、具体对象或直接回答。',
    '对话正向动作优先：连续“别A、不要B、不C”会像规则清单；角色下命令时优先说下一步要做什么，再补哪些风险暂时别碰。例如“别看背面。别补签。”可改成“先把卡片扣回去，背面和补签项都别碰”；“不读取关联对象，不打开主档案”可改成“确认范围只限维修气闸，关联对象和主档案先锁住”。',
    '状态句要接用途：单独的“可以、行、明白、稳了、不稳、够、不够、有、没有”通常要接一句用途、条件或动作。只有强情绪、打断、确认口令或角色故意冷处理时才单独成句；否则写成“可以，但只够撑十秒”“明白，我让他们先别推”“不稳，先别让伤员贴近叶片”。',
    '台词因果一致性：台词里的状态、判断、命令和代价要互相咬合。若先说风险，后面的安排应回应这个风险；若前后命令看似冲突，要写成主次、条件或取舍关系。不要为了连接而硬塞“因为/所以/但是”，可以用停顿、改口、动作打断、半句让步或省略来保持真人口吻。',
    '句子自然承接：无论题材和场景，台词、判断、动作句通常应顺着人物当下的处境、注意力、情绪和选择自然长出来，让读者能隐约读出它和前后文的关系。普通短句、停顿、情绪反应可以留白，不必每句解释因果；但如果一句话读起来像孤立标签、任务条目、抽象口号、突兀判断或断开的命令，就优先补一个具体对象、动作目的、身体反应、风险代价、条件关系或轻微转折。不要靠堆“因为/所以/但是”制造假顺滑。',
    '旁白解释密度：当动作、物件、对话或人物反应已经让读者明白当前判断时，后续旁白尽量避免反复解释同一个意思。关键判断可以保留一句清楚承接，但通常不需要连续用“因为、只要、哪怕、第一反应是、下意识”等方式展开。若解释带来新的风险、情绪变化、误判代价或后续选择，可以保留；若只是把读者已经看懂的原因再说一遍，优先删短或换成现场证据、动作反馈和下一步选择。',
    '短句留白资格：短句、断行和留白只在强情绪停顿、危险瞬间、角色不敢说完、重大发现落点、对话打断或章末钩子处少量使用。普通观察、否定判断、位置判断、动作安排、信息确认、声音/重量/速度描述，不要拆成连续孤立短句。像“没有A。也没有B。”“不A。不B。不C。”这类句群默认不写；除非几十章里遇到一次真正需要断裂感的强节点，否则合并成一句自然表达，或接入动作、感受、风险和下一步判断。短句不是默认真人感，连续短句过多会显得僵硬和分镜化。',
    '碎片判断合并：连续出现“没有/也没有/不/不再/不能/不是/也不是”等开头的判断时，除非是死亡确认、重大反转、人物崩溃或台词打断，否则优先合并为一两句自然判断，并让它接到人物反应或下一步动作上。不要把“不是A，也不是B”当作常用开场反应、身份辨析或悬念句式。合并时不要改剧情，只把普通信息从诗行式分镜拉回正常叙述。',
    '必要成分补足：角色可以急、可以省字，但只要补出主语、对象、动作方向、退回路径、下一步安排能让句子更自然，就优先补出来。涉及停止、撤离、别碰、剪断、固定、打开、关闭、放弃、转移、剂量、路线、通讯、伤员、物资、权限等关键动作时，通常要让读者一眼知道“谁做/做什么/别动哪样东西/往哪里退/下一步处理什么”。急促感来自语气、动作和打断，不来自省掉必要名词。',
    '正向安排优先：连续“不A、不B、别C”容易像规则清单；如果角色是在下命令或做决定，优先写成“先做什么 + 哪些动作暂停/谁负责看住风险”。例如“慢慢撤。别带动线，钳口先松开，沿原路退”可写成“慢慢撤，钳口先松开，别带动那根线，我们沿原路退回去”；“不剪，不取布条，也别再碰门禁片残片”可写成“先把线固定住，布条和门禁片残片都暂时别动”。',
    '取舍句自然化：表达“少做A以避免B”“放弃物资保人命”“不确认某人以免牵连某人”时，要让代价和收益具体咬合。可以保留短促口吻，但最好带出牺牲的是什么、保住的是什么、为什么现在只能这么选；不要只写抽象价值口号。',
    '空间/设备指令边界：涉及门口、深处、侧门、通道、读卡槽、监测廊、隔离帘等位置和设备时，指令要让读者知道队伍移动到哪里、暂时不做什么、谁负责看哪里。短句可以用，但优先写成“先挪到门口，别急着往里开”“离门锁半米，先看地面”这类动作边界，而不是“到门口，不开深处”式压缩标签。',
    '三项抽象排比要克制：不要把人物处境连续写成“当A、当B、当C”或“会骗人、会骗人、也会骗人”。如果只是表达危险或工具化，只保留最贴当前上下文的一项，并让它接到动作或选择上。',
    '强痛感比喻和否定对照句式要稀有：像“不是A，是B”“不是A，也不是B”“没有A。也没有B。”“不A。不B。”这类句子通常几十章才偶尔出现一次。普通疼痛、普通判断和普通反应优先写成动作变形、呼吸断掉、手松了一下、路线被迫改变、人物停顿或物件反馈。',
    '移动和追逐场景不要像摄像机扫街：一段只写1-2个会影响路线、遮挡视线、暴露敌人或提供可利用物的细节。不要同时写右侧店铺、左侧楼体、前方外墙、铁栏杆、粉尘和吐槽；能不改变动作的细节直接省略。',
    '连续抽象判断要压缩：不要连续写“信息会骗人，标记会骗人，系统也只给半截提示”这类排比总结。优先换成一句现场结论，例如“这个标记被人动过，系统也没法替他判断真假”，然后立刻接人物验证或改路。',
    '相邻章节句式避让：最近章节只用于承接事实、动作、伤势、关系和未解线索，不要模仿上一章的句式节奏。可以延续同一情绪或误会，但避免连续使用相同表达骨架，尤其是“不是A，也不是B，更像C”“没有A。也没有B。”“不A。不B。”“好消息/坏消息”“这不是X，这是Y”。需要表达同一层意思时，优先换成动作、停顿、神态、物件反馈、台词含混或人物下一步选择。',
    '【故事上下文】',
    `作品承诺：${storyContext.projectPromise}`,
    `当前阶段：${storyContext.currentStage}`,
    `本章目标：${storyContext.chapterGoal}`,
    `核心事件：${storyContext.coreEvent}`,
    storyContext.cast ? `在场人物：${storyContext.cast}` : '',
    storyContext.keyClue ? `关键物件/线索：${storyContext.keyClue}` : '',
    storyContext.systemBoundary ? `系统边界：${storyContext.systemBoundary}` : '',
    storyContext.pressureLevel ? `压力等级：${storyContext.pressureLevel}` : '',
    storyContext.protagonistChoice ? `主角主动选择：${storyContext.protagonistChoice}` : '',
    storyContext.agencyRecovery ? `主角拿回的主动权：${storyContext.agencyRecovery}` : '',
    storyContext.chapterReward ? `本章小收获/获得感：${storyContext.chapterReward}` : '',
    storyContext.hookType ? `章末钩子类型：${storyContext.hookType}` : '',
    storyContext.previousTail ? `承接末段：${storyContext.previousTail}` : '',
    storyContext.recentSummaries ? `最近摘要：\n${storyContext.recentSummaries}` : '',
    storyContext.nextDirection ? `下一章方向只作章末影子：${storyContext.nextDirection}` : '',
    '【净化后的剧情卡】',
    formatChapterCard(cleanCard, chapterNumber),
    buildSceneDramaturgyPlan({ project, storyContext, card: cleanCard, previousChapter }),
    buildParagraphWeavePlan({ project, storyContext, card: cleanCard, chapterNumber }),
  ].filter(Boolean).join('\n\n');
}

function buildProjectStyleGuide(project = {}, automation = {}) {
  const style = normalizeText(project.styleGuide).trim();
  const persona = normalizeText(automation.authorPersona).trim();
  const combined = [style, persona].filter(Boolean).join('\n');
  return [
    '作品文风硬约束：',
    style ? `用户设置文风：${style}` : '用户未单独填写文风时，按作者人设卡执行。',
    combined && /幽默|诙谐|吐槽|轻松|黑色幽默|玩梗/.test(combined)
      ? '本书需要幽默感：允许主角在危险中出现短促、克制的自嘲或荒诞感，但不能破坏生死压力。每章至少保留1处人物口吻里的轻微幽默，不要被自然感清洗成冷报告。'
      : '',
    combined && /史诗|宏大|厚重|文明|命运|战争|群像|神话/.test(combined)
      ? '本书需要史诗感：不要靠大词空喊；用废墟尺度、历史余烬、阵营压力、城市灾变和人物渺小选择来呈现。每章至少有1处环境或选择带出更大格局，但必须贴着当前行动。'
      : '',
    '自然感修复不得抹掉用户指定文风；修句子时保留幽默/史诗的语气骨架，只删除清单、档案、逻辑断裂和机械句。',
  ].filter(Boolean).join('\n');
}

function buildParagraphBudgetGuide({ project = {}, automation = {}, card = {}, chapterNumber = 1 } = {}) {
  const styleText = [project.styleGuide, automation.authorPersona, card.texturePlan, card.humanTextureBeats].map(normalizeText).join('\n');
  const wantsHumor = /幽默|诙谐|吐槽|轻松|黑色幽默|玩梗/.test(styleText);
  const wantsEpic = /史诗|宏大|厚重|文明|命运|战争|群像|神话/.test(styleText);
  const mode = getNarrativeTextureMode(card);
  const text = getNarrativeTextureInput(card);
  const recommendedTypes = ['通用推进段'];
  if (mode.primary === 'action_pressure' || /逃生|撤离|追逐|门外|脚步|危险|逼近|破门/.test(text)) recommendedTypes.push('行动受阻段', '危机逼近段', '过渡移动段');
  if (mode.primary === 'investigation' || /调查|线索|金属瓶|模块|通讯|纸条|系统|异常|存档/.test(text)) recommendedTypes.push('调查线索段', '道具交互段', '通讯系统段');
  if (mode.primary === 'dialogue_conflict' || isHighDialogueChapter(card)) recommendedTypes.push('对话冲突段');
  if (mode.primary === 'emotional_interior' || /失忆|记忆|创伤|梦|闪回|困惑/.test(text)) recommendedTypes.push('身体反应段', '内心迟疑段');
  if (mode.primary === 'relationship') recommendedTypes.push('关系错位段', '对话冲突段');
  if (mode.primary === 'daily_recovery') recommendedTypes.push('身体反应段', '生活修整段', '通用推进段');
  if (mode.primary === 'worldbuilding') recommendedTypes.push('环境压迫段', '设定承载段');
  if (mode.primary === 'transition_setup') recommendedTypes.push('过渡移动段', '通用推进段');
  if (wantsHumor) recommendedTypes.push('幽默缓冲段');
  if (wantsEpic) recommendedTypes.push('史诗压场段');
  recommendedTypes.push('章末钩子段');
  const uniqueRecommendedTypes = [...new Set(recommendedTypes)].slice(0, 8).join('、');
  return [
    '段落预算（写作前静默执行，正文中不要输出本表）：',
    '1. 默认先为每个自然段确定：段落类型、主功能、主动作、主物件、附带物件预算、情绪方式、推进结果、风格点、禁止项，再写正文。不是每段都要填满这些项，短过渡段可简化。',
    '2. 主物件可以被展开；附带物件最多1个，只能作为动作依附物，不得展开属性。没有必要时附带物件为0。',
    '3. 多数段落应产生推进结果：确认伤势、获得方向、联系失败、风险逼近、改变位置、带走关键物。纯氛围段、内心段、史诗压场段可以作为节奏缓冲，但应和当前压力、情绪或后续选择有关。',
    '4. 一段通常只承担一个主功能；必要时可有副功能，但副功能只能轻带，不能把环境说明、道具说明、心理解释、系统提示和动作推进全塞进一段。',
    '5. 句群起手采用“优先轮换”而非硬轮换：动作、声音、对话、身体反应、环境变化、内心迟疑、结果承接都可起手；连续三段避免同一种短判断句起手。静场、史诗压场、内心段可例外。',
    '6. 心理描写使用功能许可证，不按固定频率投放。每次写心理前先判断：它是否改变下一步动作、暴露人物状态、制造选择压力或形成角色口吻；没有作用就不写。',
    '7. 心理许可随章节功能变化：高压行动段宜短，并尽快回到动作；调查线索段 light/medium，用于怀疑、误判、复核；对话冲突段优先用停顿、回避、没接话替代内心独白；情绪/记忆段可 medium/high，优先由触发物引出，避免脱离当前太久；幽默段可用一句短促自嘲；史诗段让人物选择被大环境压住，不写空泛震撼。',
    '8. 段落类型不硬轮换；连续行动段可以存在，但关键行动点尽量有不同阻碍、反馈或选择变化，避免同一种动作节奏平铺。',
    `第${chapterNumber}章推荐段落类型：${uniqueRecommendedTypes}。`,
    '段落类型池：',
    '通用推进段：默认兜底；动作/反应/小结果；适合大多数普通推进，不追求特殊效果。',
    '身体反应段：疼痛、眩晕、饥渴、疲惫影响动作；禁止单独总结身体状态。',
    '环境压迫段：环境作为阻碍、尺度或危险压进动作；禁止名词清单和装修式观察。',
    '行动受阻段：角色尝试做事失败，产生新选择；允许短促停顿，但必须回到动作。',
    '调查线索段：触碰/误判/复核/只得出一个结果；禁止把线索写成档案。',
    '道具交互段：一个主物件改变行动；附带物件不得展开。',
    '通讯系统段：只写功能反馈，例如联系失败、短讯异常、信号方向；禁止设备外观档案。',
    '对话冲突段：台词推进关系或信息差；动作只用于打断、回避或露怯。',
    '内心迟疑段：短，服务下一步动作；禁止连续三句“不知道/不认识/不明白”式句号排比。',
    '幽默缓冲段：一句短促自嘲或荒诞感，立刻回到压力；不连续吐槽。',
    '史诗压场段：当前动作被废墟尺度、历史余烬或阵营压力压住；不喊宏大空词。',
    '过渡移动段：快速移动、换场、少描写；只保留一个方向或阻碍。',
    '关系错位段：关系里的沉默、误解、隐瞒改变下一步选择。',
    '生活修整段：吃、换药、整理、休息服务恢复和下一步准备；只在低压段使用。',
    '设定承载段：设定通过代价、制度压力或角色选择露出；禁止百科说明。',
    '章末钩子段：一个具体未解决动作、声音、信号或选择；禁止模板悬念句。',
    wantsHumor ? '风格预算：全章优先保留1-2处短促幽默，适合身体受阻、求援失败、荒诞处境；高速追逐、受伤、求援段可降权，宁可少一点吐槽，也要把动作因果写顺。' : '',
    wantsEpic ? '史诗预算：全章优先保留1处贴着行动的废墟尺度、城市灾变或人物渺小选择；高速追逐、受伤、求援段可降权，不要用宏大空词。' : '',
  ].filter(Boolean).join('\n');
}

function buildHumanWritingModuleGuide({ project = {}, automation = {}, card = {}, chapterNumber = 1, previousChapter = null } = {}) {
  const narrativeMode = normalizeNarrativeMode(card.narrativeMode, chapterNumber);
  const openingType = getOpeningTypeByContext({
    project,
    automation,
    order: chapterNumber,
    narrativeMode,
    cardText: [card.title, card.summary, card.hook, card.readerExpectation, card.foreshadowing].map(normalizeText).join('\n'),
    previousTypes: (automation.chapterCards || []).slice(Math.max(0, chapterNumber - 8), Math.max(0, chapterNumber - 1)).map((item) => item.openingType).filter(Boolean),
  });
  const mode = getNarrativeTextureMode(card);
  const primary = narrativeTextureModes[mode.primary] || narrativeTextureModes.transition_setup;
  const secondary = mode.secondary ? narrativeTextureModes[mode.secondary] : null;
  const oldSignals = [
    card.openingType ? `旧卡开头信号：${card.openingType}` : '',
    card.openingAnchor ? `旧卡锚点信号：${card.openingAnchor}` : '',
    card.functionMode ? `旧卡功能信号：${card.functionMode}` : '',
    card.dialogueDensity ? `旧卡对话信号：${card.dialogueDensity}` : '',
    card.texturePlan ? `旧卡质感信号：${card.texturePlan}` : '',
    card.humanTextureBeats ? `旧卡人味信号：${card.humanTextureBeats}` : '',
    card.draftingBan ? `旧卡禁区信号：${card.draftingBan}` : '',
    card.endingDelivery ? `旧卡交付信号：${card.endingDelivery}` : '',
  ].filter(Boolean);
  return [
    '真人写作模块（正文生成前临时执行，正文不要输出）：',
    '职责：章节卡只给剧情，写法由本模块决定；旧章节卡里的写法字段只能当弱信号，不能原样变成正文限制清单。',
    buildHumanWritingPatternLibrary(project),
    buildCharacterVoiceModel(project),
    `本章建议开头：${openingTypeLabels[openingType] || openingType}；${getOpeningBanByType(openingType)}`,
    `本章叙事手法：${narrativeMode}；目的：${getNarrativePurposeByMode(narrativeMode)}`,
    `本章主写法：${primary.label}${secondary ? ` + ${secondary.label}` : ''}。`,
    '开场策略：先抓本章独有的压力、异常、物件、误会、身体反馈或一句对话，再补必要背景；不要用报时定位开头。',
    '信息释放：每章只让一个核心信息真正落地；其余信息留成残缺词、错误行动后的修正、对话回避、系统短讯或物件异常。',
    '人物反应：角色先有动作、停顿、回避、答非所问或改路线，再给信息；不要所有人都立刻解释清楚。',
    '段落职责：允许有些段落只承压、只写动作修正、只缓冲、只留白或只改变关系；不要每段都闭环成“刺激-反应-反馈-下一步”。',
    '系统提示：关键节点可给完整面板；普通推进只给短讯、噪声、残缺关键词或界面边缘变化，必须推动人物动作。',
    '系统格式：凡是系统弹出的信息，必须独立成行并用【】包住整行，例如【撤：东南方向存在临时缺口】；不要写成【撤】东南方向存在临时缺口。',
    previousChapter ? `上一章承接：先接住“${previousChapter.title}”末尾的动作、伤势、选择或未解释线索，再推进本章。` : '开篇承接：没有上一章时，第一章要直接建立主角处境、目标、第一处阻碍和金手指规则边界。',
    oldSignals.length ? '旧章节卡写法字段已吸收为弱信号：' : '',
    ...oldSignals,
  ].filter(Boolean).join('\n');
}

function normalizeAuthorPersonaText(text = '') {
  return normalizeText(text).trim();
}

function extractAuthorPersonaFromBlueprint(text = '') {
  const normalized = normalizeText(text);
  const section = normalized.match(/###\s*作者人设[\s\S]*?(?=\n###\s*|$)/)?.[0] || '';
  return normalizeAuthorPersonaText(section.replace(/^###\s*作者人设\s*/i, '').trim());
}

function buildContinuityMemoryUpdate(chapters = [], startChapter = 1, previousMemory = '') {
  const latest = chapters.filter(Boolean).map((chapter, idx) => [
    `第${startChapter + idx}章：${chapter.title}`,
    `摘要：${chapter.summary || takeSummaryLine(chapter.content)}`,
    `章末：${normalizeText(chapter.content).slice(-360)}`,
  ].join('\n')).join('\n\n');
  return [
    previousMemory ? '上一轮连续性记忆：' : '',
    previousMemory || '',
    latest ? '最新生成章节记忆：' : '',
    latest,
    '后续写作提醒：承接最新章末动作和人物选择；追踪未解释系统提示、任务奖励、人物隐瞒、伤势/代价、关键物件；每章至少回应一个读者预期并保留下一步钩子；每10章检查角色口吻是否漂移。',
  ].filter(Boolean).join('\n\n').slice(-6000);
}

function buildPacingGuardText({ currentCount = 0, batchCount = 1, targetChapters = 600 }) {
  const start = currentCount + 1;
  const end = currentCount + batchCount;
  const progressPercent = Math.max(1, Math.ceil((end / Math.max(targetChapters, 1)) * 100));
  return [
    `当前只能写第${start}-${end}章，对应全书约前${progressPercent}%进度。`,
    '节奏红线：不得写出任何超过当前章节卡的蓝图阶段内容。',
    '不得提前进入后续卷高潮、终局主线、终局反派、最终秘密揭露、主角终局能力、后期大规模战争/审判/决战。',
    '如果蓝图后文有更大的冲突，本批只能埋伏笔、制造局部阻碍、让低阶代理人试探，不能直接兑现。',
    '每章只兑现章节卡写明的小目标，章末钩子只能指向下一小步，不能跳到几百章后的事件。',
  ].join('\n');
}

function getLatestCheckpointReport(automation = {}) {
  const reports = Array.isArray(automation.checkpointReports) ? automation.checkpointReports : [];
  return reports.at(-1)?.report || automation.checkpointReport || '';
}

function getCheckpointKind(chapterCount = 0) {
  const count = Number(chapterCount) || 0;
  if (count > 0 && count % checkpointIntervals.major === 0) return 'major';
  return 'standard';
}

function getCheckpointInterval(kind = 'standard') {
  return kind === 'major' ? checkpointIntervals.major : checkpointIntervals.standard;
}

function getCheckpointLabel(kind = 'standard') {
  return kind === 'major' ? '100章大阶段检查' : '20章一致性检查';
}

function getNextCheckpointInfo(chapterCount = 0) {
  const count = Number(chapterCount) || 0;
  const interval = count > 0 && (count + 1) % checkpointIntervals.major === 0
    ? checkpointIntervals.major
    : checkpointIntervals.standard;
  const remaining = count % interval === 0 ? interval : interval - (count % interval);
  return { interval, remaining };
}

function trimCheckpointReports(automation = {}, retentionCount = 20) {
  const count = Math.max(1, Number(retentionCount) || 20);
  const reports = Array.isArray(automation.checkpointReports) ? automation.checkpointReports : [];
  return reports.slice(-count);
}

function storeCheckpointReport(automation = {}, report = '', { kind = 'standard', chapterCount = 0 } = {}) {
  const retentionCount = Math.max(1, Number(automation.checkpointRetentionCount) || 20);
  const nextReports = trimCheckpointReports({ ...automation, checkpointReports: [...(automation.checkpointReports || []), { report: normalizeText(report), kind, chapterCount, createdAt: now() }] }, retentionCount);
  return {
    ...automation,
    checkpointReport: normalizeText(report),
    checkpointReports: nextReports,
    checkpointRetentionCount: retentionCount,
  };
}

async function generateCheckpointReportForProject({ db, projectIndex, project, apiKey, model, baseUrl, requestedKind = '' }) {
  const automation = project.automation || {};
  const writtenChapters = project.chapters.filter((chapter, chapterIndex) => !isBlankStarterChapter(chapter, chapterIndex));
  const currentCount = writtenChapters.length;
  const checkpointKind = normalizeText(requestedKind) === 'major' ? 'major' : getCheckpointKind(currentCount);
  const checkpointInterval = getCheckpointInterval(checkpointKind);
  const checkpointLabel = getCheckpointLabel(checkpointKind);
  const recentCards = (automation.chapterCards || []).slice(Math.max(0, currentCount - checkpointInterval), currentCount);
  const recentChapters = writtenChapters.slice(-checkpointInterval);
  const recentFullText = buildChapterRangeContext(writtenChapters, Math.max(1, currentCount - (checkpointKind === 'major' ? 10 : 5)), currentCount);
  const generationMode = automation.lightweightGeneration ? '轻量生成模式' : '单章质量模式';
  const majorReviewGuide = checkpointKind === 'major' ? [
    '这是100章大阶段检查，重点不是逐章挑错，而是判断长篇结构是否仍然健康。',
    '额外检查：主线是否偏离蓝图；当前卷是否拖沓或提前完成；角色成长是否停滞；伏笔是否长期拖欠；爽点/危机/转折密度是否下降；后续章节卡是否需要重排；分卷边界是否需要调整；蓝图是否需要写入阶段修正。',
    '报告最后必须输出【阶段建议】，并明确说明下面四个按钮是否需要点击：继续写、重排后续章节卡、重新自动分卷、保存检查建议到蓝图。不要只说“视情况”。',
  ].join('\n') : '报告最后必须输出【阶段建议】，说明是否可以直接继续写，是否需要先修订章节或重排章节卡。';

  const prompt = [
    `请生成${checkpointLabel}报告。这个报告服务后续自动写作，不是文学评论。`,
    `当前正文生成形态：${generationMode}；软件采用逐章生成、逐章保存，章节卡是剧情轨道，作者人设和最近正文是写法/口吻锚点。`,
    majorReviewGuide,
    automation.lightweightGeneration
      ? '轻量模式检查重点：不要因为缺少场景包/叙事拍就要求补流程；重点判断正文是否读起来像真人网文、是否承接章节卡、是否有开局危机/动作选择/章末钩子/能力或设定边界。'
      : '单章质量模式检查重点：允许有结构规划痕迹，但必须避免正文变成执行清单、分镜提纲或设定说明书。',
    '输出必须按以下标题组织：',
    checkpointKind === 'major'
      ? '1. 总体结论：继续 / 保存检查建议到蓝图 / 重排后续章节卡 / 重新自动分卷（选择最优先的一项，并给一句原因）。'
      : '1. 总体结论：继续 / 暂停修订 / 需要重排章节卡（三选一，并给一句原因）。',
    `2. 蓝图与章节卡执行：最近${checkpointInterval}章是否按蓝图阶段推进，哪些章节偏离或提前兑现。`,
    '3. 番茄读感：开局钩子、爽点兑现、危机密度、章末钩子、阅读顺滑度，指出最影响追读的3个问题。',
    '4. 真人写作感：是否有AI味、模板化排比、分镜提纲感、功能性喊话过多、能力/设定提示格式生硬；只列具体章节和可执行修法。',
    '5. 角色与口吻：主角吐槽、判断、害怕、行动是否稳定；重要配角是否口吻漂移。',
    '6. 伏笔与读者期待台账：列出新增、推进、回收、拖欠，标明下一阶段优先回应项。',
    checkpointKind === 'major'
      ? '7. 长篇结构复盘：判断卷结构、主线阶段、角色成长、商业爽点密度、后续章节卡和分卷边界是否需要调整。'
      : '7. 下一阶段写作指令：给后续5章的具体提醒，必须能直接喂给自动写作，不要泛泛建议。',
    checkpointKind === 'major'
      ? '8. 下一阶段写作指令：给后续10章的具体提醒，必须能直接喂给自动写作，不要泛泛建议。'
      : '',
    '最后单独输出【阶段建议】，逐项写明：1. 是否建议点击“继续写”；2. 是否建议点击“重排后续章节卡”；3. 是否建议点击“重新自动分卷”；4. 是否建议点击“保存检查建议到蓝图”。',
    buildVoiceDriftGuard(project),
    buildReaderExpectationGuide(),
    buildPlatformStrategyGuide(project, automation),
    buildAutomationMemoryGuide(project, automation),
    '长篇蓝图：',
    automation.masterPlan || '',
    buildAuthorPersonaGuide(automation.authorPersona),
    `最近${checkpointInterval}张章节卡（用于核对剧情轨道，不要按写法字段硬扣）：`,
    recentCards.map((card, cardIndex) => formatChapterCard(card, Math.max(1, currentCount - recentCards.length + 1) + cardIndex)).join('\n\n'),
    `最近${checkpointInterval}章摘要：`,
    ...recentChapters.map((chapter) => `${chapter.title}\n${chapter.summary}`),
    checkpointKind === 'major' ? '最近10章正文抽样（用于检查真人读感、系统格式、动作/对话自然度）：' : '最近5章正文抽样（用于检查真人读感、系统格式、动作/对话自然度）：',
    recentFullText,
    '角色资料：',
    project.characters.map((character) => `${character.name}/${character.role}/${character.goal}/${character.secret}`).join('\n'),
    '时间线：',
    project.timeline.map((item) => `${item.order}.${item.title} - ${item.impact}`).join('\n'),
  ].join('\n');

  const text = await callDeepSeek({ apiKey, model, baseUrl, temperature: 0.7, userPrompt: prompt });
  const nextProject = buildProjectPayload({
    ...project,
    automation: {
      ...automation,
      ...storeCheckpointReport(automation, text, { kind: checkpointKind, chapterCount: currentCount }),
      waitingForReview: true,
      lastCheckpointAt: currentCount,
      progressNotes: `已完成第 ${currentCount} 章${checkpointLabel}，等待用户确认`,
      status: 'checkpoint',
    },
  });
  db.projects[projectIndex] = nextProject;
  await writeDb(db);
  return { text, project: nextProject, kind: checkpointKind, label: checkpointLabel };
}

function serializeGeneratedChapters(chapters = [], startChapter = 1) {
  return chapters.map((chapter, idx) => [
    `### 第${startChapter + idx}章 ${stripChapterNumber(chapter.title) || '新章节'}`,
    `摘要：${chapter.summary || ''}`,
    '正文：',
    chapter.content || '',
  ].join('\n')).join('\n\n');
}

function normalizeVolumeOutput(text) {
  return normalizeText(text)
    .replace(/\r\n/g, '\n')
    .replace(/([^\n])\s*(?:\/\s*)?(定位[:：])/g, '$1\n$2')
    .replace(/([^\n])\s*(?:\/\s*)?(目标[:：])/g, '$1\n$2')
    .replace(/([^\n])\s*(?:\/\s*)?(卷末钩子[:：])/g, '$1\n$2')
    .replace(/(?:^|\n)\s*(?:#{1,6}\s*)?(第\s*[一二三四五六七八九十百千万两〇零\d]+\s*卷[^\n]*)/g, '\n### $1')
    .replace(/(?:^|\n)\s*(?:#{1,6}\s*)?(卷\s*[一二三四五六七八九十百千万两〇零\d]+[：:、.\s][^\n]*)/g, '\n### $1')
    .replace(/^\n+/, '')
    .trim();
}

function extractVolumeSections(text) {
  const normalized = normalizeVolumeOutput(text);
  const sections = normalized
    .split(/\n(?=###\s*(?:第\s*[一二三四五六七八九十百千万两〇零\d]+\s*卷|卷\s*[一二三四五六七八九十百千万两〇零\d]+))/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (sections.length > 1) return sections;

  return normalized
    .split(/\n(?=###\s+)/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function takeSummaryLine(value = '') {
  const cleaned = normalizeText(value)
    .replace(/(?:章节正文|正文|内容)[:：][\s\S]*$/g, '')
    .trim();
  const firstLine = cleaned.split('\n').map((line) => line.trim()).filter(Boolean)[0] || '';
  const firstSentence = firstLine.match(/^.{1,240}?[。！？!?]/)?.[0] || firstLine.slice(0, 240);
  return firstSentence.trim();
}

function buildChapterSummaryFromContent(content = '') {
  const cleaned = normalizeText(content)
    .replace(/(?:章节正文|正文|内容)[:：][\s\S]*$/g, '')
    .split('\n')
    .filter((line) => !isChapterMetadataLine(line))
    .join(' ')
    .trim();
  if (!cleaned) return '';

  const sentences = cleaned
    .split(/[。！？!?\n]/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const leadSentences = sentences.slice(0, 3);
  const lead = leadSentences.join('。').trim();
  const keyEvent = sentences.find((sentence, index) => index >= 1 && /任务|系统|发现|决定|冲突|到达|离开|确认|暴露|接到|看见|听见|知道|拿到|触发|警告|通知|线索|选择|暴露|反转/.test(sentence))
    || sentences.find((sentence) => sentence.length > 18)
    || '';
  const summarySentences = [...leadSentences];
  if (keyEvent && !summarySentences.includes(keyEvent)) summarySentences.push(keyEvent);
  const summary = summarySentences
    .filter(Boolean)
    .reduce((parts, part) => {
      if (!parts.includes(part)) parts.push(part);
      return parts;
    }, [])
    .join('。')
    .replace(/。+/g, '。')
    .replace(/[。]+$/, '');

  return (summary || takeSummaryLine(cleaned)).slice(0, 260);
}

function buildPlotSummaryFromContent(content = '') {
  const cleaned = normalizeText(content)
    .split('\n')
    .filter((line) => !isChapterMetadataLine(line))
    .join(' ')
    .trim();
  if (!cleaned) return '';

  const actor = cleaned.match(/(魏杰|阿米娅|博士|主角|她|他)/)?.[1] || '主角';
  if (/信标器|黄光|绿灯|基站|铭牌|07|协议|保温杯|戒指|入口|台阶/.test(cleaned)) {
    const parts = [];
    if (/信标器|黄光|绿灯/.test(cleaned)) parts.push('沿信标器指引继续前进');
    if (/阿米娅|戒指|渴|水壶/.test(cleaned)) parts.push('察觉阿米娅体力和戒指异常');
    if (/基站|铭牌|07|入口|台阶/.test(cleaned)) parts.push('抵达野外基站-07入口');
    if (/协议|保温杯|K|门可以开|石板缝隙/.test(cleaned)) parts.push('发现K留下的协议提示');
    if (parts.length >= 3) {
      return `${actor}${parts[0]}，${parts[1]}；随后${parts.slice(2).join('，')}。`.slice(0, 120);
    }
    if (parts.length >= 2) return `${actor}${parts.join('，')}。`.slice(0, 120);
  }

  const eventWords = [...cleaned.matchAll(/[^。！？!?]{0,28}(?:到达|抵达|发现|确认|进入|决定|触发|暴露|失效|遇到|交付|拿到|听见|看见|找到|离开|撤离|打开|关掉|放回|选择|提示|显现|亮起|变成|恢复)[^。！？!?]{0,46}/g)]
    .map((match) => match[0].trim())
    .filter((item) => item.length >= 8 && !/不是|没有|像|仿佛|一瞬|光线|颜色|温度残留|指腹|边缘/.test(item));
  const uniqueEvents = eventWords.reduce((parts, event) => {
    if (!parts.some((item) => item.includes(event) || event.includes(item))) parts.push(event);
    return parts;
  }, []).slice(0, 3);
  if (uniqueEvents.length) {
    const summary = `${actor}${uniqueEvents.join('，并')}`
      .replace(/\s+/g, '')
      .replace(new RegExp(`^${actor}${actor}`), actor)
      .replace(/[，。！？!?]+$/g, '');
    if (summary.length >= 18) return `${summary}。`.slice(0, 120);
  }
  return buildChapterSummaryFromContent(cleaned).slice(0, 120);
}

function isBodyLikeSummary(summary = '', content = '') {
  const cleaned = normalizeText(summary).trim();
  if (!cleaned) return true;
  const contentLead = normalizeText(content).replace(/\s+/g, '').slice(0, 160);
  const summaryLead = cleaned.replace(/\s+/g, '').slice(0, 120);
  const overlap = summaryLead.length >= 24 && contentLead.includes(summaryLead.slice(0, Math.min(48, summaryLead.length)));
  const sentenceCount = (cleaned.match(/[。！？!?]/g) || []).length;
  const hasPlotVerb = /到达|抵达|发现|确认|进入|决定|触发|暴露|失效|遇到|交付|拿到|听见|看见|找到|离开|撤离|打开|选择/.test(cleaned);
  const hasBodyTexture = /不是|没有|仿佛|像|一瞬|绿灯|黄光|指腹|温热|光线|颜色|影子|边缘|形状|轮廓|滴|疼|痛|呼吸/.test(cleaned);
  const bodyTextureCount = (cleaned.match(/不是|没有|仿佛|像|一瞬|绿灯|黄光|指腹|温热|光线|颜色|影子|边缘|形状|轮廓|滴|疼|痛|呼吸/g) || []).length;
  return (overlap && (!hasPlotVerb || cleaned.length > 90)) || cleaned.length > 120 || sentenceCount >= 4 || (bodyTextureCount >= 3 && !hasPlotVerb) || (/不是[^。！？]{1,50}[—-]{1,2}|绿灯|黄光/.test(cleaned) && !hasPlotVerb);
}

function normalizeChapterSummary(summary = '', content = '') {
  const cleaned = normalizeText(summary)
    .replace(/(?:本章正文|章节正文|正文内容|章节内容|正文|内容)[:：][\s\S]*$/g, '')
    .replace(/(?:关键钩子|章末钩子|钩子|悬念)[:：][\s\S]*$/g, '')
    .trim();

  if (!cleaned) {
    return buildPlotSummaryFromContent(content || summary);
  }

  const sentenceCount = (cleaned.match(/[。！？!?]/g) || []).length;
  if (cleaned.length > 260 || sentenceCount >= 4 || isBodyLikeSummary(cleaned, content)) {
    const compact = buildPlotSummaryFromContent(content || cleaned);
    if (compact) return compact;
  }

  return cleaned.slice(0, 260);
}

function isUsefulCardSummary(summary = '') {
  const cleaned = normalizeText(summary).trim();
  if (cleaned.length < 18 || cleaned.length > 700) return false;
  if (/并(?:我|魏杰|阿米娅|博士|主角|他|她|ACE|[A-Z]{2,}|”|“)|(?:魏杰|阿米娅|博士|主角|他|她)”(?:魏杰|阿米娅|博士|主角|他|她|ACE)/.test(cleaned)) return false;
  if (/手指|指甲|小爪子|触感|草叶|光线|味道/.test(cleaned) && !/救下|遇到|决定|进入|抵达|触发|逃离|获得/.test(cleaned)) return false;
  if (/只能看见|视线刚|听着年龄|咳得更厉害|门把|门板|脸色|指节|后颈/.test(cleaned) && !/救下|遇到|决定|进入|抵达|触发|逃离|获得|确认|制造|得到/.test(cleaned)) return false;
  if (/承接(?:上一章|上章)?|继续推进|推进主线|留下钩子|本阶段主线|局部冲突/.test(cleaned) && !/发现|确认|遇到|决定|进入|抵达|触发|听见|看见|找到|获得|救下|逃离|选择/.test(cleaned)) return false;
  return true;
}

function resolveStoredChapterSummary(card = {}, content = '') {
  const cardSummary = [card.summary, card.chapterResult, card.chapterGoal, card.coreEvent]
    .map((item) => cleanCardFieldText(item || '').slice(0, 360))
    .find((item) => isUsefulCardSummary(item)) || '';
  if (cardSummary) return cardSummary;
  const derived = buildPlotSummaryFromContent(content);
  return cleanCardFieldText(derived).slice(0, 360);
}

function hasPacingRisk(chapters = [], cards = []) {
  const text = chapters.map((chapter) => `${chapter.title}\n${chapter.summary}\n${chapter.content}`).join('\n');
  return /终局|最终|决战|大结局|后期|几百章|最终秘密|终局反派|最终反派|后续卷高潮|跨越式|提前/.test(text);
}

function parseVolumeSection(section, index) {
  const normalized = normalizeVolumeOutput(section);
  const rawTitle = normalized.match(/^###\s*(.+?)(?:\n|$)/)?.[1]?.trim() || `第${index + 1}卷`;
  const title = rawTitle
    .replace(/^卷\s*([一二三四五六七八九十百千万两〇零\d]+)[：:、.\s]*/, '第$1卷 ')
    .replace(/\s*\/.*$/, '')
    .trim();

  return createVolume({
    title: title || `第${index + 1}卷`,
    positioning: extractLabeledField(normalized, ['定位', '卷定位'], ['目标', '卷目标', '卷末钩子', '钩子']) || '',
    goal: extractLabeledField(normalized, ['目标', '卷目标'], ['卷末钩子', '钩子']) || '',
    endingHook: extractLabeledField(normalized, ['卷末钩子', '钩子'], ['###']) || '',
  });
}

function normalizeChapterOutput(text) {
  return normalizeText(text)
    .replace(/\r\n/g, '\n')
    .replace(/([^\n])\s*(?:\/\s*)?((?:本章标题|章节标题|标题)[:：])/g, '$1\n$2')
    .replace(/([^\n])\s*(?:\/\s*)?((?:本章摘要|章节摘要|摘要|简介)[:：])/g, '$1\n$2')
    .replace(/([^\n])\s*(?:\/\s*)?((?:关键钩子|章末钩子|钩子|悬念)[:：])/g, '$1\n$2')
    .replace(/([^\n])\s*(?:\/\s*)?((?:本章正文|章节正文|正文内容|章节内容|正文)[:：])/g, '$1\n$2')
    .replace(/(?:^|\n)\s*(?:#{1,6}\s*)?(第\s*[一二三四五六七八九十百千万两〇零\d]+\s*章[^\n]*)/g, '\n### $1')
    .replace(/^\n+/, '')
    .trim();
}

function buildAntiTemplateStyleGuide() {
  return [
    '反模板写作要求：',
    '1. 场景切换不能写成“推开门/下车/走进去 + 身体状态 + 解释原因”的平铺模板；必须先给一个具体感官锚点，如灯光、气味、温度、旧伤牵扯、手上动作、地面声音，再自然带出人物状态。',
    '2. 对话不能连续使用“命令-抗议-驳回”“他说/她说+解释”的机械节奏；关键对话要插入停顿、未说完的话、动作打断、视线变化、人物没有解释的留白。',
    '3. 禁用高频情绪套话：后背一凉、心头一紧、心跳漏了一拍、瞳孔一缩、深吸一口气、握紧拳头、空气凝固、如坠冰窟、他知道、她明白、这一刻、命运齿轮、事情越来越复杂、暗流涌动。需要恐惧、迟疑、震惊时，用具体身体反应替代，如手指停住、喉结动了动、呼吸慢半拍、指腹按皱纸面、视线停在某个词上。',
    '4. 段落节奏必须有快慢变化：信息抛出前可短暂停顿，紧张处短段推进，说明性信息不要连续超过2段；每次解释前先让人物做一个具体动作或产生可见反应。',
    '5. 系统提示要完整但不打断阅读：关键剧情节点可以出现“【新任务】/【奖励】/【提示】”等完整面板，用来制造爽点、目标感和网文游戏感；面板应独立成短块，通常控制在3-5行，每行只放一个有效信息，如任务名、目标、奖励、限制、提示。面板前后必须有人物动作或选择承接，让系统信息推动剧情，而不是像说明书一样悬空罗列。普通推进可用视野边缘短讯、界面异常、残缺关键词补充信息，避免每次都弹完整面板。',
    '6. 不要用旁白替读者总结情绪或意义；让读者从动作、对话、物件和后果里读出来。',
    '7. 时空锚点不得机械重复：不要连续多章用“早晨/凌晨/几点 + 地点/载具/房间 + 主角动作”开头；精确到分钟的时间只能在倒计时、任务窗口、夜袭、交接班、迟到等剧情压力存在时使用。',
    '8. 章节开头要有叙事变化：可用冲突切入、对话切入、结果切入、物件切入、感官切入、误导式判断、插叙、倒叙、延迟交代或并行叙事，但必须服务本章冲突，不得为炫技打乱主线。',
  ].join('\n');
}

function buildNoMetaNarrationGuide() {
  return [
    '正文元叙事禁令：',
    '1. 正文里绝对禁止出现面向作者/系统/章节规划的说法，例如“第29章开始”“上一章里”“前几章提到”“前文说过”“本章要写”“后续章节”“章节卡”“蓝图”“读者应该知道”。',
    '2. 角色只能根据剧情内可见的信息、记忆、物件、对话和当前事件进行思考，不能知道章节编号，也不能用章节编号回忆过去。',
    '3. 需要表达“很早之前就开始怀疑”时，必须改成剧情内时间或事件锚点，例如“从拿到那枚徽章起”“从仓库门口那次异常开始”“从丽达第一次避开他的视线起”。',
    '4. 需要承接上一章时，只写动作、情绪、场景和后果承接，不许写“上一章/前一章/前文”。',
    '5. 任何“第X章”只能出现在标题行，不得出现在摘要和正文里。',
    '6. 物品、伤势、线索的来源必须写成“之前顺手塞进兜里/先前捡到/刚才留下”，绝对不能写“第5章顺手塞进兜里”“上一章拿到”。',
  ].join('\n');
}

function buildNaturalReadingGuard() {
  return [
    '自然阅读感守门：',
    '1. 正文禁止 Markdown 痕迹：不得出现 **、__、###、```、项目符号列表、加粗/斜体标记；系统面板只能用中文方括号，不得加星号或 Markdown 强调。',
    '2. 限制短句排比和否定排除式判断：不得连续三行使用8字以内短句制造伪冲击；不要用否定开头来制造观察、推理、反转或强调。整章除非人物台词或必要辨析，否定转折判断句最多使用1次。',
    '3. 减少解释型心理：少写“他知道/他明白/他意识到/这意味着”，优先用动作、物件、表情、停顿和后果让读者自己读出来。',
    '4. 降低战术总结口吻：可以有计划和判断，但不能把主角写成永远冷静的方案机器；允许疲惫、误判、改口、吐槽、被打断和临场犹豫。',
    '5. 对话要有少量非功能性自然杂质：允许噎人、误解、半句吐槽、答非所问、沉默和关系里的小刺，不能每句都只负责发任务或解释设定。',
    '6. 生活/环境杂质只在低压过渡段少量使用；高压、逃生、调查推进段不要为了“真实感”额外补细节。细节应由动作触发，并改变下一步行动、风险或判断。',
    '6a. 动作章不要省成分镜提纲；根据场景需要补足必要过渡、身体反馈或环境后果，让读者看清角色如何从一个动作进入下一个动作。不是每个动作都要解释，关键转折和受阻处要写清。',
    '7. 章末钩子必须具体化，禁止模板句“真正的危险才刚刚开始”“事情远没有结束”“他不知道的是”；用物件、消息、动作或结果制造钩子。',
    '8. 不要每章都信息完整闭环；允许人物没说完、细节暂时没人注意、主角判断错一半、读者知道一点但角色不知道。',
  ].join('\n');
}

function buildSyntaxBudgetGuard() {
  return [
    '句式预算与强判断降权：',
    '1. 否定排除式判断只在人物自然辨析或台词反驳时少量使用；不要把普通观察写成“不是A，而是B”的作者判断。',
    '2. 非台词里的“不是/没有”可以存在，但只能服务误判、排除风险或人物口吻；如果一页里连续出现，就改成动作反馈或现场结果。全章“不是”尽量低于8次，机械否定揭示尽量低于3次，每800字不要超过2处。',
    '3. 否定转折判断不做硬性归零；章首、章末和关键转折处优先用正向动作、物件变化或对话后果承担信息。',
    '4. 破折号优先用于动作打断、声音打断或系统面板接入，少用来承接作者定义解释或反转揭示。',
    '5. 连续短句强调只在强情绪、危险逼近或对话打断处少量使用；不要整段都靠短句冒充张力。',
    '6. “说明/意味着/代表/不是推测/他知道/他意识到/他明白”这类解释性判断总数最多1次；优先让读者从现场变化和人物选择里理解。',
    '7. 不要追求每段都有金句、反转或作者判断；紧张感来自连续动作、信息差、物件变化、环境压力和人物选择，不来自旁白替读者下结论。',
    '8. 每800字尽量有一处动作链、阻碍反馈或人物反应，确保章节读起来像现场推进，而不是判断句或物件档案堆叠。',
  ].join('\n');
}

function buildPositiveDraftingSkeletonGuide(card = {}) {
  const mode = getNarrativeTextureMode(card);
  const text = getNarrativeTextureInput(card);
  const slots = ['承接上一状态：用身体反应、现场反馈或上一动作后果开场，不报时间地点。'];
  if (mode.primary === 'action_pressure' || /醒来|逃生|撤离|追逐|门外|脚步|危险|逼近|破门/.test(text)) {
    slots.push('确认身体和当前目标：疼痛、眩晕、失衡只影响一个动作。');
    slots.push('第一次尝试行动：坐起、找出口、试通讯或移动，必须遇到具体阻碍。');
    slots.push('风险逼近：声音、门、信号或环境变化压缩选择。');
  }
  if (mode.primary === 'investigation' || /调查|线索|金属瓶|模块|通讯|纸条|系统|异常|存档/.test(text)) {
    slots.push('一个主物件改变行动：通讯失败、模块发热、纸条指向或系统异常，别补全档案。');
    slots.push('复核或误判一次：角色根据当前可见信息做小判断，然后马上改变动作。');
  }
  if (mode.primary === 'investigation' || /调查|线索|编号|模块|铭牌|协议|基站|信标|戒指|痕迹|入口|07|K-|SUB-/.test(text)) {
    slots.push('调查线索章专用：每个线索只给一个异常点，人物判断必须立刻导致触摸、收起、绕路、进入或停下。');
    slots.push('调查线索章专用：避免鉴定报告式细节；编号、铭牌、协议、模块只写功能信息或异常信息二选一。');
    slots.push('调查线索章专用：普通观察不要写成“不是A，而是B”；优先写现场证据和下一步动作，例如“撬痕还新，他沿倒塌方向看过去”。');
    slots.push('调查线索章专用：黄光、戒指、铭牌、07、K、入口这类关键异常后必须有一个轻反应桥：停半拍、重新确认、伸手触碰、短问一句或改变路线，然后再继续行动。');
  }
  if (mode.primary === 'dialogue_conflict' || isHighDialogueChapter(card)) {
    slots.push('对话推进信息差：每轮台词造成让步、回避、打断或关系变化。');
  }
  if (mode.primary === 'relationship') slots.push('关系错位：沉默、避开视线或没接话改变下一步选择。');
  if (mode.primary === 'emotional_interior' || /失忆|记忆|创伤|梦|闪回|困惑/.test(text)) slots.push('短心理或记忆：由动作/物件/声音触发，1-2句后回到当前。');
  slots.push('中段推进：每段只围绕一个目标，按“目标 → 动作 → 反馈 → 新选择”写。');
  slots.push('章末压力：留下一个具体未解决动作、声音、信号或路线选择。');
  const uniqueSlots = [...new Set(slots)].slice(0, 11);
  return [
    '正向写作骨架（写作前静默使用，正文不要输出）：',
    '优先按段落槽位写，不靠禁令自检驱动正文。每个槽位只解决一个问题，物件信息跟随动作出现。',
    ...uniqueSlots.map((slot, idx) => `${idx + 1}. ${slot}`),
    '硬错误只包括：POV错位、Markdown/元叙事、章节越界、静态房间清单。句式问题只在密度高或破坏阅读时再修。',
  ].join('\n');
}

promptComposer = createPromptComposer({
  buildPositiveDraftingSkeletonGuide,
});

function buildSentenceRhythmGuard() {
  return [
    '句子节奏与动作链要求：',
    '1. 移动端短段不等于碎句；同一个连续动作链尽量合并成1-2句，不要每个小动作都单独成句。',
    '2. 禁止频繁用孤立短句制造镜头感，例如“没动。”“空的。”“安静。”“停住。”“不对。”“够了。”；这类短句只能在强情绪或关键停顿处少量使用。',
    '3. 一段里如果都是同一人物连续动作，不要连续三句都以“他/她/魏杰/阿米娅 + 动词”开头；可以合并动作、加入物件反馈或环境反应。',
    '4. 避免“动作。反馈。再动作。判断。”的脚本式节奏；动作和反馈应自然连在一起，让读者顺着动作读下去。',
    '5. 破折号不要承担“揭示这是什么”的解释功能，尤其避免“——是铁”“——是某种东西”“——说明...”这类旁白判断。',
    '6. 句子要优先逻辑通顺、自然，而不是机械拆短。遇到逗号堆叠句，优先压缩修顺：保留清晰主干 + 一个有效细节，删掉重复状态和多余补丁；实在绕口时再拆成2句。',
    '7. 细节句必须有清晰主干：谁/什么 + 做了什么/发生什么变化。可以保留一个顺畅的比喻，但不要把位置、材质、颜色、原因、结果、比喻连续塞满。',
    '8. 物件细节不要写得像静物说明书。比如污渍、泥土、反光、碎屑等，只保留能推动人物状态或动作的一处，让它自然挂在动作或观察上。',
    '9. 观察句不能写成现场勘查报告：不要先报物体、再补位置、再补状态、再补颜色形状。用一个动作或变化把原因、状态、结果串起来。',
    '10. 避免“某物的位置/边缘/颜色/形状”当主语。能直接写物件，就不要绕成位置主语；能写“碎片透光”，就不要写“碎片的位置反射出光形”。',
    '11. 场景描写要有主次，不要连续扫描灯、床、担架、水杯、纸条等清单。每次只抓一个和人物当下动作、痛感、目标有关的细节。',
    '12. 禁止同一句平权罗列三个身体/环境细节，例如“后背贴墙，手指握刀，指甲掐掌心”“转椅倒地，镜子碎裂，柜台倒地”。改成“主动作 + 一个有效细节 + 一个后果/选择”。',
  ].join('\n');
}

function buildActionChainNarrationGuard() {
  return [
    '行动链叙事骨架：',
    '1. 正文先按“当前目标 → 人物动作 → 现场反馈 → 新阻碍/新选择”推进，再把描写嵌进去；不要先扫描场景资产再解释意义。',
    '2. 每个段落至少要能回答一个问题：角色此刻想解决什么？他做了什么？这个动作带来了什么反馈？如果只是介绍物件，就删掉或并入动作。',
    '3. 不要按固定频率投喂细节。每300-500字需要的是目标推进或选择变化，不是定时插入物件描写。',
    '4. 每个物件优先只承载一个核心有效信息：要么改变行动，要么增加风险，要么触发短记忆，要么埋一个异常点。关键伏笔物件可以多给一处异常，但不要写成形状、位置、材质、字迹、背面、签名、日期齐全的完整档案。',
    '4-0. 每个动作节点优先只带一个身体细节或环境细节；细节应改变下一动作、风险或判断。不要用三连并列补画面。',
    '4a. 环境不是清单。不要写“一个临时医疗点。行军床、担架、药品柜、脚印、气味……”这种名词平铺；必须让人物扶住、碰到、绕开或利用其中一个东西，再顺带带出环境判断。',
    '4b. 动作后面不能突然接无关静态清单。人物坐起、站起、按额头、走到门边之后，下一句必须承接疼痛、重心、手上动作、目标或阻碍；不要跳去平权罗列灯、床、柜、门、箱子、屏幕。',
    '4c. 逻辑顺序优先：身体动作造成注意力，注意力带出一个环境信息，环境信息改变下一步行动。不能“坐起来。灯怎样。床怎样。柜怎样。外套怎样。”',
    '5. 受伤醒来类章节，注意力顺序应是身体疼痛/手中物件/安全风险/通讯或出口/必要物资；不要让主角像摄像机一样平等检查灯、床、柜、窗、靴子、纸条、标签。',
    '6. 细节保留规则：只有当细节改变人物动作、暴露风险、形成选择、触发短记忆或成为后续伏笔时才写；其余颜色、形状、材质、位置、缺失字段和说明性补丁直接省略。',
    '6a. 道具不是档案卡。纸条、通讯器、模块、证件、地图这类物件，不要检查背面、签名、日期、型号、材质、接口等多个字段；当前行动只需要哪一个信息，就只写哪一个。',
    '6b. 模块和通讯器尤其要克制：通讯器只写“能否联系上”；模块只写“熟悉感/异常提示/温度变化”三选一，不能同时写外形、接口、材质、按钮、标识、重量。',
    '7. 紧张感来自行动受阻和选择变窄，不来自“血。”“密封的。”“没有声音。”这类标签短句，也不来自连续否定判断。',
    '8. 修订时可以在不改变剧情的前提下重排段落顺序，让物件信息跟随人物行动出现；不要只做同义词替换。',
  ].join('\n');
}

function buildLowDramaDraftingGuard() {
  return [
    '低戏剧化初稿要求：',
    '1. 自动写作优先产出稳定、朴素、可连载的初稿，不追求电影感、金句感、强冲击、强反转或每段一个钩子。',
    '2. 不要为了制造“镜头感”频繁下判断；观察结果先落在现场物件、动作后果、人物反应上。',
    '3. 章节张力来自当前目标受阻、路线变化、人物选择和信息差，不来自旁白的否定排除式强调。',
    '4. 章末只留下一个具体未解决动作或物件信号，不要用作者口吻拔高危险、命运、真正答案或更大秘密。',
    '5. 宁可少一点炫技，也要让正文像人在现场连续经历事情；不要把普通观察写成推理宣判。',
  ].join('\n');
}

function buildHumanTextureGuide(project = {}) {
  const characters = (project.characters || []).slice(0, 8);
  return [
    '人味与情绪杂质要求：',
    '1. 每章优先让主角或关键角色出现一处具体身体不适、疲惫、疼痛、冷、热、眩晕、呛咳、手抖、旧伤牵扯或衣物装备带来的不便；应尽量嵌在动作里，不要单独总结。',
    '2. 每章最多允许一处很短的非线性记忆碎片：由气味、声音、触感或一句话触发，控制在1-2句内，必须立刻回到当前动作；不要为了触发记忆扩写物件档案。',
    '3. 对话不要总是信息对齐：允许答非所问、被打断、误解、半句吞回去、先做动作再回答、角色故意不解释。',
    '4. 人物反应要符合角色资料和作者人设：谨慎的人先试探，疲惫的人少解释，强撑的人嘴硬但动作露怯，信任未建立时不要过分顺滑配合。',
    '5. 情绪不要写成整齐总结；让情绪混进小动作、错开的回答、手上失误、呼吸变化、身体不适和对物件的处理里。',
    '6. 不要把普通发现写成孤立标签短句；如果要写一个发现，尽量让人物先碰到、看见、听见或误判一下。',
    characters.length ? '本章可参考角色资料：' : '',
    ...characters.map((character) => `${character.name}/${character.role}：目标=${character.goal || '未填'}；秘密=${character.secret || '未填'}；性格=${character.traits || '未填'}；弧光=${character.arc || '未填'}`),
  ].filter(Boolean).join('\n');
}

function isHighDialogueChapter(card = {}) {
  const text = [
    card.title,
    card.summary,
    card.hook,
    card.allowedBeats,
    card.forbiddenBeats,
    card.readerExpectation,
    card.narrativePurpose,
    card.openAction,
    card.foreshadowing,
  ].map(normalizeText).join('\n');
  return /对话密度\s*[=:：]?\s*(?:high|高|中高|[4-9]\d\s*%)|dialogue_conflict|谈判|审问|盘问|争吵|吵架|坦白|摊牌|和解|告别|汇报|会议|对峙|试探|套话|质问|逼问|辩论|拉扯|情感爆发|误会|解释清楚|交换情报|交易|招供|审讯|说服|劝说|道歉|翻脸/.test(text);
}

function buildDialogueSceneGuide({ project = {}, card = {} } = {}) {
  if (!isHighDialogueChapter(card)) {
    return [
      '对话节奏要求：',
      '本章不是高对话章节时，对话只在角色选择、关系变化、误解或信息确认处出现；不要把所有设定都改成对话说明。',
    ].join('\n');
  }

  const characters = (project.characters || []).slice(0, 8);
  return [
    '高对话章节预算：',
    '1. 本章属于高对话章节，对话应占正文约45%-70%，至少6轮有效来回；不要写成两三句交代后立刻转动作戏。',
    '2. 每轮对话必须承担不同功能：试探、回避、误解、逼问、让步、沉默、转移话题、情绪外泄、关系变化或信息交换，不能每句都只回答上一个问题。',
    '3. 对话中穿插动作、身体反应和环境干扰：端杯子、避开视线、手停住、被门外声音打断、说到一半改口、因为疼痛或疲惫省略句子。',
    '4. 角色说话要符合角色卡和当时情绪；不能所有人都理性、完整、礼貌地解释设定。',
    '5. 对话不能完全信息对齐：允许一方不接问题、故意误会、答非所问、沉默几秒、先处理眼前物件再回答。',
    '6. 结尾应由对话造成一个具体后果：关系松动、暂时合作、拒绝、暴露破绽、交出物件、改路线或留下未说完的话。',
    characters.length ? '角色说话参考：' : '',
    ...characters.map((character) => `${character.name}/${character.role}：目标=${character.goal || '未填'}；秘密=${character.secret || '未填'}；性格=${character.traits || '未填'}；弧光=${character.arc || '未填'}`),
  ].filter(Boolean).join('\n');
}

const narrativeTextureModes = {
  action_pressure: {
    label: '高压行动',
    budget: '小说感约55%，电影感约45%；章末最后100-200字可接近各半',
    keywords: /逃生|追逐|战斗|爆炸|坍塌|伏击|夜袭|灾难|突袭|围攻|撤离|奔逃|枪战|刀|怪物|追杀|失控|倒计时|潜入|营救|围堵|破门|塌方|封锁/,
    focus: '提高画面调度，但每个画面都要绑定人物动作、身体反应或选择压力。',
  },
  dialogue_conflict: {
    label: '对话冲突',
    budget: '小说感约75%，电影感约25%',
    keywords: /审问|谈判|争吵|吵架|坦白|摊牌|对峙|试探|会议|交易|劝说|道歉|告别|套话|质问|逼问|辩论|拉扯|情感爆发|误会|解释清楚|交换情报|招供|审讯|说服|翻脸/,
    focus: '重点写语气、停顿、误解、回避、打断、身体小动作和关系变化；电影感只用于压迫性的空间和声音。',
  },
  investigation: {
    label: '调查推理',
    budget: '小说感约70%，电影感约30%',
    keywords: /调查|搜证|线索|跟踪|勘查|破解|推理|信息收集|查证|监控|档案|痕迹|证物|现场|盘查|定位|追踪|分析|比对/,
    focus: '重点写人物如何误判、复核、触摸物件和串联线索；不要用旁白直接宣判答案。',
  },
  emotional_interior: {
    label: '内心创伤',
    budget: '小说感约85%，电影感约15%',
    keywords: /心理|崩溃|愧疚|恐惧|创伤|梦境|回忆|失控|旧伤|后悔|羞耻|噩梦|幻觉|记忆|闪回|自责|害怕|麻木/,
    focus: '重点写身体化情绪、碎片记忆和自我回避；电影感只作为触发记忆的感官锚点。',
  },
  relationship: {
    label: '关系变化',
    budget: '小说感约80%，电影感约20%',
    keywords: /暧昧|信任|背叛|保护|亲情|友情|师徒|同伴|关系|试探|隐瞒|和解|疏远|靠近|告白|吃醋|承诺|托付/,
    focus: '重点写话没说满、动作先暴露态度、关系里的错位和迟疑；不要把情感总结成口号。',
  },
  daily_recovery: {
    label: '日常修整',
    budget: '小说感约85%，电影感约15%',
    keywords: /修整|养伤|日常|训练|吃饭|赶路|整理物资|休息|换药|洗澡|睡觉|买东西|收拾|补给|恢复|闲聊/,
    focus: '重点写生活杂质、身体恢复、关系小刺和下一步准备；不要强行制造大场面。',
  },
  worldbuilding: {
    label: '设定承载',
    budget: '小说感约75%，电影感约25%；设定必须人物化承载',
    keywords: /设定|历史|组织|规则|系统说明|地图|势力|等级|制度|城市|宗门|公司|技术|源石|能力说明|背景|世界观|档案/,
    focus: '设定必须通过人物目标、冲突、物件和代价呈现；避免连续说明书。',
  },
  reveal_twist: {
    label: '揭露反转',
    budget: '小说感约50%，电影感约50%',
    keywords: /反转|揭露|真相|身份暴露|线索回收|章末爆点|秘密揭开|背叛揭穿|发现真相|证实|认出|曝光|反咬|隐藏身份/,
    focus: '可以提高画面和停顿，但反转要落到人物反应和选择后果上，不要只写金句。',
  },
  transition_setup: {
    label: '过渡铺垫',
    budget: '小说感约70%，电影感约30%',
    keywords: /过渡|铺垫|赶路|换场|准备行动|布置计划|出发|抵达|等待|安排|交接|转场|路上|集合/,
    focus: '重点写准备动作、未完成情绪和小伏笔；避免水段和纯说明。',
  },
};

function getNarrativeTextureInput(card = {}) {
  return [
    card.title,
    card.summary,
    card.hook,
    card.allowedBeats,
    card.forbiddenBeats,
    card.readerExpectation,
    card.narrativePurpose,
    card.openingType,
    card.openAction,
    card.foreshadowing,
    card.paceStage,
  ].map(normalizeText).join('\n');
}

function scoreNarrativeTextureModes(card = {}) {
  const text = [
    card.title,
    card.summary,
    card.allowedBeats,
    card.readerExpectation,
    card.narrativePurpose,
  ].map(normalizeText).join('\n');
  const fullText = getNarrativeTextureInput(card);
  const scores = Object.fromEntries(Object.keys(narrativeTextureModes).map((mode) => [mode, 0]));
  Object.entries(narrativeTextureModes).forEach(([mode, config]) => {
    const matches = fullText.match(new RegExp(config.keywords.source, 'g')) || [];
    const modeWeight = mode === 'worldbuilding' ? 1 : 2;
    scores[mode] += matches.length * modeWeight;
    const strongMatches = text.match(new RegExp(config.keywords.source, 'g')) || [];
    scores[mode] += mode === 'worldbuilding' ? Math.floor(strongMatches.length / 2) : strongMatches.length;
    if (new RegExp(`主功能\\s*[=＝:]\\s*${mode}`).test(fullText)) scores[mode] += 12;
    if (new RegExp(`副功能\\s*[=＝:]\\s*${mode}`).test(fullText)) scores[mode] += 8;
    if (new RegExp(`\\b${mode}\\b`).test(fullText)) scores[mode] += 4;
  });
  if (card.openingType === 'dialogue') scores.dialogue_conflict += 3;
  if (card.openingType === 'action' || card.openingType === 'conflict') scores.action_pressure += 2;
  if (card.openingType === 'object') scores.investigation += 1;
  if (/flashback|fragment|reverse/.test(normalizeText(card.narrativeMode))) scores.emotional_interior += 2;
  return scores;
}

function getNarrativeTextureMode(card = {}) {
  const scores = scoreNarrativeTextureModes(card);
  const fullText = getNarrativeTextureInput(card);
  const explicitPrimary = fullText.match(/主功能\s*[=＝:]\s*([a-z_]+)/)?.[1];
  const explicitSecondary = fullText.match(/副功能\s*[=＝:]\s*([a-z_]+)/)?.[1];
  if (explicitPrimary && narrativeTextureModes[explicitPrimary]) {
    return {
      primary: explicitPrimary,
      secondary: explicitSecondary && explicitSecondary !== '无' && narrativeTextureModes[explicitSecondary] ? explicitSecondary : '',
      scores,
    };
  }
  const priority = ['dialogue_conflict', 'emotional_interior', 'relationship', 'investigation', 'action_pressure', 'reveal_twist', 'daily_recovery', 'transition_setup', 'worldbuilding'];
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1] || priority.indexOf(a[0]) - priority.indexOf(b[0]));
  const [primaryMode, primaryScore] = sorted[0] || ['transition_setup', 0];
  const [secondaryMode, secondaryScore] = sorted[1] || ['', 0];
  const secondaryThreshold = Math.max(8, primaryScore * 0.25);
  return {
    primary: primaryScore > 0 ? primaryMode : 'transition_setup',
    secondary: secondaryScore >= secondaryThreshold ? secondaryMode : '',
    scores,
  };
}

function buildNarrativeTextureBudgetGuide(card = {}) {
  const mode = getNarrativeTextureMode(card);
  const primary = narrativeTextureModes[mode.primary] || narrativeTextureModes.transition_setup;
  const secondary = mode.secondary ? narrativeTextureModes[mode.secondary] : null;
  return [
    `本章叙述质感：${primary.label}${secondary ? ` + ${secondary.label}` : ''}`,
    `叙述预算：${primary.budget}。`,
    secondary ? `副模式补充：${secondary.focus}` : '',
    '小说感指：人物身体感、意识流动、动作因果、关系错位、未说完的话、记忆碎片和选择代价。',
    '电影感指：距离、遮挡、声音方向、物件移动、光线变化、动作后果和场面调度。',
    '电影感必须被人物经验过滤：让角色看见、听见、摸到、误判、迟疑或付出代价；不要写成客观镜头扫过。',
    '禁止低级电影感：碎句伪冲击、否定排除式判断、破折号解释、每段一个反转、标签短句。',
    primary.focus,
  ].filter(Boolean).join('\n');
}

function stripDialogueText(text = '') {
  return normalizeText(text).replace(/“[^”]{0,260}”/g, '');
}

function getNonDialogueMatches(text = '', regex) {
  const normalized = normalizeText(text);
  const dialogueRanges = [...normalized.matchAll(/“[^”]{0,260}”/g)].map((match) => ({ start: match.index || 0, end: (match.index || 0) + match[0].length }));
  const isInsideDialogue = (index) => dialogueRanges.some((range) => index >= range.start && index < range.end);
  return [...normalized.matchAll(regex)].filter((match) => !isInsideDialogue(match.index || 0));
}

function getMechanicalNegationMatches(text = '') {
  const nonDialogueText = stripDialogueText(text);
  const matches = [];
  const sentenceRegex = /[^。！？\n]*(?:不是|并非)[^。！？\n]*[。！？]?/g;
  for (const match of nonDialogueText.matchAll(sentenceRegex)) {
    const sentence = normalizeText(match[0]).trim();
    if (!sentence || sentence.length < 6) continue;
    const isMechanical = /(?:不是|并非)[^。！？\n]{1,50}(?:是|就是|而是|也不是|更像|像是|说明|意味着|代表|判断|推测|巧合|解释|自然形成|风吹|外力|信号|设备|问题)/.test(sentence)
      || /(?:与其说|不如说|不是什么)[^。！？\n]{1,50}(?:不如说|而是)/.test(sentence);
    const isNaturalAbsenceOrAction = /^不是(?:一个人|鞋印|脚步|声音|错觉)[。！？]?$/.test(sentence)
      || /“|”/.test(sentence);
    if (!isMechanical || isNaturalAbsenceOrAction) continue;
    const index = text.indexOf(sentence, Math.max(0, match.index || 0));
    matches.push({ text: sentence, index: index >= 0 ? index : (match.index || 0) });
  }
  return matches;
}

function findTransitionBridgeIssues(text = '') {
  const normalized = normalizeText(text);
  const issues = [];
  const keySignalRegex = /黄光|绿灯[^。！？\n]{0,18}(?:跳|变|闪|停顿|异常)|信标器[^。！？\n]{0,24}(?:黄|热|降|异常|变化|变了)|系统(?:提示|面板|任务|奖励|异常)|戒指[^。！？\n]{0,24}(?:亮|暗|熄|发热|变暗|恢复)|铭牌|编号|07|K-|入口|地下通道|门口|渴了|口渴|受伤|脚步声|信号中断/g;
  const reactionBridgeRegex = /停(?:住|下|顿)?|慢(?:了|下|半拍)|回头|看(?:向|着|了)|视线|盯|重新|确认|转(?:动|向)|举起|摸|碰|贴|伸手|问|说|绕开|加快|放慢|收起|拿出|掏出|靠近|蹲下|握|松开|递|喝|休息|等|让出|调整|抬手|低头|脚步|呼吸|肩带/;
  const weakContinuationRegex = /^(?:。|\s)*(?:阿米娅|魏杰|他|她|他们)?(?:点头|没问|没有追问|没有解释|没说话|没有说话|继续|先走|往前走|跟上|走了|离开)/;
  const motiveRegex = /目标|风险|危险|时间|天色|落霞|信号|黄光|绿灯|信标器|系统|戒指|铭牌|编号|07|K-|入口|地下|口渴|渴了|受伤|脚步|声音|方向|路线|距离|靠近|范围|体力|呼吸|背包|肩带|因为|所以|只好|于是|才|已经|必须/;

  for (const match of normalized.matchAll(keySignalRegex)) {
    const index = match.index || 0;
    const signal = match[0];
    const after = normalized.slice(index + signal.length, index + signal.length + 150);
    const bridgeProbe = after.replace(/没问|没有追问|也没问|也没有追问/g, '');
    const hasBridge = reactionBridgeRegex.test(bridgeProbe);
    const onlyWeakContinuation = weakContinuationRegex.test(after) && !/(重新|确认|转(?:动|向)|举起|摸|碰|贴|伸手|绕开|加快|放慢|收起|拿出|掏出|靠近|蹲下|握|松开|递|喝|休息|等|调整|脚步|呼吸)/.test(after.slice(0, 80).replace(/没问|没有追问|也没问|也没有追问/g, ''));
    if (!hasBridge || onlyWeakContinuation) {
      issues.push({
        type: 'missing-reaction-bridge',
        label: '关键异常后缺少反应桥',
        index,
        text: normalized.slice(index, Math.min(normalized.length, index + 180)).trim(),
        critical: true,
      });
    }
  }

  const paragraphs = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  paragraphs.forEach((paragraph) => {
    const index = normalized.indexOf(paragraph);
    const hasStiffTransition = /(?:点头|沉默|没说话|没有说话)[^。！？]{0,12}[。！？]\s*(?:没问|没有追问|没有解释|也没问|也没有追问)[^。！？]{0,50}[。！？]\s*(?:阿米娅|魏杰|他|她|他们)?[^。！？]{0,16}(?:继续|先走|往前走|跟上|转身|离开)/.test(paragraph)
      || /(?:说完|说罢)[^。！？]{0,16}[，,。]\s*(?:阿米娅|魏杰|他|她)[^。！？]{0,10}点头[^。！？]{0,24}(?:继续|往前|转身|离开)/.test(paragraph);
    if (hasStiffTransition) {
      issues.push({ type: 'stiff-transition', label: '人物反应与行动转折生硬', index, text: paragraph.slice(0, 180) });
    }
  });

  const sentences = [...normalized.matchAll(/[^。！？!?\n]{2,120}[。！？!?]/g)].map((match) => ({ text: match[0].trim(), index: match.index || 0 }));
  sentences.forEach((sentence) => {
    if (!/(?:阿米娅|魏杰|他|她|他们)[^。！？]{0,22}(?:先走|继续(?:往前)?走|转身离开|决定(?:进去|进入|离开)|走进|进入|收起|掏出|加快脚步|放慢脚步)/.test(sentence.text)) return;
    const context = normalized.slice(Math.max(0, sentence.index - 150), Math.min(normalized.length, sentence.index + sentence.text.length + 150));
    if (motiveRegex.test(context)) return;
    issues.push({ type: 'unmotivated-action-shift', label: '动作转折缺少最小动机', index: sentence.index, text: sentence.text });
  });

  return issues;
}

function findDialogueIssues(content = '', card = {}) {
  const text = normalizeText(content);
  const issues = [];
  const dialogueMatches = [...text.matchAll(/“([^”]{1,240})”/g)];
  const dialogueCount = dialogueMatches.length;
  const highDialogueChapter = isHighDialogueChapter(card);
  if (!highDialogueChapter) return [];
  if (dialogueCount < 8) {
    issues.push({ type: 'dialogue-too-sparse', label: '高对话章节对话不足', text: `对话段数量：${dialogueCount}` });
  }

  const dialogueText = dialogueMatches.map((match) => match[0]).join('\n');
  const explainCount = (dialogueText.match(/因为|所以|也就是说|换句话说|这意味着|你应该明白|我解释一下|简单来说/g) || []).length;
  if (highDialogueChapter && dialogueCount >= 8 && explainCount >= Math.ceil(dialogueCount * 0.45)) {
    issues.push({ type: 'dialogue-over-explains', label: '对话解释设定过多', text: `解释型对话标记：${explainCount}/${dialogueCount}` });
  }

  const interruptionCount = (text.match(/没说完|打断|沉默|停了|顿了|避开|没接|没回答|改口|咽回去|答非所问|看向|低头|移开视线/g) || []).length;
  if (highDialogueChapter && dialogueCount >= 8 && interruptionCount < 3) {
    issues.push({ type: 'dialogue-too-aligned', label: '对话过度信息对齐', text: `错位/打断/动作标记：${interruptionCount}` });
  }

  const shortCommandRegex = /^(?:快|走|跑|撤|退|停|上|下|开|关|推|拉|剪|切|放|拿|收|跟上|继续(?:走|推|撤|退)?|别(?:回|碰|动|看|开|关|剪|拿|推|拉)[^，。！？,.!?]{0,4})[。！？.!?]*$/;
  const bareStatusRegex = /^(?:行|可以|好|嗯|明白|收到|稳了|不稳|够|不够|有|没有)[。！？.!?]*$/;
  const orphanConnectorRegex = /^(?:所以|但是|可是|那|现在|先|再|然后|就这样)[，,。！？.!?]*$/;
  const negativeCommandChainRegex = /(?:^|[。！？.!?]\s*)(?:别|不要|不)[^。！？.!?]{1,14}[。！？.!?]\s*(?:别|不要|不)[^。！？.!?]{1,14}[。！？.!?]/;
  const negativeListRegex = /(?:不|别|不要)[^，。！？,.!?]{1,16}[，,、]\s*(?:不|别|不要)[^，。！？,.!?]{1,16}(?:[，,、]\s*(?:也)?(?:不|别|不要)[^。！？.!?]{1,24})/;
  const candidates = [];
  const addDialogueIssue = (type, label, match) => {
    if (issues.filter((issue) => issue.type === type).length >= 3) return;
    issues.push({ type, label, index: match.index || 0, text: match[0] });
  };
  dialogueMatches.forEach((match) => {
    const raw = match[1] || '';
    const spoken = normalizeText(raw).replace(/[“”"'‘’]/g, '').trim();
    if (!spoken) return;
    if (shortCommandRegex.test(spoken)) candidates.push({ type: 'dialogue-fragment-command', label: '台词半截命令缺少对象/方向', match });
    if (bareStatusRegex.test(spoken)) candidates.push({ type: 'dialogue-bare-status', label: '台词裸状态句缺少用途', match });
    if (orphanConnectorRegex.test(spoken)) candidates.push({ type: 'dialogue-orphan-connector', label: '台词孤立承接词缺少上下文承接', match });
    if (negativeCommandChainRegex.test(spoken)) addDialogueIssue('dialogue-negative-command-chain', '台词连续否定命令像规则清单', match);
    if (negativeListRegex.test(spoken)) addDialogueIssue('dialogue-negative-list', '台词同句连续否定排比不自然', match);
  });

  const candidateTypes = candidates.reduce((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {});
  const totalSoftCandidateCount = candidates.length;
  if (totalSoftCandidateCount >= 3) {
    candidates.forEach(({ type, label, match }) => {
      if ((candidateTypes[type] || 0) >= 2 || totalSoftCandidateCount >= 3) addDialogueIssue(type, label, match);
    });
  }

  return issues;
}

function relaxDialogueChapterNaturalnessIssues(issues = [], content = '', card = {}) {
  if (!isHighDialogueChapter(card)) return issues;
  const text = normalizeText(content);
  const dialogueText = (text.match(/“[^”]{1,240}”/g) || []).join('\n');
  const narrativeText = text.replace(/“[^”]{1,240}”/g, '');
  const narrativeNegativeCount = (narrativeText.match(/不是/g) || []).length;
  const dialogueCount = (dialogueText.match(/“/g) || []).length;

  return issues.filter((issue) => {
    if (issue.type === 'plain-negative-density') {
      return narrativeNegativeCount >= 3;
    }
    if (issue.type === 'mechanical-negation-density' || issue.type === 'mechanical-negation-window-density') {
      return narrativeNegativeCount >= 4;
    }
    if (issue.type === 'negative-standalone-judgement' || issue.type === 'negative-comma-reveal') {
      const issueText = normalizeText(issue.text);
      if (dialogueCount >= 8 && issueText && (dialogueText.includes(issueText) || issueText.length <= 24)) return false;
    }
    if (issue.type === 'negative-turn-density') {
      return narrativeNegativeCount >= 3;
    }
    return true;
  });
}

function getCompactSentenceLength(sentence = '') {
  return normalizeText(sentence).replace(/[，。！？,.!?；;：:“”"'‘’、（）()【】\s]/g, '').length;
}

function findShortFlowIssues(content = '') {
  const text = normalizeText(content);
  const issues = [];
  const sentenceMatches = [...text.matchAll(/[^。！？!?\n]{1,90}[。！？!?]/g)].map((match) => ({ text: match[0].trim(), index: match.index || 0 }));
  const isShortFlowSentence = (sentence = '') => {
    const clean = sentence.replace(/[“”"'‘’]/g, '').trim();
    const length = getCompactSentenceLength(clean);
    if (length < 2 || length > 10) return false;
    if (/【[^】]+】/.test(clean)) return false;
    return /[？?]$/.test(clean)
      || /^(?:别|不要|不|先|再|快|走|撤|退|停|看|听|开|关|推|拉|剪|切|放|拿|收|跟|继续|可以|行|好|嗯|明白|收到|稳了|不稳|够|不够|有|没有|不是|不对|等等|博士|魏杰|阿米娅)/.test(clean)
      || /(?:了|住|停|响|亮|暗|断|开|合|倒|塌|松|紧|冷|热|疼|抖|僵)[。！？!?]$/.test(clean);
  };

  for (let idx = 0; idx <= sentenceMatches.length - 3; idx += 1) {
    const group = sentenceMatches.slice(idx, idx + 3);
    if (!group.every((item) => isShortFlowSentence(item.text))) continue;
    const context = text.slice(Math.max(0, group[0].index - 90), Math.min(text.length, group[2].index + group[2].text.length + 90));
    if (/章末|最后|钩子/.test(context)) continue;
    issues.push({ type: 'short-flow-chain', label: '连续短句链影响阅读流动', index: group[0].index, text: group.map((item) => item.text).join('') });
    break;
  }

  const dialogueMatches = [...text.matchAll(/“([^”]{1,160})”/g)].map((match) => ({ text: normalizeText(match[1]).trim(), index: match.index || 0 }));
  for (let idx = 0; idx <= dialogueMatches.length - 3; idx += 1) {
    const group = dialogueMatches.slice(idx, idx + 3);
    const shortCount = group.filter((item) => getCompactSentenceLength(item.text) <= 10).length;
    const questionCount = group.filter((item) => /[？?]$/.test(item.text)).length;
    const commandCount = group.filter((item) => /^(?:别|不要|不|先|再|快|走|撤|退|停|看|听|开|关|推|拉|剪|切|放|拿|收|跟|继续)/.test(item.text)).length;
    if (shortCount >= 3 || questionCount >= 3 || commandCount >= 3) {
      issues.push({ type: 'short-dialogue-chain', label: '连续短台词缺少对象或承接', index: group[0].index, text: group.map((item) => `“${item.text}”`).join('') });
      break;
    }
  }
  return issues;
}

function findNaturalnessIssues(content = '') {
  const text = normalizeText(content);
  const issues = [];
  const lines = text.split('\n');
  const nonDialogueText = stripDialogueText(text);
  const isNaturalNegativeSentence = (sentence = '') => /^(?:我|你|他|她|魏杰|灰喉|博士|本虫)?(?:真|也|可)?(?:不是)(?:故意的|战斗型|博士|敌人|威胁|问题|梦|噩梦|错觉|人类的手|人类的语言|他的|她的|我的|普通的|普通反射|系统|陷阱|玩具|空的|新的|坏的|一个人|第一次|关键)$/.test(normalizeText(sentence).replace(/[“”"'‘’]/g, '').trim());
  const patterns = [
    { type: 'negative-reveal', regex: /不是[^。！？\n]{1,28}[，,、]?\s*也不是[^。！？\n]{1,28}[—-]{1,2}\s*(?:是|就是)?[^。！？\n]{1,60}/g, label: '否定排除式揭示句' },
    { type: 'negative-negative-explain', nonDialogueOnly: true, regex: /(?:不再是|不是)[^。！？\n]{1,36}(?:[，,、]\s*)?也不是[^。！？\n]{1,36}[。！？]\s*(?:它|他|她|这|那)?(?:变成|成了|变为|成|就是|意味着|说明|代表)[^。！？\n]{1,80}/g, label: '否定否定后解释升格句' },
    { type: 'negative-negative-affirm', nonDialogueOnly: true, regex: /(?:不再是|不是)[^。！？\n]{1,36}(?:[，,、]\s*)?也不是[^。！？\n]{1,36}[，,、]?\s*(?:而是|就是|只是|变成|成了|说明|意味着|代表|带出来的)[^。！？\n]{1,80}/g, label: '否定否定肯定转折句' },
    { type: 'negative-paired-contrast', regex: /不是[^。！？\n]{1,36}[，,、]\s*也不是[^。！？\n]{1,36}[。！？]/g, label: '不是/也不是成对否定句' },
    { type: 'negative-comma-triple', regex: /不是[^。！？\n]{1,24}[，,、]\s*不是[^。！？\n]{1,24}[，,、]\s*(?:是|就是)[^。！？\n]{1,60}/g, label: '逗号分隔的否定排除句' },
    { type: 'negative-triple', regex: /不是[^。！？\n]{1,20}[。！？]\s*不是[^。！？\n]{1,20}[。！？]\s*(?:是|就是)[^。！？\n]{1,60}[。！？]/g, label: '短句排比式否定揭示' },
    { type: 'negative-dash-reveal', regex: /不是[^。！？\n]{1,40}[—-]{1,2}\s*(?:是|就是)[^。！？\n]{1,60}/g, label: '破折号否定揭示' },
    { type: 'negative-period-reveal', regex: /不是[^。！？\n]{1,36}[。！？]\s*(?:是|就是)[^。！？\n]{1,60}[。！？]?/g, label: '句号分隔的否定揭示' },
    { type: 'negative-comma-reveal', regex: /不是[^。！？\n]{1,40}[，,]\s*(?:是|就是|而是)[^。！？\n]{1,60}/g, label: '逗号否定转折判断' },
    { type: 'negative-standalone-judgement', regex: /不是[^。！？\n]{2,28}[。！？]/g, label: '独立否定判断句' },
    { type: 'empty-reveal', regex: /没有[^。！？\n]{1,28}[，,、]?\s*也没有[^。！？\n]{1,28}[—-]{1,2}\s*(?:只有|只剩|只是在)?[^。！？\n]{1,60}/g, label: '否定缺失式揭示句' },
    { type: 'absence-short-chain', regex: /没有[^。！？\n]{1,24}[。！？]\s*也没有[^。！？\n]{1,24}[。！？]/g, label: '没有/也没有短句链' },
    { type: 'negative-short-chain', regex: /(?:^|[。！？\n])\s*不(?:接话|报位置|解释|回答|回头|停下|出声|动|问|看)[^。！？\n]{0,12}[。！？]\s*不(?:接话|报位置|解释|回答|回头|停下|出声|动|问|看)[^。！？\n]{0,12}[。！？]/g, label: '不字短句链' },
    { type: 'adjective-short-chain', regex: /(?:^|[。！？\n])\s*(?:很|太)[^。！？\n]{1,8}[。！？]\s*(?:很|太|更)[^。！？\n]{1,8}[。！？]/g, label: '形容词短句链' },
    { type: 'empty-comma-reveal', regex: /没有[^。！？\n]{1,40}[，,]\s*(?:只有|只剩|只是|而是)[^。！？\n]{1,60}/g, label: '逗号否定缺失判断' },
    { type: 'rather-than', regex: /(?:与其说|不如说|不是什么)[^。！？\n]{1,50}(?:不如说|而是)[^。！？\n]{1,60}/g, label: '与其说A，不如说B' },
    { type: 'dash-explain-judgement', regex: /[—-]{1,2}\s*(?:是|说明|意味着|代表|像是|更像)[^。！？\n]{1,60}/g, label: '破折号解释判断' },
    { type: 'auditory-overclaim', regex: /(?:皮靴|军靴|高跟鞋|作战靴)[^。！？\n]{0,24}(?:声音|响|声响|动静)|(?:声音|响|声响|动静)[^。！？\n]{0,24}(?:皮靴|军靴|高跟鞋|作战靴)/g, label: '听觉越权判断' },
    { type: 'noun-fragment-sentence', regex: /(?:^|[。！？!?\n])\s*[^，。！？!?\n]{0,16}(?:声音|闷响|光线|气味|轮廓|触感|动静)[，,](?:连着|从|在|很|越来越|一下|一阵)[^。！？!?\n]{2,40}[。！？!?]/g, label: '名词碎句' },
    { type: 'triple-noun-enumeration', nonDialogueOnly: true, regex: /一[条块个枚根段只扇片张道处][^，。！？\n]{2,22}[，,、]\s*一[条块个枚根段只扇片张道处][^，。！？\n]{2,22}[，,、]\s*一[条块个枚根段只扇片张道处][^。！？\n]{2,36}/g, label: '三项名词排比升格' },
    { type: 'isolated-label-sentence', regex: /(?:^|[。！？!?\n])\s*(暗门|没地方躲|风险中|安全了|有人|脚步声|金属声|血|出口|死路|机会|问题不大|来不及了)[。！？!?]/g, label: '孤立标签短句' },
    { type: 'markdown-noise', regex: /\*\*|__|```|^\s*#{2,6}\s+|^\s*---\s*$/gm, label: 'Markdown 排版痕迹' },
    { type: 'template-hook', regex: /真正的危险才刚刚开始|事情远没有结束|他不知道的是|她不知道的是|一切才刚刚开始/g, label: '模板章末钩子' },
  ];

  patterns.forEach((pattern) => {
    const matches = pattern.nonDialogueOnly ? getNonDialogueMatches(text, pattern.regex) : [...text.matchAll(pattern.regex)];
    for (const match of matches) {
      if (pattern.type === 'empty-comma-reveal' && /^没有(?:回头|停下|说话|回答|看|问|动|解释|接话|立刻)/.test(match[0])) continue;
      if (pattern.type === 'negative-comma-reveal' && /^不是(?:笑|哭|生气|害怕|嘲讽|威胁|命令|请求)[，,]/.test(match[0].trim())) continue;
      if (pattern.type === 'negative-standalone-judgement' && /^不是(?:笑|哭|生气|害怕|嘲讽|威胁|命令|请求)[，,]/.test(match[0].trim())) continue;
      if (pattern.type === 'negative-standalone-judgement' && /^不是(?:人类的手|梦|噩梦|错觉|敌意|敌人|威胁|问题)[。！？]?$/.test(match[0].trim())) continue;
      if (pattern.type === 'negative-standalone-judgement' && isNaturalNegativeSentence(match[0].replace(/[。！？]$/g, ''))) continue;
      if (pattern.type === 'empty-comma-reveal' && /^没有(?:动|叫|逃|说话|回答|回头|停下)[^。！？]{0,20}[，,]/.test(match[0].trim())) continue;
      issues.push({ type: pattern.type, label: pattern.label, index: match.index || 0, text: match[0] });
    }
  });

  const mechanicalNegativeMatches = getMechanicalNegationMatches(text);
  const naturalAbsenceMatches = [...text.matchAll(/没有[^。！？\n]{1,36}(?:，|。|；|$)/g)]
    .filter((match) => !/(?:只有|只剩|只是|而是)/.test(match[0]));
  const negativeTurnMatches = mechanicalNegativeMatches;
  if (negativeTurnMatches.length >= 3) {
    issues.push({
      type: 'negative-turn-density',
      label: '否定转折句式密度过高',
      index: negativeTurnMatches[2].index || 0,
      text: negativeTurnMatches.slice(0, 5).map((match) => match.text || match[0]).join('\n'),
      count: negativeTurnMatches.length,
    });
  }

  if (mechanicalNegativeMatches.length >= 3) {
    issues.push({
      type: 'mechanical-negation-density',
      label: '机械否定判断密度过高',
      index: mechanicalNegativeMatches[2].index || 0,
      text: mechanicalNegativeMatches.slice(0, 6).map((match) => match.text).join('\n'),
      count: mechanicalNegativeMatches.length,
    });
  }

  for (let start = 0; start < text.length; start += 800) {
    const end = start + 800;
    const windowMatches = mechanicalNegativeMatches.filter((match) => match.index >= start && match.index < end);
    if (windowMatches.length >= 3) {
      issues.push({
        type: 'mechanical-negation-window-density',
        label: '局部机械否定过密',
        index: windowMatches[0].index || start,
        text: windowMatches.slice(0, 4).map((match) => match.text).join('\n'),
        count: windowMatches.length,
      });
      break;
    }
  }

  if (naturalAbsenceMatches.length >= 6) {
    issues.push({
      type: 'natural-absence-density',
      label: '自然缺失描写密度偏高',
      index: naturalAbsenceMatches[5].index || 0,
      text: naturalAbsenceMatches.slice(0, 6).map((match) => match[0]).join('\n'),
      count: naturalAbsenceMatches.length,
    });
  }

  const plainNegativeCount = [...text.matchAll(/不是/g)].filter((match) => {
    const sentenceStart = Math.max(text.lastIndexOf('。', match.index), text.lastIndexOf('！', match.index), text.lastIndexOf('？', match.index), text.lastIndexOf('\n', match.index)) + 1;
    const sentenceEndCandidates = ['。', '！', '？', '\n'].map((mark) => text.indexOf(mark, match.index)).filter((index) => index >= 0);
    const sentenceEnd = sentenceEndCandidates.length ? Math.min(...sentenceEndCandidates) : text.length;
    const sentence = text.slice(sentenceStart, sentenceEnd).trim();
    if (isNaturalNegativeSentence(sentence)) return false;
    if (/“[^”]*不是[^”]*”/.test(sentence) && !/(?:而是|——|是|说明|意味着|代表|更像|像是)/.test(sentence)) return false;
    return !/^不是(?:人类的手|梦|噩梦|错觉|敌意|敌人|威胁|问题)$/.test(sentence);
  }).length;
  if (plainNegativeCount >= 4) {
    issues.push({
      type: 'plain-negative-density',
      label: '“不是”判断句密度过高',
      index: text.indexOf('不是'),
      text: `全文出现“不是”${plainNegativeCount}次`,
      count: plainNegativeCount,
    });
  }

  issues.push(...findTransitionBridgeIssues(text));
  issues.push(...findShortFlowIssues(text));

  const paragraphs = text.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  paragraphs.forEach((paragraph) => {
    const paragraphIndex = text.indexOf(paragraph);
    const nonDialogueParagraph = stripDialogueText(paragraph);
    const sentences = paragraph.match(/[^。！？!?]+[。！？!?]/g) || [];
    const inventoryWords = paragraph.match(/临时医疗点|行军床|折叠床|折叠担架|担架|药品柜|床头柜|铁皮柜|柜门|墙角|桌上|地上|窗边|窗帘|靴子|制服|袖口|标签|纸条|通讯器|屏幕|信号条|绷带|纱布|剪刀|储物箱|医疗箱|门把手|门锁|灯管|脚印|消毒水|气味/g) || [];
    const weakActionMatches = paragraph.match(/看了|看见|注意到|发现|扫了一眼|打量|低头看|抬头看|检查|翻到|摸到|放着|挂着|有一|有几|里面是|上面是|靠墙放着|半开着|是空的|蒙着|沾着/g) || [];
    const goalActionMatches = paragraph.match(/拿起|按下|拧开|收进|塞进|推开|拉开|关上|插上|退到|躲到|撑着|站起|蹲下|走到|拔掉|试着|确认|寻找|包扎|喝|扶住/g) || [];
    const propDossierWords = paragraph.match(/纸上|纸条|路线图|标注|地名|交叉点|画了个圈|圈旁边|字迹|潦草|写得很急|翻过纸|背面|空白|签名|日期|型号|接口|三针|材质|磨砂|边角|擦痕|标签|刻度|压印|编号|模块|通讯器|屏幕|按钮|指示灯|标识|重量|很轻|手感|光滑|温度/g) || [];
    const hasNounStateList = /(?:^|。)(?:一个|一台|一张|一只|一把)?[^。！？]{0,12}(?:临时医疗点|行军床|折叠担架|药品柜|地面|空气|通讯器|模块|纸条)[^。！？]{0,50}[。！？](?:[^。！？]{0,12}(?:行军床|折叠担架|药品柜|地面|空气|通讯器|模块|纸条|脚印|气味)[^。！？]{0,60}[。！？]){1,}/.test(paragraph);
    const hasStaticJudgementChain = /(?:^|。)(?:房间不大|像个临时医疗点|这地方显然是|这里是|看起来像|显得像)[。！？][^。！？]{0,50}(?:行军床|折叠担架|药品柜|床|柜|灯|脚印|气味|水泥地|墙缝|弹药箱)[。！？]/.test(paragraph);
    const hasStaticRoomSummary = /(?:^|[。！？\n])\s*(?:这(?:是|像)|这里是|房间是|屋子是|看起来像|显然是)[^。！？\n]{0,28}(?:房间|屋子|临时医疗点|临时安置点|安置点|医疗点|库房|避难所|地下室|据点)[^。！？\n]{0,30}[—:：-]{1,2}[^。！？\n]{0,100}(?:行军床|折叠床|折叠担架|担架|药品柜|铁皮柜|弹药箱|通讯终端|水泥地|灯管|脚印|消毒水)[^。！？\n]{0,100}[。！？]/.test(paragraph);
    const sentenceTexts = sentences.map((sentence) => sentence.trim());
    const firstSentence = sentenceTexts[0] || '';
    const laterText = sentenceTexts.slice(1).join('');
    const startsWithBodyAction = /^(?:他|她|魏杰|博士)?[^。！？]{0,12}(?:撑着|坐起|站起|按住|扶着|走到|退回|低头|抬手|伸手|转身|挪到|靠在)/.test(firstSentence);
    const laterStaticInventory = (laterText.match(/照明灯|灯管|行军床|折叠担架|药品柜|外套|污渍|金属门|墙边|弹药箱|通讯终端|屏幕|纱布|注射器|门锁|窗户/g) || []).length;
    const laterGoalActions = (laterText.match(/拿起|按下|拧开|收进|塞进|推开|拉开|关上|退到|躲到|走到|拔掉|试着|确认|寻找|扶住|压住|避开|听/g) || []).length;
    if (startsWithBodyAction && laterStaticInventory >= 4 && laterGoalActions <= 1) {
      issues.push({ type: 'action-static-list-disconnect', label: '动作后静态清单断裂', index: paragraphIndex, text: paragraph.slice(0, 180), count: laterStaticInventory });
    }
    if ((inventoryWords.length >= 4 && weakActionMatches.length >= 2 && goalActionMatches.length <= 2) || hasNounStateList || hasStaticJudgementChain) {
      issues.push({ type: 'inventory-scan-paragraph', label: '观察清单式段落', index: paragraphIndex, text: paragraph.slice(0, 180) });
    }
    if (hasStaticRoomSummary) {
      issues.push({ type: 'static-room-summary', label: '静态房间总结清单', index: paragraphIndex, text: paragraph.slice(0, 180) });
    }
    if (inventoryWords.length >= 6) {
      issues.push({ type: 'scene-asset-overload', label: '场景资产扫描过载', index: paragraphIndex, text: paragraph.slice(0, 180), count: inventoryWords.length });
    }
    if (propDossierWords.length >= 4 && goalActionMatches.length <= 2) {
      issues.push({ type: 'prop-dossier-description', label: '道具档案式细节补全', index: paragraphIndex, text: paragraph.slice(0, 180), count: propDossierWords.length });
    }
    if (/^[^。！？]{2,18}[。！？](?:[^。！？]{2,40}[。！？]){2,}/.test(paragraph) && (inventoryWords.length >= 2 || weakActionMatches.length >= 1) && goalActionMatches.length <= 1) {
      issues.push({ type: 'sentence-chain-flatness', label: '短句链平直', index: paragraphIndex, text: paragraph.slice(0, 180) });
    }
    sentences.forEach((sentence) => {
      const sentenceIndex = text.indexOf(sentence, paragraphIndex);
      const commaCount = (sentence.match(/[，,]/g) || []).length;
      const compactLength = sentence.replace(/[，。！？,.!?\s“”"'‘’、]/g, '').length;
      const hasRedundantDetailChain = /昨晚没洗干净，现在|颜色已经干了，在|那枚碎片的位置，透过|非常细[^。！？]*[—-]{1,2}|细得像/.test(sentence);
      const hasFuzzySubject = /(?:[^，。！？]{0,18}的)?(?:位置|边缘|颜色|形状)[，,][^。！？]{0,24}(?:透过|反射|映出|晕成|干成|落在)/.test(sentence);
      const hasPatchworkDescription = /(?:披着|穿着|套着|盖着|放着|摆着)[^。！？]{2,24}[，,][^。！？]{0,18}(?:有|带着|压着|露出)[^。！？]{2,24}[，,][^。！？]{0,18}(?:已经|颜色|边缘|位置|形状|在)[^。！？]{2,50}/.test(sentence);
      const hasCauseStateResultChop = /(?:昨晚|刚才|之前|先前|一路上|刚刚)[^。！？]{2,30}[，,][^。！？]{0,24}(?:现在|已经|此刻|这会儿|干成|凝成|变成)[^。！？]{2,30}[，,][^。！？]{0,24}(?:一碰|随着|顺着|落在|掉在|沾在|晕开)/.test(sentence);
      const detailDimensions = [
        /上方|下方|左侧|右侧|旁边|边缘|位置|墙基|台阶|入口|地面|口袋|杯底|指根/.test(sentence),
        /金属|水泥|灰浆|螺丝|铭牌|漆面|刻痕|布料|玻璃|铁锈/.test(sentence),
        /灰色|暗红|绿色|黄光|红褐色|深灰|冷白|黑色/.test(sentence),
        /新|旧|刚|最近|一直|已经|之前|昨天|风蚀|氧化|磨损|干裂/.test(sentence),
        /像|仿佛|如同|一样|轮廓|形状|对角线|痕迹/.test(sentence),
        /因为|所以|导致|说明|意味着|判断|确认|推断/.test(sentence),
      ].filter(Boolean).length;
      const bodyDetailUnits = (sentence.match(/(?:后背|手指|指甲|掌心|肩膀|喉咙|气管|背带|刀刃|握把|袖口|膝盖|脚掌|额角|脖子)[^，。！？]{0,22}(?:贴|握|掐|勒|压|疼|硌|擦|抖|绷|抵|滑|晃|轻|重)/g) || []).length;
      const sceneDetailUnits = (sentence.match(/(?:转椅|镜子|柜台|玻璃|灯牌|楼板|墙|铁门|货架|碎砖|碎玻璃|霓虹|窗|门|箱子)[^，。！？]{0,24}(?:翻倒|倒|碎|裂|歪|挂|铺|散|塌|立|透|亮|暗|卡住)/g) || []).length;
      if (commaCount >= 4 && compactLength >= 42) {
        issues.push({ type: 'comma-stacked-long-sentence', label: '逗号堆叠长句', index: sentenceIndex, text: sentence.trim().slice(0, 180) });
      }
      if (commaCount >= 2 && bodyDetailUnits >= 3) {
        issues.push({ type: 'parallel-body-detail-overload', label: '身体细节平权罗列', index: sentenceIndex, text: sentence.trim().slice(0, 180), count: bodyDetailUnits });
      }
      if (commaCount >= 2 && sceneDetailUnits >= 3) {
        issues.push({ type: 'parallel-scene-detail-overload', label: '场景物件平权罗列', index: sentenceIndex, text: sentence.trim().slice(0, 180), count: sceneDetailUnits });
      }
      if ((hasRedundantDetailChain || commaCount >= 4) && /透过|反射|晕成|干成|像一根|像一片|位置|边缘|颜色|阴影|形状|口袋|布料|针尖|划过|冻土|咖啡渍/.test(sentence)) {
        issues.push({ type: 'overloaded-detail-sentence', label: '细节缠绕句', index: sentenceIndex, text: sentence.trim().slice(0, 180) });
      }
      if (detailDimensions >= 5 && commaCount >= 2) {
        issues.push({ type: 'detail-dimension-overload', label: '细节维度过载', index: sentenceIndex, text: sentence.trim().slice(0, 180), count: detailDimensions });
      }
      if (hasFuzzySubject) {
        issues.push({ type: 'fuzzy-subject-detail', label: '主体模糊的细节句', index: sentenceIndex, text: sentence.trim().slice(0, 180) });
      }
      if (hasPatchworkDescription) {
        issues.push({ type: 'patchwork-description', label: '补丁式物件描写', index: sentenceIndex, text: sentence.trim().slice(0, 180) });
      }
      if (hasCauseStateResultChop) {
        issues.push({ type: 'cause-state-result-chop', label: '原因状态结果切碎', index: sentenceIndex, text: sentence.trim().slice(0, 180) });
      }
    });
    if (sentences.length >= 4) {
      const lengths = sentences.map((sentence) => sentence.replace(/[，。！？,.!?\s“”"'‘’、]/g, '').length);
      const avgLength = lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
      const shortCount = lengths.filter((length) => length <= 10).length;
      if (avgLength <= 14 && shortCount >= 2) {
        issues.push({ type: 'choppy-paragraph', label: '段落碎句密度过高', index: paragraphIndex, text: paragraph.slice(0, 160) });
      }
    }

    for (let idx = 0; idx <= sentences.length - 3; idx += 1) {
      const group = sentences.slice(idx, idx + 3).map((sentence) => sentence.trim());
      const groupLengths = group.map((sentence) => sentence.replace(/[，。！？,.!?\s“”"'‘’、]/g, '').length);
      const sameActorActions = group.filter((sentence) => /^(?:他|她|魏杰|阿米娅)(?:又|再|先|把|用|伸|抬|低|转|抓|扣|摸|推|拉|看|走|踩|蹲|站|停|换|掀|压|松|拿|捡|照|扫|贴)/.test(sentence)).length;
      if (sameActorActions >= 3 && groupLengths.every((length) => length <= 24)) {
        issues.push({ type: 'action-chain-fragmented', label: '连续动作链切得过碎', index: paragraphIndex, text: group.join('') });
      }
    }
  });

  const thirdPersonMarkerCount = (nonDialogueText.match(/他|她|魏杰|阿米娅|博士|主角|少年|少女|男人|女人/g) || []).length;
  const firstPersonNarrationMatches = [...nonDialogueText.matchAll(/(?:^|[\n。！？!?，,；;])\s*(我|我们|我的|咱|咱们)(?:[^方军]|$)/g)].filter((match) => {
    const start = Math.max(0, match.index - 36);
    const end = Math.min(nonDialogueText.length, match.index + 80);
    const context = nonDialogueText.slice(start, end);
    if (/心里|内心|脑子里|念头|想法|想吼|想骂|想说|想告诉|想反驳|下意识|只剩下一个念头|冒出|闪过/.test(context)) return false;
    if (/[:：]\s*(?:我|我们|我的|咱|咱们)/.test(context)) return false;
    return true;
  });
  if (thirdPersonMarkerCount >= 1 && firstPersonNarrationMatches.length >= 1) {
    issues.push({
      type: 'pov-shift',
      label: '第三人称章节混入第一人称旁白',
      index: Math.max(0, text.indexOf(firstPersonNarrationMatches[0][1])),
      text: firstPersonNarrationMatches.slice(0, 3).map((match) => match[0].trim()).join('\n'),
      count: firstPersonNarrationMatches.length,
    });
  }

  const isolatedShortMatches = [...text.matchAll(/(?:^|[\n。！？!?])\s*(没动|空的|安静|停住|不对|够了|算了|等等|别动|走)[。！？!?]/g)];
  if (isolatedShortMatches.length >= 2) {
    issues.push({
      type: 'isolated-short-sentence-density',
      label: '孤立短句密度过高',
      index: isolatedShortMatches[1].index || 0,
      text: isolatedShortMatches.slice(0, 5).map((match) => match[0].trim()).join('\n'),
      count: isolatedShortMatches.length,
    });
  }

  const nounFragmentCount = issues.filter((issue) => issue.type === 'noun-fragment-sentence').length;
  if (nounFragmentCount >= 2) {
    issues.push({
      type: 'noun-fragment-density',
      label: '名词碎句密度过高',
      index: issues.find((issue) => issue.type === 'noun-fragment-sentence')?.index || 0,
      text: `全文出现名词碎句${nounFragmentCount}处`,
      count: nounFragmentCount,
    });
  }

  const isolatedLabelCount = issues.filter((issue) => issue.type === 'isolated-label-sentence').length;
  if (isolatedLabelCount >= 2) {
    issues.push({
      type: 'isolated-label-density',
      label: '孤立标签短句密度过高',
      index: issues.find((issue) => issue.type === 'isolated-label-sentence')?.index || 0,
      text: `全文出现孤立标签短句${isolatedLabelCount}处`,
      count: isolatedLabelCount,
    });
  }

  for (let idx = 0; idx <= lines.length - 3; idx += 1) {
    const group = lines.slice(idx, idx + 3).map((line) => line.trim()).filter(Boolean);
    if (group.length < 3) continue;
    const allShort = group.every((line) => line.replace(/[，。！？,.!?\s]/g, '').length <= 8);
    const allSentence = group.every((line) => /[。！？!?]$/.test(line));
    if (allShort && allSentence) {
      issues.push({ type: 'short-line-pileup', label: '连续三行短句排比', line: idx, text: group.join('\n') });
    }
  }

  return issues.sort((a, b) => (a.index || 0) - (b.index || 0));
}

function getNaturalnessRepairWindow(content = '', issue = {}) {
  const lines = normalizeText(content).split('\n');
  if (typeof issue.line === 'number') {
    const startLine = Math.max(0, issue.line - 2);
    const endLine = Math.min(lines.length, issue.line + 5);
    return {
      before: lines.slice(0, startLine).join('\n'),
      target: lines.slice(startLine, endLine).join('\n'),
      after: lines.slice(endLine).join('\n'),
    };
  }

  const index = issue.index || 0;
  const startSearch = content.lastIndexOf('\n\n', index);
  const start = startSearch === -1 ? 0 : startSearch + 2;
  const issueEnd = index + normalizeText(issue.text).length;
  const endSearch = content.indexOf('\n\n', Math.min(content.length, issueEnd || index));
  const end = endSearch === -1 ? content.length : endSearch;
  return {
    before: content.slice(0, start).trimEnd(),
    target: content.slice(start, end).trim(),
    after: content.slice(end).trimStart(),
  };
}

function replaceNaturalnessWindow(content = '', window = {}, repaired = '') {
  return stripMarkdownNoise([window.before, normalizeText(repaired).trim(), window.after].filter(Boolean).join('\n\n'));
}

function splitAiChapterSections(text, { startChapter = 1, batchCount } = {}) {
  const normalized = normalizeChapterOutput(text);
  if (!normalized) return [];
  const sections = normalized
    .split(/\n(?=###\s*第\s*[一二三四五六七八九十百千万两〇零\d]+\s*章)/)
    .map((item) => item.trim())
    .filter((item) => /^###\s*第\s*[一二三四五六七八九十百千万两〇零\d]+\s*章/.test(item));

  if (sections.length) return Number(batchCount) ? sections.slice(0, Number(batchCount)) : sections;

  if ((Number(batchCount) || 1) === 1) {
    return [`### 第${Number(startChapter) || 1}章 新章节\n${normalized}`];
  }

  return [normalized];
}

function extractGeneratedSections(text) {
  return splitAiChapterSections(text);
}

function isInvalidGeneratedChapter(chapter = {}) {
  if (!chapter) return true;
  const content = normalizeText(chapter.content).trim();
  const compact = content.replace(/\s+/g, '');
  if (!content) return true;
  if (/^(FAIL|PASS|缺失|未生成|无正文|正文缺失|本章缺失|本章未生成)$/i.test(compact)) return true;
  if (compact.length <= 80 && /^(FAIL|缺失|未生成|无正文|正文缺失|本章缺失|本章未生成|本章未能)/i.test(compact)) return true;
  return false;
}

function makeGeneratedChapter(section, volumeId) {
  const cleaned = normalizeChapterOutput(section);
  const titleMatch = cleaned.match(/^###\s*(.+?)(?:\n|$)/);
  const body = cleaned.replace(/^###\s*.+?(?:\n|$)/, '').trim();
  const labeledTitle = extractChapterField(body, chapterTitleLabels, allChapterFieldLabels);
  const summaryLabel = body.match(new RegExp(`(?:^|\\n)(?:${chapterSummaryLabels.join('|')})[:：]\\s*`));
  const hasExplicitContent = Boolean(findFieldLabel(body, chapterContentLabels));
  let summary = extractChapterField(body, chapterSummaryLabels, allChapterFieldLabels).trim();
  let content = extractChapterField(body, chapterContentLabels, []);

  if (!content && summaryLabel) {
    const summaryStart = (summaryLabel.index || 0) + summaryLabel[0].length;
    const afterSummary = body.slice(summaryStart).trim();
    const lines = afterSummary.split('\n');
    if (!hasExplicitContent) {
      summary = buildChapterSummaryFromContent(lines.slice(0, 3).join('\n') || body);
    }
    content = lines
      .slice(1)
      .filter((line) => !isChapterMetadataLine(line))
      .join('\n')
      .trim();
  } else if (!content) {
    content = body;
  }

  if (!summary) {
    summary = buildChapterSummaryFromContent(content || body);
  }

  content = hasExplicitContent ? stripTrailingChapterMetadata(content) : sanitizeImportedContent(content);
  const headerTitle = cleanImportedChapterTitle(titleMatch?.[1] || '', '新章节');
  const title = labeledTitle && (!stripChapterNumber(headerTitle) || stripChapterNumber(headerTitle) === '新章节')
    ? labeledTitle
    : headerTitle;

  return createChapter({
    title: cleanImportedChapterTitle(title, '新章节'),
    summary,
    content: content || sanitizeImportedContent(body),
    volumeId,
  });
}

function buildRecentContext(chapters, limit = 3) {
  return (chapters || [])
    .slice(-limit)
    .map((chapter) => [chapter.title, `摘要：${chapter.summary || ''}`, '正文末段：', normalizeText(chapter.content).slice(-800)].join('\n'))
    .join('\n\n');
}

function buildChapterRangeContext(chapters, startChapter, endChapter) {
  return chapters
    .slice(startChapter - 1, endChapter)
    .map((chapter, index) => [
      `### 第${startChapter + index}章 ${chapter.title.replace(/^第\s*[一二三四五六七八九十百千万两〇零\d]+\s*章\s*/, '')}`,
      `摘要：${chapter.summary || ''}`,
      '正文：',
      chapter.content || '',
    ].join('\n'))
    .join('\n\n');
}

function isBlankStarterChapter(chapter, index) {
  return index === 0
    && countWords(chapter?.content || '') === 0
    && !normalizeText(chapter?.summary).trim()
    && /^第\s*1\s*章\s*(开场|新章节)?$/.test(normalizeText(chapter?.title).trim());
}

function getAutomationWriteState(project) {
  const chapters = project.chapters || [];
  const replaceBlankStarter = chapters.length === 1 && isBlankStarterChapter(chapters[0], 0);
  const writtenCount = replaceBlankStarter ? 0 : chapters.length;
  return {
    replaceBlankStarter,
    writtenCount,
    nextChapterStart: writtenCount + 1,
  };
}

function stripChapterNumber(title = '') {
  return normalizeText(title).replace(/^第\s*[一二三四五六七八九十百千万两〇零\d]+\s*章\s*/, '').trim();
}

function chineseChapterNumberToNumber(value = '') {
  const text = normalizeText(value).replace(/\s+/g, '');
  if (/^\d+$/.test(text)) return Number(text);
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (text === '十') return 10;
  const hundredParts = text.split('百');
  let total = 0;
  let rest = text;
  if (hundredParts.length === 2) {
    total += (digits[hundredParts[0]] || 1) * 100;
    rest = hundredParts[1];
  }
  if (rest.includes('十')) {
    const [tens, ones] = rest.split('十');
    total += (tens ? digits[tens] || 0 : 1) * 10;
    total += ones ? digits[ones] || 0 : 0;
    return total || 0;
  }
  if (rest.length > 1) {
    const numeric = rest.split('').map((char) => digits[char]).filter((item) => item !== undefined).join('');
    return numeric ? Number(numeric) : total;
  }
  return total + (digits[rest] || 0);
}

function getChapterNumberFromTitle(title = '') {
  const match = normalizeText(title).match(/^第\s*([一二三四五六七八九十百千万两〇零\d]+)\s*章/);
  return match ? chineseChapterNumberToNumber(match[1]) : 0;
}

function withChapterNumber(chapter, chapterNumber) {
  const suffix = stripChapterNumber(chapter.title) || '新章节';
  return {
    ...chapter,
    title: `第${chapterNumber}章 ${suffix}`,
  };
}

function getTargetChapterWords(automation = {}) {
  const target = Number(automation.averageChapterWords) || 2400;
  return Math.min(3200, Math.max(2200, target));
}

function getMinimumChapterWords(automation = {}) {
  return Math.max(2000, Math.floor(getTargetChapterWords(automation) * 0.88));
}

function normalizeGeneratedChapters(sections, _cards, defaultVolumeId, options = {}) {
  const startChapter = Number(options.startChapter) || 1;
  const batchCount = Number(options.batchCount) || sections.length;
  const slots = Array.from({ length: batchCount }, () => null);

  sections.forEach((section, sourceIdx) => {
    const chapter = makeGeneratedChapter(section, defaultVolumeId);
    const chapterNumber = getChapterNumberFromTitle(chapter.title);
    const directIdx = chapterNumber ? chapterNumber - startChapter : -1;
    const idx = directIdx >= 0 && directIdx < batchCount && !slots[directIdx]
      ? directIdx
      : slots.findIndex((item) => !item);
    if (idx < 0) return;
    const generatedTitle = cleanImportedChapterTitle(chapter.title, '新章节');
    const generatedSuffix = stripChapterNumber(generatedTitle);
    const title = generatedSuffix && generatedSuffix !== '新章节'
      ? generatedTitle
      : cleanImportedChapterTitle(generatedTitle, `第${startChapter + idx}章 新章节`);
    slots[idx] = {
      ...chapter,
      title,
      summary: normalizeChapterSummary(chapter.summary || '', chapter.content || ''),
    };
  });

  return slots;
}

function importAiGeneratedChapters(text, { startChapter = 1, batchCount = 1, defaultVolumeId = '' } = {}) {
  const expectedCount = Math.max(1, Number(batchCount) || 1);
  const start = Math.max(1, Number(startChapter) || 1);
  const sections = splitAiChapterSections(text, { startChapter: start, batchCount: expectedCount });
  const slots = Array.from({ length: expectedCount }, () => null);

  sections.forEach((section) => {
    const chapter = makeGeneratedChapter(section, defaultVolumeId);
    if (isInvalidGeneratedChapter(chapter)) return;
    const explicitNumber = getChapterNumberFromTitle(chapter.title);
    const directIndex = explicitNumber ? explicitNumber - start : -1;
    const index = directIndex >= 0 && directIndex < expectedCount && !slots[directIndex]
      ? directIndex
      : slots.findIndex((item) => !item);
    if (index < 0) return;

    const numbered = withChapterNumber({
      ...chapter,
      title: cleanImportedChapterTitle(chapter.title, `第${start + index}章 新章节`),
      summary: normalizeChapterSummary(chapter.summary || '', chapter.content || ''),
      content: chapter.content,
      volumeId: chapter.volumeId || defaultVolumeId,
    }, start + index);

    slots[index] = isInvalidGeneratedChapter(numbered) ? null : numbered;
  });

  return slots;
}

function parseAiChapterText(text, { startChapter = 1, batchCount, defaultVolumeId = '' } = {}) {
  const effectiveBatchCount = Number(batchCount) || Math.max(1, splitAiChapterSections(text).length);
  return importAiGeneratedChapters(text, { startChapter, batchCount: effectiveBatchCount, defaultVolumeId }).filter(Boolean);
}

function makeSingleChapterFromLooseText(text, { chapterNumber = 1, defaultVolumeId = '' } = {}) {
  const raw = normalizeText(text).trim();
  if (!raw) return null;
  const section = /^###\s*第\s*[一二三四五六七八九十百千万两〇零\d]+\s*章/.test(normalizeChapterOutput(raw))
    ? raw
    : `### 第${chapterNumber}章 新章节\n${raw}`;
  const chapter = makeGeneratedChapter(section, defaultVolumeId);
  const content = normalizeText(chapter.content || raw).trim();
  const summary = normalizeChapterSummary(chapter.summary || '', content);
  const title = cleanImportedChapterTitle(chapter.title, `第${chapterNumber}章 新章节`);
  const candidate = createChapter({
    ...chapter,
    title,
    summary,
    content,
    volumeId: defaultVolumeId,
  });
  return isInvalidGeneratedChapter(candidate) ? null : withChapterNumber(candidate, chapterNumber);
}

function isAutomationReviewWarning(warning = '') {
  return /暂停|人工确认|自然感硬检测仍未通过|发布前校验未通过|轻量发布前校验要求人工确认|审校失败/.test(normalizeText(warning));
}

function getAutomationReviewPause(warnings = []) {
  return (warnings || []).some(isAutomationReviewWarning);
}

async function generateSupplementChapter({ apiKey, model, baseUrl, project, automation, card, chapterNumber, previousChapter, nextChapter, defaultVolumeId, reason = '', signal, onToken }) {
  const prompt = promptComposer.buildRepairPrompt([
    '请只补写一章，且必须严格输出单章格式：### 第X章 标题 / 摘要：... / 正文：...',
    '这一章必须按真人写作模块补成可读小说，不是填补缺失字段，也不能写成占位内容。',
    '若上一轮输出缺少章节边界，本次只补这一章，不要输出其他章节。',
    '硬性要求：不得提前进入核心冲突，不得打乱反派梯度，不得脱离蓝图；摘要必须单独完整输出，且只写本章要点，不能把正文第一句或正文原文混进摘要；正文必须是真正文，不要写“本章未能...”之类提示。',
    buildNoMetaNarrationGuide(),
    buildProjectStyleGuide(project, automation),
    buildHumanWritingSystemGuide({ project, automation, card, chapterNumber, previousChapter, scope: '补写缺失章节' }),
    buildPositiveDraftingSkeletonGuide(card),
    buildParagraphBudgetGuide({ project, automation, card, chapterNumber }),
    buildNaturalReadingGuard(),
    buildSyntaxBudgetGuard(),
    buildSentenceRhythmGuard(),
    buildActionChainNarrationGuard(),
    buildHumanTextureGuide(project),
    buildDialogueSceneGuide({ project, card }),
    buildNarrativeTextureBudgetGuide(card),
    `章节号：第${chapterNumber}章`,
    buildPacingGuardText({ currentCount: chapterNumber - 1, batchCount: 1, targetChapters: automation.targetChapters || 600 }),
    '本章章节卡：',
    formatChapterCard(card, chapterNumber),
    reason ? `补写原因：${reason}` : '',
    '长篇蓝图：',
    automation.masterPlan,
    '前一章：',
    previousChapter ? `${previousChapter.title}\n摘要：${previousChapter.summary || ''}\n正文末段：${normalizeText(previousChapter.content).slice(-800)}` : '',
    '后一章预告：',
    nextChapter ? `${nextChapter.title}\n摘要：${nextChapter.summary || ''}` : '',
    '请直接输出，不要解释。',
  ]);

  const text = onToken
    ? await callDeepSeekStream({ apiKey, model, baseUrl, temperature: 0.82, userPrompt: prompt, signal, timeoutMs: 300000, onToken })
    : await callDeepSeek({ apiKey, model, baseUrl, temperature: 0.82, userPrompt: prompt, signal });
  const sections = extractGeneratedSections(text).slice(0, 1);
  if (!sections.length) {
    const looseChapter = makeSingleChapterFromLooseText(text, { chapterNumber, defaultVolumeId });
    if (!looseChapter) throw new Error('补写章节未返回可解析内容');
    return { text, chapter: looseChapter };
  }
  const chapter = normalizeGeneratedChapters(sections, [card], defaultVolumeId, { startChapter: chapterNumber, batchCount: 1 })[0];
  if (!chapter?.content || chapter.content.includes('本章未能从 AI 输出中稳定拆分出来')) {
    throw new Error('补写章节内容无效');
  }
  return { text, chapter: withChapterNumber({ ...chapter, volumeId: card?.volumeId || defaultVolumeId }, chapterNumber) };
}

async function expandChapterToTargetWords({ apiKey, model, baseUrl, project, automation, chapter, card, chapterNumber, defaultVolumeId, signal }) {
  const targetWords = getTargetChapterWords(automation);
  const minWords = getMinimumChapterWords(automation);
  if (!chapter || countWords(chapter.content) >= minWords) return { chapter, text: '' };

  const prompt = promptComposer.buildRepairPrompt([
    '请扩写下面这一章，保持原标题、原摘要、原剧情走向不变。扩写方式必须像真人作者补场：补人物口吻、错误行动后的修正、现实打断、短对话和同场景选择，不要为了凑字增加物件档案式细节。',
    `目标：正文至少${minWords}字，尽量接近${targetWords}字；不要少于下限，不要写下一章内容。`,
    '输出格式必须为：### 第X章 标题\n摘要：...\n正文：...',
    '摘要必须独立输出，不能直接截取正文第一句，也不能把正文内容混入摘要。',
    buildNoMetaNarrationGuide(),
    buildProjectStyleGuide(project, automation),
    buildHumanWritingSystemGuide({ project, automation, card, chapterNumber, scope: '扩写偏短章节' }),
    buildPositiveDraftingSkeletonGuide(card),
    buildParagraphBudgetGuide({ project, automation, card, chapterNumber }),
    buildNaturalReadingGuard(),
    buildSyntaxBudgetGuard(),
    buildSentenceRhythmGuard(),
    buildActionChainNarrationGuard(),
    buildHumanTextureGuide(project),
    buildDialogueSceneGuide({ project, card }),
    buildNarrativeTextureBudgetGuide(card),
    `章节号：第${chapterNumber}章`,
    card ? '章节卡只作为写作约束，不得把章节卡摘要当成输出摘要或正文：' : '',
    card ? formatChapterCard(card, chapterNumber) : '',
    '长篇蓝图：',
    automation.masterPlan || '',
    '当前章节：',
    serializeGeneratedChapters([chapter], chapterNumber),
  ]);

  const text = await callDeepSeek({ apiKey, model, baseUrl, temperature: 0.75, userPrompt: prompt, maxTokens: 8192, signal });
  const expanded = importAiGeneratedChapters(text, { startChapter: chapterNumber, batchCount: 1, defaultVolumeId })[0];
  if (!expanded || isInvalidGeneratedChapter(expanded)) return { chapter, text };
  return countWords(expanded.content) > countWords(chapter.content)
    ? { chapter: expanded, text }
    : { chapter, text };
}

async function ensureChapterMinimumWords({ apiKey, model, baseUrl, project, automation, chapter, card, chapterNumber, defaultVolumeId, signal, contextText = '' }) {
  const minWords = getMinimumChapterWords(automation);
  if (!chapter || countWords(chapter.content) >= minWords) return { chapter, text: '' };

  const targetWords = getTargetChapterWords(automation);
  const prompt = promptComposer.buildRepairPrompt([
    '请在不改变当前章节剧情、人物关系、场景和章末方向的前提下，按真人写作模块只补足同场景内的人物口吻、错误行动后的修正、行动受阻、短对话和必要过渡。不要为了真实感补充物件档案。',
    `目标：将正文补到至少${minWords}字，尽量接近${targetWords}字；不要新增大事件，不要跳场，不要写下一章。`,
    '允许增加：动作受阻、环境造成的具体麻烦、人物反应、短对话、系统提示承接。',
    '禁止增加：新设定、新人物线、新场景切换、超出当前章节卡的剧情。',
    '如果当前章节摘要不完整，请在补字内容中同时给出更像摘要的独立摘要段，不要用正文第一句充当摘要。',
    buildNoMetaNarrationGuide(),
    buildProjectStyleGuide(project, automation),
    buildHumanWritingSystemGuide({ project, automation, card, chapterNumber, scope: '保存前补字' }),
    buildPlatformStrategyGuide(project, automation),
    buildParagraphBudgetGuide({ project, automation, card, chapterNumber }),
    buildNaturalReadingGuard(),
    buildSyntaxBudgetGuard(),
    buildSentenceRhythmGuard(),
    buildActionChainNarrationGuard(),
    `章节号：第${chapterNumber}章`,
    card ? '当前章节卡：' : '',
    card ? formatChapterCard(card, chapterNumber) : '',
    '当前章节：',
    serializeGeneratedChapters([chapter], chapterNumber),
    contextText ? '补字参考上下文：' : '',
    contextText,
  ]);

  const text = await callDeepSeek({ apiKey, model, baseUrl, temperature: 0.62, maxTokens: 8192, userPrompt: prompt, signal });
  const expanded = importAiGeneratedChapters(text, { startChapter: chapterNumber, batchCount: 1, defaultVolumeId })[0];
  if (!expanded || isInvalidGeneratedChapter(expanded)) return { chapter, text };
  return countWords(expanded.content) >= countWords(chapter.content)
    ? { chapter: expanded, text }
    : { chapter, text };
}

async function repairNaturalnessLocallyWithAi({ apiKey, model, baseUrl, project, automation, chapter, card, chapterNumber, issue, signal }) {
  const window = getNaturalnessRepairWindow(chapter.content || '', issue);
  if (!window.target) return { chapter, text: '' };

  const prompt = promptComposer.buildRepairPrompt([
    '请只修下面这个问题片段，不要重写整章。',
    '目标：删除 AI 味强的机械强调句、Markdown 痕迹、短句排比或模板钩子，同时保持原剧情、人物动作、信息量和前后文衔接不变。',
    buildProjectStyleGuide(project, automation),
    buildHumanRevisionDirective({ project, automation, card, chapterNumber, scope: '局部修订' }),
    buildParagraphBudgetGuide({ project, automation, card, chapterNumber }),
    buildNaturalReadingGuard(),
    buildSyntaxBudgetGuard(),
    buildSentenceRhythmGuard(),
    buildActionChainNarrationGuard(),
    buildHumanTextureGuide(project),
    buildDialogueSceneGuide({ project, card }),
    buildNarrativeTextureBudgetGuide(card),
    buildNoMetaNarrationGuide(),
    '本次命中的问题：',
    `${issue.label || issue.type}：${issue.text || ''}`,
    '改写方式：',
    '1. 优先把解释性判断改成现场反馈和动作改变：证据先出现，人物停半拍或验证一下，然后下一步动作改变。',
    '2. 保持完整谓语动作，不要把动作改成没有谓语的名词碎句。',
    '3. Markdown 星号直接删除，系统面板保留中文方括号即可。',
    '4. 不要增加新剧情、新人物、新设定，不要提前下一章。',
    '5. 保持片段原本的信息顺序和因果关系；不要把相邻信息合并成新的判断。连续动作必须写成完整谓语句，不要写成“某个声音，连着几下”这类分镜备注。',
    '5a. 如果问题是逗号堆叠长句、细节缠绕句、主体模糊、补丁式描写或原因状态结果切碎，优先压缩修顺，不要机械拆碎：保留清晰主干 + 一个有效细节，删掉重复状态、颜色形状补丁和多余解释；只有原句实在绕口时才拆成2句。',
    '5b. 改写细节句时，直接让物件或人物动作做主语。把“昨晚没洗干净，现在干成，一碰掉下”合并成“昨晚没洗净的东西干成细屑，随着动作掉下”；把“衣服上有污渍，颜色干了，在织物上晕成”合并成“污渍干透，在织物上晕开”；把“碎片的位置透过布料反射”改成“碎片隔着布料透出光”。',
    '5c. 如果片段是观察清单，把它改成一个明确动作链：角色为了当前目标去拿、试、躲、收、走，物件信息只在动作中顺带出现。',
    '5c-1. 如果片段是“这是/这里是/房间是 + 破折号/冒号 + 床、柜、担架、终端清单”的静态房间总结，删掉总结句，改成“身体动作/目标动作 → 碰到或借用一个环境物 → 得出场所判断 → 继续下一步”。',
    '5c-2. 如果片段在第三人称章节中混入“我/我们/我的”旁白，改回第三人称贴身视角。台词里的第一人称保留；非台词里的“我低笑/我想/我知道”改成“他低笑/他想/他意识到”或更自然的动作反应。',
    '5e. 如果片段是环境扫描清单，把环境判断并入一个身体动作。示例方向：角色扶住空柜站稳、指尖掠过床架，再顺带判断这里是临时医疗点；不要保留床、担架、药柜、脚印、气味平权罗列。',
    '5d. 如果片段把一个物件写成档案卡，只保留一个有效信息。比如纸条只保留“撤离”指向，删掉背面空白、没有签名、没有日期、字迹说明等补全字段。',
    '5f. 如果片段是动作后静态清单断裂，重写成“动作受阻 → 碰到/借用一个环境物 → 得出场所判断 → 继续下一步”。不要保留动作后突然列灯、床、柜、门、屏幕的结构。',
    '5g. 心理描写只在本片段需要时保留：必须由动作、物件、声音、身体反应或废墟尺度触发，并改变下一步动作、暴露人物状态、制造选择压力或形成角色口吻；没有功能的解释型心理直接删掉。',
    '5h. 如果片段是解释性判断，只改命中的句子：让物件、声音、动作或人物停顿直接给出结果；自然的“没有回头/没有停下/没有系统提示”可以保留。',
    '5h-1. 如果同类解释判断密度过高，优先改成“现场证据 → 人物动作 → 选择变化”，不要新增解释段。',
    '5h-2. 调查线索章的改法：保留一个异常点，让它直接导致触摸、收起、绕路、停下或进入；不要写鉴定报告。示例：“不是风吹倒的，是被外力拉倒的”改成“插孔边缘有新撬出的白茬，他收起牌子，沿倒塌方向看过去”。',
    '5h-3. 如果片段是“不是A，也不是B，而是/就是C”“不再是A，也不是B。它变成C”“这意味着/说明/代表C”这类旁白解释升格，不要同义替换。改成：一个具体痕迹或物件细节 → 角色停顿/触摸/收起/避开 → 下一步动作。意义让读者从动作里读出来。',
    '5h-4. 如果片段是“一条A，一块B，一个C”三项名词排比，只保留最影响当前动作的一项；其余信息并入视线扫过、手指摸到、物件卡住、角色改变路线等动作，或者删掉。',
    '5i. 如果片段是细节维度过载，只保留主干 + 一个有效异常点。调查物件只保留功能信息或异常信息，不同时展开位置、材质、颜色、新旧、比喻和判断。',
    '5j. 如果问题是关键异常后缺少反应桥、人物反应与行动转折生硬、动作转折缺少最小动机：只补1-3句轻桥接。必须让“上一事件 → 一个反应/验证 → 下一动作”自然连上。优先用脚步停半拍、视线停住、转动设备、伸手触碰、短问一句、调整背包/路线等动作，不要用旁白解释“因为信任/因为时间紧”。',
    '5j-1. “没问/没有解释/点头/继续走”可以保留，但不能孤立承担剧情转折；若它们出现在关键异常后，必须前后加一个可感知动作或验证结果。',
    '5k. 如果片段是连续短句链或短台词链，不要扩写成解释段，也不要删掉剧情信息。只做连接修复：把连续短问、短命令、短判断合并为1-2句自然承接，或补一个明确对象、动作方向、风险条件、身体反应或选择后果。急促感来自动作和打断，不来自省掉必要名词。',
    '5l. 如果台词是“不A，不B，也不C”“别A，别B，也别C”这类同句连续否定排比，不要保留清单腔。改成一个正向承诺或主动作，再轻带限制。例如“我只看罗德岛标记，旧锁和检测物都不碰，通讯也压到最低。”保持人物目的和风险边界，不要变成规则朗读。',
    '6. 只输出修复后的片段正文，不要标题、摘要、解释或 Markdown。',
    `作品名：${project.title}`,
    `章节号：第${chapterNumber}章`,
    card ? '本章章节卡：' : '',
    card ? formatChapterCard(card, chapterNumber) : '',
    automation.authorPersona ? buildAuthorPersonaGuide(automation.authorPersona) : '',
    '需要修复的片段：',
    window.target,
  ]);

  const repaired = await callDeepSeek({ apiKey, model, baseUrl, temperature: 0.45, maxTokens: 2048, userPrompt: prompt, signal });
  const nextContent = replaceNaturalnessWindow(chapter.content || '', window, sanitizeImportedContent(repaired) || window.target);
  return {
    chapter: createChapter({
      ...chapter,
      content: nextContent,
      updatedAt: now(),
    }),
    text: `第${chapterNumber}章自然感局部修复：${issue.label || issue.type}`,
  };
}

async function rewriteChapterNaturalnessWithAi({ apiKey, model, baseUrl, project, automation, chapter, card, chapterNumber, issues, signal }) {
  const prompt = promptComposer.buildRepairPrompt([
    '请做一次分层正文清洗：先修结构，再顺句子。',
    '任务不是新增剧情，也不是把正文改成规则样板。必须保留原剧情、人物动作、人物关系、场景推进、系统提示含义和章末方向；只在不改因果的前提下重排段落，让物件信息跟随人物行动出现。',
    buildProjectStyleGuide(project, automation),
    buildHumanRevisionDirective({ project, automation, card, chapterNumber, scope: '整章清洗' }),
    buildParagraphBudgetGuide({ project, automation, card, chapterNumber }),
    buildPositiveDraftingSkeletonGuide(card),
    buildNaturalReadingGuard(),
    buildSentenceRhythmGuard(),
    buildActionChainNarrationGuard(),
    buildHumanTextureGuide(project),
    buildDialogueSceneGuide({ project, card }),
    buildNarrativeTextureBudgetGuide(card),
    buildNoMetaNarrationGuide(),
    '本次硬检测命中的问题：',
    (issues || []).slice(0, 12).map((issue) => `- ${issue.label || issue.type}：${issue.text || ''}`).join('\n'),
    '第一层：硬错误必须修。POV错位、Markdown/元叙事、章节越界、静态房间总结清单必须归零。',
    '第二层：结构问题优先修。把环境扫描、道具档案、动作后清单改成“目标 → 动作 → 反馈 → 新选择”；不要为了修句子先改情节。',
    '第三层：句式问题软修。否定判断、短句、逗号长句只有密度高或卡在章首章末时才压缩；自然辨析和角色口吻可以保留。',
    '第四层：衔接问题强修。关键异常、线索、系统提示、戒指变化、铭牌编号、入口出现后，不能直接“点头/没问/继续走”；必须补一个轻反应桥或验证动作，让下一步行动从上一事件自然长出来。',
    '第四层补充：连续短句链、短问链、短命令链要做连接修复。把它们合并为1-2句自然承接，或补清对象、方向、条件和动作后果；不要扩写成解释段，不要改变剧情顺序。',
    '第四层补充二：同一句里的连续否定排比要自然化。把“不A，不B，也不C”改成“主动作/承诺 + 顺带限制”，保留风险边界但不要像清单。',
    '句子清洗只做三件事：让承载过多的长句回到动作和反馈；把解释性判断改成现场反馈；把连续碎句接回自然动作链。不要为了避开词语把原意改反。',
    '心理描写按功能许可证保留：能改变动作、暴露状态、制造选择压力或形成口吻的短心理保留；解释型心理删掉或换成动作。',
    '只输出清洗后的正文，不要标题、摘要、原因或任何说明。',
    `作品名：${project.title}`,
    `题材：${project.genre}`,
    `章节号：第${chapterNumber}章 ${chapter.title}`,
    automation.authorPersona ? buildAuthorPersonaGuide(automation.authorPersona) : '',
    card ? '本章章节卡：' : '',
    card ? formatChapterCard(card, chapterNumber) : '',
    '原正文：',
    chapter.content || '',
  ]);

  const text = await callDeepSeek({ apiKey, model, baseUrl, temperature: 0.38, maxTokens: 8192, userPrompt: prompt, signal });
  const content = stripMarkdownNoise(sanitizeImportedContent(text));
  return createChapter({
    ...chapter,
    content: content || chapter.content,
    updatedAt: now(),
  });
}

async function ensureAutomationChapterNaturalness({ apiKey, model, baseUrl, project, automation, chapter, card, chapterNumber, signal }) {
  let currentChapter = chapter;
  const texts = [];
  let currentIssues = relaxDialogueChapterNaturalnessIssues([...findNaturalnessIssues(currentChapter.content || ''), ...findDialogueIssues(currentChapter.content || '', card)], currentChapter.content || '', card);
  let currentSeverity = classifyNaturalnessIssues(currentIssues, currentChapter.content || '');
  if (currentSeverity === 'none') return { chapter: currentChapter, text: '', severity: currentSeverity, issues: [] };
  if (currentSeverity === 'light') {
    return { chapter: currentChapter, text: `第${chapterNumber}章自然感提示：${currentIssues.map((issue) => issue.label).join('；')}`, severity: currentSeverity, issues: currentIssues };
  }

  if (currentSeverity === 'medium') {
    for (let repairCount = 0; repairCount < 5; repairCount += 1) {
      let issue = pickNaturalnessRepairIssue(currentIssues, ['plain-negative-density', 'isolated-short-sentence-density']);
      if (!issue) {
        issue = currentIssues.find((item) => item.type === 'mechanical-negation-window-density')
          || currentIssues.find((item) => item.type === 'mechanical-negation-density')
          || currentIssues.find((item) => item.type === 'negative-turn-density');
      }
      if (!issue) break;
      const repaired = await repairNaturalnessLocallyWithAi({
        apiKey,
        model,
        baseUrl,
        project,
        automation,
        chapter: currentChapter,
        card,
        chapterNumber,
        issue,
        signal,
      });
      currentChapter = repaired.chapter || currentChapter;
      if (repaired.text) texts.push(repaired.text);
      currentIssues = relaxDialogueChapterNaturalnessIssues([...findNaturalnessIssues(currentChapter.content || ''), ...findDialogueIssues(currentChapter.content || '', card)], currentChapter.content || '', card);
      currentSeverity = classifyNaturalnessIssues(currentIssues, currentChapter.content || '');
      if (currentSeverity === 'none' || currentSeverity === 'light') break;
      if (currentSeverity === 'heavy') break;
    }
    return { chapter: currentChapter, text: texts.join('\n'), severity: currentSeverity, issues: currentIssues };
  }

  if (currentSeverity === 'heavy' && isHighDialogueChapter(card)) {
    const protectedTypes = ['negative-turn-density', 'plain-negative-density', 'mechanical-negation-density', 'mechanical-negation-window-density', 'dialogue-too-sparse', 'dialogue-too-aligned'];
    const issue = pickNaturalnessRepairIssue(currentIssues, protectedTypes);
    if (issue) {
      const repaired = await repairNaturalnessLocallyWithAi({
        apiKey,
        model,
        baseUrl,
        project,
        automation,
        chapter: currentChapter,
        card,
        chapterNumber,
        issue,
        signal,
      });
      currentChapter = repaired.chapter || currentChapter;
      if (repaired.text) texts.push(repaired.text);
      currentIssues = relaxDialogueChapterNaturalnessIssues([...findNaturalnessIssues(currentChapter.content || ''), ...findDialogueIssues(currentChapter.content || '', card)], currentChapter.content || '', card);
      currentSeverity = classifyNaturalnessIssues(currentIssues, currentChapter.content || '');
    }
      const remainingCommaIssue = pickNaturalnessRepairIssue(currentIssues, protectedTypes);
    if (remainingCommaIssue) {
      const repaired = await repairNaturalnessLocallyWithAi({
        apiKey,
        model,
        baseUrl,
        project,
        automation,
        chapter: currentChapter,
        card,
        chapterNumber,
        issue: remainingCommaIssue,
        signal,
      });
      currentChapter = repaired.chapter || currentChapter;
      if (repaired.text) texts.push(repaired.text);
      currentIssues = relaxDialogueChapterNaturalnessIssues([...findNaturalnessIssues(currentChapter.content || ''), ...findDialogueIssues(currentChapter.content || '', card)], currentChapter.content || '', card);
      currentSeverity = classifyNaturalnessIssues(currentIssues, currentChapter.content || '');
    }
    return { chapter: currentChapter, text: texts.join('\n'), severity: currentSeverity, issues: currentIssues };
  }

  if (currentSeverity === 'heavy') {
    const rewritten = await rewriteChapterNaturalnessWithAi({
      apiKey,
      model,
      baseUrl,
      project,
      automation,
      chapter: currentChapter,
      card,
      chapterNumber,
      issues: currentIssues,
      signal,
    });
    currentChapter = rewritten;
    texts.push(`第${chapterNumber}章自然感整章清洗：否定揭示/Markdown/碎句密度`);
    currentIssues = relaxDialogueChapterNaturalnessIssues([...findNaturalnessIssues(currentChapter.content || ''), ...findDialogueIssues(currentChapter.content || '', card)], currentChapter.content || '', card);
    currentSeverity = classifyNaturalnessIssues(currentIssues, currentChapter.content || '');

    for (let repairCount = 0; repairCount < 3; repairCount += 1) {
      const negationIssue = currentIssues.find((item) => item.type === 'mechanical-negation-window-density')
        || currentIssues.find((item) => item.type === 'mechanical-negation-density');
      if (!negationIssue) break;
      const repaired = await repairNaturalnessLocallyWithAi({
        apiKey,
        model,
        baseUrl,
        project,
        automation,
        chapter: currentChapter,
        card,
        chapterNumber,
        issue: negationIssue,
        signal,
      });
      currentChapter = repaired.chapter || currentChapter;
      if (repaired.text) texts.push(repaired.text);
      currentIssues = relaxDialogueChapterNaturalnessIssues([...findNaturalnessIssues(currentChapter.content || ''), ...findDialogueIssues(currentChapter.content || '', card)], currentChapter.content || '', card);
      currentSeverity = classifyNaturalnessIssues(currentIssues, currentChapter.content || '');
      if (!currentIssues.some((item) => /^mechanical-negation/.test(item.type))) break;
    }

    for (let repairCount = 0; repairCount < 3; repairCount += 1) {
      const detailIssue = pickNaturalnessRepairIssue(currentIssues, ['negative-turn-density', 'plain-negative-density', 'mechanical-negation-density', 'mechanical-negation-window-density', 'isolated-short-sentence-density']);
      if (!detailIssue) break;
      const repaired = await repairNaturalnessLocallyWithAi({
        apiKey,
        model,
        baseUrl,
        project,
        automation,
        chapter: currentChapter,
        card,
        chapterNumber,
        issue: detailIssue,
        signal,
      });
      currentChapter = repaired.chapter || currentChapter;
      if (repaired.text) texts.push(repaired.text);
      currentIssues = relaxDialogueChapterNaturalnessIssues([...findNaturalnessIssues(currentChapter.content || ''), ...findDialogueIssues(currentChapter.content || '', card)], currentChapter.content || '', card);
      currentSeverity = classifyNaturalnessIssues(currentIssues, currentChapter.content || '');
    }

    for (let repairCount = 0; repairCount < 2; repairCount += 1) {
      const localIssue = pickNaturalnessRepairIssue(currentIssues, ['negative-turn-density', 'plain-negative-density', 'mechanical-negation-density', 'mechanical-negation-window-density', 'isolated-short-sentence-density']);
      if (!localIssue) break;
      const repaired = await repairNaturalnessLocallyWithAi({
        apiKey,
        model,
        baseUrl,
        project,
        automation,
        chapter: currentChapter,
        card,
        chapterNumber,
        issue: localIssue,
        signal,
      });
      currentChapter = repaired.chapter || currentChapter;
      if (repaired.text) texts.push(repaired.text);
      currentIssues = relaxDialogueChapterNaturalnessIssues([...findNaturalnessIssues(currentChapter.content || ''), ...findDialogueIssues(currentChapter.content || '', card)], currentChapter.content || '', card);
      currentSeverity = classifyNaturalnessIssues(currentIssues, currentChapter.content || '');
      if (currentSeverity === 'none' || currentSeverity === 'light') break;
    }

    if (currentSeverity === 'heavy') {
      const rewrittenAgain = await rewriteChapterNaturalnessWithAi({
        apiKey,
        model,
        baseUrl,
        project,
        automation,
        chapter: currentChapter,
        card,
        chapterNumber,
        issues: currentIssues,
        signal,
      });
      currentChapter = rewrittenAgain;
      texts.push(`第${chapterNumber}章自然感二次整章清洗：硬检测兜底`);
      currentIssues = relaxDialogueChapterNaturalnessIssues([...findNaturalnessIssues(currentChapter.content || ''), ...findDialogueIssues(currentChapter.content || '', card)], currentChapter.content || '', card);
      currentSeverity = classifyNaturalnessIssues(currentIssues, currentChapter.content || '');
    }
  }

  return { chapter: currentChapter, text: texts.join('\n'), severity: currentSeverity, issues: currentIssues };
}

function normalizePacingRepairChapters({ text, plannedCards, originalChapters, defaultVolumeId, startChapter, batchCount }) {
  const sections = extractGeneratedSections(text).slice(0, batchCount);
  if (!sections.length) {
    return { chapters: originalChapters.slice(0, batchCount).map((chapter, idx) => withChapterNumber(chapter, startChapter + idx)), repairedCount: 0 };
  }

  const repaired = normalizeGeneratedChapters(sections, plannedCards, defaultVolumeId, { startChapter, batchCount })
    .slice(0, batchCount)
    .map((chapter, idx) => (isInvalidGeneratedChapter(chapter) ? null : withChapterNumber(chapter, startChapter + idx)));

  const chapters = originalChapters.slice(0, batchCount).map((chapter, idx) => {
    const repairedChapter = repaired[idx];
    if (!repairedChapter) {
      return withChapterNumber(chapter, startChapter + idx);
    }
    return withChapterNumber({
      ...chapter,
      ...repairedChapter,
      volumeId: repairedChapter.volumeId || chapter.volumeId,
    }, startChapter + idx);
  });

  return { chapters, repairedCount: repaired.filter(Boolean).length };
}

async function auditAndRepairPacing({ apiKey, model, baseUrl, project, automation, chapters, plannedCards, startChapter, batchCount, signal }) {
  const auditPrompt = [
    '你是长篇网文节奏审稿器。请检查下面章节是否超过当前章节卡和蓝图阶段。',
    '如果出现提前进入后续卷高潮、终局主线、终局反派、最终秘密揭露、跨越几百章的大事件，必须判定 FAIL。',
    '若 PASS，只输出：PASS',
    '若 FAIL，请直接重写这些章节，保持相同章节数，格式严格为：### 第X章 标题 / 摘要：... / 正文：...。重写时只能写当前章节卡允许的小目标和局部冲突。',
    buildPacingGuardText({ currentCount: startChapter - 1, batchCount, targetChapters: automation.targetChapters || 600 }),
    '长篇蓝图：',
    automation.masterPlan,
    '当前章节卡：',
    plannedCards.map((card, idx) => formatChapterCard(card, startChapter + idx)).join('\n\n'),
    '待审章节：',
    serializeGeneratedChapters(chapters, startChapter),
  ].join('\n');

  const text = await callDeepSeek({ apiKey, model, baseUrl, temperature: 0.35, userPrompt: auditPrompt, signal });
  if (/^\s*PASS\b/i.test(text)) {
    return { text: '', chapters };
  }

  const repaired = normalizePacingRepairChapters({
    text,
    plannedCards,
    originalChapters: chapters,
    defaultVolumeId: project.volumes[0]?.id || '',
    startChapter,
    batchCount,
  });

  if (!repaired.repairedCount) {
    throw new Error('节奏守门发现剧情超前，但 AI 未返回可解析的修订章节，已保留原始章节');
  }

  return { text, chapters: repaired.chapters };
}

function validateChapterRhythmPlan(text = '') {
  const normalized = normalizeText(text).trim();
  if (!normalized) return { pass: false, reason: '节奏谱为空' };
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  const paragraphTypeMatches = normalized.match(/承压段|行动段|错误行动段|信息段|留白段|缓冲段|对话段|钩子段/g) || [];
  const uniqueTypes = new Set(paragraphTypeMatches);
  const hasExecutionPlan = /主目标/.test(normalized) && /核心信息/.test(normalized) && /章末钩子/.test(normalized);
  const hasEnoughBeats = lines.length >= 8 && paragraphTypeMatches.length >= 6 && uniqueTypes.size >= 4;
  const hasActionStructure = hasExecutionPlan && /段落节奏谱|节奏谱/.test(normalized);
  const hasProseLeak = /正文[:：]|###\s*第|摘要[:：]/.test(normalized) || normalized.length > 2600;
  return {
    pass: hasEnoughBeats && hasActionStructure && !hasProseLeak,
    reason: hasProseLeak ? '节奏谱混入正文格式' : !hasActionStructure ? '缺少执行计划或节奏谱结构' : !hasEnoughBeats ? '节奏谱节点或类型不足' : '',
  };
}

function buildFallbackRhythmPlan(card = {}, chapterNumber = 1) {
  return [
    '【章节卡执行计划】',
    `主目标：${card.allowedBeats || card.summary || `完成第${chapterNumber}章当前小目标`}。`,
    `主要场景：${card.openAction || '承接上一章结果，在当前场景内推进，不频繁跳场'}。`,
    `核心信息：${card.readerExpectation || card.commercialBeat || '只交付一个关键发现或一个小结果'}。`,
    `关系变化：${card.foreshadowing || '人物只发生一次试探、误解、让步或信任变化'}。`,
    `章末钩子：${card.hook || card.endingDelivery || '留下一个具体未解决动作、消息、物件异常或路线选择'}。`,
    `本章不写：${card.forbiddenBeats || '不写完整撤离、正式组队、终局解释、后续大战或跨阶段结果'}。`,
    '',
    '【段落节奏谱】',
    '1. 类型：承压段；作用：承接上一章危险或身体压力，让人物先忍住/停住，不立刻解释；素材：上一章末状态、身体不适、环境压迫。',
    '2. 类型：信息段；作用：系统、物件或声音只给出一个不完整信息；素材：章节卡核心信息；限制：不解释完整意义。',
    '3. 类型：错误行动段；作用：主角以为能直接推进，现场反馈打断；限制：写现场证据如何改变动作。',
    '4. 类型：行动段；作用：人物绕行、搜刮、接近或转移；限制：环境只写一个会影响动作的物件。',
    '5. 类型：缓冲段；作用：短吐槽、身体不适或生活化反应，打破连续战术记录。',
    '6. 类型：留白段；作用：异常出现但主角暂时压下，不解释；素材：伏笔、系统杂音、残缺词。',
    '7. 类型：对话段；作用：一句话改变关系或暴露不信任；限制：不把所有信息说清。',
    '8. 类型：钩子段；作用：具体威胁、选择或未解决动作出现，停在必须处理的下一步。',
  ].join('\n');
}

function splitCardStoryFacts(card = {}) {
  return [card.chapterGoal, card.coreEvent, card.keyClue, card.chapterResult, card.allowedBeats, card.readerExpectation, card.foreshadowing, card.commercialBeat, card.systemRule, card.summary, card.hook]
    .map(normalizeText)
    .join('。')
    .split(/[。！？；;\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4 && !/禁止|不得|不能|写法|开头|段落|检测|真人写作引擎/.test(item));
}

function parseNarrativeBeatPlan(text = '') {
  const normalized = normalizeText(text).replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const sections = normalized
    .split(/\n(?=【\s*叙事拍\s*\d+\s*】|叙事拍\s*\d+[:：])/g)
    .map((item) => item.trim())
    .filter((item) => /(?:【\s*)?叙事拍\s*\d+/.test(item));
  return sections.map((section, index) => ({
    index: index + 1,
    title: extractLabeledField(section, ['名称', '拍名', '标题'], ['目标', '事件', '人物', '信息', '视角', '可见', '可听', '可推测', '不可断言', '句法预算', '停点']) || `叙事拍${index + 1}`,
    goal: extractLabeledField(section, ['目标', '作用'], ['事件', '人物', '信息', '视角', '可见', '可听', '可推测', '不可断言', '句法预算', '停点']),
    event: extractLabeledField(section, ['事件', '行动', '发生'], ['人物', '信息', '视角', '可见', '可听', '可推测', '不可断言', '句法预算', '停点']),
    cast: extractLabeledField(section, ['人物', '出场人物'], ['信息', '视角', '可见', '可听', '可推测', '不可断言', '句法预算', '停点']),
    information: extractLabeledField(section, ['信息', '释放信息'], ['视角', '可见', '可听', '可推测', '不可断言', '句法预算', '停点']),
    pov: extractLabeledField(section, ['视角', 'POV'], ['可见', '可听', '可推测', '不可断言', '句法预算', '停点']) || '主角',
    visible: extractLabeledField(section, ['可见'], ['可听', '可推测', '不可断言', '句法预算', '停点']),
    audible: extractLabeledField(section, ['可听'], ['可推测', '不可断言', '句法预算', '停点']),
    inferable: extractLabeledField(section, ['可推测'], ['不可断言', '句法预算', '停点']),
    forbiddenAssertions: extractLabeledField(section, ['不可断言', '不能断言'], ['句法预算', '停点']),
    syntaxBudget: extractLabeledField(section, ['句法预算', '预算'], ['停点']),
    endpoint: extractLabeledField(section, ['停点', '结尾', '收束'], ['【', '叙事拍']),
  })).filter((beat) => beat.goal || beat.event || beat.information);
}

function validateNarrativeBeatPlan(beats = []) {
  const valid = Array.isArray(beats) ? beats : [];
  const enough = valid.length >= 5 && valid.length <= 9;
  const withPermission = valid.filter((beat) => beat.visible && beat.audible && beat.forbiddenAssertions).length;
  const withEvent = valid.filter((beat) => beat.event && beat.goal).length;
  return {
    pass: enough && withPermission >= Math.min(4, valid.length) && withEvent >= Math.min(5, valid.length),
    reason: !enough ? '叙事拍数量不足或过多' : withPermission < Math.min(4, valid.length) ? '感知权限不足' : withEvent < Math.min(5, valid.length) ? '目标事件不足' : '',
  };
}

function buildFallbackNarrativeBeatPlan(card = {}, chapterNumber = 1) {
  const facts = splitCardStoryFacts(card);
  const protagonist = /魏杰/.test([card.cast, card.summary, card.coreEvent].map(normalizeText).join('\n')) ? '魏杰' : '主角';
  const hook = card.hook || card.chapterResult || facts.at(-1) || '新的威胁逼近，人物必须马上选择下一步';
  const templates = [
    ['困境进入', card.openAction || facts[0] || `第${chapterNumber}章从当前麻烦直接进入`, '只让人物先处理眼前压力'],
    ['错误行动', facts[1] || card.chapterGoal || '人物按旧经验尝试推进', '现场反馈迫使人物改动作'],
    ['线索触碰', card.keyClue || facts[2] || '人物碰到一个能改变路线的物件或声音', '释放一个不完整信息'],
    ['关系碰撞', card.cast || facts[3] || '在场人物用动作或一句话改变关系', '让不信任或误会落到当场选择'],
    ['系统/规则反馈', card.systemRule || facts[4] || '系统或规则只给出短反馈', '反馈必须改变下一步动作'],
    ['代价推进', card.chapterResult || facts[5] || '人物拿到小结果，同时付出代价', '把爽点落在结果上'],
    ['章末停点', hook, '停在具体动作、声音、物件变化、路线选择或一句没说完的话前'],
  ];
  return templates.map(([title, event, goal], index) => ({
    index: index + 1,
    title,
    goal,
    event,
    cast: card.cast || protagonist,
    information: index === templates.length - 1 ? hook : (facts[index] || event),
    pov: protagonist,
    visible: '人物眼前的地形、物件、动作、表情和距离；只写当前视角能看见的东西',
    audible: '脚步、呼吸、通讯杂音、系统短讯或近处动静；声音来源不清时只写方向和变化',
    inferable: '人物可以根据声音、伤势、距离、物件用途和对方反应做有限推测',
    forbiddenAssertions: '不能直接断言视野外人物身份、鞋子材质、精确人数、完整动机、完整设定来源；先给证据，再让人物行动验证',
    syntaxBudget: '260-430字；长句最多1个；破折号最多0个；否定判断0个；身体细节最多1个；环境细节最多2个；解释/总结句最多1句',
    endpoint: index === templates.length - 1 ? hook : '以一个动作变化、短台词、声音靠近或物件反馈收束',
  }));
}

function formatNarrativeBeatPlan(beats = []) {
  return beats.map((beat, index) => [
    `【叙事拍${index + 1}】`,
    `名称：${beat.title || `叙事拍${index + 1}`}`,
    `目标：${beat.goal || ''}`,
    `事件：${beat.event || ''}`,
    `人物：${beat.cast || ''}`,
    `信息：${beat.information || ''}`,
    `视角：${beat.pov || '主角'}`,
    `可见：${beat.visible || ''}`,
    `可听：${beat.audible || ''}`,
    `可推测：${beat.inferable || ''}`,
    `不可断言：${beat.forbiddenAssertions || ''}`,
    `句法预算：${beat.syntaxBudget || ''}`,
    `停点：${beat.endpoint || ''}`,
  ].join('\n')).join('\n\n');
}

function buildBeatDirectorGuide(beat = {}, index = 0, total = 1) {
  return [
    `当前只写第${index + 1}/${total}个叙事拍，不写整章。`,
    `拍名：${beat.title || `叙事拍${index + 1}`}`,
    `目标：${beat.goal || ''}`,
    `事件：${beat.event || ''}`,
    `出场人物：${beat.cast || ''}`,
    `本拍只释放的信息：${beat.information || ''}`,
    `视角人物：${beat.pov || '主角'}`,
    '感知权限：',
    `可见：${beat.visible || '只写视角人物眼前能看见的动作和物件'}`,
    `可听：${beat.audible || '只写方向、远近和变化，不替人物精确命名看不见的来源'}`,
    `可推测：${beat.inferable || '推测必须来自现场证据，并立刻影响动作'}`,
    `不可断言：${beat.forbiddenAssertions || '不能替视角人物知道视野外身份、动机、数量和完整设定'}`,
    `句法预算：${beat.syntaxBudget || '260-430字；每句只承载一个动作、感知或选择；解释/总结句最多1句'}`,
    `本拍停点：${beat.endpoint || '以一个动作变化、短台词、声音靠近或物件反馈收束'}`,
  ].join('\n');
}

function getBeatGateIssues(content = '', card = {}) {
  const issues = relaxDialogueChapterNaturalnessIssues([...findNaturalnessIssues(content), ...findDialogueIssues(content, card)], content, card);
  const blockingTypes = new Set([
    'markdown-noise',
    'negative-reveal',
    'negative-comma-triple',
    'negative-triple',
    'negative-dash-reveal',
    'negative-period-reveal',
    'negative-comma-reveal',
    'auditory-overclaim',
    'negative-turn-density',
    'mechanical-negation-density',
    'mechanical-negation-window-density',
    'plain-negative-density',
    'comma-stacked-long-sentence',
    'detail-dimension-overload',
    'inventory-scan-paragraph',
    'scene-asset-overload',
    'prop-dossier-description',
    'parallel-body-detail-overload',
    'parallel-scene-detail-overload',
    'dash-explain-judgement',
    'sentence-chain-flatness',
    'isolated-label-sentence',
  ]);
  return issues.filter((issue) => blockingTypes.has(issue.type));
}

function stripBeatDraftNoise(text = '') {
  return stripMarkdownNoise(normalizeText(text)
    .replace(/【短导演令】[\s\S]*$/g, '')
    .replace(/【章节导演上下文[\s\S]*$/g, '')
    .replace(/^\s*正文\s*[:：]/, '')
    .replace(/^\s*本拍正文\s*[:：]/, '')
    .replace(/^\s*【[^】]{1,30}】\s*/gm, '')
    .replace(/^\s*叙事拍\s*\d+\s*[:：].*$/gm, '')
    .trim());
}

function classifyDashFunction(sentence = '') {
  const text = normalizeText(sentence).trim();
  if (!/[—-]{1,2}/.test(text)) return 'none';
  if (/^【[^】]*[—-]{1,2}[^】]*】/.test(text) || /【[^】]*[—-]{1,2}[^】]*】/.test(text)) return 'system_panel';
  if (/“[^”]*[—-]{1,2}\s*”/.test(text) || /“[^”]*[—-]{1,2}\s*$/.test(text)) return 'dialogue_cut';
  const after = text.split(/[—-]{1,2}/).slice(1).join('—').trim();
  if (/^(?:是|就是|这是|这说明|这意味着|说明|意味着|代表|像是|更像|其实|不对|不是|而是)/.test(after)) return 'explanation';
  if (/^(?:\d+|[一二三四五六七八九十百千万两]+|冷却|电量|距离|坐标|状态|奖励|任务|进度|宿主|技能|等级|编号|余量|剩余|限时|精度|倒计时)/.test(after)) return 'light_detail';
  if (/^(?:门|脚步|系统|光屏|对讲机|匕首|枪|弩|声音|哭声|喊声|风声|雷声|车灯|卡车|奶妈|修士)/.test(after)) return 'interruption';
  if (/^(?:完了|等等|不行|糟了|操|妈的|草|这下|他想|她想|杜震宇想|魏杰想)/.test(after)) return 'emotion_cut';
  if (/(?:真相|身份|血脉|天赋|灵根|系统来源|不是普通|天生|转生|穿越)/.test(text)) return 'reveal';
  return 'light_detail';
}

function replaceDashByFunction(sentence = '') {
  const type = classifyDashFunction(sentence);
  const text = normalizeText(sentence);
  if (type === 'none' || type === 'dialogue_cut') return text;
  if (type === 'system_panel') {
    return text.replace(/【([^】]*?)[—-]{1,2}\s*([^】]*?)】/g, '【$1：$2】');
  }
  if (type === 'light_detail') {
    return text.replace(/[—-]{1,2}\s*/g, '，');
  }
  if (type === 'interruption') {
    return text.replace(/[—-]{1,2}\s*/g, '。');
  }
  if (type === 'emotion_cut') {
    return text.replace(/[—-]{1,2}\s*/g, '。');
  }
  if (type === 'explanation' || type === 'reveal') {
    return text
      .replace(/[—-]{1,2}\s*(?:是|就是|说明|意味着|代表|像是|更像|其实)\s*/g, '，')
      .replace(/[—-]{1,2}\s*(?:不对|不是|而是)\s*/g, '，');
  }
  return text;
}

function normalizeDashUsage(content = '') {
  return normalizeText(content)
    .split(/([^。！？!?\n]*[—-]{1,2}[^。！？!?\n]*[。！？!?]?)/g)
    .map((part) => /[—-]{1,2}/.test(part) ? replaceDashByFunction(part) : part)
    .join('')
    .replace(/。{2,}/g, '。')
    .replace(/，{2,}/g, '，')
    .replace(/，。/g, '。')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildPerceptionScope({ project = {}, card = {}, scenePack = null, chapterNumber = 1 } = {}) {
  const text = [project.title, project.genre, project.premise, project.styleGuide, card.title, card.summary, card.coreEvent, card.cast, scenePack?.title, scenePack?.goal].map(normalizeText).join('\n');
  const povCharacter = /魏杰/.test(text) ? '魏杰' : (/杜蓁蓁|杜震宇|女婴/.test(text) ? '杜蓁蓁' : (normalizeText(card.cast).split(/[、,，]/).find(Boolean) || '主角'));
  const isInfant = /女婴|婴儿|襁褓|纸尿裤|喝奶|倒拎|塞着脚/.test(text);
  const isConstrained = /倒拎|悬空|捆|襁褓|夹缝|受伤|昏迷|黑暗|遮挡/.test(text);
  return {
    povCharacter,
    bodyState: [isInfant ? '女婴身体，脖子和四肢控制很弱' : '', /倒拎|悬空/.test(text) ? '被倒拎或悬空，视野受限' : '', isConstrained ? '行动和视野受限' : '正常行动视角'].filter(Boolean),
    availableSenses: {
      sight: isInfant ? ['眼前局部', '眼角余光', '襁褓遮挡', '近处衣摆', '头顶局部'] : ['眼前可见物', '余光', '近处动作', '光线变化'],
      hearing: ['说话声', '脚步声', '碰撞声', '系统提示音'],
      touch: isInfant ? ['嘴里的触感', '襁褓束缚', '被拎起的晃动', '身体失控'] : ['掌心触感', '脚下反馈', '疼痛和重量'],
      smell: ['近处气味'],
      inner: ['困惑', '恐惧', '判断', '意识到的身体限制'],
    },
    forbiddenKnowledge: ['完整房间布局', '看不见的身后情况', '他人内心', '未看清的脸色', '远处精确细节', '俯拍视角', '未听见的身份信息'],
    requiredAnchors: ['看见', '听见', '闻到', '摸到', '感觉到', '发现', '意识到', '察觉', '余光', '眼前', '耳边', '掌心', '喉咙', '皮肤'],
    chapterNumber,
  };
}

function formatPerceptionScopeForPrompt(scope = {}) {
  const senses = scope.availableSenses || {};
  return [
    '【感知准入规则】',
    `POV人物：${scope.povCharacter || '主角'}`,
    `身体/视野状态：${(scope.bodyState || []).join('；')}`,
    `可见：${(senses.sight || []).join('；')}`,
    `可听：${(senses.hearing || []).join('；')}`,
    `可触/体感：${(senses.touch || []).join('；')}`,
    `可闻：${(senses.smell || []).join('；')}`,
    `可写内在：${(senses.inner || []).join('；')}`,
    `禁止直接断言：${(scope.forbiddenKnowledge || []).join('；')}`,
    '外部信息点必须有感知来源：看见/听见/摸到/闻到/感觉到/发现/意识到/余光/眼前/耳边等。',
    '人物动作、心理和台词可正常写；环境、物体、他人状态、距离方位、系统变化必须能回答“人物怎么知道”。',
    '禁止摄像机报景：房间里、远处、她身后、头顶是、某人脸上露出等，除非句内或前句已有感知凭证。',
  ].filter(Boolean).join('\n');
}

const PERCEPTION_ANCHOR_RE = /看见|看到|听见|听到|闻到|摸到|碰到|感觉|感到|发现|意识到|察觉|余光|眼前|视线|耳边|掌心|喉咙|皮肤|瞥见|望见|盯着|抬眼|低头|眨/;

function splitPerceptionSentences(content = '') {
  return normalizeText(content).split(/(?<=[。！？!?])|\n+/).map((item) => item.trim()).filter(Boolean);
}

function findPerceptionIssues(content = '', scope = {}) {
  const sentences = splitPerceptionSentences(content);
  const issues = [];
  sentences.forEach((sentence, index) => {
    const previous = sentences[index - 1] || '';
    const context = `${previous}${sentence}`;
    if (/^(?:视野倒转|头顶是|房间里|远处|走廊尽头|空气中|墙上|地面上|她身后|他身后)|粉色的襁褓布垂下来/.test(sentence) && !PERCEPTION_ANCHOR_RE.test(sentence)) {
      issues.push({ type: 'camera-like-description', label: '摄像机式无来源描写', text: sentence });
    }
    if (/(?:头顶是|房间里|远处|走廊尽头|空气中弥漫|墙上|地面上)[^。！？!?]{1,60}/.test(sentence) && !PERCEPTION_ANCHOR_RE.test(context)) {
      issues.push({ type: 'ungrounded-perception', label: '外部信息缺少感知来源', text: sentence });
    }
    if (/蹬了蹬(?:没被塞进嘴里的)?(?:另|另一)条腿，(?:却)?够不到/.test(sentence) || /(?:抬头|伸手|转头|低头)，[^。！？!?]{1,40}(?:很远|很高|够不到|看不清)/.test(sentence)) {
      issues.push({ type: 'missing-cognition-verb', label: '动作后缺少发现/意识到', text: sentence });
    }
    if (/(?:另|另一)条腿/.test(sentence) && !/没被|另一只|嘴里|脚/.test(context)) {
      issues.push({ type: 'orphaned-body-reference', label: '身体部位参照不清', text: sentence });
    }
  });
  return issues;
}

function repairPerceptionLocally(content = '', scope = {}) {
  return normalizeText(content)
    .replace(/视野倒转。/g, '她眨了好几下眼，才意识到不是屋顶歪了，是自己正被倒拎着。')
    .replace(/粉色的襁褓布垂下来，头顶是灰白的石质天花板。/g, '她费力转动眼珠，只看见粉色襁褓布从脸侧垂下来，布缝外露出一小块灰白石顶。')
    .replace(/她蹬了蹬另一条腿，够不到任何东西。/g, '她蹬了蹬没被塞进嘴里的那条腿，这才发现脚尖连床沿都碰不到。')
    .replace(/她蹬了蹬没被塞进嘴里的另一条腿，够不到任何东西。/g, '她蹬了蹬没被塞进嘴里的那条腿，这才发现脚尖连床沿都碰不到。')
    .replace(/头顶是([^。！？!?]{2,40})。/g, '她抬眼，只看见头顶$1。')
    .replace(/空气中弥漫着([^。！？!?]{2,40})。/g, '她闻到空气里有$1。')
    .replace(/房间里([^。！？!?]{2,50})。/g, '她能看见的范围里$1。')
    .replace(/远处传来([^。！？!?]{2,40})。/g, '她听见远处传来$1。')
    .replace(/([^。！？!?]{0,18})抬头，([^。！？!?]{1,30})(很高|很远|看不清|够不到)/g, '$1费力抬头，才发现$2$3')
    .replace(/([^。！？!?]{0,18})伸手，([^。！？!?]{1,30})(很远|够不到)/g, '$1伸手去够，才发现$2$3')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function applyPerceptionGate(content = '', scope = {}) {
  const issues = findPerceptionIssues(content, scope);
  const repaired = issues.length ? repairPerceptionLocally(content, scope) : normalizeText(content).trim();
  return { content: repaired, issues };
}

function sentenceCoreLength(sentence = '') {
  return normalizeText(sentence).replace(/[，。！？,.!?\n\s“”"'‘’、]/g, '').length;
}

function isAllowedShortBeat(sentence = '') {
  const text = normalizeText(sentence).trim();
  return /^(?:是她|是他|脚步声停了|哭声断了|她愣住了|他愣住了|门开了|灯灭了|声音断了|刀停住了|血停了)[。！？!?]?$/.test(text);
}

function isSensoryFragment(sentence = '') {
  const text = normalizeText(sentence).trim();
  if (!text || isAllowedShortBeat(text)) return false;
  return /^(?:她|他|杜蓁蓁)?(?:抬手|低头|睁眼|睁开眼|抬起手|伸手|手指|五指|整只手|皮肤|鼻腔|喉咙|嘴里|眼前|视野|耳边|脸颊|指尖|胳膊|腿|脖子|哭声|气味|冷意|凉意)/.test(text) && sentenceCoreLength(text) <= 22;
}

function findRhythmIssues(content = '') {
  const text = normalizeText(content);
  const issues = [];
  const opening = text.slice(0, 320);
  const openingSentences = splitPerceptionSentences(opening);
  const openingShortCount = openingSentences.filter((sentence) => sentenceCoreLength(sentence) <= 12).length;
  if (openingSentences.length >= 4 && openingShortCount >= 3) {
    issues.push({ type: 'staccato-opening', label: '开头短句链平直', index: 0, text: opening.slice(0, 180) });
  }
  for (let idx = 0; idx <= openingSentences.length - 3; idx += 1) {
    const group = openingSentences.slice(idx, idx + 4).filter(Boolean);
    if (group.length >= 3 && group.filter(isSensoryFragment).length >= 3) {
      issues.push({ type: 'sensory-fragment-chain', label: '连续感知短句未串联', index: text.indexOf(group[0]), text: group.join('') });
      break;
    }
  }
  [...text.matchAll(/(?:^|[\n。！？!?])\s*(冷|很冷|真的很冷|雪|血|疼|黑|安静|沉默|心跳|一张脸|脚步声|停顿半秒)[。！？!?]/g)].forEach((match) => {
    if (isAllowedShortBeat(match[0].replace(/^[\n。！？!?]\s*/, ''))) return;
    issues.push({ type: 'isolated-sensation-fragment', label: '孤立感官/名词碎句', index: match.index || 0, text: match[0].trim() });
  });
  if (/她僵住了。[\s\n]*手指停下了。/.test(text) || /她愣住。[\s\n]*又试一次。/.test(text)) {
    issues.push({ type: 'fragmented-action-chain', label: '动作链切得过碎', index: text.search(/她(?:僵住|愣住)/), text: text.match(/她(?:僵住了|愣住)。[\s\n]*(?:手指停下了|又试一次。)/)?.[0] || '' });
  }
  [...text.matchAll(/不是[^。！？!?]{1,40}[，。](?:而是|是|像是)[^。！？!?]{1,60}[。！？!?]/g)].forEach((match) => {
    issues.push({ type: 'negative-reveal-chain', label: '否定揭示链', index: match.index || 0, text: match[0].trim() });
  });
  if (/不止冷，还有气味。/.test(text)) {
    issues.push({ type: 'repeated-short-beat-chain', label: '感知短句链', index: text.indexOf('不止冷'), text: text.slice(text.indexOf('不止冷'), text.indexOf('不止冷') + 120) });
  }
  return issues;
}

function repairRhythmLocally(content = '') {
  return normalizeText(content)
    .replace(/脸贴着冰凉。\n\n她被一记撞击声吵醒。像有什么东西砸在木头上。\n\n睁开眼。左半张脸压着湿冷的触感，鼻子里灌进一股枯草和泥土的气味。/g, '脸颊贴着冰凉时，她被一记撞击声吵醒，像有什么东西砸在木头上。她费力睁开眼，左半张脸还压着湿冷的东西，鼻子里灌进枯草和泥土的气味。')
    .replace(/她抬手。手指软得像没有骨头。五指分不开。整只手像一只肉球。/g, '她抬起手，手指软得像没有骨头，五指也分不开，整只手像一只粉红色的肉球。')
    .replace(/她抬起右手。手指软得像没有骨头，五指也分不开，整只手像一只粉红色的肉球。/g, '她抬起右手，手指软得像没有骨头，五指也分不开，整只手像一只粉红色的肉球。')
    .replace(/雪。脸颊下面是雪。雪化成水渗进布料，贴着皮肤，凉得她一个激灵。/g, '她这才意识到脸颊下面压着的是雪，化开的水正渗进布料，贴着皮肤凉得她一个激灵。')
    .replace(/冷。真的很冷。/g, '冷意顺着皮肤往里钻，冻得她连呼吸都发紧。')
    .replace(/她僵住了。\n\n手指停下了。/g, '她僵在原地，刚抬起的手指也停在半空。')
    .replace(/她僵住了。\s*手指停下了。/g, '她僵在原地，刚抬起的手指也停在半空。')
    .replace(/停顿半秒。/g, '那个声音顿了半秒。')
    .replace(/不是风声，是脚步声。/g, '风声里混进了细碎的脚步声。')
    .replace(/不是想哭。是([^。！？!?]{1,80})。/g, '$1。')
    .replace(/不是不想说。\s*是([^。！？!?]{1,80})。/g, '$1。')
    .replace(/不对。重点不是这个。重点是，/g, '她刚想继续想下去，却立刻把注意力拽回眼前。')
    .replace(/不是。等一下，/g, '她念头一顿，')
    .replace(/不止冷，还有气味。腐土腥甜，像铁锈，还有别的臭，烂肉和排泄物混在一起的味道。身体躺的地方不对，这不是产房，不是医院。/g, '冷意之外，腐土和铁锈似的腥甜气味也钻进鼻腔，还混着烂肉和排泄物的臭味。她终于意识到自己躺的地方不对，这里绝不是产房，也不是医院。')
    .replace(/心跳。是有什么东西在她胸腔里跳动了一下/g, '胸口猛地一跳，像有什么东西在她胸腔里拨了一下')
    .replace(/一张脸。年轻女人，/g, '她好不容易稳住视线，才看清抱着自己的是个年轻女人，')
    .replace(/不是脂粉香，像是草药混着雪化后的干净水汽。/g, '那气味没有脂粉的甜腻，更像草药混着雪化后的干净水汽。')
    .replace(/不是一步。是三步。/g, '她连退三步。')
    .replace(/不是([^。！？!?，,]{1,24})，像是([^。！？!?]{1,50})。/g, '不像$1，更像$2。')
    .replace(/([，。！？!?\n]\s*)我(?=挣扎|试着|张嘴|盯着|想追问|转了转|呼吸|拼命|还没|愣住|闭上眼|抡圆|从床|低头|抬起|缩身|松手|又变|躺在|被吊|在那人|看见|使劲|又|只能|偏头|抬头|咬着牙|一边|现在|深吸|收回|侧过|没法|倒吸|能看见|能闻见|余光|前世|活了)/g, '$1她')
    .replace(/([，。！？!?\n]\s*)我的(?=世界|手|脚|脸|脖子|身体|视野|脑子)/g, '$1她的')
    .replace(/落在我(?=脸上|身上|手上|肩膀|怀里)/g, '落在她')
    .replace(/蹭到我(?=鼻尖|脸|脖子|手|脚)/g, '蹭到她')
    .replace(/朝我(?=脖子|脸|这边|压下来|扑过来)/g, '朝她')
    .replace(/把我(?=拎|夹|抱|缠|裹|吊)/g, '把她')
    .replace(/离我(?=上身|脸|手|脚|不到)/g, '离她')
    .replace(/(^|[\n。！？!?])我(?=使劲|又|只能|偏头|抬头|咬着牙|一边|现在|试着|深吸|收回|侧过|没法|倒吸|能看见|能闻见|余光|张大嘴|想|愣|前世|活了)/g, '$1她')
    .replace(/，我(?=使劲|又|只能|偏头|抬头|咬着牙|一边|现在|试着|深吸|收回|侧过|没法|倒吸|能看见|能闻见|余光|张大嘴|想|愣|前世|活了)/g, '，她')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function applyRhythmGate(content = '') {
  const issues = findRhythmIssues(content);
  const repaired = issues.length ? repairRhythmLocally(content) : normalizeText(content).trim();
  return { content: repaired, issues };
}

function polishMechanicalDraftLocally(content = '') {
  return normalizeDashUsage(normalizeText(content))
    .replace(/【短导演令】[\s\S]*$/g, '')
    .replace(/【章节导演上下文[\s\S]*$/g, '')
    .replace(/脚步声——不止一个人的——正/g, '不止一道脚步声正')
    .replace(/脚步声从转角传来——嘎吱，嘎吱，节奏稳定，没有停顿。/g, '脚步声从转角传来，碎石被踩得轻响。节奏稳定，没有停顿。')
    .replace(/倒计时已经开始跳了。45。44。43。数字很小，浅灰色字体。/g, '倒计时开始跳动，45、44、43，浅灰色数字缩在光屏角落。')
    .replace(/检测到敌方单位——东侧巡逻队/g, '检测到敌方单位：东侧巡逻队')
    .replace(/敌方单位——/g, '敌方单位：')
    .split(/(\n{2,})/)
    .map((part) => {
      if (/^\n+$/.test(part) || part.length < 90) return part;
      return part.replace(/([^。！？\n]{70,160}，[^。！？\n]{12,80}，[^。！？\n]{12,80})，/g, '$1。');
    })
    .join('')
    .replace(/([。！？])\n{2,}([。！？])/g, '$1\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function polishGeneratedDraftLocally(content = '', perceptionScope = null) {
  let polished = polishMechanicalDraftLocally(content);
  if (!perceptionScope) return polished;
  polished = repairSystemMessageLocally(polished);
  polished = applyInteriorMonologueGate(polished).content;
  polished = applyPerceptionGate(polished, perceptionScope).content;
  polished = applyEnvironmentScanGate(polished).content;
  polished = applySyntaxGate(polished).content;
  polished = applyRhythmGate(polished).content;
  polished = repairDuplicateEmphasisLocally(polished);
  polished = applySyntaxGate(polished).content;
  polished = applyInteriorMonologueGate(polished).content;
  return repairSystemMessageLocally(polishMechanicalDraftLocally(polished));
}

function repairDuplicateEmphasisLocally(content = '') {
  return normalizeText(content)
    .replace(/脚步声停了。\s*停了。\s*停在她([^。！？!?]{1,40})。/g, '脚步声停在她$1。')
    .replace(/脚步声停了。\s*停了。/g, '脚步声停住了。')
    .replace(/哭声断了。\s*断了。/g, '哭声被硬生生卡在喉咙里。')
    .replace(/冷。\s*还是很冷。/g, '冷意还在往骨头缝里钻。')
    .replace(/风停了。\s*火还在烧/g, '风停了，火还在烧')
    .trim();
}

function formatRhythmGateGuide() {
  return [
    '【句群节奏规则】',
    '每个自然段优先形成连续体验链：动作 → 感知 → 身体/心理反应 → 下一选择。',
    '短句只能当重锤，每段最多一个；不要用连续短句、名词碎句或判断碎句假装节奏。',
    '连续的感知描写不要全部用短句；一个感知段落内，用逗号将感官细节串联成气息连贯的句子。',
    '错误：她抬手。手指软得像没有骨头。五指分不开。整只手像一只肉球。',
    '正确：她抬起手，手指软得像没有骨头，五指也分不开，整只手像一只粉红色的肉球。',
    '短句只用于重大发现、危险信号、情绪冲击、段落收束；普通动作、感知、环境描写，用逗号组织成连贯句子。',
    '不要写“雪。脸颊下面是雪。”“心跳。”“一张脸。”这类孤立镜头；要并入人物发现、听见、触到或反应。',
    '不要用“不是A。是B。”或“不是A，像是B。”制造揭示；改成证据、气味、触感、动作后的判断。',
  ].join('\n');
}

function buildSceneRhythmContract({ scenePack = {}, compiled = {}, card = {}, previousSceneText = '' } = {}) {
  const text = [scenePack.title, scenePack.goal, scenePack.summary, scenePack.beats?.join('；'), card.title, card.summary, card.coreEvent, compiled.chapterIntent?.goal, compiled.chapterIntent?.mainEvent].map(normalizeText).join('\n');
  const constraints = [
    '段落数量：3-5段；每段承担一个推进功能，不用清单式打卡。',
    '段落起手轮换：感官/客观动作结果/心理认知/外界声音或对话/系统短讯，不能连续用“她想/她试着/她努力/她用力”。',
    '短句预算：本场景包最多1个独立短句，只用于重大发现、危险信号、情绪冲击或段落收束。',
  ];
  const paragraphPlan = [];
  const keyInfoBridges = [];
  const forbidden = [
    '禁止连续三句“她想/她试着/她努力/她用力 + 失败结果”。',
    '禁止把普通动作、感知、环境描写切成短句清单。',
    '禁止一个场景包连续塞入多个重大设定结果，除非每个结果都有主角理解桥。',
    '禁止用“不是A，是B / 不对，重点是B / 不是。等一下”作为信息揭示主方法。',
  ];
  constraints.push('揭示方式：新信息必须写成现场证据 → 人物辨认/意识到 → 行动改变。');
  constraints.push('识别方式：不要写“雪。是雪。”“脚步声。”“一张脸。”，要写感知、辨认和意味。');

  if (/醒|觉醒|睁眼|女婴|婴儿|身体|错位|襁褓|抓周/.test(text)) {
    constraints.push('身体尝试打包：眼皮、手指、脖子、声音等身体失败只能打包成1-2个连续段落，不逐句罗列。');
    paragraphPlan.push('段落1：感官进入，不以“她想/她试着”起手；用眼皮、手指、脖子或声音形成一组身体限制。');
    paragraphPlan.push('段落2：认知落点，让主角意识到“这不是普通虚弱，而是婴儿身体/身体错位”。');
  }
  if (/系统|绑定|任务|面板|奖励|魔法少女/.test(text)) {
    constraints.push('系统提示只出现1-2次，每次出现后必须改变主角下一动作或选择。');
    keyInfoBridges.push('系统绑定/任务弹出：信息出现 → 主角理解限制或代价 → 身体/情绪轻反应 → 下一动作。');
  }
  if (/灵根|杂灵根|检测|资质|废物|宗门淘汰/.test(text)) {
    constraints.push('灵根/资质结果是重大信息，结果后必须停一拍给主角理解，不要立刻跳到抱走或下个地点。');
    keyInfoBridges.push('杂灵根：结果出现 → 主角知道它意味着修炼慢/会被放弃 → 呼吸、心跳或注意力变化 → 周围议论压下来。');
  }
  if (/抓周|围观|奶妈|长老|众人|议论/.test(text)) {
    constraints.push('围观和议论最多2句，必须服务一个核心结果；主角通过声音、视线或触觉理解处境。');
  }
  if (/死亡|预告|危险|非法能量|狼|妖兽|攻击|活过今晚/.test(text)) {
    keyInfoBridges.push('危险/死亡预告：预告出现 → 主角先有一拍身体反应 → 再进入逃跑、哭喊或求生动作。');
  }
  if (!paragraphPlan.length) {
    paragraphPlan.push('段落1：从当前最强感知或外界动作进入，不用解释开场。');
    paragraphPlan.push('段落2：人物动作带出一个新信息，给出轻反应。');
    paragraphPlan.push('段落3：用选择、打断或具体危险收束。');
  }
  if (!keyInfoBridges.length) {
    keyInfoBridges.push('本包若出现新信息，必须给一口主角理解：信息 → 意味着什么 → 轻反应 → 下一动作。');
  }
  return { constraints, paragraphPlan, keyInfoBridges, forbidden, previousTail: normalizeText(previousSceneText).slice(-180) };
}

function formatSceneRhythmContract(contract = {}) {
  return [
    '【本场景包节奏合同：生成前执行】',
    ...(contract.constraints || []),
    '段落策略：',
    ...(contract.paragraphPlan || []),
    '重大信息反应桥：',
    ...(contract.keyInfoBridges || []),
    '禁止项：',
    ...(contract.forbidden || []),
    contract.previousTail ? `上一场景末尾承接：${contract.previousTail}` : '',
  ].filter(Boolean).join('\n');
}

function buildSentencePatternLibrary({ project = {}, card = {}, scenePack = {} } = {}) {
  return {
    perception: [
      '火把摇晃着暗红色火光。',
      '冰凉的石面贴着后背，寒意顺着脊骨往上爬。',
      '暗红色火光在眼前晃动，她勉强辨认出那是火把。',
      '脚步声落在石面上，沉闷而急促。',
    ],
    bodyFailure: [
      '她试了一遍眼皮、手指和脖子，才确认这个身体几乎不听使唤。',
      '眼皮只能掀开一线，右手抬不到两厘米，脖子刚撑起就歪回去。',
    ],
    informationBridge: [
      '“无灵根”三个字落下来时，她脑子空了一瞬。',
      '她知道这个词意味着什么：修仙路还没开始，已经被人提前判了死刑。',
      '系统短讯亮起后，不解释来历，只把她下一步逼出来。',
    ],
    danger: [
      '巨兽的前爪拍在她面前不到一臂的地方。',
      '裂缝从祭坛边缘爬过来，正朝她脚边逼近。',
      '火球擦过她左耳，热浪灼得半边脸发烫。',
    ],
  };
}

function buildSyntaxContract({ scenePack = {}, card = {}, perceptionScope = {}, rhythmContract = {} } = {}) {
  const patterns = buildSentencePatternLibrary({ card, scenePack });
  return {
    canonicalOrder: '普通描写优先使用中文正序：主体 → 动作/状态 → 结果/感知。',
    recognitionRule: '如果先写感知结果，必须补认知动作：她看见/听见/摸到/辨认出。',
    forbidden: [
      '禁止“感知结果，名词”倒装：火光摇晃的暗红色，火把。',
      '禁止距离/方位后置补丁：巨兽的前爪拍到她面前，距离不到一臂。',
      '禁止“形容短语，物体名”后置命名：湿冷触感，石头。',
      '禁止“名词。是名词。”碎片识别：雪。是雪。/ 火光。火把。/ 一张脸。',
    ],
    examples: [
      ...patterns.perception.slice(0, 3),
      ...patterns.danger.slice(0, 2),
      ...patterns.bodyFailure.slice(0, 1),
    ],
  };
}

function formatSyntaxContract(contract = {}) {
  return [
    '【正序句法合同：生成前执行】',
    contract.canonicalOrder || '普通描写优先正序。',
    contract.recognitionRule || '',
    '禁止句法：',
    ...(contract.forbidden || []),
    '推荐句型：',
    ...(contract.examples || []),
  ].filter(Boolean).join('\n');
}

function buildDetailBudgetContract({ scenePack = {}, card = {} } = {}) {
  return {
    sentenceBudget: '每句最多承载：1个主动作 + 1个感官细节 + 1个身体/心理反应 + 1个结果。超过就拆成两句。',
    paragraphBudget: '每段最多一个主物件、一个危险来源、一个系统提示；不要把环境、身体、动作、结果全部塞进一个长逗号句。',
    splitExample: '祭坛猛地一震，碎石崩到她脚心，冰凉又尖锐。闷雷般的咆哮从石缝里炸开，一只暗青色爪子伸出来，扣住祭坛边缘。整块石头随之往下一沉。',
  };
}

function formatDetailBudgetContract(contract = {}) {
  return [
    '【细节预算合同：生成前执行】',
    contract.sentenceBudget,
    contract.paragraphBudget,
    '长句拆分示例：',
    contract.splitExample,
  ].filter(Boolean).join('\n');
}

function buildSceneContinuityLedger({ previousText = '', currentDraft = '', scenePack = {}, card = {} } = {}) {
  const text = [previousText, currentDraft].map(normalizeText).join('\n');
  const lightSource = /青色|灵光/.test(text) ? '青色灵光' : (/火光|火把|烧/.test(text) ? '火光' : (/月光/.test(text) ? '月光' : (/雪光|雪/.test(text) ? '雪光' : '未明确')));
  const bodyPosture = /压在身下|压住/.test(text) ? '被压住/护在身下' : (/抱|怀里|裹进/.test(text) ? '被抱起/裹住' : (/躺|趴|雪里|地上/.test(text) ? '躺着或趴着' : '未明确'));
  const activeSound = /脚步声[^。！？!?]{0,20}停/.test(text) ? '脚步声已停' : (/脚步声/.test(text) ? '脚步声出现' : '未明确');
  const activeThreat = /追杀|翻|手伸|灵光|脚步声已停|没死/.test(text) ? '近处威胁正在确认主角状态' : (/狼|巨兽|妖兽/.test(text) ? '兽类危险逼近' : (/雪|冷|冻/.test(text) ? '低温威胁' : '未明确'));
  const activeHelpers = [];
  if (/扶着[他她]|扶住[他她]|托着[他她]|喂药|药碗|师姐|啾啾|苏晚晴|少女/.test(text)) activeHelpers.push('照顾/扶着主角的人仍在场或刚离场');
  if (/门外|隔着门|推开门|重新煎|脚步声退远/.test(text)) activeHelpers.push('门外照顾者/来人位置需要连续交代');
  return {
    lightSource,
    bodyPosture,
    activeSound,
    activeThreat,
    activeHelpers,
    visibleRange: bodyPosture.includes('压') ? '只能看见近处、上方和遮挡缝隙' : '跟随当前姿态限制视野',
    knownObjects: ['火光', '灵光', '脚步声', '襁褓', '手'].filter((item) => text.includes(item)),
    forbiddenContradictions: [
      `当前光源：${lightSource}。不得突然写月光/火光/灵光互相替换，除非写出光源变化过程。`,
      `${activeSound}后，不得重放“越来越近→停住”的过程，必须写后果。`,
      `当前姿态：${bodyPosture}。不得让人物看见超出姿态和遮挡范围的完整场景。`,
      activeHelpers.length ? `本章已出现会影响当前动作、安全或信息的近场人物：${activeHelpers.join('；')}。如果后续场景仍受她影响，需要自然交代她仍在、退到门外、去煎药、被打断或主角主动避开；若她已不影响当前动作，可不额外报备。` : '',
    ],
  };
}

function formatSceneContinuityLedger(ledger = {}) {
  return [
    '【场景连续性账本：生成前继承】',
    `当前光源：${ledger.lightSource || '未明确'}`,
    `当前姿态：${ledger.bodyPosture || '未明确'}`,
    `当前声音：${ledger.activeSound || '未明确'}`,
    `当前危险：${ledger.activeThreat || '未明确'}`,
    (ledger.activeHelpers || []).length ? `在场/近场人物：${ledger.activeHelpers.join('；')}` : '',
    `可见范围：${ledger.visibleRange || ''}`,
    `已确认物件：${(ledger.knownObjects || []).join('、')}`,
    '禁止冲突：',
    ...(ledger.forbiddenContradictions || []),
  ].filter(Boolean).join('\n');
}

function buildRepetitionLedger({ previousText = '', currentDraft = '' } = {}) {
  const text = [previousText, currentDraft].map(normalizeText).join('\n');
  const repeatedFacts = [];
  if (/脚步声[^。！？!?]{0,20}停/.test(text)) repeatedFacts.push('脚步声已停');
  if (/保持安静|别动|不要有任何反应|禁止发声/.test(text)) repeatedFacts.push('系统已警告保持安静');
  if (/不能动|动不了|抬不起来|翻不了|身体不听/.test(text)) repeatedFacts.push('主角不能动');
  if (/哭声|呜咽|发声/.test(text)) repeatedFacts.push('主角无法完全控制声音');
  if (/有人|手伸|指尖|翻/.test(text)) repeatedFacts.push('近处有人正在确认');
  return {
    repeatedFacts,
    escalationRules: repeatedFacts.map((fact) => {
      if (fact === '脚步声已停') return '脚步声已停：不能再写“停了”，必须升级为手伸过来、光照到脸上、呼吸压近或下令。';
      if (fact === '系统已警告保持安静') return '系统已警告保持安静：不能重复同一警告，必须让人物动作或危险升级。';
      if (fact === '主角不能动') return '主角不能动：不能再次罗列身体失败，必须写一个可执行的微动作或外界打断。';
      return `${fact}：下一段必须写后果或变化，不能同义重复。`;
    }),
  };
}

function formatRepetitionLedger(ledger = {}) {
  return [
    '【重复账本：生成前去重】',
    `已表达信息：${(ledger.repeatedFacts || []).join('；') || '无'}`,
    '推进规则：',
    ...(ledger.escalationRules || []),
  ].filter(Boolean).join('\n');
}

function buildInteriorMonologueContract({ card = {}, scenePack = {} } = {}) {
  return {
    rules: [
      '内心独白只承担情绪反应和轻吐槽，不承担信息揭示。',
      '心声最多1句，后面必须接动作、感知或外界变化。',
      '不得在心声里使用“不是A，是B”“不对”“等一下”“重点是”推进信息。',
      '如果需要表达判断，改成现场证据、身体反应或动作选择。',
    ],
    examples: [
      '允许：她脑子里只剩一个念头：完了。',
      '禁止：我刚才不是被卡车创死了吗？这不是重生吗？',
    ],
  };
}

function formatInteriorMonologueContract(contract = {}) {
  return [
    '【内心独白合同：生成前执行】',
    ...(contract.rules || []),
    '示例：',
    ...(contract.examples || []),
  ].filter(Boolean).join('\n');
}

function findInteriorMonologueIssues(content = '') {
  const text = normalizeText(content);
  const issues = [];
  [...text.matchAll(/(?:脑子里|心里|念头|想法)[^。！？!?]{0,30}[:：][^。！？!?]*(?:不是|不对|等一下|重点是)[^。！？!?]*[。！？!?]/g)].forEach((match) => {
    issues.push({ type: 'interior-negative-reveal', label: '心声转移否定揭示', index: match.index || 0, text: match[0] });
  });
  [...text.matchAll(/我他妈[^。！？!?]{0,80}(?:不是|这不是|怎么办)[^。！？!?]*[。！？!?]/g)].forEach((match) => {
    issues.push({ type: 'interior-exposition-overload', label: '心声承担过多解释', index: match.index || 0, text: match[0] });
  });
  return issues;
}

function repairInteriorMonologueLocally(content = '') {
  return normalizeText(content)
    .replace(/她脑子里冒出一句：我他妈刚才不是被卡车创死了吗？这不是重生吗？/g, '她脑子里乱成一团，骂人的念头还没成形，身体已经先一步失控。')
    .replace(/一个念头冒出来，活过今晚？什么今晚？我他妈刚才不是被卡车创死了吗？这不是重生吗？重生就得先死一回是吧，行，我认了。但你好歹让我喘口气啊！/g, '一个念头冒出来：完了。骂人的话还没成形，眼前的危险已经把她的注意力拽了回去。')
    .replace(/你倒是让我动啊！我心里想动，但这破胳膊根本抬不起来！这玩意儿泡的是水还是血？能不能先告诉我那个女人怎么样了？/g, '她急得想骂人，胳膊却连抬一下都做不到，只能听着自己的呼吸越来越乱。')
    .replace(/惩罚？我都被压在这血泊里了，你还能怎么罚我？再扣我十年阳寿？等等，我阳寿已经没了。/g, '惩罚两个字刺得她脑子一跳，荒唐感还没翻上来，喉咙已经先一步收紧。')
    .replace(/这不叫发声，这叫自残。我咬我自己总行了吧？/g, '疼痛把哭声压回去，她脑子里只剩一个念头：别出声。')
    .replace(/装死？我一个连哭都控制不住的婴儿，你要我装死？你倒是告诉我不呼吸怎么活啊！/g, '装死两个字荒唐得要命，可她已经没有别的选择。')
    .replace(/我能怎么办？我他妈已经吸了那口气了！/g, '她脑子里一片空白，那口气已经吸进去了。')
    .trim();
}

function applyInteriorMonologueGate(content = '') {
  const issues = findInteriorMonologueIssues(content);
  const repaired = issues.length ? repairInteriorMonologueLocally(content) : normalizeText(content).trim();
  return { content: repaired, issues };
}

function buildSystemMessageContract({ project = {}, scenePack = {} } = {}) {
  const text = [project.premise, project.styleGuide, scenePack.title, scenePack.goal].map(normalizeText).join('\n');
  return {
    rules: [
      '系统提示超过2项必须分行，不能挤成一长串。',
      '系统提示必须用中文方括号包住整行：每行从【开始，到】结束；不要写成“【搜】附近可回收物资”这种只有标签进框的半框格式。',
      '系统提示字段名使用自然词：写“风险：坍塌、未知”，不要写“风险词：坍塌、未知”或“风险项：坍塌、未知”。',
      '系统面板只给状态、任务、限制、倒计时、奖励等可执行信息，不写百科。',
      /雌小鬼|嘴欠|损友/.test(text) ? '系统口吻保留雌小鬼/损友感：短促、欠揍、护短，不写官方播报腔。' : '系统口吻短促，避免官方播报腔。',
    '系统出现后通常应改变主角下一步动作；少数情况下也可以确认风险、打断判断或制造误判，但不能只是无意义播报。',
    ],
    example: ['【宿主意识确认】', '【搜：附近可回收物资为运输车残骸；风险：热源残留】', '【打：不建议正面冲突】', '【撤：东南方向存在临时缺口】'],
  };
}

function formatSystemMessageContract(contract = {}) {
  return [
    '【系统提示合同】',
    ...(contract.rules || []),
    '分行示例：',
    ...(contract.example || []),
  ].filter(Boolean).join('\n');
}

function repairSystemMessageLocally(content = '') {
  return normalizeText(content)
    .replace(/“滴。宿主意识确认。检测完成。身体绑定成功。当前世界定位：修真大陆。当前身体状态：新生儿。当前场景危险等级：三级。妖兽正在接近，预估到达时间：三百秒后。”/g, '【宿主意识确认】\n【身体绑定成功】\n【当前世界：修真大陆】\n【当前身体：新生儿】\n【危险等级：三级】\n【妖兽接近，预估三百秒后抵达】')
    .replace(/风险词\s*[:：]/g, '风险：')
    .replace(/风险项\s*[:：]/g, '风险：')
    .replace(/^\s*\[(搜|打|撤)\]\s*([^\n]{2,180})$/gm, (_, label, body) => `【${label}：${body.replace(/^\s*[：:，,。；;\-—]+\s*/, '').trim()}】`)
    .replace(/^【([^】\n]{1,18})】([^\n【】]{2,120})$/gm, (_, label, body) => `【${label}：${body.replace(/^\s*[：:，,。；;\-—]+\s*/, '').trim()}】`)
    .replace(/【([^】。]{2,20})。([^】]{8,160})】/g, (_, first, rest) => `【${first}】\n【${rest.replace(/。/g, '】\n【').replace(/【$/g, '')}】`)
    .replace(/\n【】/g, '')
    .replace(/^\s*】\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildInspirationFidelityContract({ project = {}, card = {} } = {}) {
  const premise = normalizeText(project.premise || project.summary || '');
  const genre = normalizeText(project.genre || '');
  const required = [];
  if (/卡车|救人/.test(premise)) required.push('开局事实：杜震宇/主角为了救人被卡车创死。');
  if (/女婴|婴儿/.test(premise)) required.push('转生结果：修仙世界女婴。');
  if (/魔法少女系统/.test(premise)) required.push('金手指：魔法少女系统。');
  if (/雌小鬼|拟人/.test(premise)) required.push('系统性格：拟人化、像雌小鬼，嘴欠但能推动行动。');
  if (/百合/.test(`${premise} ${genre}`)) required.push('长期类型承诺：百合关系线。');
  return {
    required,
    forbidden: ['不得改成灭门开局、乱葬岗主线、无关复仇线，除非章节卡明确要求。', '不得把魔法少女系统改成普通修仙面板。', '不得丢掉搞笑、日常、热血的基调。'],
  };
}

function formatInspirationFidelityContract(contract = {}) {
  return [
    '【灵感保真合同】',
    ...(contract.required || []),
    '禁止漂移：',
    ...(contract.forbidden || []),
  ].filter(Boolean).join('\n');
}

function buildGenrePromiseContract({ project = {} } = {}) {
  const source = normalizeText([project.premise, project.genre, project.styleGuide].filter(Boolean).join('\n'));
  const promises = [];
  if (/修仙/.test(source)) promises.push('修仙：境界、灵根、宗门、资源竞争只通过当前事件露出，不百科解释。');
  if (/系统|魔法少女/.test(source)) promises.push('系统：任务、限制、吐槽、奖励必须改变当场动作。');
  if (/搞笑/.test(source)) promises.push('搞笑：成年人灵魂和萝莉/女婴身体错位，靠行动尴尬和系统嘴欠产生笑点。');
  if (/日常/.test(source)) promises.push('日常：喂食、走路、求救、学习、修炼小目标要有可爱细节。');
  if (/热血/.test(source)) promises.push('热血：弱小但不服输，每章至少一个小努力或小选择。');
  if (/百合/.test(source)) promises.push('百合：长期关系线，第一章只埋温柔/保护/误会，不硬塞恋爱。');
  if (/废萌|萝莉/.test(source)) promises.push('废萌：弱小、可爱、笨拙但不废物，萌点服务求生和成长。');
  return { source, promises, forbidden: ['不得漂移成纯黑暗逃杀、灭门复仇或普通修仙升级文。', '不得丢掉魔法少女系统和雌小鬼口吻。'] };
}

function formatGenrePromiseContract(contract = {}) {
  return ['【类型承诺合同】', ...(contract.promises || []), '禁止漂移：', ...(contract.forbidden || [])].filter(Boolean).join('\n');
}

function buildOpeningHookContract({ project = {}, card = {}, chapterNumber = 1 } = {}) {
  const text = normalizeText([project.premise, card.summary, card.coreEvent].join('\n'));
  const strategy = chapterNumber === 1 && /转生|萝莉|女婴|将死|系统/.test(text) ? '强错位 + 危险压脸' : (/系统/.test(text) ? '系统异常开头' : '已发生的麻烦开头');
  return { strategy, rules: [`开头策略：${strategy}。`, '第一段必须让读者立刻知道主角处在麻烦里。', '不要从天气、背景设定、作者说明或完整世界观开头。', '若是第一章，必须保留“救人被卡车创死→转生将死萝莉/女婴→系统介入”的因果承诺。'] };
}

function formatOpeningHookContract(contract = {}) {
  return ['【开头钩子合同】', ...(contract.rules || [])].filter(Boolean).join('\n');
}

function buildChapterFunctionContract({ card = {}, chapterNumber = 1 } = {}) {
  const text = normalizeText([card.summary, card.chapterGoal, card.coreEvent].join('\n'));
  const fn = chapterNumber === 1 ? '开局章' : (/修炼|突破/.test(text) ? '修炼章' : (/关系|姐姐|救|保护|百合/.test(text) ? '关系章' : (/战斗|危险|妖兽/.test(text) ? '承压行动章' : '推进章')));
  const rules = fn === '开局章'
    ? ['本章功能：开局章。立人设、给冲突、给金手指、留钩子。', '必须交付：主角是谁、变成什么、危险是什么、系统如何改变选择。']
    : [`本章功能：${fn}。`, '每章必须有一个小目标、一个阻力、一个反馈、一个章末问题。'];
  return { fn, rules };
}

function formatChapterFunctionContract(contract = {}) {
  return ['【章节功能合同】', ...(contract.rules || [])].filter(Boolean).join('\n');
}

function buildWorldExposureBudgetContract({ card = {}, chapterNumber = 1 } = {}) {
  return { rules: ['世界观释放预算：每章最多释放1个世界规则。', '规则必须通过动作、对话、惩罚、奖励或他人反应体现，不百科解释。', chapterNumber === 1 ? '第一章只允许粗略确认：这是修仙世界 + 主角处境危险。不要解释完整境界体系。' : '只释放与当前目标直接相关的规则。'] };
}

function formatWorldExposureBudgetContract(contract = {}) {
  return ['【世界观释放预算】', ...(contract.rules || [])].filter(Boolean).join('\n');
}

function buildGenreKnowledgeContract({ project = {}, card = {} } = {}) {
  const text = normalizeText([project.premise, project.summary, project.genre, project.styleGuide, card.summary, card.coreEvent].join('\n'));
  const isTransmigration = /穿越|转生|重生|异世界|夺舍|胎穿|魂穿/.test(text);
  const genreConcepts = [];
  if (/修仙|仙侠|玄幻|灵脉|宗门|境界/.test(text)) genreConcepts.push('修仙/仙侠网文常识');
  if (/系统|金手指/.test(text)) genreConcepts.push('系统/金手指网文常识');
  if (/魔法少女/.test(text)) genreConcepts.push('魔法少女类型常识');
  if (/百合/.test(text)) genreConcepts.push('百合关系类型常识');
  const rules = [];
  if (isTransmigration || genreConcepts.length) {
    rules.push(`主角可拥有的类型常识：${genreConcepts.length ? genreConcepts.join('、') : '常见网文/类型文常识'}。`);
    rules.push('主角暂时不知道当前世界的具体规则、势力名称、境界细则、系统来源和本身体质真相。');
    rules.push('人物反应应体现“听过这种类型，但眼前规则和身体代价不明”：可以吐槽、联想、试探、误判，不要把她写成完全没有类型概念。');
  }
  return { rules };
}

function formatGenreKnowledgeContract(contract = {}) {
  return ['【类型常识/穿越者知识合同】', ...(contract.rules || [])].filter(Boolean).join('\n');
}

function buildDialoguePurposeContract({ card = {}, scenePack = {} } = {}) {
  const text = normalizeText([card.summary, card.cast, scenePack.title, scenePack.goal].join('\n'));
  const rules = ['对话/短讯必须承担一种功能：暴露关系、制造误会、推进行动、表达性格、释放少量信息。', '系统每次说话必须服务主角下一步动作；通常应改变动作，也可确认风险、打断判断或制造误判，不能只是无意义播报。', '系统短讯长度和口吻由系统性格决定：冷淡系统可短，嘴欠/雌小鬼/损友型系统允许多一句嘲讽或挑衅，但仍要服务行动。', '真人台词不强制短句；关键人物每章至少有几句带性格的完整表达，可以有犹豫、嘴硬、遮掩、反问或半句解释。', '对话后有时可以接神态、动作或心理反应，不要长期一句台词接一句台词。', '对话密度按场景压力调整，不追求固定轮数；战斗喊话、追兵喊话可以报状态，但不要连续只报状态；根据场景需要加入少量判断、误判、急躁、威胁或立场，让它更像人在喊话，而不是系统音效。'];
  if (/系统|吐槽|求救|魔法少女/.test(text)) rules.push('系统互动至少包含：主角诉求或慌乱 → 系统嘴欠回应 → 主角动作改变。');
  if (/百合|姐姐|救|保护/.test(text)) rules.push('关系互动只埋一粒情绪种子：保护、误会、温柔或依赖，不硬塞恋爱。');
  return { rules };
}

function formatDialoguePurposeContract(contract = {}) {
  return ['【对话目的合同】', ...(contract.rules || [])].filter(Boolean).join('\n');
}

function buildDetailSelectionContract({ scenePack = {}, card = {}, perceptionScope = {}, chapterNumber = 1 } = {}) {
  const text = normalizeText([scenePack.title, scenePack.goal, card.summary, card.coreEvent].join('\n'));
  const allowed = ['1个主环境细节', '1个身体危机细节', '1个可行动物件/线索', '1个气味或声音细节'];
  const functions = ['遮挡视野', '制造危险', '暴露身体状态', '提供行动方向', '证明身份/处境', '制造关系反应'];
  const preferred = [];
  if (/破屋|房|床|醒/.test(text)) preferred.push('房梁/窗光只留一个，用来证明她只能看上方或屋子破败。');
  if (/将死|濒死|病|痛|寿命/.test(text)) preferred.push('身体危机优先：胸口刺痛、肾痛、呼吸失败三选一，不全部展开。');
  if (/系统|魔法少女/.test(text)) preferred.push('系统光屏只作为行动触发，不展开界面材质。');
  return {
    allowed,
    functions,
    preferred,
    forbidden: ['禁写房梁、椽子、灰尘、蛛网、窗户、光线、霉味、酸臭连续平铺。', '禁写连续两句静态环境描写。', '禁写与当前动作无关的装饰细节。'],
    openingRule: chapterNumber === 1 ? '开场前200字最多2个环境细节 + 1个身体危机。' : '每段最多2个有效细节。',
  };
}

function formatDetailSelectionContract(contract = {}) {
  return [
    '【细节选择合同】',
    `最多允许：${(contract.allowed || []).join('；')}`,
    `细节功能：${(contract.functions || []).join('；')}`,
    contract.openingRule,
    '优先细节：',
    ...(contract.preferred || []),
    '禁写：',
    ...(contract.forbidden || []),
  ].filter(Boolean).join('\n');
}

function findEnvironmentScanIssues(content = '') {
  const text = normalizeText(content);
  const issues = [];
  const opening = text.slice(0, 420);
  const envTerms = opening.match(/房梁|椽子|灰尘|蛛网|墙角|窗户|光线|木板|草席|屋子|霉味|酸臭|房间|空间/g) || [];
  const actionTerms = opening.match(/看见|摸到|闻到|吸气|抬手|转头|抓住|撑开|碰到|听见/g) || [];
  if (envTerms.length >= 6 && actionTerms.length <= 3) {
    issues.push({ type: 'opening-detail-overload', label: '开场环境细节过载', index: 0, text: opening.slice(0, 220), count: envTerms.length });
  }
  const staticSentences = splitPerceptionSentences(opening).filter((sentence) => /房梁|椽子|蛛网|窗户|光线|灰尘|墙角/.test(sentence) && !/她|杜蓁蓁|看见|闻到|摸到|撑开|吸/.test(sentence));
  if (staticSentences.length >= 3) {
    issues.push({ type: 'static-environment-scan', label: '静态环境扫描', index: text.indexOf(staticSentences[0]), text: staticSentences.join('') });
  }
  return issues;
}

function repairEnvironmentScanLocally(content = '') {
  return normalizeText(content)
    .replace(/发黄的木头房梁横在视野上方。椽子露在外面，布满灰尘。蛛网从墙角垂下来，轻轻晃着。光线极暗，只一扇巴掌大的窗户透进来灰白色的光，勉强照亮一小片空间。霉味混着一股酸臭钻进鼻腔，那是很久没洗澡的人身上才会有的味道。胸口的刺痛随着每次呼吸拉扯着肺叶。/g, '她费力撑开眼，只看见发黄的房梁和一点灰白窗光。霉味混着酸臭钻进鼻腔，刚吸进去半口，胸口的刺痛就把肺叶扯住。')
    .replace(/椽子露在外面，布满灰尘。蛛网从墙角垂下来，轻轻晃着。/g, '墙角蛛网轻轻晃着。')
    .replace(/光线极暗，只一扇巴掌大的窗户透进来灰白色的光，勉强照亮一小片空间。/g, '巴掌大的窗缝漏进一点灰白光。')
    .trim();
}

function applyEnvironmentScanGate(content = '') {
  const issues = findEnvironmentScanIssues(content);
  const repaired = issues.length ? repairEnvironmentScanLocally(content) : normalizeText(content).trim();
  return { content: repaired, issues };
}

function buildDialogueDensityContract({ card = {}, scenePack = {} } = {}) {
  const text = [card.summary, card.cast, card.coreEvent, scenePack.title, scenePack.goal].map(normalizeText).join('\n');
  const isDialogueRelevant = /系统|对话|求救|吐槽|争|问|喊|说|姐姐|百合/.test(text);
  return {
    rules: isDialogueRelevant
      ? ['本包为对话/互动相关场景，至少2轮有效互动：主角诉求/反应 → 对方回应/系统嘴欠 → 主角动作改变。', '对话不能解释完整设定，只改变当场关系或动作。', '真人对话允许完整句和带性格的长短变化；系统短讯按系统性格决定长短。', '连续两句以上对话后，优先插入一次动作、神态或心理承接。']
      : ['非对话主导场景也至少保留1个声音、短讯或动作回应，避免全段独白。'],
  };
}

function formatDialogueDensityContract(contract = {}) {
  return ['【对话密度合同】', ...(contract.rules || [])].filter(Boolean).join('\n');
}

function buildStyleTextureContract({ project = {}, scenePack = {} } = {}) {
  return {
    rules: [
      '短句可以用，但只用于冲击、停顿、决定、钩子；不要连续3个短句都只承担识别或判断。',
      '中等长度动作句作为主体；长句可用于连续动作或复杂心理，但不要连续多段堆叠。',
      '常见情绪句可以正常使用，例如后背发凉、心头一紧、喉咙发紧、眼眶发热。',
      '不要为了规避情绪句而写过度设计的动作描写。',
      '同类情绪套句在同一章内出现三次以上时，后续优先用人物口吻、动作选择、对话停顿、系统打断或现场变化承接。',
      '每段最多突出一个强感受或强修饰；环境、身体痛感、心理反应不要同段全堆满。',
      '可以写漂亮句子，但不要连续用比喻和强修饰撑段落。',
    ],
    styleHint: normalizeText([project.styleGuide, scenePack.title, scenePack.goal].join('；')),
  };
}

function formatStyleTextureContract(contract = {}) {
  return ['【风格纹理合同：轻量密度控制】', ...(contract.rules || [])].filter(Boolean).join('\n');
}

function buildTitleCoreSellContract({ project = {}, card = {}, chapterNumber = 1 } = {}) {
  const text = normalizeText([project.premise, project.summary, project.genre, project.styleGuide, card.title, card.summary].join('\n'));
  const hooks = [];
  if (/转生|穿越|重生|魂穿/.test(text)) hooks.push('转生错位');
  if (/将死|濒死|残血|寿命|短命/.test(text)) hooks.push('生存倒计时');
  if (/萝莉|女婴|少女/.test(text)) hooks.push('将死萝莉/身体反差');
  if (/魔法少女/.test(text)) hooks.push('魔法少女系统');
  if (/修仙|仙侠/.test(text)) hooks.push('修仙反差');
  return {
    rules: [
      chapterNumber === 1 ? '首章标题至少命中一个核心卖点，不能只概括动作。' : '标题优先贴当前章卖点，不只写地点或动作。',
      hooks.length ? `本书标题可用核心卖点：${hooks.join('、')}。` : '标题优先呈现人物处境、冲突或反差。',
      '如果题材有系统/转生/强反差，标题优先展示反差或生存压力。',
    ],
  };
}

function formatTitleCoreSellContract(contract = {}) {
  return ['【标题核心卖点合同】', ...(contract.rules || [])].filter(Boolean).join('\n');
}

function buildEscapeInteractionContract({ card = {}, scenePack = {} } = {}) {
  const text = normalizeText([card.summary, card.coreEvent, card.hook, scenePack.title, scenePack.goal].join('\n'));
  const isEscape = /逃|活|死|濒死|追|查死|危险|倒计时|二选一|门外/.test(text);
  const hasSystem = /系统|短讯|任务|奖励|选项|魔法少女/.test(text);
  const hasNearbyPerson = /门外|少女|师姐|姐姐|照顾|扶|敌|查死|人/.test(text);
  const rules = [];
  if (isEscape && hasSystem) rules.push('逃生章里的系统互动至少完成一次：嘲讽/性格表达 → 限制或选项 → 主角嘴硬/反击 → 被迫行动。');
  if (isEscape && hasNearbyPerson) rules.push('如果有近场人物，至少留下一个关系钩子：误解、照顾、威胁、保护、亏欠或利用。');
  if (isEscape) rules.push('关系钩子不能抢主线，只落一个可延续动作或一句有立场的话。');
  return { rules };
}

function formatEscapeInteractionContract(contract = {}) {
  return ['【逃生互动合同】', ...(contract.rules || [])].filter(Boolean).join('\n');
}

function findSyntaxIssues(content = '') {
  const text = normalizeText(content);
  const issues = [];
  [...text.matchAll(/(?:火光摇晃的暗红色，火把|湿冷的触感，石头|冰凉，石头|白色一片，雪|一张脸，年轻女人)[。！？!?]?/g)].forEach((match) => {
    issues.push({ type: 'inverted-sensory-apposition', label: '感知倒装后置命名', index: match.index || 0, text: match[0] });
  });
  [...text.matchAll(/(?:雪。是雪。|火光。火把。|脚步声。|一张脸。|狼的眼睛。)/g)].forEach((match) => {
    issues.push({ type: 'fragmented-identification', label: '碎片化识别句', index: match.index || 0, text: match[0] });
  });
  [...text.matchAll(/(?:不是[^。！？!?]{1,24}[，,。]|没有[^。！？!?]{1,24}[，,。])/g)].forEach((match, index) => {
    if (index >= 2) issues.push({ type: 'negative-judgement-density', label: '否定判断句密度偏高', index: match.index || 0, text: match[0] });
  });
  const sentences = splitPerceptionSentences(text);
  for (let idx = 0; idx < sentences.length - 2; idx += 1) {
    const chain = sentences.slice(idx, idx + 3);
    if (chain.every((sentence) => sentence.length <= 14) && chain.filter((sentence) => /血衣|完了|系统|门外|苦|疼|不是|没有|杜雨|魔法少女/.test(sentence)).length >= 2) {
      issues.push({ type: 'short-sentence-chain-density', label: '短句链密度偏高', index: text.indexOf(chain[0]), text: chain.join('') });
      break;
    }
  }
  [...text.matchAll(/[^。！？!?]{2,40}(?:拍到|落到|停在|伸到)她面前，距离不到[^。！？!?]{1,12}[。！？!?]/g)].forEach((match) => {
    issues.push({ type: 'distance-afterthought', label: '距离后置补丁', index: match.index || 0, text: match[0] });
  });
  return issues;
}

function repairSyntaxLocally(content = '') {
  return normalizeText(content)
    .replace(/火光摇晃的暗红色，火把。/g, '火把摇晃着暗红色火光。')
    .replace(/湿冷的触感，石头。/g, '湿冷的石头贴着皮肤。')
    .replace(/冰凉，石头。/g, '冰凉的石头贴着皮肤。')
    .replace(/白色一片，雪。/g, '雪白的地面贴着脸颊。')
    .replace(/雪。是雪。/g, '眼角余光里大片白色被风卷着贴上脸颊，她这才意识到自己半张脸都埋在雪里。')
    .replace(/火光。火把。/g, '暗红色火光在眼前晃动，她勉强辨认出那是火把。')
    .replace(/脚步声。/g, '风声里混进了细碎的脚步声。')
    .replace(/狼的眼睛。/g, '一双发绿的眼睛在暗处亮起来。')
    .replace(/一张脸，年轻女人。/g, '一张年轻女人的脸探进视野。')
    .replace(/一张脸。/g, '一张脸探进视野。')
    .replace(/巨兽的前爪拍到她面前，距离不到一臂。/g, '巨兽的前爪拍在她面前不到一臂的地方。')
    .replace(/([^。！？!?]{2,24})拍到她面前，距离不到一臂。/g, '$1拍在她面前不到一臂的地方。')
    .trim();
}

function applySyntaxGate(content = '') {
  const issues = findSyntaxIssues(content);
  const repaired = issues.length ? repairSyntaxLocally(content) : normalizeText(content).trim();
  return { content: repaired, issues };
}

function buildChapterStateMachine({ project = {}, card = {}, chapterNumber = 1, previousChapter = null } = {}) {
  const protagonist = /魏杰/.test([card.cast, card.summary, card.coreEvent, project.premise].map(normalizeText).join('\n')) ? '魏杰' : '主角';
  const previousTail = normalizeText(previousChapter?.content || '').slice(-220);
  return {
    actor: protagonist,
    currentState: previousTail ? `承接上一章末尾：${previousTail}` : (card.openAction || card.chapterGoal || '人物已经处在当前麻烦里'),
    goal: card.chapterGoal || card.allowedBeats || card.summary || '完成本章局部目标',
    resources: [card.keyClue, card.systemRule, /系统|搜打撤/.test([project.premise, card.summary].map(normalizeText).join('\n')) ? '系统短讯/预判' : '', /魏杰/.test(protagonist) ? '玩家经验但不能全信' : '已有经验'].filter(Boolean).join('；'),
    pressure: card.readerExpectation || card.commercialBeat || '危险正在逼近，人物需要马上行动',
    wrongAssumption: '人物会先按旧经验、玩家认知或眼前最省力的方案处理，但现场反馈会缩窄选择。',
    interruption: card.keyClue || card.foreshadowing || card.hook || '声音、物件、伤势、系统短讯或角色质问打断原计划',
    nextState: card.chapterResult || card.hook || '人物带着新问题进入下一章',
  };
}

function buildInformationBudget(card = {}) {
  const summary = normalizeText(card.summary);
  const explicit = firstUsefulSentence(card.chapterResult, card.keyClue, card.commercialBeat, summary) || '只明确交付一个能改变路线、关系或选择的信息';
  const hint = firstUsefulSentence(card.foreshadowing, card.readerExpectation, summary) || '只暗示更大的问题，不解释完整答案';
  return {
    explicit,
    hint,
    characterMisread: '允许人物根据不完整证据产生误会或保留判断，但不要让旁白立刻裁决真相。',
    forbiddenExplanation: card.forbiddenBeats || '禁止解释后期核心秘密、系统来源、人物完整动机、世界观百科和下一章正文。',
    repeatAvoidance: '同一信息只证明一次；读者已经看懂的证据，不要再用对话完整解释一遍。',
  };
}

function buildCharacterKnowledgeLedger({ project = {}, card = {} } = {}) {
  const cardText = [card.cast, card.summary, card.coreEvent, card.keyClue, card.hook].map(normalizeText).join('\n');
  const names = buildVoiceRoster({ project, card }).map((line) => line.split('：')[0]).filter(Boolean).slice(0, 6);
  if (!names.length) names.push(/魏杰/.test(cardText) ? '魏杰' : '主角');
  return names.map((name) => {
    if (/魏杰/.test(name)) return `${name}｜知道：玩家经验、系统短讯、眼前危险；不知道：真实博士身份差异的全部原因、系统来源；误会/偏差：会先按游戏逻辑理解现实；隐瞒：害怕和不确定。`;
    if (/灰喉/.test(name)) return `${name}｜知道：博士外貌细节、罗德岛战场习惯、自己伤势；不知道：魏杰穿越和系统；误会/偏差：魏杰可能是假博士或诱饵；隐瞒：伤势严重和求援压力。`;
    if (/系统/.test(name)) return `${name}｜知道：规则、倒计时、预判和奖励；不知道/不说：世界观解释和完整真相；表达：只给短讯、限制、异常和可执行提示。`;
    return `${name}｜知道：自己的目标和眼前证据；不知道：对方完整动机；误会/偏差：只凭当前证据行动；隐瞒：至少保留一个顾虑或未说出口的信息。`;
  });
}

function buildActionCausalityChain(card = {}) {
  const facts = splitCardStoryFacts(card);
  const steps = [
    card.openAction || facts[0] || '人物先处理眼前压力',
    facts[1] || card.chapterGoal || '人物尝试推进当前目标',
    card.keyClue || facts[2] || '碰到一个会改变路线的线索或物件',
    card.systemRule || facts[3] || '系统、声音或对方动作给出限制',
    card.chapterResult || facts[4] || '人物获得小结果但付出代价',
    card.hook || facts[5] || '章末出现必须马上处理的下一步',
  ].filter(Boolean);
  return steps.map((step, index) => `${index + 1}. ${step} → 下一步必须由这个结果触发，不能靠旁白解释跳转`);
}

function buildReaderSimulation(card = {}) {
  return {
    readerKnows: firstUsefulSentence(card.summary, card.keyClue, card.chapterResult) || '读者会跟随人物获得当前线索',
    readerWants: card.readerExpectation || card.hook || '读者想知道这个线索会把人物推向什么选择',
    doNotRepeat: '如果读者已经通过动作、系统短讯或物件看懂，不要再用对话完整解释一遍。',
    nextQuestion: card.hook || card.foreshadowing || '用一个具体未解决动作或选择留下下一章问题',
  };
}

function buildChapterDirectorContext({ project = {}, automation = {}, card = {}, chapterNumber = 1, previousChapter = null } = {}) {
  return {
    stateMachine: buildChapterStateMachine({ project, automation, card, chapterNumber, previousChapter }),
    informationBudget: buildInformationBudget(card),
    characterKnowledge: buildCharacterKnowledgeLedger({ project, card }),
    actionChain: buildActionCausalityChain(card),
    readerSimulation: buildReaderSimulation(card),
  };
}

function formatChapterDirectorContext(context = {}) {
  const state = context.stateMachine || {};
  const budget = context.informationBudget || {};
  const reader = context.readerSimulation || {};
  return [
    '【章节导演上下文：高于句式修补】',
    '状态机：',
    `当前状态：${state.currentState || ''}`,
    `人物目标：${state.goal || ''}`,
    `可用资源：${state.resources || ''}`,
    `压力/打断：${state.pressure || ''}；${state.interruption || ''}`,
    `错误前提：${state.wrongAssumption || ''}`,
    `新状态：${state.nextState || ''}`,
    '信息预算：',
    `明确释放：${budget.explicit || ''}`,
    `只暗示：${budget.hint || ''}`,
    `人物可误会：${budget.characterMisread || ''}`,
    `禁止解释：${budget.forbiddenExplanation || ''}`,
    `避免重复：${budget.repeatAvoidance || ''}`,
    '人物认知账本：',
    ...(context.characterKnowledge || []),
    '动作因果链：',
    ...(context.actionChain || []),
    '读者视角模拟：',
    `读者已获得：${reader.readerKnows || ''}`,
    `读者想知道：${reader.readerWants || ''}`,
    `不要重复：${reader.doNotRepeat || ''}`,
    `下一问题：${reader.nextQuestion || ''}`,
  ].filter(Boolean).join('\n');
}

function formatCompactDirectorDirective(context = {}) {
  const state = context.stateMachine || {};
  const budget = context.informationBudget || {};
  const reader = context.readerSimulation || {};
  return [
    '【短导演令】',
    `人物当前目标：${state.goal || ''}`,
    `本章只明确释放：${budget.explicit || ''}`,
    `本章只暗示：${budget.hint || ''}`,
    `禁止解释：${budget.forbiddenExplanation || ''}`,
    `避免重复：${budget.repeatAvoidance || ''}`,
    `读者下一问题：${reader.nextQuestion || ''}`,
  ].filter(Boolean).join('\n').slice(0, 900);
}

function compileChapterForGeneration({ project = {}, automation = {}, card = {}, chapterNumber = 1, previousChapter = null } = {}) {
  const cleanCard = sanitizeChapterCardForHumanEngine(card, chapterNumber);
  const directorContext = buildChapterDirectorContext({ project, automation, card: cleanCard, chapterNumber, previousChapter });
  const cardText = [cleanCard.title, cleanCard.summary, cleanCard.coreEvent, cleanCard.cast, cleanCard.systemRule, cleanCard.hook].map(normalizeText).join('\n');
  const isFirstThreeChapters = chapterNumber <= 3 ? 1 : 0;
  const hasNewCharacter = cleanCard.cast && !previousChapter?.summary?.includes(cleanCard.cast.split(/[、,，]/)[0]) ? 1 : 0;
  const hasSystemRule = /系统|金手指|任务|奖励|面板|魔法少女|搜打撤/.test(cardText) ? 1 : 0;
  const hasIdentityConflict = /身份|冒充|不是|认出|疤|转生|穿越|女婴|博士/.test(cardText) ? 1 : 0;
  const hasCombat = /战斗|巡逻|追杀|匕首|弩|刀|敌|合围|危险|妖兽|斗法/.test(cardText) ? 1 : 0;
  const isVolumeOpening = chapterNumber === 1 || /开局|入门|第一卷/.test(cleanCard.paceStage || cleanCard.volumeName || '') ? 1 : 0;
  const isVolumeEnding = /卷末|高潮|收束|决战/.test(cardText) ? 1 : 0;
  const recentHeavyIssues = /heavy|硬检测|自然感硬/.test(normalizeText(automation.habitLedger || automation.progressNotes || automation.lastRepairReport)) ? 1 : 0;
  const complexityScore = isFirstThreeChapters * 3 + hasNewCharacter * 2 + hasSystemRule * 2 + hasIdentityConflict * 2 + hasCombat * 2 + isVolumeOpening * 2 + isVolumeEnding * 3 + recentHeavyIssues * 2;
  return {
    chapterIntent: {
      goal: cleanCard.chapterGoal || cleanCard.allowedBeats || cleanCard.summary,
      mainEvent: cleanCard.coreEvent || cleanCard.summary,
      cast: cleanCard.cast,
      requiredClues: cleanCard.keyClue || cleanCard.foreshadowing,
      requiredOutcome: cleanCard.chapterResult || cleanCard.hook,
      hook: cleanCard.hook,
      forbiddenProgress: cleanCard.forbiddenBeats || cleanCard.progressLock,
    },
    executionPack: {
      stateMachine: directorContext.stateMachine,
      informationBudget: directorContext.informationBudget,
      characterKnowledge: directorContext.characterKnowledge,
      actionChain: directorContext.actionChain,
      povBoundary: {
        canSee: '当前视角人物眼前的人、物、动作、光线和距离',
        canHear: '方向、远近、节奏、音量变化；来源不明时不精确命名身份和材质',
        canInfer: '只能根据现场证据做有限推测，推测后必须改变动作',
        cannotAssert: '不能直接断言视野外身份、完整动机、精确人数、完整世界观真相',
      },
      physicsBoundary: {
        distance: '远距离低语不可听清；隔墙不可看见表情；黑暗中不可看清细小编号',
        injury: '伤势会影响动作速度、姿态和说话长度',
        heldItems: '手中物会限制动作，不能一边握紧多物一边流畅完成复杂动作',
      },
      styleCapsule: resolveWritingStyle(project, automation),
      sentenceBudget: '每个场景包450-750字；每段只承担一个主功能；每组最多一个长句、一个环境主物件、一个系统提示。',
      complexityScore,
    },
    directorContext,
  };
}

function getWritingStrategyLibrary(project = {}) {
  const text = [project.genre, project.premise, project.styleGuide, project.targetAudience].map(normalizeText).join('\n');
  return {
    openings: ['压力已发生', '错误行动后果', '异常物先出现', '对话压迫切入', '系统短讯打断'],
    informationRelease: ['先给可行动信息，后推迟解释', '明确结果 + 残缺警告', '物件反馈改变路线', '对话只给半句证据'],
    protagonistReactions: /搞笑|日常|吐槽|雌小鬼|魔法少女/.test(text) ? ['嘴硬短吐槽', '成年人认知撞上身体限制', '怕但先动', '被系统嘲讽后找补'] : ['先怂后动', '短促自嘲', '现实打断玩家经验'],
    dialoguePressure: ['台词制造选择压力', '角色只说自己知道的证据', '拒绝完整解释', '用停顿和动作替代推理说明'],
    systemStoryMoves: ['系统只给短讯、限制、奖励、嘲讽和代价', '系统提示必须改变下一步动作', '拟人系统可以嘴欠但不能讲百科'],
    payoffPatterns: ['拿到东西', '躲过一次', '识破风险', '关系松动', '获得小能力但有代价'],
    endingHooks: ['具体动作未完成', '具体声音逼近', '具体选择未做', '具体物件异常', '具体台词没接住'],
    mobilePacing: ['2个叙事拍一组', '每组2-5个自然段', '每组至少一个动作结果', '避免连续三个孤立短句'],
  };
}

function directHumanWriting({ project = {}, compiled = {}, card = {}, chapterNumber = 1 } = {}) {
  const library = getWritingStrategyLibrary(project);
  const text = [project.genre, project.premise, project.styleGuide, card.summary, card.coreEvent, card.systemRule].map(normalizeText).join('\n');
  const strategy = {
    opening: /第一章|开局|转生|死亡|卡车|醒来|女婴/.test(text) ? '压力已发生' : library.openings[0],
    informationRelease: /系统|坐标|频道|线索|魔法少女/.test(text) ? '明确结果 + 残缺警告' : '先给可行动信息，后推迟解释',
    protagonistReaction: /女婴|转生/.test(text) ? '成年人认知撞上身体限制' : library.protagonistReactions[0],
    dialogue: /灰喉|身份|疤|不信|百合|关系/.test(text) ? '角色只给证据，不完整推理' : '台词制造选择压力',
    systemMove: /系统|魔法少女/.test(text) ? '系统嘴欠但只给短讯、限制、奖励和代价' : '系统提示必须改变下一步动作',
    payoff: /系统|奖励|搜刮|修炼|逆袭/.test(text) ? '获得小能力但有代价' : '拿到东西',
    hook: compiled.chapterIntent?.hook || '停在具体动作、声音、物件变化或选择未完成处',
    sentenceRhythm: compiled.executionPack?.sentenceBudget || '中短句为主，每组最多一个长句。',
  };
  return { library, selectedStrategies: strategy };
}

function routeGenerationMode(compiled = {}) {
  const score = Number(compiled.executionPack?.complexityScore) || 0;
  if (score >= 7) return 'quality';
  if (score >= 3) return 'scene-pack';
  return 'cheap';
}

function buildScenePacks({ compiled = {}, beats = [] } = {}) {
  const sourceBeats = Array.isArray(beats) && beats.length ? beats : buildFallbackNarrativeBeatPlan({
    chapterGoal: compiled.chapterIntent?.goal,
    coreEvent: compiled.chapterIntent?.mainEvent,
    cast: compiled.chapterIntent?.cast,
    keyClue: compiled.chapterIntent?.requiredClues,
    chapterResult: compiled.chapterIntent?.requiredOutcome,
    hook: compiled.chapterIntent?.hook,
  });
  const packs = [];
  const desiredPackCount = sourceBeats.length <= 5 ? 2 : (sourceBeats.length <= 8 ? 3 : 4);
  const beatsPerPack = Math.max(2, Math.ceil(sourceBeats.length / desiredPackCount));
  for (let idx = 0; idx < sourceBeats.length; idx += beatsPerPack) {
    const packBeats = sourceBeats.slice(idx, idx + beatsPerPack);
    packs.push({
      index: packs.length + 1,
      title: packBeats.map((beat) => beat.title).filter(Boolean).join(' + ') || `场景包${packs.length + 1}`,
      goal: packBeats.map((beat) => beat.goal).filter(Boolean).join('；'),
      events: packBeats.map((beat) => beat.event).filter(Boolean),
      information: packBeats.map((beat) => beat.information).filter(Boolean).join('；'),
      cast: packBeats.map((beat) => beat.cast).filter(Boolean).join('、'),
      povBoundary: packBeats.map((beat) => beat.forbiddenAssertions).filter(Boolean).join('；') || compiled.executionPack?.povBoundary?.cannotAssert,
      endpoint: packBeats.at(-1)?.endpoint || '以动作结果或未完成选择收束',
      targetWords: '700-1100字',
    });
  }
  return packs;
}

function formatCompiledPackForDraft({ compiled = {}, strategy = {}, scenePack = {}, previousText = '' } = {}) {
  const info = compiled.executionPack?.informationBudget || {};
  const pov = compiled.executionPack?.povBoundary || {};
  const physics = compiled.executionPack?.physicsBoundary || {};
  return [
    `场景包${scenePack.index}：${scenePack.title}`,
    `目标：${scenePack.goal}`,
    `事件：${scenePack.events?.join(' → ')}`,
    `只释放信息：${scenePack.information}`,
    `出场人物：${scenePack.cast}`,
    `停点：${scenePack.endpoint}`,
    `明确释放上限：${info.explicit || ''}`,
    `只暗示：${info.hint || ''}`,
    `禁止解释：${info.forbiddenExplanation || ''}`,
    `避免重复：${info.repeatAvoidance || ''}`,
    `POV不可断言：${scenePack.povBoundary || pov.cannotAssert || ''}`,
    `物理权限：${physics.distance || ''}；${physics.injury || ''}`,
    `写法策略：开场=${strategy.opening}；信息=${strategy.informationRelease}；人物反应=${strategy.protagonistReaction}；对话=${strategy.dialogue}；系统=${strategy.systemMove}；爽点=${strategy.payoff}`,
    `句法预算：${strategy.sentenceRhythm || ''}`,
    previousText ? `上一场景包末尾：${normalizeText(previousText).slice(-360)}` : '',
  ].filter(Boolean).join('\n');
}

async function buildNarrativeBeatPlan({ apiKey, model, baseUrl, project, automation, card, nextCard, chapterNumber, previousChapter, rhythmPlan = '', directorContext = null, signal }) {
  const effectiveDirectorContext = directorContext || buildChapterDirectorContext({ project, automation, card, chapterNumber, previousChapter });
  const prompt = promptComposer.buildGenerationPrompt([
    '质量优先写作模式：请先把本章拆成 6-8 个“叙事拍”，不要写正文。',
    '叙事拍是小说的最小行动单元：每拍只完成一个现场动作、一个人物反应或一个信息释放。',
    '每拍必须给出感知权限，防止视角人物直接知道看不见、听不准、不能判断的信息。',
    '每拍必须把抽象目标降成可写动作：碰到、听见、躲开、拿起、停住、质问、压低声音、改变路线、收起物件。',
    '每拍只允许一个核心信息；后期秘密、人物完整动机、系统来源和世界观解释延后。',
    `章节号：第${chapterNumber}章`,
    `作品名：${project.title}`,
    `题材：${project.genre}`,
    `文风：${project.styleGuide}`,
    formatChapterDirectorContext(effectiveDirectorContext),
    buildHumanWritingEnginePrompt({ project, automation, card, nextCard, chapterNumber, previousChapter, scope: '叙事拍导演' }),
    rhythmPlan ? '已有章节执行计划与段落节奏谱：' : '',
    rhythmPlan,
    '输出格式必须严格重复以下结构，不要 Markdown 表格，不要正文：',
    '【叙事拍1】',
    '名称：...',
    '目标：...',
    '事件：...',
    '人物：...',
    '信息：...',
    '视角：...',
    '可见：...',
    '可听：...',
    '可推测：...',
    '不可断言：...',
    '句法预算：260-430字；长句最多1个；破折号最多0个；否定判断0个；身体细节最多1个；环境细节最多2个；解释/总结句最多1句',
    '停点：...',
  ]);
  const text = await callDeepSeek({ apiKey, model, baseUrl, temperature: 0.42, userPrompt: prompt, maxTokens: 4096, signal });
  const beats = parseNarrativeBeatPlan(text);
  const validation = validateNarrativeBeatPlan(beats);
  return validation.pass ? beats : buildFallbackNarrativeBeatPlan(card, chapterNumber);
}

async function generateNarrativeBeatDraft({ apiKey, model, baseUrl, project, automation, card, nextCard, chapterNumber, previousChapter, rhythmPlan, directorContext = null, beats, beat, beatIndex, previousBeatText = '', retryReason = '', signal }) {
  const effectiveDirectorContext = directorContext || buildChapterDirectorContext({ project, automation, card, chapterNumber, previousChapter });
  const prompt = promptComposer.buildGenerationPrompt([
    '质量优先写作模式：你现在只写一个叙事拍，不写整章，不输出标题、摘要、报告或说明。',
    '叙述人称：全章第三人称跟随视角。内心也写成“魏杰来不及犹豫/他没时间想完”，不要出现第一人称旁白。',
    '把信息放进动作、感知、短台词和选择里；先给现场证据，再让人物动作改变。',
    '如果声音来自视野外，只写方向、远近、节奏和人物反应；不要替人物精确命名材质、身份、人数或动机。',
    '视野外脚步统一写“脚步声、鞋底摩擦声、碎石被踩响”，不要写“皮靴声、军靴声、某种鞋碾过”。',
    '系统提示只能短促改变下一步选择，不解释世界观。',
    '人物说话按人物口吻表，不用台词讲完整设定。',
    retryReason ? `上一稿需要按写作动作重写：${retryReason}` : '',
    buildHumanWritingEnginePrompt({ project, automation, card, nextCard, chapterNumber, previousChapter, scope: '逐拍正文生成' }),
    rhythmPlan ? '本章执行计划与节奏谱：' : '',
    rhythmPlan,
    '本章叙事拍计划：',
    formatNarrativeBeatPlan(beats),
    '当前叙事拍导演：',
    buildBeatDirectorGuide(beat, beatIndex, beats.length),
    previousBeatText ? '上一拍末尾，用于自然承接：' : '',
    previousBeatText ? normalizeText(previousBeatText).slice(-500) : '',
    '输出要求：只输出本拍小说正文。不要加“正文：”。不要解释你怎么写。',
  ]);
  const text = await callDeepSeek({ apiKey, model, baseUrl, temperature: retryReason ? 0.48 : 0.62, userPrompt: prompt, maxTokens: 2048, signal });
  return stripBeatDraftNoise(text);
}

async function generateScenePackDraft({ apiKey, model, baseUrl, project, automation, card, nextCard, chapterNumber, previousChapter, compiled, humanPlan, scenePack, previousSceneText = '', retryReason = '', signal }) {
  const perceptionScope = buildPerceptionScope({ project, card, scenePack, chapterNumber });
  const continuityLedger = buildSceneContinuityLedger({ previousText: previousSceneText || previousChapter?.content || '', scenePack, card });
  const repetitionLedger = buildRepetitionLedger({ previousText: previousSceneText || previousChapter?.content || '' });
  const rhythmContract = buildSceneRhythmContract({ scenePack, compiled, card, previousSceneText });
  const syntaxContract = buildSyntaxContract({ scenePack, card, perceptionScope, rhythmContract });
  const detailBudgetContract = buildDetailBudgetContract({ scenePack, card });
  const interiorContract = buildInteriorMonologueContract({ card, scenePack });
  const systemMessageContract = buildSystemMessageContract({ project, scenePack });
  const fidelityContract = buildInspirationFidelityContract({ project, card });
  const genrePromiseContract = buildGenrePromiseContract({ project });
  const openingHookContract = buildOpeningHookContract({ project, card, chapterNumber });
  const chapterFunctionContract = buildChapterFunctionContract({ card, chapterNumber });
  const worldExposureBudgetContract = buildWorldExposureBudgetContract({ card, chapterNumber });
  const genreKnowledgeContract = buildGenreKnowledgeContract({ project, card });
  const dialoguePurposeContract = buildDialoguePurposeContract({ card, scenePack });
  const detailSelectionContract = buildDetailSelectionContract({ scenePack, card, perceptionScope, chapterNumber });
  const dialogueDensityContract = buildDialogueDensityContract({ card, scenePack });
  const styleTextureContract = buildStyleTextureContract({ project, scenePack });
  const titleCoreSellContract = buildTitleCoreSellContract({ project, card, chapterNumber });
  const escapeInteractionContract = buildEscapeInteractionContract({ card, scenePack });
  const prompt = promptComposer.buildGenerationPrompt([
    '自动连载生产系统：你只写当前场景包正文，不写整章，不输出标题、摘要、报告或说明。',
    '正文阶段只执行当前小上下文：不要补全蓝图，不要解释世界观，不要复述章节卡。',
    '第三人称贴身视角；叙述句必须用“她/杜蓁蓁”，不能用“我”做动作主语。只有被“她想/她脑子里闪过/她想说”明确引出的心声短句才可出现第一人称。',
    '系统提示必须短，像功能反馈或嘴欠短讯，只要能改变下一步动作；不要长面板百科；系统弹窗必须独立成行并用【】包住整行。',
    '对话只推动当场关系或选择，不完整解释身份逻辑；追逐/战斗喊话可以短，但根据场景需要带一点判断、误判、急躁或威胁，避免全是报状态。',
    formatSceneContinuityLedger(continuityLedger),
    formatRepetitionLedger(repetitionLedger),
    formatInspirationFidelityContract(fidelityContract),
    formatGenrePromiseContract(genrePromiseContract),
    formatOpeningHookContract(openingHookContract),
    formatChapterFunctionContract(chapterFunctionContract),
    formatWorldExposureBudgetContract(worldExposureBudgetContract),
    formatGenreKnowledgeContract(genreKnowledgeContract),
    formatDetailSelectionContract(detailSelectionContract),
    formatPerceptionScopeForPrompt(perceptionScope),
    formatSceneRhythmContract(rhythmContract),
    formatSyntaxContract(syntaxContract),
    formatDetailBudgetContract(detailBudgetContract),
    formatInteriorMonologueContract(interiorContract),
    formatSystemMessageContract(systemMessageContract),
    formatDialoguePurposeContract(dialoguePurposeContract),
    formatDialogueDensityContract(dialogueDensityContract),
    formatStyleTextureContract(styleTextureContract),
    formatTitleCoreSellContract(titleCoreSellContract),
    formatEscapeInteractionContract(escapeInteractionContract),
    formatRhythmGateGuide(),
    retryReason ? `上一稿需要修订：${retryReason}` : '',
    formatCompiledPackForDraft({ compiled, strategy: humanPlan.selectedStrategies, scenePack, previousText: previousSceneText }),
    '当前章节卡精简意图：',
    `目标：${compiled.chapterIntent.goal || ''}`,
    `结果：${compiled.chapterIntent.requiredOutcome || ''}`,
    `钩子：${compiled.chapterIntent.hook || ''}`,
    `输出要求：只输出本场景包小说正文，${scenePack.targetWords || '700-1100字'}。`,
  ]);
  const text = await callDeepSeek({ apiKey, model, baseUrl, temperature: retryReason ? 0.48 : 0.62, userPrompt: prompt, maxTokens: 3072, signal });
  return polishGeneratedDraftLocally(stripBeatDraftNoise(text), perceptionScope);
}

async function generateScenePackChapter({ apiKey, model, baseUrl, project, automation, card, nextCard, chapterNumber, previousChapter, defaultVolumeId, compiled, humanPlan, scenePacks, signal }) {
  const drafts = [];
  const reports = [];
  for (let idx = 0; idx < scenePacks.length; idx += 1) {
    const scenePack = scenePacks[idx];
    const chapterSoFar = drafts.filter(Boolean).join('\n\n');
    const previousSceneText = idx === 0 ? previousChapter?.content || '' : chapterSoFar;
    let draft = await generateScenePackDraft({ apiKey, model, baseUrl, project, automation, card, nextCard, chapterNumber, previousChapter, compiled, humanPlan, scenePack, previousSceneText, signal });
    const perceptionScope = buildPerceptionScope({ project, card, scenePack, chapterNumber });
    let interiorGate = applyInteriorMonologueGate(draft);
    draft = interiorGate.content;
    let perceptionGate = applyPerceptionGate(draft, perceptionScope);
    draft = perceptionGate.content;
    let environmentGate = applyEnvironmentScanGate(draft);
    draft = environmentGate.content;
    let syntaxGate = applySyntaxGate(draft);
    draft = syntaxGate.content;
    let rhythmGate = applyRhythmGate(draft);
    draft = rhythmGate.content;
    draft = repairDuplicateEmphasisLocally(draft);
    syntaxGate = applySyntaxGate(draft);
    draft = syntaxGate.content;
    interiorGate = applyInteriorMonologueGate(draft);
    draft = interiorGate.content;
    let issues = [...interiorGate.issues, ...perceptionGate.issues, ...environmentGate.issues, ...syntaxGate.issues, ...rhythmGate.issues, ...getBeatGateIssues(draft, card)];
    for (let repairAttempt = 0; issues.length && repairAttempt < 2; repairAttempt += 1) {
      draft = await generateScenePackDraft({
        apiKey,
        model,
        baseUrl,
        project,
        automation,
        card,
        nextCard,
        chapterNumber,
        previousChapter,
        compiled,
        humanPlan,
        scenePack,
        previousSceneText,
        retryReason: translateIssuesToRevisionActions(issues) || '保留事件事实，改成动作因果、现场证据和人物轻反应；不要解释判断、短句链、长逗号句或清单段。',
        signal,
      });
      interiorGate = applyInteriorMonologueGate(draft);
      draft = interiorGate.content;
      perceptionGate = applyPerceptionGate(draft, perceptionScope);
      draft = perceptionGate.content;
      environmentGate = applyEnvironmentScanGate(draft);
      draft = environmentGate.content;
      syntaxGate = applySyntaxGate(draft);
      draft = syntaxGate.content;
      rhythmGate = applyRhythmGate(draft);
      draft = rhythmGate.content;
      draft = repairDuplicateEmphasisLocally(draft);
      syntaxGate = applySyntaxGate(draft);
      draft = syntaxGate.content;
      interiorGate = applyInteriorMonologueGate(draft);
      draft = interiorGate.content;
      issues = [...interiorGate.issues, ...perceptionGate.issues, ...environmentGate.issues, ...syntaxGate.issues, ...rhythmGate.issues, ...getBeatGateIssues(draft, card)];
    }
    drafts.push(draft);
    reports.push(`场景包${scenePack.index}《${scenePack.title}》：${issues.length ? `仍需关注：${issues.slice(0, 3).map((issue) => issue.label).join('；')}` : '通过局部门禁'}`);
  }
  const title = `第${chapterNumber}章 ${stripChapterNumber(card.title || '') || '新章节'}`;
  const content = polishGeneratedDraftLocally(drafts.filter(Boolean).join('\n\n'), buildPerceptionScope({ project, card, chapterNumber }));
  const chapter = withChapterNumber({
    title,
    summary: resolveStoredChapterSummary(card, content),
    content,
    volumeId: defaultVolumeId,
  }, chapterNumber);
  return {
    chapter,
    text: [
      `第${chapterNumber}章编译执行包：\n${formatCompiledPackForDraft({ compiled, strategy: humanPlan.selectedStrategies, scenePack: scenePacks[0] || {} })}`,
      `第${chapterNumber}章场景包计划：\n${scenePacks.map((pack) => `${pack.index}. ${pack.title}｜${pack.goal}｜${pack.targetWords}`).join('\n')}`,
      `第${chapterNumber}章场景包局部门禁：\n${reports.join('\n')}`,
      `### ${title}\n正文：\n${content}`,
    ].join('\n\n'),
    warnings: reports.filter((line) => line.includes('仍需关注')),
  };
}

async function assembleNarrativeBeatChapter({ apiKey, model, baseUrl, project, automation, card, nextCard, chapterNumber, previousChapter, directorContext = null, beats, beatDrafts, defaultVolumeId, signal }) {
  const rawContent = beatDrafts.map((item) => stripBeatDraftNoise(item)).filter(Boolean).join('\n\n');
  const title = `第${chapterNumber}章 ${stripChapterNumber(card.title || '') || '新章节'}`;
  const content = polishMechanicalDraftLocally(stripMarkdownNoise(rawContent));
  return {
    text: `### ${title}\n正文：\n${content}`,
    chapter: withChapterNumber({
      title,
      summary: resolveStoredChapterSummary(card, content),
      content,
      volumeId: defaultVolumeId,
    }, chapterNumber),
  };
}

function translateIssuesToRevisionActions(issues = []) {
  const actions = new Set();
  issues.forEach((issue) => {
    if (/negative-judgement-density|plain-negative-density|negative-standalone|negative-paired-contrast|negative-negative|empty-comma|negative-comma/.test(issue.type)) actions.add('逐句处理“不是/没有”密度：保留台词里的自然反驳和人物嘴硬；删掉或改写非台词里连续承担辨认/解释的“不是/没有”。“不是A，也不是B”“第一反应不是A，也不是B”“没有A。也没有B。”“不A。不B。”这类句式按几十章才偶尔一次处理，除非是身份确认、重大反转、死亡确认或人物崩溃，否则改成现场证据、动作结果、人物停顿、物件反馈或下一步选择。');
    if (/negative-negative-explain|negative-negative-affirm/.test(issue.type)) actions.add('把“否定、否定、再解释/升格/转折”的作者判断改掉：不要写“它不再是A，也不是B。它变成了C”或“不是A，也不是B，就是C”。优先让角色看到一个具体痕迹、摸到一个物件、停顿一下、改变动作或做出下一步选择；意义让读者从动作里读出来。');
    if (issue.type === 'triple-noun-enumeration') actions.add('压掉三项名词排比：不要用“一条A，一块B，一个C”替读者升格意义。保留最能改变当前行动的一项，其他信息并入动作、视线或物件反馈，或者直接删掉。');
    if (/negative|negation|plain-negative/.test(issue.type)) actions.add('把辨认结果改成证据顺序：先出现可见/可听证据，再写人物停顿、验证或改变动作；不要用排除式判断承接信息。');
    if (/perception|camera-like|cognition|orphaned-body/.test(issue.type)) actions.add('所有外部信息先过人物感知：补上看见、听见、感觉到、发现或意识到；删掉摄像机报景和人物当下不可能知道的信息。');
    if (/rhythm|fragment|staccato|negative-reveal-chain/.test(issue.type)) actions.add('把碎句链合并成动作-感知-反应-选择的自然段；保留一个关键短句即可，不要连续名词碎句、判断碎句或“不是A。是B。”揭示。');
    if (/absence-short-chain|negative-short-chain|adjective-short-chain/.test(issue.type)) actions.add('把普通观察、否定判断或形容词碎句合并成自然句：例如“没有A。也没有B。”改成“没有A，也没有B”；“不A。不B。不C。”改成一句带目的或反应的判断；“很慢。很重。”改成“拖得很慢，也很重”。除非是死亡确认、重大反转或人物崩溃，不要用断行短句制造留白。');
    if (/isolated-label|sentence-chain|fragment/.test(issue.type)) actions.add('检查短句是否省掉让阅读自然的必要成分。只要补出主语、对象、动作方向、退回路径、下一步安排能让句子更顺，就优先补出来。停止、撤离、别碰、剪断、固定、打开、关闭、放弃、转移这类关键动作要保留“谁做/做什么/别动哪样东西/往哪里退/下一步处理什么”。连续“不A、不B、别C”改成“先做什么 + 哪些动作暂停/谁负责看住风险”，例如“慢慢撤。别带动线，钳口先松开，沿原路退”改成“慢慢撤，钳口先松开，别带动那根线，我们沿原路退回去”，“不剪，不取布条，也别再碰门禁片残片”改成“先把线固定住，布条和门禁片残片都暂时别动”。');
    if (issue.type === 'auditory-overclaim') actions.add('看不见来源的声音只写方向、远近、重量感和节奏，不直接写鞋子材质、身份或兵种。');
    if (issue.type === 'dash-explain-judgement') actions.add('去掉破折号后的解释判断，保留物件反馈、角色动作或一句短台词。');
    if (/sentence-chain|isolated-label/.test(issue.type)) actions.add('把连续短判断句合成带动作因果的自然段：动作、感知、停顿、选择连在一起，不一行一个结论。');
    if (/comma-stacked|detail|inventory|dossier|scene-asset|parallel/.test(issue.type)) actions.add('拆开承载过多的长句，每句只保留一个动作或一个有效细节；环境和道具只保留会改变动作的部分。');
    if (/missing-reaction|stiff-transition/.test(issue.type)) actions.add('关键异常后补一个轻反应桥：人物停顿、看向某物、压低声音、改握物件或改变路线，再进入下一步。');
    if (/dialogue-fragment-command|dialogue-bare-status|dialogue-orphan-connector|dialogue-negative-command-chain/.test(issue.type)) actions.add('修台词时补最小必要成分：半截命令补对象、方向或下一步；“行/可以/明白/不稳”等状态句接用途、条件或动作；孤立“所以/但是/那/现在”只有真有上下文承接才保留；连续“别A/不要B/不C”改成“先做什么 + 哪些风险暂时别碰/谁负责看住”。');
    if (/dialogue/.test(issue.type)) actions.add('台词只推动当场关系或选择，不让两个人把同一组信息对齐说明。');
  });
  return [...actions].join('\n');
}

async function reviseAssembledChapterByGate({ apiKey, model, baseUrl, project, automation, card, nextCard, chapter, chapterNumber, previousChapter, directorContext = null, beats, issues, defaultVolumeId, signal }) {
  const actions = translateIssuesToRevisionActions(issues);
  if (!actions) return { chapter, text: '' };
  const prompt = promptComposer.buildGenerationPrompt([
    '章节质量编辑：按下面“写作动作”修订这一章，只输出完整章节。',
    '重要：不要复述检测问题名，不要解释修订原因，不要新增剧情。',
    '保留章节事实、人物关系、系统提示、章末钩子和大致字数。',
    '若出现“皮靴声/军靴声/某鞋碾过”等视野外声音命名，改成“脚步声/鞋底摩擦声/碎石被踩响”，通过人物反应表现危险。',
    '若出现连续短句链，把相邻动作按因果合成自然段；保留停顿感，但不要一行一个判断。',
    '写作动作：',
    actions,
    `输出格式必须严格为：### 第${chapterNumber}章 ${stripChapterNumber(chapter.title || card.title || '') || '新章节'}\n正文：...`,
    buildHumanWritingEnginePrompt({ project, automation, card, nextCard, chapterNumber, previousChapter, scope: '逐拍整章质量编辑' }),
    '叙事拍计划：',
    formatNarrativeBeatPlan(beats),
    '待修订章节：',
    `### ${chapter.title}\n正文：\n${chapter.content}`,
  ]);
  const text = await callDeepSeek({ apiKey, model, baseUrl, temperature: 0.42, userPrompt: prompt, maxTokens: 8192, signal });
  const revised = makeSingleChapterFromLooseText(text, { chapterNumber, defaultVolumeId });
  const content = polishMechanicalDraftLocally(stripMarkdownNoise(revised.content || chapter.content));
  return {
    text,
    chapter: withChapterNumber({
      ...chapter,
      ...revised,
      content,
      summary: resolveStoredChapterSummary(card, content),
      volumeId: revised.volumeId || chapter.volumeId || defaultVolumeId,
    }, chapterNumber),
  };
}

async function buildChapterBeatPlan({ apiKey, model, baseUrl, project, automation, card, nextCard, chapterNumber, previousChapter, signal }) {
  const prompt = promptComposer.buildGenerationPrompt([
    '稳定连载模式：请先按真人写作模块，为本章生成“章节卡执行计划 + 段落节奏谱”，不要写正文。',
    '目标：把剧情章节卡转化成写法导演方案，避免正文按任务清单打卡，也避免每段都走同一种线性逻辑。',
    '执行计划只允许保留：一个主目标、一个主要场景、一个核心信息、一个关系变化、一个章末钩子；其余内容标记为本章不写/推迟/背景带过。',
    '段落节奏谱输出 8-10 个节点，每个节点必须有“类型/作用/素材/限制”。',
    '可用类型：承压段、行动段、错误行动段、信息段、留白段、缓冲段、对话段、钩子段。连续两个节点不能同类型。',
    '不是每个节点都必须推进下一步；允许有些段落只负责承压、留白、动作修正、缓冲或关系变化。',
    '禁止输出标题、摘要、正文、解释、Markdown 表格。',
    '普通观察要落到现场反馈和下一步动作：人物先碰到/听见/看见，再因此改变路线、姿势、说法或选择。',
    '每个节点只允许一个主物件或一个异常点；不要写物件档案、环境清单或设定说明。',
    '每个节点最多一个身体细节或环境细节，并且必须改变下一动作；不要设计“身体三连细节”或“场景三连物件”。',
    '若需要环境，写成角色绕开/碰到/利用一个物件，不写转椅、镜子、柜台等平权清单。',
    '章末节点必须留下一个具体未解决动作、消息、物件异常或路线选择。',
    `章节号：第${chapterNumber}章`,
    `作品名：${project.title}`,
    `题材：${project.genre}`,
    `文风：${project.styleGuide}`,
    buildPlatformStrategyGuide(project, automation),
    buildAutomationMemoryGuide(project, automation),
    buildHumanWritingModuleGuide({ project, automation, card, chapterNumber, previousChapter }),
    '本章剧情卡：',
    formatChapterCard(card, chapterNumber, { includeWritingSignals: true }),
    previousChapter ? '上一章末段：' : '',
    previousChapter ? normalizeText(previousChapter.content).slice(-1000) : '',
    nextCard ? '下一章方向只作章末钩子参考：' : '',
    nextCard ? formatChapterCard(nextCard, chapterNumber + 1) : '',
    '输出格式必须包含：',
    '【章节卡执行计划】',
    '主目标：...',
    '主要场景：...',
    '核心信息：...',
    '关系变化：...',
    '章末钩子：...',
    '本章不写：...',
    '【段落节奏谱】',
    '1. 类型：承压段；作用：...；素材：...；限制：...',
    '2. 类型：信息段；作用：...；素材：...；限制：...',
  ]);

  const text = await callDeepSeek({ apiKey, model, baseUrl, temperature: 0.45, userPrompt: prompt, maxTokens: 3072, signal });
  const validation = validateChapterRhythmPlan(text);
  if (validation.pass) return text;
  return buildFallbackRhythmPlan(card, chapterNumber);
}

async function resolveGeneratedChapters({ apiKey, model, baseUrl, project, automation, sections, plannedCards, startChapter, batchCount, defaultVolumeId, sourceText, reason = '', signal, onSupplementToken, onSupplementPhase }) {
  const chapters = importAiGeneratedChapters(sourceText, { startChapter, batchCount, defaultVolumeId });
  const texts = [sourceText];
  const warnings = [];

  if (batchCount === 1 && !chapters[0]) {
    chapters[0] = makeSingleChapterFromLooseText(sourceText, {
      chapterNumber: startChapter,
      defaultVolumeId,
    });
  }

  for (let idx = 0; idx < batchCount; idx += 1) {
    if (chapters[idx]) continue;
    const card = plannedCards[idx];
    const previousChapter = idx === 0 ? project.chapters.at(-1) : chapters[idx - 1] || project.chapters.at(-1);
    const nextChapter = plannedCards[idx + 1] ? { title: plannedCards[idx + 1].title, summary: plannedCards[idx + 1].summary } : null;
    try {
      onSupplementPhase?.(`正在流式补写第${startChapter + idx}章`);
      const supplement = await generateSupplementChapter({
        apiKey,
        model,
        baseUrl,
        project,
        automation,
        card,
        chapterNumber: startChapter + idx,
        previousChapter,
        nextChapter,
        defaultVolumeId,
        reason: reason || '上一轮未产出有效正文',
        signal,
        onToken: onSupplementToken,
      });
      chapters[idx] = isInvalidGeneratedChapter(supplement.chapter) ? null : supplement.chapter;
      texts.push(supplement.text);
    } catch (error) {
      warnings.push(`补写第${startChapter + idx}章失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  for (let idx = 0; idx < batchCount; idx += 1) {
    if (!chapters[idx]) continue;
    const words = countWords(chapters[idx].content);
    const minWords = getMinimumChapterWords(automation);
    if (words >= minWords) continue;
    try {
      const expanded = await expandChapterToTargetWords({
        apiKey,
        model,
        baseUrl,
        project,
        automation,
        chapter: withChapterNumber(chapters[idx], startChapter + idx),
        card: plannedCards[idx],
        chapterNumber: startChapter + idx,
        defaultVolumeId,
        signal,
      });
      chapters[idx] = expanded.chapter;
      if (expanded.text) texts.push(expanded.text);
    } catch (error) {
      warnings.push(`第${startChapter + idx}章正文偏短但扩写失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  const validChapters = chapters.filter(Boolean);

  if (!validChapters.length) {
    throw new Error(`AI 未返回可写入章节：${warnings.join('；') || '未解析到章节边界'}`);
  }

  if (validChapters.length < batchCount) {
    warnings.push(`AI 本次只成功生成 ${validChapters.length}/${batchCount} 章，已先写入成功章节，剩余章节请继续自动写作。`);
  }

  const resolved = chapters.slice(0, batchCount).map((chapter, idx) => (chapter ? withChapterNumber(chapter, startChapter + idx) : null));
  const presentChapters = resolved.filter(Boolean);
  let pacing = { text: '', chapters: resolved };
  if (presentChapters.length === resolved.length && hasPacingRisk(presentChapters, plannedCards.slice(0, presentChapters.length))) {
    try {
      pacing = await auditAndRepairPacing({
        apiKey,
        model,
        baseUrl,
        project,
        automation,
        chapters: presentChapters,
        plannedCards: plannedCards.slice(0, resolved.length),
        startChapter,
        batchCount: resolved.length,
        signal,
      });
    } catch (error) {
      warnings.push(`节奏守门检查失败，已先写入原始有效章节：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  return {
    text: texts.filter(Boolean).join('\n\n'),
    chapters: pacing.chapters,
    pacingReport: pacing.text,
    warnings,
  };
}

async function generateAutomationChapter({ apiKey, model, baseUrl, project, automation, card, nextCard, chapterNumber, defaultVolumeId, signal, beatPlan = '', onToken, onPhase }) {
  if (!aiUsageStorage.getStore()) {
    const tracked = await withAiUsageTracking(() => generateAutomationChapter({ apiKey, model, baseUrl, project, automation, card, nextCard, chapterNumber, defaultVolumeId, signal, beatPlan, onToken, onPhase }));
    return {
      ...tracked.result,
      aiUsage: tracked.usage,
      text: [tracked.result?.text, `第${chapterNumber}章AI用量统计：\n${formatAiUsageReport(tracked.usage)}`].filter(Boolean).join('\n\n'),
    };
  }

  const previousChapter = project.chapters.filter((chapter, idx) => !isBlankStarterChapter(chapter, idx)).at(-1);
  const narrativeMode = normalizeNarrativeMode(card?.narrativeMode, chapterNumber);
  const compiled = compileChapterForGeneration({ project, automation, card, chapterNumber, previousChapter });
  const humanPlan = directHumanWriting({ project, compiled, card, chapterNumber });
  const mode = routeGenerationMode(compiled);
  let scenePackFallbackWarning = '';
  if (mode === 'scene-pack' || mode === 'quality') {
    try {
      const planningBeatPlan = beatPlan || await buildChapterBeatPlan({ apiKey, model, baseUrl, project, automation, card, nextCard, chapterNumber, previousChapter, signal });
      const planningBeats = await buildNarrativeBeatPlan({ apiKey, model, baseUrl, project, automation, card, nextCard, chapterNumber, previousChapter, rhythmPlan: planningBeatPlan, directorContext: compiled.directorContext, signal });
      const scenePacks = buildScenePacks({ compiled, beats: planningBeats });
      const sceneResult = await generateScenePackChapter({ apiKey, model, baseUrl, project, automation, card, nextCard, chapterNumber, previousChapter, defaultVolumeId, compiled, humanPlan, scenePacks, signal });
      let sceneChapter = sceneResult.chapter;
      let sceneIssues = getBeatGateIssues(sceneChapter.content || '', card);
      let sceneText = [
        `第${chapterNumber}章生成模式：${mode}（复杂度${compiled.executionPack.complexityScore}）`,
        sceneResult.text,
      ].join('\n\n');
      if (sceneIssues.length) {
        const revised = await reviseAssembledChapterByGate({ apiKey, model, baseUrl, project, automation, card, nextCard, chapter: sceneChapter, chapterNumber, previousChapter, beats: planningBeats, issues: sceneIssues, defaultVolumeId, signal });
        sceneChapter = revised.chapter || sceneChapter;
        sceneText = [sceneText, `第${chapterNumber}章场景包质量编辑：${sceneIssues.slice(0, 6).map((issue) => issue.label).join('；')}`, revised.text].filter(Boolean).join('\n\n');
        sceneIssues = getBeatGateIssues(sceneChapter.content || '', card);
      }
      if (sceneChapter && countWords(sceneChapter.content || '') < getMinimumChapterWords(automation)) {
        const expanded = await ensureChapterMinimumWords({
          apiKey,
          model,
          baseUrl,
          project,
          automation,
          chapter: sceneChapter,
          card,
          chapterNumber,
          defaultVolumeId,
          contextText: `场景包稿偏短，只补到${getMinimumChapterWords(automation)}-${getTargetChapterWords(automation)}字之间。只补当前场景包内动作受阻、人物轻反应和必要过渡，不新增解释。`,
          signal,
        });
        if (expanded.chapter && countWords(expanded.chapter.content || '') >= countWords(sceneChapter.content || '') && countWords(expanded.chapter.content || '') <= getTargetChapterWords(automation) + 500) {
          const content = polishMechanicalDraftLocally(stripMarkdownNoise(expanded.chapter.content || sceneChapter.content || ''));
          sceneChapter = withChapterNumber({ ...sceneChapter, ...expanded.chapter, content, summary: resolveStoredChapterSummary(card, content), volumeId: expanded.chapter.volumeId || sceneChapter.volumeId || defaultVolumeId }, chapterNumber);
          sceneText = [sceneText, `第${chapterNumber}章场景包补字：${countWords(content)}字`, expanded.text].filter(Boolean).join('\n\n');
          sceneIssues = getBeatGateIssues(sceneChapter.content || '', card);
        }
      }
      if (sceneChapter && !isInvalidGeneratedChapter(sceneChapter)) {
        return {
          text: sceneText,
          chapter: withChapterNumber({ ...sceneChapter, content: stripMarkdownNoise(sceneChapter.content), volumeId: sceneChapter.volumeId || defaultVolumeId }, chapterNumber),
          warnings: [...(sceneResult.warnings || []), ...sceneIssues.slice(0, 5).map((issue) => `场景包终检仍需关注：${issue.label}`)],
          beatPlan: planningBeatPlan,
          narrativeBeats: planningBeats,
          scenePacks,
          generationMode: mode,
        };
      }
    } catch (error) {
      scenePackFallbackWarning = `第${chapterNumber}章场景包链路失败，已退回逐拍生成：${error instanceof Error ? error.message : '未知错误'}`;
    }
  }
  const directorContext = buildChapterDirectorContext({ project, automation, card, chapterNumber, previousChapter });
  const effectiveBeatPlan = beatPlan || await buildChapterBeatPlan({ apiKey, model, baseUrl, project, automation, card, nextCard, chapterNumber, previousChapter, signal });
  const narrativeBeats = await buildNarrativeBeatPlan({ apiKey, model, baseUrl, project, automation, card, nextCard, chapterNumber, previousChapter, rhythmPlan: effectiveBeatPlan, directorContext, signal });
  const beatDrafts = [];
  const beatReports = scenePackFallbackWarning ? [scenePackFallbackWarning] : [];

  for (let beatIndex = 0; beatIndex < narrativeBeats.length; beatIndex += 1) {
    const beat = narrativeBeats[beatIndex];
    const previousBeatText = beatDrafts.at(-1) || previousChapter?.content || '';
    let draft = await generateNarrativeBeatDraft({
      apiKey,
      model,
      baseUrl,
      project,
      automation,
      card,
      nextCard,
      chapterNumber,
      previousChapter,
      rhythmPlan: effectiveBeatPlan,
      directorContext,
      beats: narrativeBeats,
      beat,
      beatIndex,
      previousBeatText,
      signal,
    });
    let beatIssues = getBeatGateIssues(draft, card);
    for (let repairAttempt = 0; beatIssues.length && repairAttempt < 3; repairAttempt += 1) {
      const repairAction = translateIssuesToRevisionActions(beatIssues) || beatIssues.slice(0, 3).map((issue) => issue.label).join('；');
      draft = await generateNarrativeBeatDraft({
        apiKey,
        model,
        baseUrl,
        project,
        automation,
        card,
        nextCard,
        chapterNumber,
        previousChapter,
        rhythmPlan: effectiveBeatPlan,
        directorContext,
        beats: narrativeBeats,
        beat,
        beatIndex,
        previousBeatText,
        retryReason: `保留本拍事件事实，改成现场证据、人物动作和选择变化；视野外脚步只写脚步声/鞋底摩擦声/碎石被踩响；全程第三人称；减少解释判断、长逗号链、破折号解释、短句链和细节清单。修订动作：${repairAction}`,
        signal,
      });
      beatIssues = getBeatGateIssues(draft, card);
    }
    beatDrafts.push(draft);
    beatReports.push(`叙事拍${beatIndex + 1}《${beat.title || ''}》：${beatIssues.length ? `仍需终检关注：${beatIssues.slice(0, 3).map((issue) => issue.label).join('；')}` : '通过局部门禁'}`);
  }

  const assembled = await assembleNarrativeBeatChapter({
    apiKey,
    model,
    baseUrl,
    project,
    automation,
    card,
    nextCard,
    chapterNumber,
    previousChapter,
    directorContext,
    beats: narrativeBeats,
    beatDrafts,
    defaultVolumeId,
    signal,
  });

  let assembledChapter = assembled.chapter;
  let assembledText = assembled.text;
  let assembledIssues = assembledChapter ? getBeatGateIssues(assembledChapter.content || '', card) : [];
  if (assembledChapter && assembledIssues.length) {
    const revised = await reviseAssembledChapterByGate({
      apiKey,
      model,
      baseUrl,
      project,
      automation,
      card,
      nextCard,
      chapter: assembledChapter,
      chapterNumber,
      previousChapter,
      directorContext,
      beats: narrativeBeats,
      issues: assembledIssues,
      defaultVolumeId,
      signal,
    });
    assembledChapter = revised.chapter || assembledChapter;
    assembledText = [assembledText, `第${chapterNumber}章逐拍整章质量编辑：${assembledIssues.slice(0, 6).map((issue) => issue.label).join('；')}`, revised.text].filter(Boolean).join('\n\n');
    assembledIssues = getBeatGateIssues(assembledChapter.content || '', card);
  }

  if (assembledChapter && countWords(assembledChapter.content || '') < getMinimumChapterWords(automation)) {
    const expanded = await ensureChapterMinimumWords({
      apiKey,
      model,
      baseUrl,
      project,
      automation,
      chapter: assembledChapter,
      card,
      chapterNumber,
      defaultVolumeId,
      contextText: [
        `逐拍生成稿偏短，只补到${Math.max(getMinimumChapterWords(automation), 2200)}-${getTargetChapterWords(automation)}字之间，不要扩成长章。`,
        '只补同场景动作受阻、人物轻反应、系统短讯承接和必要过渡。',
        '不要新增新角色、新地点、完整解释、设定说明或下一章内容。',
        '优先补一到两个短段：躲避巡逻时的动作代价、对讲机声音后的轻反应或灰喉对峙里的动作压力。',
      ].join('\n'),
      signal,
    });
    if (expanded.chapter && countWords(expanded.chapter.content || '') >= countWords(assembledChapter.content || '') && countWords(expanded.chapter.content || '') <= getTargetChapterWords(automation) + 500) {
      const content = polishMechanicalDraftLocally(stripMarkdownNoise(expanded.chapter.content || assembledChapter.content || ''));
      assembledChapter = withChapterNumber({
        ...assembledChapter,
        ...expanded.chapter,
        content,
        summary: resolveStoredChapterSummary(card, content),
        volumeId: expanded.chapter.volumeId || assembledChapter.volumeId || defaultVolumeId,
      }, chapterNumber);
      assembledText = [assembledText, `第${chapterNumber}章逐拍补字：${countWords(content)}字`, expanded.text].filter(Boolean).join('\n\n');
      assembledIssues = getBeatGateIssues(assembledChapter.content || '', card);
    }
  }

  if (assembledChapter && !isInvalidGeneratedChapter(assembledChapter)) {
    return {
      text: [
        `第${chapterNumber}章执行计划与段落节奏谱：\n${effectiveBeatPlan}`,
        `第${chapterNumber}章导演上下文：\n${formatChapterDirectorContext(directorContext)}`,
        `第${chapterNumber}章叙事拍计划：\n${formatNarrativeBeatPlan(narrativeBeats)}`,
        `第${chapterNumber}章逐拍局部门禁：\n${beatReports.join('\n')}`,
        assembledText,
      ].filter(Boolean).join('\n\n'),
      chapter: withChapterNumber({ ...assembledChapter, content: stripMarkdownNoise(assembledChapter.content), volumeId: assembledChapter.volumeId || defaultVolumeId }, chapterNumber),
      warnings: [...beatReports.filter((item) => item.includes('仍需终检关注') || item.includes('场景包链路失败')), ...assembledIssues.slice(0, 5).map((issue) => `整章质量编辑后仍需关注：${issue.label}`)],
      beatPlan: effectiveBeatPlan,
      narrativeBeats,
    };
  }

  const humanEnginePrompt = buildHumanWritingEnginePrompt({ project, automation, card, nextCard, chapterNumber, previousChapter, scope: '正文首稿生成' });
  const prompt = promptComposer.buildGenerationPrompt([
    '稳定连载模式：请以“真人写作引擎”为最高优先级，只生成一章正文。',
    '输出格式必须严格为：### 第X章 标题\n正文：...',
    '不要生成摘要；章节摘要由系统使用章节卡自动写入。',
    '正文第一行禁止再次输出标题、Markdown 标题或“# 第X章”；正文只能从小说内容开始。',
    '真人写作引擎决定本章怎么写；段落节奏谱是下游草图，不得压过人物口吻、错误行动、现实打断和场景选择。',
    humanEnginePrompt,
    '硬性一致性规则：1. 不得提前进入蓝图后期核心冲突；2. 必须按章节卡和分卷定位控制节奏；3. 反派只能按蓝图梯度逐级登场/施压，不能提前暴露终局反派或越级冲突；4. 若章节卡没有要求，不能新增脱离蓝图的大事件、阵营、危机或设定；5. 本章只写“铺垫、推进、兑现本阶段小冲突”，不能跳到下一卷或下一阶段。',
    buildPacingGuardText({ currentCount: chapterNumber - 1, batchCount: 1, targetChapters: automation.targetChapters || 600 }),
    `本次只生成：第${chapterNumber}章`,
    `目标每章字数：${automation.averageChapterWords || 2400}`,
    `叙事手法：${narrativeMode}`,
    `叙事目的：${card?.narrativePurpose || getNarrativePurposeByMode(narrativeMode)}`,
    `作品名：${project.title}`,
    `题材：${project.genre}`,
    `灵感：${automation.inspiration || project.premise}`,
    buildProjectStyleGuide(project, automation),
    buildPlatformStrategyGuide(project, automation),
    buildParagraphBudgetGuide({ project, automation, card, chapterNumber }),
    '长篇蓝图：',
    automation.masterPlan,
    getLatestCheckpointReport(automation) ? '最新阶段检查报告：' : '',
    getLatestCheckpointReport(automation) || '',
    buildContinuityMemoryText(project, automation),
    buildAutomationMemoryGuide(project, automation),
    buildVoiceDriftGuard(project),
    buildOpeningNarrativeStrategyGuide(project),
    buildNoMetaNarrationGuide(),
    buildHumanTextureGuide(project),
    buildDialogueSceneGuide({ project, card }),
    buildNarrativeTextureBudgetGuide(card),
    '本章执行计划与段落节奏谱（只作结构草图；真人写作引擎优先）：',
    effectiveBeatPlan,
    '本章剧情卡：',
    formatChapterCard(card, chapterNumber),
    previousChapter ? '上一章完整承接信息：' : '',
    previousChapter ? `${previousChapter.title}\n摘要：${previousChapter.summary || ''}\n正文末段：${normalizeText(previousChapter.content).slice(-1200)}` : '',
    nextCard ? '下一章只作为章末钩子方向参考，禁止提前写下一章正文：' : '',
    nextCard ? formatChapterCard(nextCard, chapterNumber + 1) : '',
    '最近章节摘要：',
    ...project.chapters.filter((chapter, idx) => !isBlankStarterChapter(chapter, idx)).slice(-5).map((chapter) => `${chapter.title}\n${chapter.summary}`),
    '最近正文衔接上下文：',
    buildRecentContext(project.chapters.filter((chapter, idx) => !isBlankStarterChapter(chapter, idx)), 3),
    buildReaderExpectationGuide(),
    buildUnevenHumanStyleGuide(),
    '动作章质感：动作推进要快，但不要省成分镜提纲；根据场景需要补足必要过渡、身体反馈或环境后果，关键受阻和转折处要让读者看清因果。',
    '段落节奏：段落类型不硬轮换；连续行动段可以存在，但关键行动点尽量有不同阻碍、反馈或选择变化。',
    '对话质感：追兵喊话、战斗喊话可以承担压力，但不要连续只报状态；根据场景需要带少量判断、误判、急躁、威胁或立场。',
    '风格降权：幽默和史诗感优先保留，但高速追逐、受伤、求援段可以降权；宁可少一点吐槽，也要把动作因果写顺。',
    '首稿要求：只写这一章，不要写下一章，不要输出解释。正文控制在2000到3200字。让人物处在麻烦里，让信息从动作和对话中露出，让系统提示改变选择，让章末停在具体动作或路线选择前。',
  ]);

  onPhase?.(`正在生成第${chapterNumber}章质量首稿`);
  const text = onToken
    ? await callDeepSeekStream({ apiKey, model, baseUrl, temperature: 0.68, userPrompt: prompt, maxTokens: 8192, signal, timeoutMs: 300000, onToken })
    : await callDeepSeek({ apiKey, model, baseUrl, temperature: 0.68, userPrompt: prompt, maxTokens: 8192, signal });
  onPhase?.(`正在解析第${chapterNumber}章质量首稿`);
  const resolved = await resolveGeneratedChapters({
    apiKey,
    model,
    baseUrl,
    project,
    automation,
    sections: extractGeneratedSections(text).slice(0, 1),
    plannedCards: [card],
    startChapter: chapterNumber,
    batchCount: 1,
    defaultVolumeId,
    sourceText: text,
    reason: `逐章生成第${chapterNumber}章时章节边界不完整`,
    signal,
    onSupplementToken: onToken,
    onSupplementPhase: onPhase,
  });

  return {
    text: [`第${chapterNumber}章执行计划与段落节奏谱：\n${effectiveBeatPlan}`, resolved.text, resolved.pacingReport].filter(Boolean).join('\n\n'),
    chapter: resolved.chapters[0] ? withChapterNumber({ ...resolved.chapters[0], content: stripMarkdownNoise(resolved.chapters[0].content), volumeId: resolved.chapters[0].volumeId || defaultVolumeId }, chapterNumber) : null,
    warnings: resolved.warnings || [],
    beatPlan: effectiveBeatPlan,
  };
}

async function generateLightweightAutomationChapter({ apiKey, model, baseUrl, project, automation, card, nextCard, chapterNumber, defaultVolumeId, signal, onToken, onPhase }) {
  const previousChapter = project.chapters?.filter((chapter, idx) => !isBlankStarterChapter(chapter, idx)).at(-1) || null;
  const prompt = promptComposer.buildGenerationPrompt([
    '轻量生成模式：你是中文网文作者，只写当前这一章，不解释，不输出写作计划。',
    '本模式保留蓝图、作者人设、章节卡和最近上下文，但跳过场景包、叙事拍和多层重控制；目标是更自然、顺畅、像真人连载正文。',
    '输出格式必须严格为：### 第X章 标题\n摘要：...\n正文：...',
    '叙事人称：第三人称有限视角，主视角跟随当前主角；不要用第一人称做正文叙述。',
    '正文长度：1500-4000中文字符；宁可少写，也不要扩成长章。',
    '系统提示格式：系统弹窗必须独立成行，整行用【】包住；不要写成【搜】附近可回收物资这种半框格式，应写成【搜：附近可回收物资为运输车残骸】。',
    buildNoMetaNarrationGuide(),
    buildHumanWebNovelReadabilityGuide(),
    buildHumanWritingEnginePrompt({ project, automation, card, nextCard, chapterNumber, previousChapter, scope: '轻量正文生成' }),
    buildPacingGuardText({ currentCount: chapterNumber - 1, batchCount: 1, targetChapters: automation.targetChapters || 600 }),
    buildPlatformStrategyGuide(project, automation),
    buildProjectStyleGuide(project, automation),
    '轻量动作与对话规则：',
    '1. 正常说话优先：求救、指挥、安抚、拒绝、解释、确认信息和安排撤离时，先把正常对话和行动信息说清。',
    '2. 动作因果清楚：看见问题、判断代价、安排动作要连上；关键受阻和转折处补足必要过渡、身体反馈或环境后果。',
    '3. 角色口吻服务关系：人物按当下处境、关系、目的、信息差和身体状态说话；短句可以有，但不要像清单报告。',
    '3b. 必要成分补足：短句可以急促，但只要补出主语、对象、动作方向、退回路径、下一步安排能让句子更自然，就优先补出来。停止、撤离、别碰、剪断、固定、打开、关闭、放弃、转移这类关键动作要说清“谁做/做什么/别动哪样东西/往哪里退/下一步处理什么”。连续“不A、不B、别C”优先改成“先做什么 + 哪些动作暂停/谁负责看住风险”。',
    '3c. 对话流畅度：台词少主语、谓语、对象、方向、条件或承接词会让读者回推时，优先补足。不要长期写成“快。”“行。”“继续走。”“别回门。”“可以。”这类孤立口令或状态播报；可改成“你们先往前走”“行，我来开维护气闸”“沿这条手动轨道继续推”“先别回那扇门”“可以，我只开维护项”。',
    '3d. 连接词贴上下文：所以、但是、那、行、嗯、好、现在、先、再、就这类词只在回应上一句话、现场动作或明确选择时使用；上下文不是因果、转折或让步时，改成动作、称呼、具体对象或直接回答。单独的“可以、行、明白、稳了、不稳、够、不够、有、没有”通常要接用途、条件或动作。',
    '3e. 同句连续否定排比要少用：“不A，不B，也不C”“别A，别B，也别C”很容易像规则朗读。角色声明边界时，优先写“我只做什么 + 哪些风险顺带压住”，例如“我只看罗德岛标记，旧锁和检测物都不碰，通讯也压到最低。”',
    '4. 短句有资格：短句、断行和留白只用于强情绪、危险瞬间、对话打断、重大发现或章末钩子；普通观察、否定判断、位置判断、动作安排和信息确认写成自然句。',
    '4b. 压缩解释不能换成碎句：减少解释时，不要把“为什么这样判断”拆成多句短判断或连续短台词。普通判断优先写成“现场证据 + 人物动作/安排”的自然承接句；高压段可以短，但连续两三句短问、短命令、短判断后通常要接一个完整动作或明确对象。',
    '5. 否定对照极低频：“不是A，也不是B”“没有A。也没有B。”“不A。不B。”这类句式默认几十章才偶尔保留一次；普通段落改成动作、停顿、物件反馈或下一步选择。',
    '6. 吐槽低于人设和行动：调侃、梗和夸张比喻只有在遮掩害怕、暴露误判、缓冲关系或推动行动时才短促出现；高压救人、撤离、伤情恶化和敌人逼近时优先写行动。',
    '7. 类型经验有边界：游戏、原作、系统或套路经验只用于初始误判、快速判断或被现实纠正；遇到真实伤痛、救人和关系冲突时优先写现场证据和人物选择。',
    '8. 系统提示只改变动作：系统提示必须独立成行、整行【】包住，只给目标、限制、风险、异常、奖励或代价，不能替作者讲世界观。',
    '9. 环境服务行动：每个环境段只保留会改变路线、遮挡视线、暴露敌人或提供可利用物的1-2个细节。',
    '10. 基调优先自然落地：轻松日常优先写生活小目标、小麻烦、小收获和关系软化；轻喜反差优先写错位误会、奇怪但有效的处理和反差收益；高压求生也要让主角用判断或代价换回一点主动权。不要把所有作品都写成连续追杀、受伤和更大危险靠近。',
    '11. 首稿不要自我检查式写作：不要为了满足规则而逐条展示技巧，先让人物在麻烦里自然行动；详细检测交给后处理。',
    '作品信息：',
    `作品名：${project.title}`,
    `题材：${project.genre}`,
    `读者：${project.targetAudience}`,
    `核心设定：${project.premise}`,
    '作者人设：',
    automation.authorPersona || '',
    buildToneProtocolGuide(project, automation),
    buildToneDriftGuide(automation),
    '长篇蓝图：',
    automation.masterPlan || '',
    buildAutomationMemoryGuide(project, automation),
    buildContinuityMemoryText(project, automation),
    '当前章节卡：',
    formatChapterCard(card, chapterNumber),
    nextCard ? '下一章只作为章末钩子方向参考，禁止提前写下一章正文：' : '',
    nextCard ? formatChapterCard(nextCard, chapterNumber + 1) : '',
    previousChapter ? '上一章承接：' : '',
    previousChapter ? `${previousChapter.title}\n摘要：${previousChapter.summary || ''}\n正文末段：${normalizeText(previousChapter.content).slice(-1200)}` : '',
    '最近章节摘要：',
    ...project.chapters.filter((chapter, idx) => !isBlankStarterChapter(chapter, idx)).slice(-5).map((chapter) => `${chapter.title}\n${chapter.summary}`),
    '最近正文衔接上下文：',
    buildRecentContext(project.chapters.filter((chapter, idx) => !isBlankStarterChapter(chapter, idx)), 3),
    '只写本章章节卡允许的事件；不要提前写后续章节正文；章末停在当前章节卡钩子或下一步选择上。',
  ]);

  onPhase?.(`正在生成第${chapterNumber}章轻量首稿`);
  const text = onToken
    ? await callDeepSeekStream({ apiKey, model, baseUrl, temperature: 0.68, userPrompt: prompt, maxTokens: 8192, signal, timeoutMs: 300000, onToken })
    : await callDeepSeek({ apiKey, model, baseUrl, temperature: 0.68, userPrompt: prompt, maxTokens: 8192, signal, timeoutMs: 300000 });
  onPhase?.(`正在解析第${chapterNumber}章轻量首稿`);
  const resolved = await resolveGeneratedChapters({
    apiKey,
    model,
    baseUrl,
    project,
    automation,
    sections: extractGeneratedSections(text).slice(0, 1),
    plannedCards: [card],
    startChapter: chapterNumber,
    batchCount: 1,
    defaultVolumeId,
    sourceText: text,
    reason: `轻量生成第${chapterNumber}章时章节边界不完整`,
    signal,
    onSupplementToken: onToken,
    onSupplementPhase: onPhase,
  });
  const chapter = resolved.chapters[0] ? withChapterNumber({
    ...resolved.chapters[0],
    content: repairDenseRhetoricLocally(repairUrgentCommandBurstsLocally(repairStandaloneTacticalLabelsLocally(repairSystemMessageLocally(stripMarkdownNoise(resolved.chapters[0].content || ''))))),
    summary: resolveStoredChapterSummary(card, resolved.chapters[0].content || ''),
    volumeId: resolved.chapters[0].volumeId || defaultVolumeId,
  }, chapterNumber) : null;
  return {
    text: ['轻量生成模式：已跳过场景包/叙事拍重控制。', resolved.text, resolved.pacingReport].filter(Boolean).join('\n\n'),
    chapter,
    warnings: resolved.warnings || [],
    generationMode: 'lightweight',
  };
}

async function generateAutomationChaptersSequential({ apiKey, model, baseUrl, project, automation, plannedCards, startChapter, batchCount, defaultVolumeId, signal }) {
  const chapters = [];
  const texts = [];
  const warnings = [];
  const initialState = getAutomationWriteState(project);

  for (let idx = 0; idx < batchCount; idx += 1) {
    const chapterNumber = startChapter + idx;
    const workingChapters = initialState.replaceBlankStarter ? chapters : [...project.chapters, ...chapters];
    const workingProject = { ...project, chapters: workingChapters };
    const card = plannedCards[idx];
    const nextCard = plannedCards[idx + 1];

    try {
      const result = await generateAutomationChapter({
        apiKey,
        model,
        baseUrl,
        project: workingProject,
        automation,
        card,
        nextCard,
        chapterNumber,
        defaultVolumeId,
        signal,
      });

      if (!result.chapter || isInvalidGeneratedChapter(result.chapter)) {
        warnings.push(`第${chapterNumber}章未生成可写入正文，已停止本轮自动写作。`);
        break;
      }

      let finalChapter = result.chapter;
      if (result.text) texts.push(result.text);
      warnings.push(...result.warnings);
      try {
        let naturalness = await ensureAutomationChapterNaturalness({
          apiKey,
          model,
          baseUrl,
          project: workingProject,
          automation,
          chapter: finalChapter,
          card,
          chapterNumber,
          signal,
        });
        finalChapter = naturalness.chapter || finalChapter;
        if (naturalness.text) texts.push(naturalness.text);
        if (naturalness.severity === 'medium' || naturalness.severity === 'heavy') {
          const retry = await generateAutomationChapter({
          apiKey,
          model,
          baseUrl,
          project: workingProject,
          automation,
          card,
          nextCard,
          chapterNumber,
          defaultVolumeId,
          signal,
          beatPlan: result.beatPlan,
        });
          if (retry.chapter && !isInvalidGeneratedChapter(retry.chapter)) {
          finalChapter = retry.chapter;
          texts.push(`第${chapterNumber}章按同一节奏谱重生成正文`);
          if (retry.text) texts.push(retry.text);
          naturalness = await ensureAutomationChapterNaturalness({
            apiKey,
            model,
            baseUrl,
            project: workingProject,
            automation,
            chapter: finalChapter,
            card,
            chapterNumber,
            signal,
          });
          finalChapter = naturalness.chapter || finalChapter;
          if (naturalness.text) texts.push(naturalness.text);
          }
        }
        if (naturalness.severity === 'light') {
          warnings.push(`第${chapterNumber}章存在轻微自然感问题：${naturalness.issues.map((issue) => issue.label).join('；')}`);
        }
        finalChapter = withChapterNumber({
          ...finalChapter,
          summary: resolveStoredChapterSummary(card, finalChapter.content),
        }, chapterNumber);
        if (naturalness.severity === 'heavy') {
        warnings.push(`第${chapterNumber}章自然感硬检测仍未通过，已保存清洗稿并暂停：${naturalness.issues.map((issue) => issue.label).join('；')}`);
          chapters.push(finalChapter);
          break;
        }
      } catch (error) {
        warnings.push(`第${chapterNumber}章自然感局部修复失败，保留原稿进入后续审校：${error instanceof Error ? error.message : '未知错误'}`);
      }
      try {
        const lightCheck = await lightCheckAutomationChapter({
              apiKey,
              model,
              baseUrl,
              project: workingProject,
              automation,
              chapter: finalChapter,
              card,
              nextCard,
              chapterNumber,
              signal,
            });
        texts.push(`第${chapterNumber}章轻量发布前校验：\n${lightCheck.text}`);

        if (lightCheck.decision === 'PAUSE') {
          chapters.push(finalChapter);
          warnings.push(`第${chapterNumber}章轻量发布前校验要求人工确认，已保存生成稿并暂停。`);
          break;
        }

        if (lightCheck.decision === 'REWRITE') {
          const auditRevision = await auditRewriteValidateAutomationChapter({
            apiKey,
            model,
            baseUrl,
            project: workingProject,
            automation,
            chapter: finalChapter,
            card,
            nextCard,
            chapterNumber,
            defaultVolumeId,
            signal,
          });
          finalChapter = auditRevision.chapter;
          texts.push(auditRevision.text);
          if (auditRevision.shouldPause) {
            chapters.push(finalChapter);
            warnings.push(`第${chapterNumber}章发布前校验未通过，已保存修订稿并暂停，请人工确认。`);
            break;
          }
        }
      } catch (error) {
        if (chapterNumber <= 3) {
          chapters.push(finalChapter);
          warnings.push(`第${chapterNumber}章为前三章，但发布前审校失败，已保存生成稿并暂停：${error instanceof Error ? error.message : '未知错误'}`);
          break;
        }
        warnings.push(`第${chapterNumber}章轻量发布前校验失败，已保留生成稿：${error instanceof Error ? error.message : '未知错误'}`);
      }

      chapters.push(finalChapter);
    } catch (error) {
      warnings.push(`生成第${chapterNumber}章失败：${error instanceof Error ? error.message : '未知错误'}`);
      break;
    }
  }

  if (!chapters.length) {
    throw new Error(`AI 未返回可写入章节：${warnings.join('；') || '逐章生成失败'}`);
  }

  if (chapters.length < batchCount) {
    warnings.push(`本轮逐章生成只成功 ${chapters.length}/${batchCount} 章，已先写入成功章节，剩余章节请继续自动写作。`);
  }

  return {
    text: texts.filter(Boolean).join('\n\n'),
    chapters,
    warnings,
  };
}

async function generateAndPersistQualityChapters({ req, projectIndex, project, automation, plannedCards, startChapter, batchCount, defaultVolumeId, apiKey, model, baseUrl, targetProgress = null, stopAtCheckpoint = false, lightweight = false, signal }) {
  const generatedChapters = [];
  const texts = [];
  const warnings = [];
  const initialState = getAutomationWriteState(project);
  let workingProject = project;
  let persistedProject = project;

  for (let idx = 0; idx < batchCount; idx += 1) {
    const chapterNumber = startChapter + idx;
    const card = plannedCards[idx];
    const nextCard = plannedCards[idx + 1] || null;
    if (!card) {
      warnings.push(`第${chapterNumber}章缺少章节卡，已停止本轮自动写作。`);
      break;
    }

    try {
      const result = await (lightweight ? generateLightweightAutomationChapter : generateAutomationChapter)({
        apiKey,
        model,
        baseUrl,
        project: workingProject,
        automation,
        card,
        nextCard,
        chapterNumber,
        defaultVolumeId,
        signal,
      });

      if (result.text) texts.push(result.text);
      warnings.push(...(result.warnings || []));

      if (!result.chapter || isInvalidGeneratedChapter(result.chapter)) {
        warnings.push(`第${chapterNumber}章未生成可写入正文，已停止本轮自动写作。`);
        break;
      }

      const numberedChapter = withChapterNumber({
        ...result.chapter,
        volumeId: result.chapter.volumeId || card.volumeId || defaultVolumeId,
        content: stripMarkdownNoise(result.chapter.content || ''),
        summary: resolveStoredChapterSummary(card, result.chapter.content || ''),
      }, chapterNumber);

      generatedChapters.push(numberedChapter);
      const chaptersForProject = initialState.replaceBlankStarter
        ? [...generatedChapters]
        : [...project.chapters, ...generatedChapters];
      const batchWords = generatedChapters.reduce((sum, chapter) => sum + countWords(chapter.content), 0);
      const ledgerUpdate = buildAutomationLedgerUpdate({ chapters: generatedChapters, cards: plannedCards.slice(0, generatedChapters.length), startChapter, previousAutomation: automation, projectCharacters: project.characters || [] });
      const nextCount = initialState.writtenCount + generatedChapters.length;
      const reachCheckpoint = stopAtCheckpoint && nextCount > 0 && nextCount % checkpointIntervals.standard === 0;
      const checkpointKind = reachCheckpoint ? getCheckpointKind(nextCount) : '';
      const checkpointLabel = reachCheckpoint ? getCheckpointLabel(checkpointKind) : '';
      const reachedTarget = targetProgress ? nextCount >= targetProgress : generatedChapters.length >= batchCount;
      const shouldPauseForReview = getAutomationReviewPause(warnings);
      const automationBeforeToneDrift = {
        ...automation,
        ...ledgerUpdate,
        continuityMemory: buildContinuityMemoryUpdate(generatedChapters, startChapter, automation.continuityMemory),
        totalGeneratedWords: (automation.totalGeneratedWords || 0) + batchWords,
        targetProgress: targetProgress || automation.targetProgress,
        waitingForReview: reachCheckpoint || shouldPauseForReview,
        status: shouldPauseForReview ? 'review' : reachCheckpoint ? 'checkpoint' : reachedTarget ? 'paused' : 'writing',
        progressNotes: warnings.length
          ? `已用${lightweight ? '轻量生成模式' : '单章质量模式'}写到第 ${nextCount} 章，但有警告：${warnings.join('；')}`
          : reachCheckpoint
            ? `已用${lightweight ? '轻量生成模式' : '单章质量模式'}写到第 ${nextCount} 章，触发 ${checkpointLabel}`
            : reachedTarget
              ? `已用${lightweight ? '轻量生成模式' : '单章质量模式'}写到第 ${nextCount} 章，达到指定进度`
              : `已用${lightweight ? '轻量生成模式' : '单章质量模式'}写到第 ${nextCount} 章，继续朝第 ${targetProgress || initialState.writtenCount + batchCount} 章推进`,
      };
      const projectBeforeToneDrift = { ...project, chapters: chaptersForProject, automation: automationBeforeToneDrift };

      persistedProject = buildProjectPayload({
        ...project,
        chapters: chaptersForProject,
        automation: maybeUpdateToneDriftAfterWrite({ project: projectBeforeToneDrift, automation: automationBeforeToneDrift, chapterCount: nextCount }),
      });

      req.db.projects[projectIndex] = persistedProject;
      await writeDb(req.db);
      workingProject = persistedProject;

      if (reachCheckpoint && !shouldPauseForReview) {
        const planningConfig = resolveAiModelConfig(req.body, 'planning');
        const checkpointReport = await generateCheckpointReportForProject({
          db: req.db,
          projectIndex,
          project: persistedProject,
          apiKey: planningConfig.apiKey || apiKey,
          model: planningConfig.model || model,
          baseUrl: planningConfig.baseUrl || baseUrl,
          requestedKind: checkpointKind,
        });
        persistedProject = checkpointReport.project;
        workingProject = checkpointReport.project;
      }

      if (reachCheckpoint || shouldPauseForReview) break;
    } catch (error) {
      warnings.push(`生成第${chapterNumber}章失败：${error instanceof Error ? error.message : '未知错误'}`);
      break;
    }
  }

  if (!generatedChapters.length) {
    throw new Error(`AI 未返回可写入章节：${warnings.join('；') || '单章质量生成失败'}`);
  }

  return {
    text: texts.filter(Boolean).join('\n\n'),
    chapters: generatedChapters,
    project: persistedProject,
    warnings,
    reachedCheckpoint: Boolean(persistedProject.automation?.waitingForReview && persistedProject.automation?.status === 'checkpoint'),
    pausedForReview: Boolean(persistedProject.automation?.waitingForReview && persistedProject.automation?.status === 'review'),
    replacedBlankStarter: initialState.replaceBlankStarter,
  };
}

automationEngine = createAutomationEngine({
  generateAutomationChapter,
  generateAutomationChaptersSequential,
  ensureAutomationChapterNaturalness,
});

function parseCharacterCards(text) {
  const normalized = normalizeText(text).replace(/\r\n/g, '\n');
  const sections = normalized
    .split(/\n(?=###\s*(?:人物|角色)\s*[：:]?\s*)/)
    .map((item) => item.trim())
    .filter((item) => /^###\s*(?:人物|角色)\s*[：:]?\s*/.test(item));

  return sections.map((section) => {
    const header = section.match(/^###\s*(?:人物|角色)\s*[：:]?\s*(.+?)(?:\n|$)/);
    const body = section.replace(/^###\s*.+?(?:\n|$)/, '');
    const name = cleanCardFieldText(header?.[1] || extractLabeledField(body, ['姓名', '名字', '角色名'], ['身份', '定位', '目标', '秘密', '性格', '弧光']))
      .replace(/^[:：]/, '')
      .trim();
    return createCharacter({
      name,
      role: extractLabeledField(body, ['身份', '定位', '角色定位'], ['目标', '诉求', '秘密', '性格', '人物性格', '弧光', '成长线']),
      goal: extractLabeledField(body, ['目标', '诉求', '人物目标'], ['秘密', '隐藏信息', '性格', '人物性格', '弧光', '成长线']),
      secret: extractLabeledField(body, ['秘密', '隐藏信息', '隐情'], ['性格', '人物性格', '弧光', '成长线']),
      traits: extractLabeledField(body, ['性格', '人物性格', '特质'], ['弧光', '成长线']),
      arc: extractLabeledField(body, ['弧光', '成长线', '角色弧光'], ['###']),
    });
  }).filter((character) => character.name);
}

function parseSuggestedNumber(text, fallback) {
  const match = normalizeText(text).match(/(\d{3,7})\s*字/);
  return match ? Number(match[1]) : fallback;
}

export const __testHooks = {
  callDeepSeek,
  callDeepSeekStream,
  createTimeoutSignal,
  combineAbortSignals,
  buildProjectPayload,
  normalizeAiSettingsPayload,
  resolveAiModelConfig,
  isAiHttpStatus,
  isRecoverableChapterCardError,
  cleanAutomationLedgersAfterChapterDelete,
  resetAutomationRuntimeState,
  buildAuthorPersonaPrompt,
  buildReaderExpectationGuide,
  buildChapterCardControlGuide,
  cleanCardFieldText,
  cleanStoredChapterContent,
  formatChapterCard,
  createChapter,
  extractLabeledField,
  assertEnoughChapterCards,
  parseGeneratedChapterCardSection,
  buildToneDriftReport,
  maybeUpdateToneDriftAfterWrite,
  extractGeneratedSections,
  hasPacingRisk,
  findNaturalnessIssues,
  classifyNaturalnessIssues,
  isHighDialogueChapter,
  findDialogueIssues,
  getNarrativeTextureMode,
  repairNaturalnessLocallyWithAi,
  rewriteChapterNaturalnessWithAi,
  repairChapterMetaNarrationLocally,
  generateAutomationChapter,
  generateLightweightAutomationChapter,
  generateAndPersistQualityChapters,
  buildChapterBeatPlan,
  buildHumanWebNovelReadabilityGuide,
  parseNarrativeBeatPlan,
  validateNarrativeBeatPlan,
  buildFallbackNarrativeBeatPlan,
  formatNarrativeBeatPlan,
  getBeatGateIssues,
  translateIssuesToRevisionActions,
  polishMechanicalDraftLocally,
  polishGeneratedDraftLocally,
  classifyDashFunction,
  normalizeDashUsage,
  buildPerceptionScope,
  formatPerceptionScopeForPrompt,
  findPerceptionIssues,
  repairPerceptionLocally,
  applyPerceptionGate,
  findRhythmIssues,
  repairRhythmLocally,
  applyRhythmGate,
  formatRhythmGateGuide,
  buildSceneRhythmContract,
  formatSceneRhythmContract,
  buildSceneContinuityLedger,
  formatSceneContinuityLedger,
  buildRepetitionLedger,
  formatRepetitionLedger,
  buildInteriorMonologueContract,
  formatInteriorMonologueContract,
  findInteriorMonologueIssues,
  repairInteriorMonologueLocally,
  applyInteriorMonologueGate,
  buildSystemMessageContract,
  formatSystemMessageContract,
  repairSystemMessageLocally,
  buildInspirationFidelityContract,
  formatInspirationFidelityContract,
  buildGenrePromiseContract,
  formatGenrePromiseContract,
  buildOpeningHookContract,
  formatOpeningHookContract,
  buildChapterFunctionContract,
  formatChapterFunctionContract,
  buildWorldExposureBudgetContract,
  formatWorldExposureBudgetContract,
  buildGenreKnowledgeContract,
  formatGenreKnowledgeContract,
  buildDialoguePurposeContract,
  formatDialoguePurposeContract,
  buildDialogueDensityContract,
  formatDialogueDensityContract,
  buildStyleTextureContract,
  formatStyleTextureContract,
  buildTitleCoreSellContract,
  formatTitleCoreSellContract,
  buildEscapeInteractionContract,
  formatEscapeInteractionContract,
  buildDetailSelectionContract,
  formatDetailSelectionContract,
  findEnvironmentScanIssues,
  repairEnvironmentScanLocally,
  applyEnvironmentScanGate,
  buildSentencePatternLibrary,
  buildSyntaxContract,
  formatSyntaxContract,
  buildDetailBudgetContract,
  formatDetailBudgetContract,
  findSyntaxIssues,
  repairSyntaxLocally,
  applySyntaxGate,
  createAiUsageTracker,
  formatAiUsageReport,
  withAiUsageTracking,
  compileChapterForGeneration,
  directHumanWriting,
  routeGenerationMode,
  buildScenePacks,
  formatCompiledPackForDraft,
  buildChapterDirectorContext,
  formatChapterDirectorContext,
  formatCompactDirectorDirective,
  buildInformationBudget,
  buildCharacterKnowledgeLedger,
  buildActionCausalityChain,
  validateChapterRhythmPlan,
  buildFallbackRhythmPlan,
  resolveStoredChapterSummary,
  isUsefulCardSummary,
  ensureAutomationChapterNaturalness,
  buildParagraphBudgetGuide,
  buildPositiveDraftingSkeletonGuide,
  buildHumanWritingModuleGuide,
  buildHumanWritingPatternLibrary,
  buildCharacterVoiceModel,
  buildHumanWritingSystemGuide,
  buildHumanWritingEnginePrompt,
  buildHumanRevisionDirective,
  buildChapterAuditPrompt,
  buildChapterRewritePrompt,
  buildAutomationExpressionRewritePrompt,
  buildAutomationContinuityValidationPrompt,
  buildAutomationLightCheckPrompt,
  buildStyleResolverGuide,
  buildVoiceRosterGuide,
  sanitizeChapterCardForHumanEngine,
  buildPlatformStrategyGuide,
  buildAutomationMemoryGuide,
  buildAutomationLedgerUpdate,
  getAutomationReviewPause,
  auditRewriteValidateAutomationChapter,
  importAiGeneratedChapters,
  isInvalidGeneratedChapter,
  makeSingleChapterFromLooseText,
  makeGeneratedChapter,
  parseAiChapterText,
  normalizeGeneratedChapters,
  normalizePacingRepairChapters,
};

app.post('/api/auth/register', async (req, res) => {
  const username = normalizeText(req.body.username).trim();
  const password = normalizeText(req.body.password);
  const displayName = normalizeText(req.body.displayName).trim() || username;

  if (username.length < 3 || password.length < 6) {
    return res.status(400).json({ message: '账号至少3位，密码至少6位' });
  }

  const db = await readDb();
  if (db.users.some((item) => item.username === username)) {
    return res.status(409).json({ message: '账号已存在' });
  }

  const user = {
    id: crypto.randomUUID(),
    username,
    displayName,
    passwordHash: hashPassword(password),
    createdAt: now(),
  };
  const token = createToken();

  db.users.push(user);
  db.sessions.push({ token, userId: user.id, createdAt: now() });
  await writeDb(db);

  res.status(201).json({ token, user: sanitizeUser(user) });
});

app.post('/api/auth/login', async (req, res) => {
  const username = normalizeText(req.body.username).trim();
  const password = normalizeText(req.body.password);
  const db = await readDb();
  const user = db.users.find((item) => item.username === username);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ message: '账号或密码错误' });
  }

  const token = createToken();
  db.sessions.push({ token, userId: user.id, createdAt: now() });
  await writeDb(db);

  res.json({ token, user: sanitizeUser(user) });
});

if (process.env.NODE_ENV === 'development' || process.env.START_EMBEDDED_SERVER === '1') {
  app.get('/api/auth/dev-session', async (_req, res) => {
    const db = await readDb();
    const session = db.sessions.at(-1);
    const user = session ? db.users.find((item) => item.id === session.userId) : null;
    if (!session || !user) {
      return res.status(404).json({ message: '没有可用的开发会话' });
    }
    res.json({ token: session.token, user: sanitizeUser(user) });
  });
}

app.get('/api/auth/me', auth, async (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

app.get('/api/settings/ai', auth, async (req, res) => {
  const settings = await ensureUserSettings(req.db, req.user.id);
  settings.aiConfig = normalizeAiSettingsPayload(settings.aiConfig || {});
  await writeDb(req.db);
  res.json(settings.aiConfig);
});

app.put('/api/settings/ai', auth, async (req, res) => {
  const settings = await ensureUserSettings(req.db, req.user.id);
  settings.aiConfig = normalizeAiSettingsPayload(req.body || {});
  settings.updatedAt = now();
  await writeDb(req.db);
  res.json(settings.aiConfig);
});

app.post('/api/auth/logout', auth, async (req, res) => {
  req.db.sessions = req.db.sessions.filter((item) => item.token !== req.token);
  await writeDb(req.db);
  res.json({ success: true });
});

app.get('/api/projects', auth, async (req, res) => {
  const projects = req.db.projects.filter((item) => item.ownerId === req.user.id);
  res.json(projects.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)));
});

app.post('/api/projects', auth, async (req, res) => {
  const project = buildProjectPayload(createProjectTemplate(req.body, req.user.id));
  req.db.projects.unshift(project);
  await writeDb(req.db);
  res.status(201).json(project);
});

app.put('/api/projects/:id', auth, async (req, res) => {
  const index = req.db.projects.findIndex((item) => item.id === req.params.id && item.ownerId === req.user.id);
  if (index === -1) {
    return res.status(404).json({ message: '作品不存在' });
  }

  const currentProject = req.db.projects[index];
  const incomingChapters = Array.isArray(req.body?.chapters) ? req.body.chapters : currentProject.chapters;
  const incomingChapterIds = new Set((incomingChapters || []).map((chapter) => chapter.id).filter(Boolean));
  const deletedChapterNumbers = (currentProject.chapters || [])
    .map((chapter, chapterIndex) => (chapter.id && !incomingChapterIds.has(chapter.id) ? chapterIndex + 1 : null))
    .filter(Boolean);
  const incomingAutomation = deletedChapterNumbers.length
    ? cleanAutomationLedgersAfterChapterDelete({ ...(currentProject.automation || {}), ...(req.body.automation || {}) }, deletedChapterNumbers)
    : req.body.automation;
  const nextProject = buildProjectPayload({
    ...currentProject,
    ...req.body,
    ...(incomingAutomation ? { automation: incomingAutomation } : {}),
    ownerId: req.user.id,
    id: currentProject.id,
    createdAt: currentProject.createdAt,
  });
  req.db.projects[index] = nextProject;
  await writeDb(req.db);
  res.json(nextProject);
});

app.delete('/api/projects/:id', auth, async (req, res) => {
  const before = req.db.projects.length;
  req.db.projects = req.db.projects.filter((item) => !(item.id === req.params.id && item.ownerId === req.user.id));
  if (req.db.projects.length === before) {
    return res.status(404).json({ message: '作品不存在' });
  }

  await writeDb(req.db);
  res.json({ success: true });
});

app.post('/api/projects/:id/compliance-check', auth, async (req, res) => {
  const index = req.db.projects.findIndex((item) => item.id === req.params.id && item.ownerId === req.user.id);
  if (index === -1) {
    return res.status(404).json({ message: '作品不存在' });
  }

  const candidate = req.body?.project
    ? buildProjectPayload({
        ...req.db.projects[index],
        ...req.body.project,
        ownerId: req.user.id,
        id: req.db.projects[index].id,
        createdAt: req.db.projects[index].createdAt,
      })
    : req.db.projects[index];

  const report = inspectCompliance(candidate);
  req.db.projects[index] = {
    ...candidate,
    compliance: report,
    updatedAt: now(),
  };
  await writeDb(req.db);
  res.json(report);
});

app.post('/api/ai/generate', auth, async (req, res) => {
  const { systemPrompt, userPrompt, temperature = 0.9 } = req.body;
  const { apiKey, model, baseUrl } = resolveAiModelConfig(req.body, 'writing');
  if (!apiKey) return res.status(400).json({ message: '缺少 DeepSeek API Key' });
  if (!userPrompt) return res.status(400).json({ message: '缺少生成指令' });

  try {
    const text = await callDeepSeek({ apiKey, model, baseUrl, systemPrompt, userPrompt, temperature });
    res.json({ text });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : 'AI 生成失败' });
  }
});

app.post('/api/ai/parse-chapters', auth, async (req, res) => {
  const text = normalizeText(req.body.text);
  const startChapter = Number(req.body.startChapter) || 1;
  const batchCount = Number(req.body.batchCount) || 3;
  const defaultVolumeId = normalizeText(req.body.defaultVolumeId);
  const chapters = parseAiChapterText(text, { startChapter, batchCount, defaultVolumeId });
  if (!chapters.length) {
    return res.status(400).json({ message: 'AI 文本中没有可导入章节' });
  }
  res.json({ chapters });
});

function buildChapterAuditPrompt(project, chapter, chapterNumber) {
  const previousChapter = project.chapters?.[chapterNumber - 2];
  const nextChapter = project.chapters?.[chapterNumber];
  return [
    '请以番茄小说发布前审校编辑身份，对当前章节做章节级巡检。',
    '巡检优先判断“是否像一个真人作者按人物习惯写出来”，不要只做词语禁令清单。',
    '必须覆盖以下四类：',
    '1. AI痕迹弱化：句式重复、模板化转折、机械铺陈、情绪/动作/心理描写套路、段落节奏单一。',
    '2. 平台风险分级：涉政、涉黄、暴力、未成年、极端行为、自伤自杀、赌博毒品、导流、现实敏感事件。按 high/medium/low 标注。',
    '3. 章节级改写建议：给出可直接执行的具体改法，不要只说原则。',
    '4. 番茄风格适配：前三章钩子、爽点密度、段落节奏、标题吸引力、移动端阅读体验。若不是前三章，也评估本章钩子和爽点密度。',
    buildAntiTemplateStyleGuide(),
    buildHumanWritingSystemGuide({ project, automation: project.automation || {}, chapterNumber, previousChapter, scope: '章节巡检' }),
    buildOpeningNarrativeStrategyGuide(project),
    buildNoMetaNarrationGuide(),
    buildNaturalReadingGuard(),
    '特别检查：开头是否为到达新场景模板；对话是否是机械三句转折；是否出现“后背一凉/心头一紧”等情绪套话；系统提示是否完整清晰但没有打断阅读；系统面板前后是否有人物动作或选择承接；段落是否长期只有对话+说明。',
    '输出格式：',
    '【总风险】low/medium/high',
    '【AI痕迹】逐条列出问题和修改建议',
    '【平台风险】按类别列出风险等级和触发原因',
    '【番茄适配评分】钩子/爽点/节奏/标题 各0-10分，并说明扣分原因',
    '【改写建议】列出5-10条具体改写动作',
    '【建议修订指令】给后续重写模型的一段简明指令',
    '',
    `作品名：${project.title}`,
    `题材：${project.genre}`,
    `目标读者：${project.targetAudience}`,
    `故事简介：${project.summary}`,
    `世界观：${project.worldSetting}`,
    `角色概览：${project.characterProfiles}`,
    previousChapter ? `上一章：${previousChapter.title}\n${previousChapter.summary || ''}\n${normalizeText(previousChapter.content).slice(-1200)}` : '',
    `当前章节：第${chapterNumber}章 ${chapter.title}\n摘要：${chapter.summary || ''}\n正文：\n${chapter.content || ''}`,
    nextChapter ? `下一章摘要：${nextChapter.title}\n${nextChapter.summary || ''}` : '',
  ].filter(Boolean).join('\n\n');
}

function buildChapterRewritePrompt(project, chapter, chapterNumber, auditText) {
  return [
    '请根据发布前巡检报告，直接修订当前章节正文。',
    '目标：按真人写作模块重织表达，让人物口吻、错误行动后的修正、现实打断和动作选择自然长出来；弱化AI痕迹只是结果，不是靠硬删词实现。',
    '硬性要求：',
    '1. 只输出修订后的正文，不要输出标题、摘要、说明、Markdown。',
    '2. 不改变主线事件和人物关系，不新增越界设定。',
    '3. 避免敏感风险直白表达，用更安全的剧情表达替代。',
    '4. 保留章节原本的剧情功能，并让语气更自然、有变化。',
    '5. 段落适合手机阅读，长段拆短。',
    '6. 字数尽量接近原文，不要明显缩水。',
    '',
    `作品名：${project.title}`,
    `题材：${project.genre}`,
    buildHumanWritingSystemGuide({ project, automation: project.automation || {}, chapterNumber, scope: '单章人工修订' }),
    `当前章节：第${chapterNumber}章 ${chapter.title}`,
    '巡检报告/改写建议：',
    auditText || '请自行检查AI痕迹、平台风险和番茄风格适配后修订。',
    '原正文：',
    chapter.content || '',
  ].join('\n\n');
}

function buildAutomationExpressionRewritePrompt({ project, automation, chapter, originalChapter, card, nextCard, chapterNumber, auditText }) {
  const previousChapter = project.chapters?.filter((item, idx) => !isBlankStarterChapter(item, idx)).at(-1);
  return [
    '请对当前自动生成章节做发布前表达层修订。',
    '目标：按真人写作模块重织表达，让人物口吻、错误行动后的修正、现实打断、同人认知差和系统反馈自然进入正文；弱化AI痕迹只是结果。',
    '这是表达层编辑，不是剧情重写。',
    '硬性禁止：1. 不得改变本章核心事件；2. 不得删除伏笔；3. 不得改变人物动机和关系；4. 不得改变章节卡规定的剧情功能；5. 不得提前写下一章正文；6. 不得改变章末衔接方向；7. 不得新增脱离蓝图的大事件。',
    '允许修改：句式重复、模板化转折、机械铺陈、风险表达、长段落、AI味总结句、钩子表达力度、移动端阅读节奏。',
    buildAntiTemplateStyleGuide(),
    buildHumanWritingSystemGuide({ project, automation, card, chapterNumber, previousChapter, scope: '自动发布前修订' }),
    buildOpeningNarrativeStrategyGuide(project),
    buildNoMetaNarrationGuide(),
    buildNaturalReadingGuard(),
    buildSyntaxBudgetGuard(),
    buildSentenceRhythmGuard(),
    buildActionChainNarrationGuard(),
    buildHumanTextureGuide(project),
    buildDialogueSceneGuide({ project, card }),
    buildNarrativeTextureBudgetGuide(card),
    '只输出修订后的正文，不要输出标题、摘要、解释或 Markdown。',
    '',
    `作品名：${project.title}`,
    `题材：${project.genre}`,
    `当前章节：第${chapterNumber}章 ${chapter.title}`,
    '长篇蓝图：',
    automation.masterPlan || '',
    '本章章节卡：',
    card ? formatChapterCard(card, chapterNumber) : '',
    nextCard ? '下一章章节卡（只用于保持章末钩子方向，禁止提前写）：' : '',
    nextCard ? formatChapterCard(nextCard, chapterNumber + 1) : '',
    previousChapter ? '上一章衔接：' : '',
    previousChapter ? `${previousChapter.title}\n摘要：${previousChapter.summary || ''}\n正文末段：${normalizeText(previousChapter.content).slice(-1200)}` : '',
    '巡检报告：',
    auditText || '请自行弱化AI痕迹、降低平台风险并保持剧情连贯。',
    buildContinuityMemoryText(project, automation),
    buildVoiceDriftGuard(project),
    buildReaderExpectationGuide(),
    buildUnevenHumanStyleGuide(),
    '原章节摘要：',
    originalChapter.summary || chapter.summary || '',
    '原正文：',
    originalChapter.content || chapter.content || '',
  ].filter(Boolean).join('\n\n');
}

function buildAutomationContinuityValidationPrompt({ project, automation, originalChapter, revisedChapter, card, nextCard, chapterNumber, auditText }) {
  const previousChapter = project.chapters?.filter((item, idx) => !isBlankStarterChapter(item, idx)).at(-1);
  return [
    '请校验自动修订后的章节是否可保存。',
    '只输出 PASS 或 FAIL，并附简短原因。',
    '必须判定 FAIL 的情况：',
    '1. 修订版改变本章核心事件；2. 删除关键伏笔或章末钩子；3. 改变人物动机/关系；4. 脱离章节卡；5. 无法自然承接上一章或下一章方向；6. 仍存在 high 级平台风险；7. 明显缩水导致章节功能不足；8. 正文出现“第X章/上一章/前文提到/章节卡/蓝图”等元叙事泄露。',
    buildNoMetaNarrationGuide(),
    buildNaturalReadingGuard(),
    '若只是句式、段落、表达、风险措辞被优化，应判定 PASS。',
    '',
    `章节号：第${chapterNumber}章`,
    '本章章节卡：',
    card ? formatChapterCard(card, chapterNumber) : '',
    buildContinuityMemoryText(project, automation),
    buildVoiceDriftGuard(project),
    nextCard ? '下一章方向：' : '',
    nextCard ? formatChapterCard(nextCard, chapterNumber + 1) : '',
    previousChapter ? '上一章末段：' : '',
    previousChapter ? normalizeText(previousChapter.content).slice(-1000) : '',
    '巡检报告：',
    auditText || '',
    '原正文：',
    originalChapter.content || '',
    '修订正文：',
    revisedChapter.content || '',
  ].filter(Boolean).join('\n\n');
}

function validationFailed(text = '') {
  return /^\s*FAIL\b/i.test(normalizeText(text)) || /仍存在\s*high|high\s*级|总风险[：:]\s*high/i.test(normalizeText(text));
}

async function auditRewriteValidateAutomationChapter({ apiKey, model, baseUrl, project, automation, chapter, card, nextCard, chapterNumber, defaultVolumeId, signal }) {
  const originalChapter = withChapterNumber({ ...chapter, volumeId: chapter.volumeId || card?.volumeId || defaultVolumeId }, chapterNumber);
  const auditText = await callDeepSeek({
    apiKey,
    model,
    baseUrl,
    temperature: 0.32,
    maxTokens: 4096,
    userPrompt: buildChapterAuditPrompt(project, originalChapter, chapterNumber),
    signal,
  });
  const revisedText = await callDeepSeek({
    apiKey,
    model,
    baseUrl,
    temperature: 0.62,
    maxTokens: 8192,
    userPrompt: buildAutomationExpressionRewritePrompt({ project, automation, chapter: originalChapter, originalChapter, card, nextCard, chapterNumber, auditText }),
    signal,
  });
  const revisedChapter = withChapterNumber(createChapter({
    ...originalChapter,
    content: sanitizeImportedContent(revisedText) || originalChapter.content,
    updatedAt: now(),
  }), chapterNumber);
  const validationText = await callDeepSeek({
    apiKey,
    model,
    baseUrl,
    temperature: 0.2,
    maxTokens: 2048,
    userPrompt: buildAutomationContinuityValidationPrompt({ project, automation, originalChapter, revisedChapter, card, nextCard, chapterNumber, auditText }),
    signal,
  });

  let finalChapter = revisedChapter;
  let expansionText = '';
  if (countWords(finalChapter.content) < getMinimumChapterWords(automation)) {
    const expanded = await ensureChapterMinimumWords({
      apiKey,
      model,
      baseUrl,
      project,
      automation,
      chapter: finalChapter,
      card,
      chapterNumber,
      defaultVolumeId,
      signal,
      contextText: [
        '补字仅允许在同场景内展开，不可改动剧情骨架。',
        '可补充上一章遗留动作、角色反应、系统提示承接、伏笔回响、对话留白。',
      ].join('\n'),
    });
    finalChapter = expanded.chapter || finalChapter;
    expansionText = expanded.text || '';
  }

  const finalNaturalness = await ensureAutomationChapterNaturalness({
    apiKey,
    model,
    baseUrl,
    project,
    automation,
    chapter: finalChapter,
    card,
    chapterNumber,
    signal,
  });
  finalChapter = finalNaturalness.chapter || finalChapter;
  const needsNaturalnessPause = ['medium', 'heavy'].includes(finalNaturalness.severity);

  if (countWords(finalChapter.content) < getMinimumChapterWords(automation)) {
    throw new Error(`修订后章节仍低于最低字数要求（${countWords(finalChapter.content)}字 < ${getMinimumChapterWords(automation)}字），已暂停保存，请重新生成或手动修订`);
  }

  return {
    chapter: finalChapter,
    text: [`第${chapterNumber}章发布前巡检：`, auditText, `第${chapterNumber}章连贯性校验：`, validationText, expansionText ? `第${chapterNumber}章字数补足：` : '', expansionText, finalNaturalness.text ? `第${chapterNumber}章最终自然感终检：` : '', finalNaturalness.text].filter(Boolean).join('\n\n'),
    shouldPause: validationFailed(validationText) || needsNaturalnessPause,
  };
}

function buildAutomationLightCheckPrompt({ project, automation, chapter, card, nextCard, chapterNumber }) {
  const previousChapter = project.chapters?.filter((item, idx) => !isBlankStarterChapter(item, idx)).at(-1);
  const openingLedger = buildRecentOpeningPatternLedger(project, 8);
  return [
    '请对自动生成章节做轻量发布前校验，只输出一个结论和简短原因。',
    '优先校验真人写作模块是否生效：人物是否有口吻和欲望，是否出现错误行动后的修正/现实打断/同人认知差，系统提示是否改变动作而非讲设定。',
    '结论只能是：PASS、REWRITE、PAUSE。',
    'PASS：AI痕迹不明显，平台风险低，能承接上下文，可直接保存。',
    'REWRITE：有明显AI味、模板化、段落节奏差、番茄钩子/爽点弱，或中等平台风险，但表达层修订可解决。',
    'PAUSE：存在high平台风险、明显断连、改变章节卡核心事件、涉政涉黄未成年极端行为等需要人工确认。',
    '以下情况通常判定 REWRITE：开头是到达新场景模板；对话是机械命令-抗议-驳回；使用“后背一凉/心头一紧/心跳漏了一拍/瞳孔一缩/事情越来越复杂/暗流涌动”等套话；系统提示频繁使用完整面板、内容冗长、字段重复、和人物动作割裂；全章长期只有“他说/她说+说明”。允许关键节点出现3-5行、信息完整清晰的【新任务】/【奖励】/【提示】面板。',
    '额外检查：若首句/首段是精确时间打卡、或者时间+地点+主角动作的固定模具，通常直接 REWRITE；若最近开头模式里 time 过多或连续重复同一 openingType，也应 REWRITE。',
    '若正文中出现“第X章开始/上一章里/前几章提到/前文说过/本章/章节卡/蓝图”等面向作者或章节规划的元叙事表达，必须判定 REWRITE。',
    '若正文出现 Markdown 星号/加粗符号（如 **【提示】**）、###、列表符号，必须判定 REWRITE。',
    '若正文出现连续三行短句排比或否定排除式伪冲击句，必须判定 REWRITE。',
    '若章末是“真正的危险才刚刚开始/事情远没有结束/他不知道的是”等模板钩子，必须判定 REWRITE。',
    buildNoMetaNarrationGuide(),
    buildHumanWritingSystemGuide({ project, automation, card, chapterNumber, previousChapter, scope: '轻量发布前校验' }),
    buildNaturalReadingGuard(),
    openingLedger,
    '不要吹毛求疵。只有影响发布安全或阅读质量时才 REWRITE/PAUSE。',
    '',
    `章节号：第${chapterNumber}章`,
    `作品名：${project.title}`,
    `题材：${project.genre}`,
    '本章章节卡：',
    card ? formatChapterCard(card, chapterNumber) : '',
    nextCard ? '下一章方向：' : '',
    nextCard ? formatChapterCard(nextCard, chapterNumber + 1) : '',
    previousChapter ? '上一章末段：' : '',
    previousChapter ? normalizeText(previousChapter.content).slice(-900) : '',
    '当前章节：',
    serializeGeneratedChapters([chapter], chapterNumber),
  ].filter(Boolean).join('\n\n');
}

function parseLightCheckDecision(text = '') {
  const normalized = normalizeText(text).trim();
  if (/^PAUSE\b/i.test(normalized) || /\bPAUSE\b/i.test(normalized)) return 'PAUSE';
  if (/^REWRITE\b/i.test(normalized) || /\bREWRITE\b/i.test(normalized)) return 'REWRITE';
  return 'PASS';
}

async function lightCheckAutomationChapter({ apiKey, model, baseUrl, project, automation, chapter, card, nextCard, chapterNumber, signal }) {
  const text = await callDeepSeek({
    apiKey,
    model,
    baseUrl,
    temperature: 0.2,
    maxTokens: 1024,
    userPrompt: buildAutomationLightCheckPrompt({ project, automation, chapter, card, nextCard, chapterNumber }),
    signal,
  });
  return { text, decision: parseLightCheckDecision(text) };
}

app.post('/api/projects/:id/chapters/:chapterId/audit', auth, async (req, res) => {
  const index = req.db.projects.findIndex((item) => item.id === req.params.id && item.ownerId === req.user.id);
  if (index === -1) return res.status(404).json({ message: '作品不存在' });
  const { apiKey, model, baseUrl } = resolveAiModelConfig(req.body, 'planning');
  if (!apiKey) return res.status(400).json({ message: '缺少 DeepSeek API Key' });
  const project = req.body?.project ? buildProjectPayload({ ...req.db.projects[index], ...req.body.project, ownerId: req.user.id, id: req.db.projects[index].id, createdAt: req.db.projects[index].createdAt }) : req.db.projects[index];
  const chapterIndex = project.chapters.findIndex((chapter) => chapter.id === req.params.chapterId);
  if (chapterIndex === -1) return res.status(404).json({ message: '章节不存在' });
  const chapter = project.chapters[chapterIndex];
  if (!chapter.content) return res.status(400).json({ message: '当前章节正文为空' });

  try {
    const report = await callDeepSeek({ apiKey, model, baseUrl, temperature: 0.35, maxTokens: 4096, userPrompt: buildChapterAuditPrompt(project, chapter, chapterIndex + 1) });
    res.json({ report });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : '章节巡检失败' });
  }
});

app.post('/api/projects/:id/chapters/:chapterId/audit-rewrite', auth, async (req, res) => {
  const index = req.db.projects.findIndex((item) => item.id === req.params.id && item.ownerId === req.user.id);
  if (index === -1) return res.status(404).json({ message: '作品不存在' });
  const auditConfig = resolveAiModelConfig(req.body, 'planning');
  const writeConfig = resolveAiModelConfig(req.body, 'writing');
  const { apiKey, model, baseUrl } = writeConfig;
  if (!apiKey) return res.status(400).json({ message: '缺少 DeepSeek API Key' });
  const project = req.body?.project ? buildProjectPayload({ ...req.db.projects[index], ...req.body.project, ownerId: req.user.id, id: req.db.projects[index].id, createdAt: req.db.projects[index].createdAt }) : req.db.projects[index];
  const chapterIndex = project.chapters.findIndex((chapter) => chapter.id === req.params.chapterId);
  if (chapterIndex === -1) return res.status(404).json({ message: '章节不存在' });
  const chapter = project.chapters[chapterIndex];
  if (!chapter.content) return res.status(400).json({ message: '当前章节正文为空' });

  try {
    const auditText = normalizeText(req.body.auditText) || await callDeepSeek({ ...auditConfig, temperature: 0.35, maxTokens: 4096, userPrompt: buildChapterAuditPrompt(project, chapter, chapterIndex + 1) });
    const revised = await callDeepSeek({ apiKey, model, baseUrl, temperature: 0.68, maxTokens: 8192, userPrompt: buildChapterRewritePrompt(project, chapter, chapterIndex + 1, auditText) });
    const nextChapters = [...project.chapters];
    const nextChapter = createChapter({
      ...chapter,
      content: sanitizeImportedContent(revised),
      updatedAt: now(),
    });
    nextChapters[chapterIndex] = nextChapter;
    const nextProject = buildProjectPayload({ ...project, chapters: nextChapters, updatedAt: now() });
    req.db.projects[index] = nextProject;
    await writeDb(req.db);
    res.json({ project: nextProject, chapter: nextChapter, report: auditText, revised: nextChapter.content });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : '章节修订失败' });
  }
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const message = typeof data === 'object' && data?.message ? data.message : text;
    throw new Error(message || `请求失败：${response.status}`);
  }
  return data;
}

async function getComfyCheckpoint(baseUrl) {
  const info = await fetchJson(`${baseUrl}/object_info/CheckpointLoaderSimple`);
  const checkpoints = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
  const checkpoint = checkpoints[0];
  if (!checkpoint) throw new Error('ComfyUI 没有可用模型，请先把 checkpoint 放到 ComfyUI/models/checkpoints');
  return checkpoint;
}

function buildAssistantImageWorkflow({ checkpoint, prompt, seed }) {
  return {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    2: { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: prompt } },
    3: { class_type: 'CLIPTextEncode', inputs: { clip: ['1', 1], text: 'busy background, scenery, portrait crop, close-up, face only, upper body only, cut off feet, cut off legs, low quality, blurry, bad anatomy, extra fingers, watermark, logo, text, nsfw, child, underage' } },
    4: { class_type: 'EmptyLatentImage', inputs: { width: 768, height: 1344, batch_size: 1 } },
    5: {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
        seed,
        steps: 32,
        cfg: 8,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
      },
    },
    6: { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'ai_assistant' } },
  };
}

async function getComfyGeneratedImage(baseUrl, promptId) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const history = await fetchJson(`${baseUrl}/history/${promptId}`);
    const result = history?.[promptId];
    const images = result?.outputs ? Object.values(result.outputs).flatMap((output) => output.images || []) : [];
    if (images.length) return images[0];
    await sleep(1200);
  }
  throw new Error('ComfyUI 生成超时，请检查本地绘图队列');
}

app.post('/api/ai/comfyui/assistant-image', auth, async (req, res) => {
  const baseUrl = normalizeText(req.body.baseUrl || 'http://127.0.0.1:8188').replace(/\/$/, '');
  const userPrompt = normalizeText(req.body.prompt).trim();
  if (!userPrompt) return res.status(400).json({ message: '请输入形象提示词' });

  try {
    const checkpoint = await getComfyCheckpoint(baseUrl);
    const prompt = [
      'masterpiece, best quality, anime style adult AI editor assistant character, single character, full body visual novel sprite, entire body visible from head to shoes, centered, plain clean background, no scenery, polished illustration, safe for work',
      userPrompt,
    ].join(', ');
    const seed = Math.floor(Math.random() * 1000000000000);
    const clientId = crypto.randomUUID();
    const workflow = buildAssistantImageWorkflow({ checkpoint, prompt, seed });
    const queued = await fetchJson(`${baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    });
    const image = await getComfyGeneratedImage(baseUrl, queued.prompt_id);
    const params = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '', type: image.type || 'output' });
    const imageResponse = await fetch(`${baseUrl}/view?${params.toString()}`);
    if (!imageResponse.ok) throw new Error('读取 ComfyUI 输出图片失败');
    const contentType = imageResponse.headers.get('content-type') || 'image/png';
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    res.json({ image: `data:${contentType};base64,${buffer.toString('base64')}`, checkpoint, seed });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : '生成 AI 助手形象失败' });
  }
});

app.post('/api/ai/first-three-chapters', auth, async (req, res) => {
  const { apiKey, model, baseUrl } = resolveAiModelConfig(req.body, 'writing');
  const { project, temperature = 0.95 } = req.body;
  if (!apiKey) return res.status(400).json({ message: '缺少 DeepSeek API Key' });
  if (!project?.title) return res.status(400).json({ message: '缺少作品信息' });

  const prompt = [
    '请为一部适合番茄小说连载的中文网络小说，直接生成前三章内容。',
    '必须按真人写作模块起稿：先给人物处境和口吻，再让设定从动作、错误行动后的修正、对话和现实打断中露出。不要先写设定说明。',
    '输出格式必须严格如下：',
    '### 第1章 标题',
    '摘要：...',
    '正文：...',
    '### 第2章 标题',
    '摘要：...',
    '正文：...',
    '### 第3章 标题',
    '摘要：...',
    '正文：...',
    '',
    `作品名：${project.title}`,
    `类型：${project.genre}`,
    `目标读者：${project.targetAudience}`,
    `一句话 premise：${project.premise}`,
    `文风要求：${project.styleGuide}`,
    `故事简介：${project.summary}`,
    `世界观：${project.worldSetting}`,
    `角色设定：${project.characterProfiles}`,
    `主线大纲：${project.outline}`,
    buildHumanWritingSystemGuide({ project, automation: project.automation || {}, scope: '前三章试写' }),
    '要求：前三章要完成开篇钩子、主角诉求建立、首轮冲突和下一步悬念。每章正文 2000-3200 字。每一章只能写该章内容，不要把下一章正文混进来。不要输出解释。',
  ].join('\n');

  try {
    const text = await callDeepSeek({
      apiKey,
      model,
      baseUrl,
      temperature,
      userPrompt: prompt,
    });
    res.json({ text });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : '生成失败' });
  }
});

app.post('/api/projects/:id/automation/plan', auth, async (req, res) => {
  await writeAiDebugLog('automation.plan.received', { projectId: req.params.id, contentLength: req.headers['content-length'] || '' });
  const index = req.db.projects.findIndex((item) => item.id === req.params.id && item.ownerId === req.user.id);
  if (index === -1) {
    await writeAiDebugLog('automation.plan.project_not_found', { projectId: req.params.id, userId: req.user.id });
    return res.status(404).json({ message: '作品不存在' });
  }

  const { apiKey, model, baseUrl } = resolveAiModelConfig(req.body, 'planning');
  const { minimumWords = 1500000, targetChapters = 600, inspiration } = req.body;
  const project = req.db.projects[index];
  const automation = project.automation || {};
  const effectiveInspiration = normalizeText(inspiration || project.automation?.inspiration || project.premise || project.summary);
  const toneProtocol = buildToneProtocolGuide({ ...project, premise: [project.premise, effectiveInspiration].filter(Boolean).join('\n') }, automation);

  await writeAiDebugLog('automation.plan.config_resolved', {
    projectTitle: project.title,
    model,
    baseUrl,
    hasApiKey: Boolean(apiKey),
    inspirationLen: effectiveInspiration.length,
    minimumWords,
    targetChapters,
  });

  if (!apiKey) {
    await writeAiDebugLog('automation.plan.missing_api_key', { model, baseUrl });
    return res.status(400).json({ message: '缺少 DeepSeek API Key' });
  }
  if (!effectiveInspiration) {
    await writeAiDebugLog('automation.plan.missing_inspiration', { projectTitle: project.title });
    return res.status(400).json({ message: '请先提供灵感或核心想法' });
  }

  const prompt = [
    '请基于以下灵感，为中文网络小说规划一部长篇连载方案。',
    '规划时要以真人连载写法为核心：卷结构服务人物欲望、处境反差、错误行动后的修正、关系错位和阶段性爽点，不要只堆设定名词。',
    '要求：最终体量必须不低于最低总字数要求，但具体最终总字数、卷数、章节规模由你根据题材、角色复杂度、升级节奏、商业化连载需求自行判断。',
    '输出必须包含：题材定位、核心卖点、主线/副线、主角成长线、反派梯度、至少8卷分卷规划、每卷高潮与卷末钩子、长线伏笔、商业化连载建议，并明确建议的最终总字数与建议总章节数。',
    '最后必须追加【主要人物卡】部分，并且严格按下面格式重复输出至少4个主要人物：',
    '### 人物：姓名',
    '身份：...',
    '目标：...',
    '秘密：...',
    '性格：...',
    '弧光：...',
    `最低总字数要求：${minimumWords}`,
    `参考章节规模：${targetChapters}`,
    `作品名：${project.title}`,
    `题材：${project.genre}`,
    `目标读者：${project.targetAudience}`,
    `文风要求：${project.styleGuide}`,
    `灵感：${effectiveInspiration}`,
    buildToneProtocolGuide({ ...project, premise: [project.premise, effectiveInspiration].filter(Boolean).join('\n') }, automation),
    buildHumanWritingSystemGuide({ project, automation, scope: '长篇蓝图规划' }),
    buildPlatformStrategyGuide(project, { ...automation, platformStrategy: automation.platformStrategy }),
    '蓝图还必须初始化：长线伏笔类型、读者期待类型、主要爽点类型、角色关系主轴、金手指/系统规则阶段、章节功能轮换建议。',
    '请直接输出详细策划，不要解释。',
  ].join('\n');

  const personaPrompt = buildAuthorPersonaPrompt({
    project,
    inspiration: effectiveInspiration,
    minimumWords,
    targetChapters,
  });
  const signal = getRequestAbortSignal(req);

  try {
    await writeAiDebugLog('automation.plan.ai_start', { model, baseUrl, personaTimeoutMs: 180000, planTimeoutMs: 300000 });
    const [personaText, text] = await Promise.all([
      callDeepSeek({ apiKey, model, baseUrl, temperature: 0.85, userPrompt: personaPrompt, signal, timeoutMs: 180000 }),
      callDeepSeek({ apiKey, model, baseUrl, temperature: 0.95, userPrompt: `${prompt}\n\n重要：蓝图全部完成后，最后必须单独输出一行：【蓝图完】。`, maxTokens: 8192, signal, timeoutMs: 300000 }),
    ]);
    const completedPlan = await completeMasterPlanIfNeeded({ apiKey, model, baseUrl, project, automation, prompt, currentText: text, signal });
    await writeAiDebugLog('automation.plan.ai_done', { model, personaLen: personaText.length, planLen: completedPlan.text.length, continuationCount: completedPlan.continuations.length, complete: completedPlan.complete });
    if (!completedPlan.complete) {
      throw new Error('长篇蓝图疑似被截断，自动续写补全后仍未完整收尾。已阻止覆盖旧蓝图，请重试或降低参考章节数。');
    }
    const characters = parseCharacterCards(completedPlan.text);
    const nextProject = buildProjectPayload({
      ...project,
      characters: characters.length ? characters : project.characters,
      automation: {
        ...resetAutomationRuntimeState(project.automation, '已生成新蓝图，并重置自动写作运行态台账', { preserveChapterCards: false }),
        inspiration: effectiveInspiration,
        minimumWords,
        targetWords: minimumWords,
        targetChapters,
        averageChapterWords: Math.ceil(minimumWords / targetChapters),
        authorPersona: normalizeAuthorPersonaText(personaText),
        toneProtocol,
        masterPlan: completedPlan.text,
        status: 'planned',
      },
    });
    req.db.projects[index] = nextProject;
    await writeDb(req.db);
    await writeAiDebugLog('automation.plan.saved', { projectTitle: nextProject.title, masterPlanLen: completedPlan.text.length, authorPersonaLen: normalizeAuthorPersonaText(personaText).length, complete: completedPlan.complete });
    res.json({ text: `${personaText}\n\n${completedPlan.text}`, project: nextProject, authorPersona: normalizeAuthorPersonaText(personaText), complete: completedPlan.complete });
  } catch (error) {
    await writeAiDebugLog('automation.plan.failed', { model, baseUrl, error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: error instanceof Error ? error.message : '长篇规划失败' });
  }
});

app.post('/api/projects/:id/automation/author-persona', auth, async (req, res) => {
  const index = req.db.projects.findIndex((item) => item.id === req.params.id && item.ownerId === req.user.id);
  if (index === -1) return res.status(404).json({ message: '作品不存在' });

  const { apiKey, model, baseUrl } = resolveAiModelConfig(req.body, 'planning');
  const { force = false } = req.body;
  const project = req.db.projects[index];
  const automation = project.automation || {};
  if (!apiKey) return res.status(400).json({ message: '缺少 DeepSeek API Key' });

  try {
    let authorPersona = normalizeAuthorPersonaText(automation.authorPersona);
    let text = authorPersona;

    if (!authorPersona || force) {
      const source = automation.masterPlan || project.premise || project.summary || project.outline;
      if (!source) return res.status(400).json({ message: '缺少蓝图或灵感，无法生成作者人设' });
      const personaPrompt = buildAuthorPersonaPrompt({
        project,
        inspiration: automation.inspiration || project.premise || project.summary || project.outline,
        minimumWords: automation.minimumWords || 1500000,
        targetChapters: automation.targetChapters || 600,
      });
      text = await callDeepSeek({ apiKey, model, baseUrl, temperature: 0.82, userPrompt: personaPrompt });
      authorPersona = normalizeAuthorPersonaText(text);
    }

    const nextProject = buildProjectPayload({
      ...project,
      automation: {
        ...automation,
        authorPersona,
        progressNotes: authorPersona ? '已生成/更新作者人设卡' : automation.progressNotes,
      },
    });
    req.db.projects[index] = nextProject;
    await writeDb(req.db);
    res.json({ text, authorPersona, project: nextProject });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : '作者人设生成失败' });
  }
});

app.put('/api/projects/:id/automation/author-persona', auth, async (req, res) => {
  const index = req.db.projects.findIndex((item) => item.id === req.params.id && item.ownerId === req.user.id);
  if (index === -1) return res.status(404).json({ message: '作品不存在' });

  const project = req.db.projects[index];
  const automation = project.automation || {};
  const authorPersona = normalizeAuthorPersonaText(req.body.authorPersona);
  const nextProject = buildProjectPayload({
    ...project,
    automation: {
      ...automation,
      authorPersona,
      progressNotes: authorPersona ? '已手动更新作者人设卡' : automation.progressNotes,
    },
  });
  req.db.projects[index] = nextProject;
  await writeDb(req.db);
  res.json({ authorPersona, project: nextProject });
});

app.get('/api/projects/:id/automation/author-persona', auth, async (req, res) => {
  const index = req.db.projects.findIndex((item) => item.id === req.params.id && item.ownerId === req.user.id);
  if (index === -1) return res.status(404).json({ message: '作品不存在' });

  const project = req.db.projects[index];
  const automation = project.automation || {};
  res.json({
    authorPersona: normalizeAuthorPersonaText(automation.authorPersona),
    source: extractAuthorPersonaFromBlueprint(automation.masterPlan),
    project,
  });
});

app.post('/api/projects/:id/automation/generate-current', auth, async (req, res) => {
  const index = req.db.projects.findIndex((item) => item.id === req.params.id && item.ownerId === req.user.id);
  if (index === -1) return res.status(404).json({ message: '作品不存在' });

  const { apiKey, model, baseUrl } = resolveAiModelConfig(req.body, 'writing');
  const { chapterId, chapterNumber, lightweight = false } = req.body;
  const project = req.db.projects[index];
  const automation = project.automation || {};
  if (!apiKey) return res.status(400).json({ message: '缺少 DeepSeek API Key' });
  if (!automation.masterPlan) return res.status(400).json({ message: '请先生成长篇规划' });

  const chapters = project.chapters || [];
  const selectedIndex = chapterId
    ? chapters.findIndex((chapter) => chapter.id === chapterId)
    : Math.max(0, (Number(chapterNumber) || 1) - 1);
  if (selectedIndex < 0 || selectedIndex >= chapters.length) return res.status(400).json({ message: '请先选择要生成的章节' });

  const targetChapterNumber = selectedIndex + 1;
  try {
    assertEnoughChapterCards({ automation, startChapter: targetChapterNumber, batchCount: 1 });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : '章节卡不足，请先自动排章节卡' });
  }

  const card = (automation.chapterCards || [])[targetChapterNumber - 1];
  const nextCard = (automation.chapterCards || [])[targetChapterNumber] || null;
  const signal = getRequestAbortSignal(req);

  try {
    const result = await (lightweight ? generateLightweightAutomationChapter : generateAutomationChapter)({
      apiKey,
      model,
      baseUrl,
      project,
      automation,
      card,
      nextCard,
      chapterNumber: targetChapterNumber,
      defaultVolumeId: project.volumes[0]?.id || '',
      signal,
    });

    if (!result.chapter || isInvalidGeneratedChapter(result.chapter)) {
      throw new Error(`AI 未返回可写入第${targetChapterNumber}章正文`);
    }

    const existingChapter = chapters[selectedIndex] || {};
    const generatedChapter = createChapter(withChapterNumber({
      ...existingChapter,
      ...result.chapter,
      id: existingChapter.id || result.chapter.id,
      volumeId: result.chapter.volumeId || card.volumeId || existingChapter.volumeId || project.volumes[0]?.id || '',
      content: stripMarkdownNoise(result.chapter.content || ''),
      summary: resolveStoredChapterSummary(card, result.chapter.content || ''),
      status: existingChapter.status || result.chapter.status || 'draft',
      updatedAt: now(),
    }, targetChapterNumber));

    const nextChapters = chapters.map((chapter, chapterIndex) => (chapterIndex === selectedIndex ? generatedChapter : chapter));
    const ledgerUpdate = buildAutomationLedgerUpdate({ chapters: [generatedChapter], cards: [card], startChapter: targetChapterNumber, previousAutomation: automation, projectCharacters: project.characters || [] });
    const previousContentWords = countWords(existingChapter.content || '');
    const contentWordDelta = countWords(generatedChapter.content || '') - previousContentWords;
    const automationBeforeToneDrift = {
      ...automation,
      ...ledgerUpdate,
      continuityMemory: buildContinuityMemoryUpdate([generatedChapter], targetChapterNumber, automation.continuityMemory),
      totalGeneratedWords: Math.max(0, (automation.totalGeneratedWords || 0) + contentWordDelta),
      status: automation.status === 'idle' ? 'paused' : automation.status,
      progressNotes: result.warnings?.length
        ? `已用${lightweight ? '轻量生成模式' : '单章质量模式'}生成第 ${targetChapterNumber} 章，但有警告：${result.warnings.join('；')}`
        : `已用${lightweight ? '轻量生成模式' : '单章质量模式'}生成第 ${targetChapterNumber} 章`,
    };
    const projectBeforeToneDrift = { ...project, chapters: nextChapters, automation: automationBeforeToneDrift };
    const nextProject = buildProjectPayload({
      ...project,
      chapters: nextChapters,
      automation: maybeUpdateToneDriftAfterWrite({ project: projectBeforeToneDrift, automation: automationBeforeToneDrift, chapterCount: targetChapterNumber }),
    });

    req.db.projects[index] = nextProject;
    await writeDb(req.db);
    res.json({ text: [result.text, ...(result.warnings || [])].filter(Boolean).join('\n\n'), chapter: generatedChapter, chapters: [generatedChapter], project: nextProject, warnings: result.warnings || [], lightweight: Boolean(lightweight) });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : '当前章节生成失败' });
  }
});

app.post('/api/projects/:id/automation/generate-current/stream', auth, async (req, res) => {
  const send = startNdjsonStream(res);
  try {
    const index = req.db.projects.findIndex((item) => item.id === req.params.id && item.ownerId === req.user.id);
    if (index === -1) throw new Error('作品不存在');
    const { apiKey, model, baseUrl } = resolveAiModelConfig(req.body, 'writing');
    const { chapterId, chapterNumber } = req.body;
    const project = req.db.projects[index];
    const automation = project.automation || {};
    if (!apiKey) throw new Error('缺少 DeepSeek API Key');
    if (!automation.masterPlan) throw new Error('请先生成长篇规划');
    const chapters = project.chapters || [];
    const selectedIndex = chapterId ? chapters.findIndex((chapter) => chapter.id === chapterId) : Math.max(0, (Number(chapterNumber) || 1) - 1);
    if (selectedIndex < 0 || selectedIndex >= chapters.length) throw new Error('请先选择要生成的章节');
    const targetChapterNumber = selectedIndex + 1;
    assertEnoughChapterCards({ automation, startChapter: targetChapterNumber, batchCount: 1 });
    const card = (automation.chapterCards || [])[targetChapterNumber - 1];
    const nextCard = (automation.chapterCards || [])[targetChapterNumber] || null;
    const signal = getRequestAbortSignal(req);
    const previousChapter = project.chapters?.filter((chapter, idx) => idx < selectedIndex && !isBlankStarterChapter(chapter, idx)).at(-1) || null;
    send({ type: 'phase', text: `正在流式生成第${targetChapterNumber}章草稿` });
    const prompt = promptComposer.buildGenerationPrompt([
      '轻量生成模式：你是中文网文作者，只写当前这一章，不解释，不输出写作计划。',
      '本模式保留蓝图、作者人设、章节卡和最近上下文，但跳过场景包、叙事拍和多层重控制；目标是更自然、顺畅、像真人连载正文。',
      '输出格式必须严格为：### 第X章 标题\n摘要：...\n正文：...',
      '叙事人称：第三人称有限视角，主视角跟随当前主角；不要用第一人称做正文叙述。',
      '正文长度：1500-4000中文字符；宁可少写，也不要扩成长章。',
      '系统提示格式：系统弹窗必须独立成行，整行用【】包住；不要写成【搜】附近可回收物资这种半框格式，应写成【搜：附近可回收物资为运输车残骸】。',
      buildNoMetaNarrationGuide(),
      buildHumanWebNovelReadabilityGuide(),
      buildHumanWritingEnginePrompt({ project, automation, card, nextCard, chapterNumber: targetChapterNumber, previousChapter, scope: '轻量正文流式生成' }),
      buildPacingGuardText({ currentCount: targetChapterNumber - 1, batchCount: 1, targetChapters: automation.targetChapters || 600 }),
      buildPlatformStrategyGuide(project, automation),
      buildProjectStyleGuide(project, automation),
      '轻量动作与对话规则：',
      '1. 正常说话优先：求救、指挥、安抚、拒绝、解释、确认信息和安排撤离时，先把正常对话和行动信息说清。',
      '2. 动作因果清楚：看见问题、判断代价、安排动作要连上；关键受阻和转折处补足必要过渡、身体反馈或环境后果。',
      '3. 角色口吻服务关系：人物按当下处境、关系、目的、信息差和身体状态说话；短句可以有，但不要像清单报告。',
      '3b. 必要成分补足：短句可以急促，但只要补出主语、对象、动作方向、退回路径、下一步安排能让句子更自然，就优先补出来。连续“不A、不B、别C”优先改成“先做什么 + 哪些动作暂停/谁负责看住风险”。',
      '3c. 对话流畅度：台词少主语、谓语、对象、方向、条件或承接词会让读者回推时，优先补足。不要长期写成“快。”“行。”“继续走。”“别回门。”“可以。”这类孤立口令或状态播报；可改成“你们先往前走”“行，我来开维护气闸”“沿这条手动轨道继续推”“先别回那扇门”“可以，我只开维护项”。',
      '3d. 连接词贴上下文：所以、但是、那、行、嗯、好、现在、先、再、就这类词只在回应上一句话、现场动作或明确选择时使用；上下文不是因果、转折或让步时，改成动作、称呼、具体对象或直接回答。单独的“可以、行、明白、稳了、不稳、够、不够、有、没有”通常要接用途、条件或动作。',
      '4. 短句有资格：短句、断行和留白只用于强情绪、危险瞬间、对话打断、重大发现或章末钩子；普通观察、否定判断、位置判断、动作安排和信息确认写成自然句。',
      '5. 否定对照极低频：“不是A，也不是B”“没有A。也没有B。”“不A。不B。”这类句式默认几十章才偶尔保留一次；普通段落改成动作、停顿、物件反馈或下一步选择。',
      '6. 吐槽低于人设和行动：调侃、梗和夸张比喻只有在遮掩害怕、暴露误判、缓冲关系或推动行动时才短促出现；高压救人、撤离、伤情恶化和敌人逼近时优先写行动。',
      '7. 类型经验有边界：游戏、原作、系统或套路经验只用于初始误判、快速判断或被现实纠正；遇到真实伤痛、救人和关系冲突时优先写现场证据和人物选择。',
      '8. 系统提示只改变动作：系统提示必须独立成行、整行【】包住，只给目标、限制、风险、异常、奖励或代价，不能替作者讲世界观。',
      '9. 环境服务行动：每个环境段只保留会改变路线、遮挡视线、暴露敌人或提供可利用物的1-2个细节。',
      '10. 基调优先自然落地：轻松日常优先写生活小目标、小麻烦、小收获和关系软化；轻喜反差优先写错位误会、奇怪但有效的处理和反差收益；高压求生也要让主角用判断或代价换回一点主动权。不要把所有作品都写成连续追杀、受伤和更大危险靠近。',
      '11. 首稿不要自我检查式写作：不要为了满足规则而逐条展示技巧，先让人物在麻烦里自然行动；详细检测交给后处理。',
      '作品信息：',
      `作品名：${project.title}`,
      `题材：${project.genre}`,
      `读者：${project.targetAudience}`,
      `核心设定：${project.premise}`,
      '作者人设：',
      automation.authorPersona || '',
      buildToneProtocolGuide(project, automation),
      buildToneDriftGuide(automation),
      '长篇蓝图：',
      automation.masterPlan || '',
      buildAutomationMemoryGuide(project, automation),
      buildContinuityMemoryText(project, automation),
      '当前章节卡：',
      formatChapterCard(card, targetChapterNumber),
      nextCard ? '下一章只作为章末钩子方向参考，禁止提前写下一章正文：' : '',
      nextCard ? formatChapterCard(nextCard, targetChapterNumber + 1) : '',
      previousChapter ? '上一章承接：' : '',
      previousChapter ? `${previousChapter.title}\n摘要：${previousChapter.summary || ''}\n正文末段：${normalizeText(previousChapter.content).slice(-1200)}` : '',
      '最近章节摘要：',
      ...project.chapters.filter((chapter, idx) => idx < selectedIndex && !isBlankStarterChapter(chapter, idx)).slice(-5).map((chapter) => `${chapter.title}\n${chapter.summary}`),
      '最近正文衔接上下文：',
      buildRecentContext(project.chapters.filter((chapter, idx) => idx < selectedIndex && !isBlankStarterChapter(chapter, idx)), 3),
      '只写本章章节卡允许的事件；不要提前写后续章节正文；章末停在当前章节卡钩子或下一步选择上。',
    ]);
    const text = await callDeepSeekStream({ apiKey, model, baseUrl, temperature: 0.68, userPrompt: prompt, maxTokens: 8192, signal, timeoutMs: 300000, onToken: (token) => send({ type: 'token', text: token }) });
    send({ type: 'phase', text: '正在解析和保存最终稿' });
    if (signal?.aborted) throw new Error('AI 请求已中断');
    const resolved = await resolveGeneratedChapters({ apiKey, model, baseUrl, project, automation, sections: extractGeneratedSections(text).slice(0, 1), plannedCards: [card], startChapter: targetChapterNumber, batchCount: 1, defaultVolumeId: project.volumes[0]?.id || '', sourceText: text, reason: `流式生成第${targetChapterNumber}章时章节边界不完整`, signal });
    if (signal?.aborted) throw new Error('AI 请求已中断');
    const parsed = resolved.chapters[0];
    if (!parsed || isInvalidGeneratedChapter(parsed)) throw new Error(`AI 未返回可写入第${targetChapterNumber}章正文`);
    const existingChapter = chapters[selectedIndex] || {};
    const generatedChapter = createChapter(withChapterNumber({ ...existingChapter, ...parsed, id: existingChapter.id || parsed.id, volumeId: parsed.volumeId || card.volumeId || existingChapter.volumeId || project.volumes[0]?.id || '', content: repairDenseRhetoricLocally(repairUrgentCommandBurstsLocally(repairStandaloneTacticalLabelsLocally(repairSystemMessageLocally(stripMarkdownNoise(parsed.content || ''))))), summary: resolveStoredChapterSummary(card, parsed.content || ''), status: existingChapter.status || parsed.status || 'draft', updatedAt: now() }, targetChapterNumber));
    const nextChapters = chapters.map((chapter, chapterIndex) => (chapterIndex === selectedIndex ? generatedChapter : chapter));
    const ledgerUpdate = buildAutomationLedgerUpdate({ chapters: [generatedChapter], cards: [card], startChapter: targetChapterNumber, previousAutomation: automation, projectCharacters: project.characters || [] });
    const contentWordDelta = countWords(generatedChapter.content || '') - countWords(existingChapter.content || '');
    const automationBeforeToneDrift = { ...automation, ...ledgerUpdate, continuityMemory: buildContinuityMemoryUpdate([generatedChapter], targetChapterNumber, automation.continuityMemory), totalGeneratedWords: Math.max(0, (automation.totalGeneratedWords || 0) + contentWordDelta), status: automation.status === 'idle' ? 'paused' : automation.status, progressNotes: `已用轻量流式生成第 ${targetChapterNumber} 章` };
    const projectBeforeToneDrift = { ...project, chapters: nextChapters, automation: automationBeforeToneDrift };
    const nextProject = buildProjectPayload({ ...project, chapters: nextChapters, automation: maybeUpdateToneDriftAfterWrite({ project: projectBeforeToneDrift, automation: automationBeforeToneDrift, chapterCount: targetChapterNumber }) });
    if (signal?.aborted) throw new Error('AI 请求已中断');
    req.db.projects[index] = nextProject;
    await writeDb(req.db);
    send({ type: 'saved', text: `第${targetChapterNumber}章已保存`, chapter: generatedChapter, chapters: [generatedChapter], project: nextProject, output: [resolved.text, resolved.pacingReport].filter(Boolean).join('\n\n') });
    send({ type: 'done' });
    res.end();
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : '当前章节流式生成失败' });
    res.end();
  }
});

app.post('/api/projects/:id/automation/generate-batch', auth, async (req, res) => {
  const index = req.db.projects.findIndex((item) => item.id === req.params.id && item.ownerId === req.user.id);
  if (index === -1) {
    return res.status(404).json({ message: '作品不存在' });
  }

  const { apiKey, model, baseUrl } = resolveAiModelConfig(req.body, 'writing');
  const { batchCount = 3, lightweight = false } = req.body;
  const project = req.db.projects[index];
  const automation = project.automation || {};
  if (!apiKey) return res.status(400).json({ message: '缺少 DeepSeek API Key' });
  if (!automation.masterPlan) return res.status(400).json({ message: '请先生成长篇规划' });

  const writeState = getAutomationWriteState(project);
  const nextChapterStart = writeState.nextChapterStart;
  try {
    assertEnoughChapterCards({ automation, startChapter: nextChapterStart, batchCount });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : '章节卡不足，请先自动排章节卡' });
  }
  const plannedCards = (automation.chapterCards || []).slice(writeState.writtenCount, writeState.writtenCount + batchCount);
  const signal = getRequestAbortSignal(req);

  try {
    const firstVolumeId = project.volumes[0]?.id || '';
    const resolved = await generateAndPersistQualityChapters({
      req,
      projectIndex: index,
      apiKey,
      model,
      baseUrl,
      project,
      automation,
      plannedCards,
      startChapter: nextChapterStart,
      batchCount,
      defaultVolumeId: firstVolumeId,
      lightweight,
      signal,
    });
    res.json({ text: [resolved.text, ...(resolved.warnings || [])].filter(Boolean).join('\n\n'), chapters: resolved.chapters, project: resolved.project, replacedBlankStarter: resolved.replacedBlankStarter, warnings: resolved.warnings || [], pausedForReview: resolved.pausedForReview });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : '批量生成失败' });
  }
});

app.post('/api/projects/:id/automation/generate-next/stream', auth, async (req, res) => {
  const send = startNdjsonStream(res);
  try {
    const index = req.db.projects.findIndex((item) => item.id === req.params.id && item.ownerId === req.user.id);
    if (index === -1) throw new Error('作品不存在');
    const { apiKey, model, baseUrl } = resolveAiModelConfig(req.body, 'writing');
    const { targetChapter = null, targetProgress = null, stopAtCheckpoint = false, lightweight = false } = req.body;
    const project = req.db.projects[index];
    const automation = project.automation || {};
    if (!apiKey) throw new Error('缺少 DeepSeek API Key');
    if (!automation.masterPlan) throw new Error('请先生成长篇规划');
    if (automation.waitingForReview) throw new Error('已到检查点或审校暂停，请先确认是否继续');

    const writeState = getAutomationWriteState(project);
    const chapterNumber = writeState.nextChapterStart;
    if (targetChapter && Number(targetChapter) !== chapterNumber) throw new Error(`章节进度已变化，当前下一章是第${chapterNumber}章`);
    if (targetProgress && chapterNumber > Number(targetProgress)) throw new Error('已达到目标进度');
    assertEnoughChapterCards({ automation, startChapter: chapterNumber, batchCount: 1 });

    const card = (automation.chapterCards || [])[chapterNumber - 1];
    const nextCard = (automation.chapterCards || [])[chapterNumber] || null;
    const signal = getRequestAbortSignal(req);
    send({ type: 'phase', text: `正在流式生成第${chapterNumber}章草稿`, chapterNumber });

    const result = await (lightweight ? generateLightweightAutomationChapter : generateAutomationChapter)({
      apiKey,
      model,
      baseUrl,
      project,
      automation,
      card,
      nextCard,
      chapterNumber,
      defaultVolumeId: project.volumes[0]?.id || '',
      signal,
      onPhase: (text) => send({ type: 'phase', text, chapterNumber }),
      onToken: (token) => send({ type: 'token', text: token, chapterNumber }),
    });
    send({ type: 'phase', text: `正在解析和保存第${chapterNumber}章`, chapterNumber });
    if (signal?.aborted) throw new Error('AI 请求已中断');
    if (!result.chapter || isInvalidGeneratedChapter(result.chapter)) throw new Error(`AI 未返回可写入第${chapterNumber}章正文`);
    const generatedChapter = withChapterNumber({
      ...result.chapter,
      volumeId: result.chapter.volumeId || card.volumeId || project.volumes[0]?.id || '',
      content: stripMarkdownNoise(result.chapter.content || ''),
      summary: resolveStoredChapterSummary(card, result.chapter.content || ''),
    }, chapterNumber);

    const generatedChapters = [generatedChapter];
    const chaptersForProject = writeState.replaceBlankStarter ? generatedChapters : [...project.chapters, ...generatedChapters];
    const batchWords = countWords(generatedChapter.content || '');
    const ledgerUpdate = buildAutomationLedgerUpdate({ chapters: generatedChapters, cards: [card], startChapter: chapterNumber, previousAutomation: automation, projectCharacters: project.characters || [] });
    const nextCount = writeState.writtenCount + 1;
    const reachCheckpoint = stopAtCheckpoint && nextCount > 0 && nextCount % checkpointIntervals.standard === 0;
    const checkpointKind = reachCheckpoint ? getCheckpointKind(nextCount) : '';
    const checkpointLabel = reachCheckpoint ? getCheckpointLabel(checkpointKind) : '';
    const reachedTarget = targetProgress ? nextCount >= Number(targetProgress) : true;
    const warnings = result.warnings || [];
    const shouldPauseForReview = getAutomationReviewPause(warnings);
    const automationBeforeToneDrift = {
      ...automation,
      ...ledgerUpdate,
      continuityMemory: buildContinuityMemoryUpdate(generatedChapters, chapterNumber, automation.continuityMemory),
      totalGeneratedWords: (automation.totalGeneratedWords || 0) + batchWords,
      targetProgress: targetProgress || automation.targetProgress,
      waitingForReview: reachCheckpoint || shouldPauseForReview,
      status: shouldPauseForReview ? 'review' : reachCheckpoint ? 'checkpoint' : reachedTarget ? 'paused' : 'writing',
      progressNotes: warnings.length
        ? `已流式写到第 ${nextCount} 章，但有警告：${warnings.join('；')}`
          : reachCheckpoint
            ? `已流式写到第 ${nextCount} 章，触发 ${checkpointLabel}`
            : `已流式写到第 ${nextCount} 章`,
    };
    const projectBeforeToneDrift = { ...project, chapters: chaptersForProject, automation: automationBeforeToneDrift };
    const nextProject = buildProjectPayload({
      ...project,
      chapters: chaptersForProject,
      automation: maybeUpdateToneDriftAfterWrite({ project: projectBeforeToneDrift, automation: automationBeforeToneDrift, chapterCount: nextCount }),
    });
    if (signal?.aborted) throw new Error('AI 请求已中断');
    req.db.projects[index] = nextProject;
    await writeDb(req.db);
    let savedProject = nextProject;
    let checkpointReport = null;
    if (reachCheckpoint && !shouldPauseForReview) {
      send({ type: 'phase', text: `正在生成${checkpointLabel}报告`, chapterNumber });
      const planningConfig = resolveAiModelConfig(req.body, 'planning');
      checkpointReport = await generateCheckpointReportForProject({ db: req.db, projectIndex: index, project: nextProject, apiKey: planningConfig.apiKey || apiKey, model: planningConfig.model || model, baseUrl: planningConfig.baseUrl || baseUrl, requestedKind: checkpointKind });
      savedProject = checkpointReport.project;
    }
    send({ type: 'saved', text: `第${chapterNumber}章已保存`, chapter: generatedChapter, chapters: generatedChapters, project: savedProject, output: result.text || generatedChapter.content || '', warnings, reachedCheckpoint: reachCheckpoint, checkpointKind, checkpointLabel, checkpointReport: checkpointReport?.text || '', pausedForReview: shouldPauseForReview, replacedBlankStarter: writeState.replaceBlankStarter });
    send({ type: 'done' });
    res.end();
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : '自动写作流式生成失败' });
    res.end();
  }
});

app.post('/api/projects/:id/automation/auto-volumes', auth, async (req, res) => {
  const index = req.db.projects.findIndex((item) => item.id === req.params.id && item.ownerId === req.user.id);
  if (index === -1) return res.status(404).json({ message: '作品不存在' });

  const { apiKey, model, baseUrl } = resolveAiModelConfig(req.body, 'planning');
  const project = req.db.projects[index];
  const automation = project.automation || {};
  if (!apiKey) return res.status(400).json({ message: '缺少 DeepSeek API Key' });
  if (!automation.masterPlan) return res.status(400).json({ message: '请先生成长篇规划' });

  const prompt = [
    '请根据以下长篇蓝图，自动拆分分卷。',
    '分卷要服务真人连载阅读体验：每卷都要有人物处境变化、关系错位、错误行动后的修正、阶段性爽点和具体卷末动作钩子，不能只是设定阶段名。',
    '输出格式必须逐卷严格重复：### 第X卷 卷名',
    '定位：...',
    '目标：...',
    '卷末钩子：...',
    '必须把全书按蓝图完整拆成所有卷，不允许只输出一卷；每一卷都要覆盖蓝图中的对应阶段，不允许把多个阶段塞进同一卷。',
    '卷名必须和蓝图中的分卷阶段对应，定位要明确这卷处于什么剧情阶段，目标要明确本卷要完成什么，卷末钩子要指向下一卷而不是终局。',
    `最低总字数：${automation.minimumWords || 1500000}`,
    `参考总章节：${automation.targetChapters || 600}`,
    buildHumanWritingSystemGuide({ project, automation, scope: '自动分卷' }),
    buildToneProtocolGuide(project, automation),
    buildAuthorPersonaGuide(automation.authorPersona),
    automation.masterPlan,
  ].join('\n');

  try {
    const text = await callDeepSeek({ apiKey, model, baseUrl, temperature: 0.9, userPrompt: prompt });
    const sections = extractVolumeSections(text);
    const volumes = sections.map((section, i) => parseVolumeSection(section, i));
    if (volumes.length < 2) {
      throw new Error('自动分卷结果过少，已阻止写入。请检查蓝图是否足够明确，或重新生成分卷。');
    }
    const nextProject = buildProjectPayload({
      ...project,
      volumes,
      automation: {
        ...automation,
        volumeBlueprint: text,
        progressNotes: `已自动拆分 ${volumes.length} 卷`,
      },
    });
    req.db.projects[index] = nextProject;
    await writeDb(req.db);
    res.json({ text, project: nextProject });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : '自动分卷失败' });
  }
});

app.post('/api/projects/:id/automation/chapter-cards', auth, async (req, res) => {
  const index = req.db.projects.findIndex((item) => item.id === req.params.id && item.ownerId === req.user.id);
  if (index === -1) return res.status(404).json({ message: '作品不存在' });

  const { apiKey, model, baseUrl } = resolveAiModelConfig(req.body, 'chapter-card');
  const { targetChapter, lightweight = false } = req.body;
  const project = req.db.projects[index];
  const automation = project.automation || {};
  if (!apiKey) return res.status(400).json({ message: '缺少 DeepSeek API Key' });
  if (!automation.masterPlan) return res.status(400).json({ message: '请先生成长篇规划' });

  const existingCards = automation.chapterCards || [];
  const nextCardStart = existingCards.length + 1;
  const targetCardChapter = Math.max(1, Number(targetChapter) || Number(automation.targetChapters) || 600);
  if (targetCardChapter < nextCardStart) {
    return res.status(400).json({ message: `章节卡已排到第 ${existingCards.length} 章，目标章节必须大于当前章节卡数量` });
  }
  const expectedNewCardCount = targetCardChapter - existingCards.length;
  const allowedVolumeNames = project.volumes.map((volume) => volume.title).join('、');
  const signal = getRequestAbortSignal(req);
  const openingPlan = [];
  const previousOpeningTypes = existingCards.map((card) => normalizeText(card.openingType).trim()).filter(Boolean);
  for (let idx = 0; idx < expectedNewCardCount; idx += 1) {
    const order = nextCardStart + idx;
    const narrativeMode = normalizeNarrativeMode('', order);
    const openingType = getOpeningTypeByContext({
      project,
      automation,
      order,
      narrativeMode,
      previousTypes: [...previousOpeningTypes, ...openingPlan.map((item) => item.openingType)],
    });
    openingPlan.push({
      order,
      openingType,
      openingLabel: openingTypeLabels[openingType] || openingType,
      narrativeMode,
      narrativePurpose: getNarrativePurposeByMode(narrativeMode),
      openingBan: getOpeningBanByType(openingType),
    });
  }
  const buildChapterCardPrompt = (attemptCount = expectedNewCardCount) => {
    const attemptTargetChapter = nextCardStart + Math.max(1, attemptCount) - 1;
    return [
    '请根据以下长篇蓝图和分卷信息，自动续排章节卡。',
    '章节卡只安排剧情事件，必须给真人写作模块留下发挥空间：写清人物困境、错误行动、现实打断、信息差、结果和具体钩子，不要写正文写法。',
    '如果已有章节卡，只能从已有章节卡之后继续排，不能重写、覆盖或重复已有章节卡。',
    `本次目标续排第${nextCardStart}章到第${attemptTargetChapter}章，共${attemptCount}张章节卡；尽量写满，若受长度限制也必须至少返回1张完整章节卡。`,
    '输出格式必须逐章严格重复：### 第X章 标题\n卷：...\n蓝图阶段：...\n本章目标：...\n核心事件：...\n出场人物：...\n关键物件/线索：...\n本章结果：...\n进度锁：...\n本章只允许：...\n本章禁止：...\n读者预期：...\n上一章遗留动作：...\n伏笔规划：...\n本章爽点：...\n平台适配：...\n系统规则：...\n压力等级：...\n主角主动选择：...\n主角拿回的主动权：...\n本章小收获：...\n章末钩子类型：...\n摘要：...\n关键钩子：...',
    '卷名必须从给定分卷列表中逐字选择，不允许自造卷名；摘要必须不能为空，但摘要只写剧情轨道，不写成正文复述。优先用“目标/事件/结果/限制/钩子”的短轨道句，不要使用“魏杰一度想...却...两人还没争出结果...本章结果是...结尾...”这类正文式因果复述。',
    '每张章节卡必须是慢节奏卡：只写当前章的小目标，不允许把后续几十章、几百章后的核心冲突提前放进摘要或钩子。',
    '“承接上一章”只能写在“上一章遗留动作”里，摘要、关键钩子、读者预期、本章只允许、本章禁止都必须写出具体事件，不能只写空泛承接句。',
    `第${nextCardStart}章是本次续排的第一张卡，必须写出清晰的新场景、新冲突和本章结果，不能只复述上一章。`,
    '进度锁必须写清“本章只能推进到什么程度”；本章禁止必须列出禁止提前触碰的后期事件、反派层级或秘密。',
    '章节卡禁止输出写法字段：不要写“开头方式/开头锚点/禁止开头/叙事手法/叙事目的/章节功能/对话密度/叙述质感/人味锚点/正文禁区/段落节奏”。这些由真人写作模块负责。',
    buildReaderExpectationGuide(),
    buildChapterCardControlGuide(),
    buildHumanWritingSystemGuide({ project, automation, scope: '自动排章节卡' }),
    buildToneChapterCardGuide(project, automation),
    buildToneDriftGuide(automation),
    buildPlatformStrategyGuide(project, automation),
    buildAutomationMemoryGuide(project, automation),
    '章节卡连续性要求：每张卡必须说明它要承接上一章哪个动作、选择、伤势、隐瞒、系统提示或未解释线索；不能只写孤立剧情点。',
    '伏笔账本要求：每张卡必须标明“新埋伏笔 / 推进伏笔 / 回收伏笔 / 暂不回收”之一，并写清伏笔对象。',
    '爽点要求：每张卡必须写“本章爽点”，可选信息爽、关系爽、系统奖励、行动兑现、反差梗、原作遗憾推进；调查章也必须有线索奖励感。爽点只写剧情兑现和读者获得感，不写正文口吻要求。',
    '章节卡只写剧情轨道，不规定正文口吻。可提示本章适合保留的角色压力、关系变化或系统规则，但不要要求每章固定出现吐槽、系统短讯、同人梗、史诗句或作者人设展示。',
    '章节卡去解释化：本章只允许、摘要、读者预期和钩子都要避免写成完整正文段落；不要替正文解释人物为什么这么判断，只标清当前章的目标、阻碍、错误行动、现实反馈、结果和禁止越界内容。',
    '支线寿命要求：同一地点、物件、谜团或异常最多连续占用5章；超过5章必须在本批收束、转场或回到卷级目标，不能继续滚出新谜团。',
    '系统规则要求：涉及系统/金手指时必须写清已知规则、限制或本章仅允许的反馈，禁止临时新增外挂能力。',
    '角色规划：章节卡只写角色在剧情中的信息差、隐瞒、冲突或结果，不要规定台词写法。',
    `参考总章节数：${automation.targetChapters || 600}`,
    `已有章节卡数量：${existingCards.length}`,
    `本次必须从第${nextCardStart}章开始续排，到第${attemptTargetChapter}章结束`,
    `允许使用的卷名：${allowedVolumeNames || '第一卷'}`,
    '长篇蓝图：',
    automation.masterPlan,
    buildAuthorPersonaGuide(automation.authorPersona),
    '真人写作模块将另行决定本批开头与叙事手法，章节卡不要输出这些字段。',
    getLatestCheckpointReport(automation) ? '最新阶段检查报告：' : '',
    getLatestCheckpointReport(automation) || '',
    '分卷信息：',
    project.volumes.map((volume) => `${volume.title}\n定位：${volume.positioning}\n目标：${volume.goal}\n钩子：${volume.endingHook}`).join('\n\n'),
    '最近已有章节卡：',
    existingCards.slice(-5).map((card) => `${card.order}. ${card.title}\n卷：${card.volumeName}\n读者预期：${card.readerExpectation || ''}\n上一章遗留动作：${card.openAction || ''}\n伏笔规划：${card.foreshadowing || ''}\n本章爽点：${card.commercialBeat || ''}\n平台适配：${card.platformNotes || ''}\n系统规则：${card.systemRule || ''}\n压力等级：${card.pressureLevel || ''}\n主角主动选择：${card.protagonistChoice || ''}\n主角拿回的主动权：${card.agencyRecovery || ''}\n本章小收获：${card.chapterReward || ''}\n章末钩子类型：${card.hookType || ''}\n摘要：${card.summary}\n钩子：${card.hook}`).join('\n\n'),
    ].join('\n');
  };

  try {
    const deepseekConfig = resolveAiModelConfig({ ...req.body, modelRouting: 'mixed' }, 'planning');
    const attempts = [
      { label: 'gpt55-3', count: expectedNewCardCount, config: { apiKey, model, baseUrl }, note: '' },
      { label: 'gpt55-1', count: 1, config: { apiKey, model, baseUrl }, note: 'GPT-5.5 章节卡请求超时或返回格式不可解析，已降级为1章一批。' },
      { label: 'deepseek-3', count: expectedNewCardCount, config: deepseekConfig, note: 'GPT-5.5 章节卡连续超时或格式不可解析，已临时切换 DeepSeek 生成本批章节卡；下一轮会自动回到 GPT-5.5。' },
    ];
    let text = '';
    let sections = [];
    let usedAttempt = attempts[0];
    let lastError = null;
    for (const attempt of attempts) {
      try {
        if (!attempt.config?.apiKey) throw new Error(attempt.label === 'deepseek-3' ? 'DeepSeek 配置缺少 API Key，无法执行章节卡 524 降级' : '缺少章节卡模型 API Key');
        text = await callDeepSeek({ ...attempt.config, temperature: 0.9, userPrompt: buildChapterCardPrompt(attempt.count), signal });
        sections = extractGeneratedSections(text).slice(0, attempt.count);
        if (!sections.length) throw new Error('AI 未返回可解析的章节卡，请重试。');
        usedAttempt = attempt;
        break;
      } catch (error) {
        lastError = error;
        if (!isRecoverableChapterCardError(error)) throw error;
      }
    }
    if (!sections.length) throw lastError || new Error('AI 未返回可解析的章节卡，请重试。');
    const newChapterCards = sections.map((section, idx) => {
      const order = nextCardStart + idx;
      const plannedOpening = openingPlan[idx] || {};
      return parseGeneratedChapterCardSection({ section, order, plannedOpening, project });
    });
    const chapterCards = [...existingCards, ...newChapterCards].map((card, idx) => ({
      ...card,
      order: idx + 1,
      title: `第${idx + 1}章 ${stripChapterNumber(card.title) || '未命名章节'}`,
    }));
    const nextProject = buildProjectPayload({
      ...project,
      automation: {
        ...automation,
        chapterCards,
        progressNotes: usedAttempt.note || (newChapterCards.length < expectedNewCardCount
          ? `AI 本次返回 ${newChapterCards.length}/${expectedNewCardCount} 张章节卡，已先写入，下一轮会继续从第 ${chapterCards.length + 1} 章补排`
          : `已续排 ${newChapterCards.length} 个章节卡，当前共 ${chapterCards.length} 个章节卡，已排到第 ${targetCardChapter} 章`),
      },
    });
    req.db.projects[index] = nextProject;
    await writeDb(req.db);
    res.json({ text, project: nextProject, targetChapter: targetCardChapter, generatedCount: newChapterCards.length, partial: newChapterCards.length < expectedNewCardCount, fallback: usedAttempt.label });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : '章节卡生成失败' });
  }
});

app.post('/api/projects/:id/automation/chapter-cards/stream', auth, async (req, res) => {
  const send = startNdjsonStream(res);
  try {
    const index = req.db.projects.findIndex((item) => item.id === req.params.id && item.ownerId === req.user.id);
    if (index === -1) throw new Error('作品不存在');
    const { apiKey, model, baseUrl } = resolveAiModelConfig(req.body, 'chapter-card');
    const { targetChapter } = req.body;
    const project = req.db.projects[index];
    const automation = project.automation || {};
    if (!apiKey) throw new Error('缺少 DeepSeek API Key');
    if (!automation.masterPlan) throw new Error('请先生成长篇规划');
    const existingCards = automation.chapterCards || [];
    const nextCardStart = existingCards.length + 1;
    const targetCardChapter = Math.max(1, Number(targetChapter) || Number(automation.targetChapters) || 600);
    if (targetCardChapter < nextCardStart) throw new Error(`章节卡已排到第 ${existingCards.length} 章，目标章节必须大于当前章节卡数量`);
    const expectedNewCardCount = targetCardChapter - existingCards.length;
    const allowedVolumeNames = project.volumes.map((volume) => volume.title).join('、');
    const signal = getRequestAbortSignal(req);
    const openingPlan = [];
    const previousOpeningTypes = existingCards.map((card) => normalizeText(card.openingType).trim()).filter(Boolean);
    for (let idx = 0; idx < expectedNewCardCount; idx += 1) {
      const order = nextCardStart + idx;
      const narrativeMode = normalizeNarrativeMode('', order);
      const openingType = getOpeningTypeByContext({ project, automation, order, narrativeMode, previousTypes: [...previousOpeningTypes, ...openingPlan.map((item) => item.openingType)] });
      openingPlan.push({ order, openingType, openingLabel: openingTypeLabels[openingType] || openingType, narrativeMode, narrativePurpose: getNarrativePurposeByMode(narrativeMode), openingBan: getOpeningBanByType(openingType) });
    }
    const buildChapterCardPrompt = (attemptCount = expectedNewCardCount) => {
      const attemptTargetChapter = nextCardStart + Math.max(1, attemptCount) - 1;
      return [
        '请根据以下长篇蓝图和分卷信息，自动续排章节卡。',
        '章节卡只安排剧情事件，必须给真人写作模块留下发挥空间：写清人物困境、错误行动、现实打断、信息差、结果和具体钩子，不要写正文写法。',
        '如果已有章节卡，只能从已有章节卡之后继续排，不能重写、覆盖或重复已有章节卡。',
        `本次目标续排第${nextCardStart}章到第${attemptTargetChapter}章，共${attemptCount}张章节卡；尽量写满，若受长度限制也必须至少返回1张完整章节卡。`,
        '输出格式必须逐章严格重复：### 第X章 标题\n卷：...\n蓝图阶段：...\n本章目标：...\n核心事件：...\n出场人物：...\n关键物件/线索：...\n本章结果：...\n进度锁：...\n本章只允许：...\n本章禁止：...\n读者预期：...\n上一章遗留动作：...\n伏笔规划：...\n本章爽点：...\n平台适配：...\n系统规则：...\n压力等级：...\n主角主动选择：...\n主角拿回的主动权：...\n本章小收获：...\n章末钩子类型：...\n摘要：...\n关键钩子：...',
        '卷名必须从给定分卷列表中逐字选择，不允许自造卷名；摘要必须不能为空，但摘要只写剧情轨道，不写成正文复述。优先用“目标/事件/结果/限制/钩子”的短轨道句，不要使用“魏杰一度想...却...两人还没争出结果...本章结果是...结尾...”这类正文式因果复述。',
        '每张章节卡必须是慢节奏卡：只写当前章的小目标，不允许把后续几十章、几百章后的核心冲突提前放进摘要或钩子。',
        `第${nextCardStart}章是本次续排的第一张卡，必须写出清晰的新场景、新冲突和本章结果，不能只复述上一章。`,
        '章节卡禁止输出写法字段：不要写“开头方式/开头锚点/禁止开头/叙事手法/叙事目的/章节功能/对话密度/叙述质感/人味锚点/正文禁区/段落节奏”。这些由真人写作模块负责。',
        buildReaderExpectationGuide(),
        buildChapterCardControlGuide(),
        buildHumanWritingSystemGuide({ project, automation, scope: '自动排章节卡' }),
        buildToneChapterCardGuide(project, automation),
        buildToneDriftGuide(automation),
        buildPlatformStrategyGuide(project, automation),
        buildAutomationMemoryGuide(project, automation),
        '章节卡连续性要求：每张卡必须说明它要承接上一章哪个动作、选择、伤势、隐瞒、系统提示或未解释线索；不能只写孤立剧情点。',
        '伏笔账本要求：每张卡必须标明“新埋伏笔 / 推进伏笔 / 回收伏笔 / 暂不回收”之一，并写清伏笔对象。',
        '爽点要求：每张卡必须写“本章爽点”，可选信息爽、关系爽、系统奖励、行动兑现、反差梗、原作遗憾推进；调查章也必须有线索奖励感。爽点只写剧情兑现和读者获得感，不写正文口吻要求。',
        '章节卡只写剧情轨道，不规定正文口吻。可提示本章适合保留的角色压力、关系变化或系统规则，但不要要求每章固定出现吐槽、系统短讯、同人梗、史诗句或作者人设展示。',
        '章节卡去解释化：本章只允许、摘要、读者预期和钩子都要避免写成完整正文段落；不要替正文解释人物为什么这么判断，只标清当前章的目标、阻碍、错误行动、现实反馈、结果和禁止越界内容。',
        '支线寿命要求：同一地点、物件、谜团或异常最多连续占用5章；超过5章必须在本批收束、转场或回到卷级目标，不能继续滚出新谜团。',
        '系统规则要求：涉及系统/金手指时必须写清已知规则、限制或本章仅允许的反馈，禁止临时新增外挂能力。',
        '角色规划：章节卡只写角色在剧情中的信息差、隐瞒、冲突或结果，不要规定台词写法。',
        `参考总章节数：${automation.targetChapters || 600}`,
        `已有章节卡数量：${existingCards.length}`,
        `本次必须从第${nextCardStart}章开始续排，到第${attemptTargetChapter}章结束`,
        `允许使用的卷名：${allowedVolumeNames || '第一卷'}`,
        '长篇蓝图：',
        automation.masterPlan,
        buildAuthorPersonaGuide(automation.authorPersona),
        getLatestCheckpointReport(automation) ? '最新阶段检查报告：' : '',
        getLatestCheckpointReport(automation) || '',
        '分卷信息：',
        project.volumes.map((volume) => `${volume.title}\n定位：${volume.positioning}\n目标：${volume.goal}\n钩子：${volume.endingHook}`).join('\n\n'),
        '最近已有章节卡：',
        existingCards.slice(-5).map((card) => `${card.order}. ${card.title}\n卷：${card.volumeName}\n读者预期：${card.readerExpectation || ''}\n上一章遗留动作：${card.openAction || ''}\n伏笔规划：${card.foreshadowing || ''}\n本章爽点：${card.commercialBeat || ''}\n平台适配：${card.platformNotes || ''}\n系统规则：${card.systemRule || ''}\n压力等级：${card.pressureLevel || ''}\n主角主动选择：${card.protagonistChoice || ''}\n主角拿回的主动权：${card.agencyRecovery || ''}\n本章小收获：${card.chapterReward || ''}\n章末钩子类型：${card.hookType || ''}\n摘要：${card.summary}\n钩子：${card.hook}`).join('\n\n'),
      ].join('\n');
    };
    send({ type: 'phase', text: `正在流式排第${nextCardStart}-${targetCardChapter}章章节卡` });
    const text = await callDeepSeekStream({ apiKey, model, baseUrl, temperature: 0.9, userPrompt: buildChapterCardPrompt(expectedNewCardCount), signal, timeoutMs: 300000, onToken: (token) => send({ type: 'token', text: token }) });
    send({ type: 'phase', text: '正在解析章节卡并保存' });
    if (signal?.aborted) throw new Error('AI 请求已中断');
    let sections = extractGeneratedSections(text).slice(0, expectedNewCardCount);
    let usedText = text;
    let fallback = 'stream';
    if (!sections.length) {
      send({ type: 'phase', text: '流式返回不可解析，降级为普通1章生成' });
      if (signal?.aborted) throw new Error('AI 请求已中断');
      usedText = await callDeepSeek({ apiKey, model, baseUrl, temperature: 0.9, userPrompt: buildChapterCardPrompt(1), signal });
      sections = extractGeneratedSections(usedText).slice(0, 1);
      fallback = 'stream-to-json-1';
    }
    if (!sections.length) {
      send({ type: 'phase', text: '章节卡仍不可解析，临时切换 DeepSeek 生成本批' });
      if (signal?.aborted) throw new Error('AI 请求已中断');
      const deepseekConfig = resolveAiModelConfig({ ...req.body, modelRouting: 'mixed' }, 'planning');
      if (!deepseekConfig.apiKey) throw new Error('DeepSeek 配置缺少 API Key，无法执行章节卡降级');
      usedText = await callDeepSeek({ ...deepseekConfig, temperature: 0.9, userPrompt: buildChapterCardPrompt(expectedNewCardCount), signal });
      sections = extractGeneratedSections(usedText).slice(0, expectedNewCardCount);
      fallback = 'stream-to-deepseek';
    }
    if (!sections.length) throw new Error('AI 未返回可解析的章节卡，请重试。');
    const newChapterCards = sections.map((section, idx) => parseGeneratedChapterCardSection({ section, order: nextCardStart + idx, plannedOpening: openingPlan[idx] || {}, project }));
    const chapterCards = [...existingCards, ...newChapterCards].map((card, idx) => ({ ...card, order: idx + 1, title: `第${idx + 1}章 ${stripChapterNumber(card.title) || '未命名章节'}` }));
    const nextProject = buildProjectPayload({ ...project, automation: { ...automation, chapterCards, progressNotes: newChapterCards.length < expectedNewCardCount ? `流式章节卡本次返回 ${newChapterCards.length}/${expectedNewCardCount} 张，已先写入。` : `已流式续排 ${newChapterCards.length} 个章节卡，当前共 ${chapterCards.length} 个章节卡` } });
    if (signal?.aborted) throw new Error('AI 请求已中断');
    req.db.projects[index] = nextProject;
    await writeDb(req.db);
    send({ type: 'saved', text: `已保存 ${newChapterCards.length} 张章节卡`, project: nextProject, output: usedText, targetChapter: targetCardChapter, generatedCount: newChapterCards.length, partial: newChapterCards.length < expectedNewCardCount, fallback });
    send({ type: 'done' });
    res.end();
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : '章节卡流式生成失败' });
    res.end();
  }
});

app.post('/api/projects/:id/automation/checkpoint', auth, async (req, res) => {
  const index = req.db.projects.findIndex((item) => item.id === req.params.id && item.ownerId === req.user.id);
  if (index === -1) return res.status(404).json({ message: '作品不存在' });

  const { apiKey, model, baseUrl } = resolveAiModelConfig(req.body, 'planning');
  const project = req.db.projects[index];
  if (!apiKey) return res.status(400).json({ message: '缺少 DeepSeek API Key' });

  try {
    const result = await generateCheckpointReportForProject({ db: req.db, projectIndex: index, project, apiKey, model, baseUrl, requestedKind: req.body.kind });
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : '检查点分析失败' });
  }
});

app.get('/api/projects/:id/automation/checkpoints', auth, async (req, res) => {
  const index = req.db.projects.findIndex((item) => item.id === req.params.id && item.ownerId === req.user.id);
  if (index === -1) return res.status(404).json({ message: '作品不存在' });

  const project = req.db.projects[index];
  const automation = project.automation || {};
  res.json({
    retentionCount: Number(automation.checkpointRetentionCount) || 20,
    currentReport: getLatestCheckpointReport(automation),
    reports: Array.isArray(automation.checkpointReports) ? automation.checkpointReports : [],
  });
});

app.put('/api/projects/:id/automation/checkpoints', auth, async (req, res) => {
  const index = req.db.projects.findIndex((item) => item.id === req.params.id && item.ownerId === req.user.id);
  if (index === -1) return res.status(404).json({ message: '作品不存在' });

  const retentionCount = Math.max(1, Number(req.body.retentionCount) || 20);
  const project = req.db.projects[index];
  const automation = project.automation || {};
  const nextProject = buildProjectPayload({
    ...project,
    automation: {
      ...automation,
      checkpointRetentionCount: retentionCount,
      checkpointReports: trimCheckpointReports(automation, retentionCount),
    },
  });
  req.db.projects[index] = nextProject;
  await writeDb(req.db);
  res.json({ retentionCount, reports: nextProject.automation.checkpointReports || [] });
});

app.delete('/api/projects/:id/automation/checkpoints/current', auth, async (req, res) => {
  const index = req.db.projects.findIndex((item) => item.id === req.params.id && item.ownerId === req.user.id);
  if (index === -1) return res.status(404).json({ message: '作品不存在' });

  const project = req.db.projects[index];
  const automation = project.automation || {};
  const reports = Array.isArray(automation.checkpointReports) ? automation.checkpointReports : [];
  const nextReports = reports.slice(0, -1);
  const nextCurrentReport = nextReports.at(-1)?.report || '';
  const nextProject = buildProjectPayload({
    ...project,
    automation: {
      ...automation,
      checkpointReport: nextCurrentReport,
      checkpointReports: nextReports,
      lastCheckpointAt: nextCurrentReport ? automation.lastCheckpointAt : 0,
      waitingForReview: nextCurrentReport ? automation.waitingForReview : false,
      status: nextCurrentReport ? automation.status : 'paused',
      progressNotes: nextCurrentReport ? '已删除当前检查点报告，已切换到上一条报告' : '已删除当前检查点报告，暂无检查点报告',
    },
  });
  req.db.projects[index] = nextProject;
  await writeDb(req.db);
  res.json({
    project: nextProject,
    currentReport: nextProject.automation.checkpointReport || '',
    reports: nextProject.automation.checkpointReports || [],
    retentionCount: nextProject.automation.checkpointRetentionCount || 20,
  });
});

app.post('/api/projects/:id/automation/resume', auth, async (req, res) => {
  const index = req.db.projects.findIndex((item) => item.id === req.params.id && item.ownerId === req.user.id);
  if (index === -1) return res.status(404).json({ message: '作品不存在' });

  const project = req.db.projects[index];
    const nextProject = buildProjectPayload({
      ...project,
      automation: {
        ...project.automation,
        waitingForReview: false,
      status: 'writing',
        progressNotes: `用户已确认，从第 ${getAutomationWriteState(project).nextChapterStart} 章继续自动写作`,
    },
  });
  req.db.projects[index] = nextProject;
  await writeDb(req.db);
  res.json({ project: nextProject });
});

app.post('/api/projects/:id/automation/reset-runtime', auth, async (req, res) => {
  const index = req.db.projects.findIndex((item) => item.id === req.params.id && item.ownerId === req.user.id);
  if (index === -1) return res.status(404).json({ message: '作品不存在' });

  const project = req.db.projects[index];
  const nextProject = buildProjectPayload({
    ...project,
    automation: resetAutomationRuntimeState(project.automation, '已手动清空自动写作运行态台账，已保留章节卡'),
  });
  req.db.projects[index] = nextProject;
  await writeDb(req.db);
  res.json({ project: nextProject });
});

app.post('/api/projects/:id/automation/rebuild-ledgers', auth, async (req, res) => {
  const index = req.db.projects.findIndex((item) => item.id === req.params.id && item.ownerId === req.user.id);
  if (index === -1) return res.status(404).json({ message: '作品不存在' });

  const project = req.db.projects[index];
  const automation = project.automation || {};
  const chapters = (project.chapters || []).filter((chapter, chapterIndex) => !isBlankStarterChapter(chapter, chapterIndex));
  const cards = automation.chapterCards || [];
  let rebuilt = {
    foreshadowingLedger: [],
    readerExpectations: [],
    commercialBeatLedger: [],
    characterStateMemory: [],
    characterLongTermSummary: [],
    powerSystemLedger: [],
    chapterFunctionCalendar: [],
  };

  chapters.forEach((chapter, indexInWritten) => {
    const chapterNumber = getChapterNumberFromTitle(chapter.title) || indexInWritten + 1;
    rebuilt = buildAutomationLedgerUpdate({
      chapters: [chapter],
      cards: [cards[chapterNumber - 1] || {}],
      startChapter: chapterNumber,
      previousAutomation: rebuilt,
      projectCharacters: project.characters || [],
    });
  });

  const nextProject = buildProjectPayload({
    ...project,
    automation: {
      ...automation,
      ...rebuilt,
      progressNotes: `已根据现有 ${chapters.length} 章正文和章节卡重建自动写作台账`,
    },
  });
  req.db.projects[index] = nextProject;
  await writeDb(req.db);
  res.json({ project: nextProject, rebuilt });
});

app.post('/api/projects/:id/automation/repair-range', auth, async (req, res) => {
  const index = req.db.projects.findIndex((item) => item.id === req.params.id && item.ownerId === req.user.id);
  if (index === -1) return res.status(404).json({ message: '作品不存在' });

  const { apiKey, model, baseUrl } = resolveAiModelConfig(req.body, 'writing');
  const { startChapter, endChapter, repairInstruction = '' } = req.body;
  const project = req.db.projects[index];
  const automation = project.automation || {};
  if (!apiKey) return res.status(400).json({ message: '缺少 DeepSeek API Key' });
  if (!automation.masterPlan) return res.status(400).json({ message: '请先生成长篇规划' });

  const start = Math.max(1, Number(startChapter) || 1);
  const end = Math.min(project.chapters.length, Number(endChapter) || start);
  if (start > end) return res.status(400).json({ message: '修订范围无效' });

  const rangeCount = end - start + 1;
  const plannedCards = (automation.chapterCards || []).slice(start - 1, end);
  const prompt = [
    '请根据一致性检测报告，修订用户指定范围内的小说章节。',
    '核心目标：把章节拉回长篇蓝图和真人写作模块，修复节奏过快、提前进入核心冲突、反派梯度被打乱、脱离蓝图规划、人物口吻被写成说明书等问题。',
    '硬性要求：1. 必须保持章节数量不变；2. 必须严格按原章节范围输出；3. 不得新增超出蓝图阶段的大事件；4. 不得提前暴露或越级使用后期反派；5. 可以重写正文、微调摘要和标题，但必须保留与前后章节的衔接；6. 每章输出格式严格为：### 第X章 标题 / 摘要：... / 正文：...',
    buildPacingGuardText({ currentCount: start - 1, batchCount: rangeCount, targetChapters: automation.targetChapters || 600 }),
    buildHumanWritingSystemGuide({ project, automation, chapterNumber: start, scope: '范围修订' }),
    `修订章节范围：第${start}章到第${end}章`,
    `必须输出章节数：${rangeCount}`,
    '长篇蓝图：',
    automation.masterPlan,
    buildAuthorPersonaGuide(automation.authorPersona),
    buildPlatformStrategyGuide(project, automation),
    buildAutomationMemoryGuide(project, automation),
    getLatestCheckpointReport(automation) ? '最新阶段检查报告：' : '',
    getLatestCheckpointReport(automation) || '',
    '本范围章节卡：',
    plannedCards.map((card, idx) => formatChapterCard(card, start + idx)).join('\n\n'),
    '一致性检测报告：',
    automation.checkpointReport || '暂无检测报告，请仍按蓝图和章节卡修订。',
    repairInstruction ? `用户补充修订要求：${normalizeText(repairInstruction)}` : '',
    '前文衔接：',
    buildChapterRangeContext(project.chapters, Math.max(1, start - 2), start - 1),
    '需要修订的原章节：',
    buildChapterRangeContext(project.chapters, start, end),
    '后文衔接：',
    buildChapterRangeContext(project.chapters, end + 1, Math.min(project.chapters.length, end + 2)),
    '请直接输出修订后的章节，不要解释，不要输出修订说明。',
  ].filter(Boolean).join('\n');

  try {
    const text = await callDeepSeek({ apiKey, model, baseUrl, temperature: 0.72, userPrompt: prompt });
    const sections = extractGeneratedSections(text).slice(0, rangeCount);
    if (!sections.length) return res.status(500).json({ message: 'AI 未返回可解析的修订章节' });

    const resolved = await resolveGeneratedChapters({
      apiKey,
      model,
      baseUrl,
      project,
      automation,
      sections,
      plannedCards,
      startChapter: start,
      batchCount: rangeCount,
      defaultVolumeId: project.volumes[0]?.id || '',
      sourceText: text,
      reason: `修订第${start}-${end}章时章节边界不完整`,
    });

    const parsedChapters = [...project.chapters];
    resolved.chapters.forEach((chapter, idx) => {
      if (!chapter) return;
      const original = project.chapters[start - 1 + idx];
      const volumeId = original?.volumeId || chapter.volumeId || project.volumes[0]?.id || '';
      parsedChapters[start - 1 + idx] = {
        ...chapter,
        id: original?.id || chapter.id,
        volumeId,
        status: original?.status || chapter.status,
        updatedAt: now(),
      };
    });

    const nextChapters = parsedChapters;

    const nextProject = buildProjectPayload({
      ...project,
      chapters: nextChapters,
      automation: {
        ...automation,
        lastRepairReport: resolved.text,
        waitingForReview: false,
        status: 'repaired',
        progressNotes: resolved.warnings?.length
          ? `已按一致性报告修订第 ${start}-${end} 章，但有警告：${resolved.warnings.join('；')}`
          : `已按一致性报告修订第 ${start}-${end} 章`,
      },
    });
    req.db.projects[index] = nextProject;
    await writeDb(req.db);
    res.json({ text: [resolved.text, ...(resolved.warnings || [])].filter(Boolean).join('\n\n'), chapters: parsedChapters.slice(start - 1, end), project: nextProject, warnings: resolved.warnings || [] });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : '章节范围修订失败' });
  }
});

app.post('/api/projects/:id/automation/write-to-progress', auth, async (req, res) => {
  const index = req.db.projects.findIndex((item) => item.id === req.params.id && item.ownerId === req.user.id);
  if (index === -1) return res.status(404).json({ message: '作品不存在' });

  const { apiKey, model, baseUrl } = resolveAiModelConfig(req.body, 'writing');
  const { targetChapter, lightweight = false } = req.body;
  const project = req.db.projects[index];
  const automation = project.automation || {};
  if (!apiKey) return res.status(400).json({ message: '缺少 DeepSeek API Key' });
  if (!automation.masterPlan) return res.status(400).json({ message: '请先生成长篇规划' });
  if (automation.waitingForReview) return res.status(400).json({ message: '已到检查点或审校暂停，请先确认是否继续' });

  const writeState = getAutomationWriteState(project);
  const currentCount = writeState.writtenCount;
  const desiredTarget = Number(targetChapter) || currentCount;
  if (desiredTarget <= currentCount) {
    return res.status(400).json({ message: '目标进度必须大于当前章节数' });
  }

  const { remaining: chaptersUntilCheckpoint } = getNextCheckpointInfo(currentCount);
  const batchCount = Math.min(desiredTarget - currentCount, chaptersUntilCheckpoint);
  if (batchCount <= 0) {
    return res.status(400).json({ message: '本次推进章节数计算异常，请重新设置目标章节' });
  }
  try {
    assertEnoughChapterCards({ automation, startChapter: currentCount + 1, batchCount });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : '章节卡不足，请先自动排章节卡' });
  }
  const plannedCards = (automation.chapterCards || []).slice(currentCount, currentCount + batchCount);
  const signal = getRequestAbortSignal(req);

  try {
    const defaultVolumeId = project.volumes[0]?.id || '';
    const resolved = await generateAndPersistQualityChapters({
      req,
      projectIndex: index,
      apiKey,
      model,
      baseUrl,
      project,
      automation,
      plannedCards,
      startChapter: currentCount + 1,
      batchCount,
      defaultVolumeId,
      targetProgress: desiredTarget,
      stopAtCheckpoint: true,
      lightweight,
      signal,
    });
    res.json({ text: [resolved.text, ...(resolved.warnings || [])].filter(Boolean).join('\n\n'), chapters: resolved.chapters, project: resolved.project, reachedCheckpoint: resolved.reachedCheckpoint, replacedBlankStarter: resolved.replacedBlankStarter, warnings: resolved.warnings || [], pausedForReview: resolved.pausedForReview });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : '自动写到指定进度失败' });
  }
});

app.get('/api/publish/templates', auth, async (_req, res) => {
  res.json({
    platform: '番茄小说',
    checklist: tomatoRules.map((rule) => rule.label),
    sensitiveKeywords,
  });
});

app.use(express.static(distDir));

app.get('*', async (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();

  try {
    await fs.access(path.join(distDir, 'index.html'));
    res.sendFile(path.join(distDir, 'index.html'));
  } catch {
    res.status(200).send('前端开发服务器未启动，请运行 npm run dev');
  }
});

export async function startServer({ port = process.env.PORT || 3001, maxAttempts = 40 } = {}) {
  await ensureStorage();
  const startPort = Number(port) || 3001;

  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const candidatePort = startPort + offset;
    try {
      await new Promise((resolve, reject) => {
        const server = app.listen(candidatePort, () => resolve(server));
        server.once('error', reject);
      });
      console.log(`AI Novel Studio server listening on http://localhost:${candidatePort}`);
      return { port: candidatePort, url: `http://localhost:${candidatePort}` };
    } catch (error) {
      if (error?.code !== 'EADDRINUSE') throw error;
      console.warn(`Port ${candidatePort} is in use, trying ${candidatePort + 1}`);
    }
  }

  throw new Error(`No available port found from ${startPort}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startServer();
}
