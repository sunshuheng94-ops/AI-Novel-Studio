import assert from 'node:assert/strict';
import { __testHooks } from '../server.js';
const { normalizeAiSettingsPayload, resolveAiModelConfig } = __testHooks;
const { buildProjectPayload } = __testHooks;
const { resetAutomationRuntimeState } = __testHooks;
const { createTimeoutSignal, combineAbortSignals } = __testHooks;
const { buildAuthorPersonaPrompt } = __testHooks;
const { buildCommercialSerialGuide, buildPlatformStrategyGuide } = __testHooks;
const { buildChapterAuditPrompt, buildChapterRewritePrompt, buildAutomationExpressionRewritePrompt, buildAutomationContinuityValidationPrompt, buildAutomationLightCheckPrompt } = __testHooks;
const { generateAndPersistQualityChapters, formatChapterCard } = __testHooks;
const { buildGenreKnowledgeContract, formatGenreKnowledgeContract } = __testHooks;
const { buildStyleTextureContract, formatStyleTextureContract } = __testHooks;
const { buildTitleCoreSellContract, formatTitleCoreSellContract } = __testHooks;
const { buildNaturalChapterTitleGuide } = __testHooks;
const { buildEscapeInteractionContract, formatEscapeInteractionContract } = __testHooks;
const { repairChapterMetaNarrationLocally } = __testHooks;
const { isAiHttpStatus, isRecoverableChapterCardError, cleanAutomationLedgersAfterChapterDelete } = __testHooks;

const { assertEnoughChapterCards, cleanCardFieldText, cleanStoredChapterContent, createChapter, extractGeneratedSections, extractLabeledField, makeGeneratedChapter, hasPacingRisk, findNaturalnessIssues, classifyNaturalnessIssues, findDialogueIssues, getAutomationReviewPause, getNarrativeTextureMode, isHighDialogueChapter, importAiGeneratedChapters, isInvalidGeneratedChapter, isUsefulCardSummary, makeSingleChapterFromLooseText, normalizeGeneratedChapters, normalizePacingRepairChapters, parseAiChapterText, parseGeneratedChapterCardSection, resolveStoredChapterSummary, validateChapterRhythmPlan, buildFallbackRhythmPlan, parseNarrativeBeatPlan, validateNarrativeBeatPlan, buildFallbackNarrativeBeatPlan, formatNarrativeBeatPlan, getBeatGateIssues, translateIssuesToRevisionActions, polishMechanicalDraftLocally, classifyDashFunction, normalizeDashUsage, buildPerceptionScope, formatPerceptionScopeForPrompt, findPerceptionIssues, repairPerceptionLocally, applyPerceptionGate, findRhythmIssues, repairRhythmLocally, applyRhythmGate, buildSceneRhythmContract, formatSceneRhythmContract, buildSceneContinuityLedger, formatSceneContinuityLedger, buildRepetitionLedger, formatRepetitionLedger, buildInteriorMonologueContract, formatInteriorMonologueContract, findInteriorMonologueIssues, repairInteriorMonologueLocally, applyInteriorMonologueGate, buildSystemMessageContract, formatSystemMessageContract, repairSystemMessageLocally, buildInspirationFidelityContract, formatInspirationFidelityContract, buildGenrePromiseContract, formatGenrePromiseContract, buildOpeningHookContract, formatOpeningHookContract, buildChapterFunctionContract, formatChapterFunctionContract, buildWorldExposureBudgetContract, formatWorldExposureBudgetContract, buildDialoguePurposeContract, formatDialoguePurposeContract, buildDialogueDensityContract, formatDialogueDensityContract, buildDetailSelectionContract, formatDetailSelectionContract, findEnvironmentScanIssues, repairEnvironmentScanLocally, applyEnvironmentScanGate, buildSentencePatternLibrary, buildSyntaxContract, formatSyntaxContract, buildDetailBudgetContract, formatDetailBudgetContract, findSyntaxIssues, repairSyntaxLocally, applySyntaxGate, formatAiUsageReport, compileChapterForGeneration, directHumanWriting, routeGenerationMode, buildScenePacks, formatCompiledPackForDraft, buildChapterDirectorContext, formatChapterDirectorContext, formatCompactDirectorDirective, buildInformationBudget, buildCharacterKnowledgeLedger, buildActionCausalityChain, buildParagraphBudgetGuide, buildPositiveDraftingSkeletonGuide, buildHumanWritingModuleGuide, buildHumanWritingPatternLibrary, buildCharacterVoiceModel, buildHumanWritingSystemGuide, buildStyleResolverGuide, buildVoiceRosterGuide, sanitizeChapterCardForHumanEngine } = __testHooks;

const compact = `### 第1章 风起 / 摘要：主角发现异常。 / 正文：第一段正文。\n第二段正文。\n### 第2章 入局\n本章摘要：主角被迫入局。\n章节正文：这里是第二章正文。`;
const sections = extractGeneratedSections(compact);
assert.equal(sections.length, 2, 'should split two chapters');

const gpt55Config = normalizeAiSettingsPayload({
  activeProfile: 'gpt55',
  profiles: {
    deepseek: { apiKey: 'deepseek-key', model: 'deepseek-v4-pro', baseUrl: 'https://api.deepseek.com' },
    gpt55: { apiKey: 'relay-key', model: 'gpt-5.5', baseUrl: 'https://www.cctq.ai/v1' },
  },
});
assert.equal(gpt55Config.activeProfile, 'gpt55', 'should keep selected GPT-5.5 profile');
assert.equal(gpt55Config.apiKey, 'relay-key', 'active profile API key should be used by requests');
assert.equal(gpt55Config.model, 'gpt-5.5', 'active profile model should be used by requests');
assert.equal(gpt55Config.baseUrl, 'https://www.cctq.ai/v1', 'active profile base URL should be used by requests');
assert.equal(gpt55Config.modelRouting, 'mixed', 'new settings should default to mixed routing');
const mixedPayload = {
  activeProfile: 'gpt55',
  modelRouting: 'mixed',
  profiles: {
    deepseek: { apiKey: 'deepseek-key', model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com' },
    gpt55: { apiKey: 'relay-key', model: 'gpt-5.5', baseUrl: 'https://www.cctq.ai/v1' },
  },
};
assert.equal(resolveAiModelConfig(mixedPayload, 'planning').model, 'deepseek-v4-flash', 'mixed routing should use DeepSeek for planning');
assert.equal(resolveAiModelConfig(mixedPayload, 'chapter-card').model, 'gpt-5.5', 'mixed routing should use GPT-5.5 for chapter cards');
assert.equal(resolveAiModelConfig(mixedPayload, 'writing').model, 'gpt-5.5', 'mixed routing should use GPT-5.5 for chapter writing');
assert.equal(resolveAiModelConfig({ ...mixedPayload, modelRouting: 'active' }, 'planning').model, 'gpt-5.5', 'active routing should keep selected model for all stages');
const legacyConfig = normalizeAiSettingsPayload({ apiKey: 'old-key', model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com' });
assert.equal(legacyConfig.activeProfile, 'deepseek', 'legacy settings should default to DeepSeek');
assert.equal(legacyConfig.apiKey, 'old-key', 'legacy API key should remain usable');
const transmigrationKnowledge = buildGenreKnowledgeContract({
  project: { premise: '杜震宇转生成修仙世界的将死萝莉，获得魔法少女系统。', genre: '修仙 百合 系统 废萌' },
  card: { summary: '第一章确认转生、濒死身体和系统绑定。' },
});
const knowledgeText = formatGenreKnowledgeContract(transmigrationKnowledge);
assert.ok(knowledgeText.includes('修仙/仙侠网文常识'), 'transmigrator should keep xianxia genre knowledge');
assert.ok(knowledgeText.includes('暂时不知道当前世界的具体规则'), 'transmigrator should not know local world details');
assert.ok(knowledgeText.includes('不要把她写成完全没有类型概念'), 'contract should prevent missing genre awareness without banning specific wording');
const textureText = formatStyleTextureContract(buildStyleTextureContract({ project: { styleGuide: '搞笑、废萌、热血' }, scenePack: { title: '逃生和系统绑定' } }));
assert.ok(textureText.includes('短句可以用'), 'style texture should allow short sentences');
assert.ok(textureText.includes('同类情绪套句在同一章内出现三次以上'), 'emotion density should only intervene after repeated use');
assert.ok(textureText.includes('不要为了规避情绪句而写过度设计的动作描写'), 'emotion rule should avoid over-engineered action prose');
assert.ok(textureText.includes('每段最多突出一个强感受或强修饰'), 'texture contract should reduce modifier pileups');
const titleText = formatTitleCoreSellContract(buildTitleCoreSellContract({ project: { premise: '转生成修仙世界的将死萝莉，获得魔法少女系统。' }, card: { title: '第1章 被撞醒' }, chapterNumber: 1 }));
assert.ok(titleText.includes('首章标题可以命中核心卖点'), 'title contract should allow core sell without formulaic titles');
assert.ok(titleText.includes('将死萝莉'), 'title contract should surface loli survival hook');
assert.ok(titleText.includes('魔法少女系统'), 'title contract should surface system hook');
assert.ok(titleText.includes('章节标题自然化'), 'title contract should include natural title guidance');
assert.ok(buildNaturalChapterTitleGuide('chapter-card').includes('标题不要只写“系统升级'), 'chapter-card title guide should prevent formulaic titles');
assert.ok(buildNaturalChapterTitleGuide('draft').includes('更贴现场的短标题'), 'draft title guide should allow natural title repair');
const escapeText = formatEscapeInteractionContract(buildEscapeInteractionContract({ card: { summary: '主角濒死逃生，系统给二选一，门外有人查死。' }, scenePack: { title: '系统绑定 + 十秒二选一', goal: '逃过门外查死' } }));
assert.ok(escapeText.includes('嘲讽/性格表达'), 'escape contract should require system personality in survival scenes');
assert.ok(escapeText.includes('关系钩子'), 'escape contract should allow nearby character relationship hooks');
assert.ok(escapeText.includes('不能抢主线'), 'escape contract should keep relationship hook lightweight');
const negativeRevision = translateIssuesToRevisionActions([{ type: 'negative-judgement-density', label: '否定判断句密度偏高' }]);
assert.ok(negativeRevision.includes('逐句处理“不是/没有”'), 'negative density should produce explicit local revision instructions');
assert.ok(negativeRevision.includes('保留台词里的自然反驳'), 'negative density action should preserve natural dialogue negatives');
const resetAutomation = resetAutomationRuntimeState({
  masterPlan: '保留蓝图',
  authorPersona: '保留作者人设',
  lightweightGeneration: true,
  chapterCards: [{ title: '旧卡' }],
  foreshadowingLedger: [{ item: '旧伏笔' }],
  readerExpectations: [{ expectation: '旧期待' }],
  commercialBeatLedger: [{ beat: '旧爽点' }],
  characterStateMemory: [{ character: '旧角色' }],
  powerSystemLedger: [{ rule: '旧规则' }],
  chapterFunctionCalendar: [{ chapter: 1 }],
  checkpointReports: [{ report: '旧检查点' }],
  waitingForReview: true,
  totalGeneratedWords: 1234,
});
assert.equal(resetAutomation.masterPlan, '保留蓝图', 'runtime reset should preserve master plan');
assert.equal(resetAutomation.authorPersona, '保留作者人设', 'runtime reset should preserve author persona');
assert.equal(resetAutomation.lightweightGeneration, true, 'runtime reset should preserve lightweight generation mode');
assert.equal(resetAutomation.chapterCards.length, 1, 'manual runtime reset should preserve chapter cards');
assert.equal(resetAutomationRuntimeState(resetAutomation, '重置并清空章节卡', { preserveChapterCards: false }).chapterCards.length, 0, 'blueprint reset can explicitly clear chapter cards');
assert.equal(resetAutomation.foreshadowingLedger.length, 0, 'runtime reset should clear foreshadowing ledger');
assert.equal(resetAutomation.waitingForReview, false, 'runtime reset should clear review waiting state');
assert.equal(resetAutomation.totalGeneratedWords, 0, 'runtime reset should reset generated word counter');

const timeout = createTimeoutSignal(1, '测试超时');
const userAbort = new AbortController();
const combinedAbort = combineAbortSignals(userAbort.signal, timeout.signal);
await new Promise((resolve) => setTimeout(resolve, 5));
assert.equal(combinedAbort.signal.aborted, true, 'combined signal should abort when timeout fires');
assert.equal(combinedAbort.signal.reason.message, '测试超时', 'combined signal should preserve timeout reason');
combinedAbort.cleanup();
timeout.cleanup();
assert.equal(isAiHttpStatus(new Error('AI 请求失败（HTTP 524）：{}'), 524), true, 'should detect AI HTTP 524 errors');
assert.equal(isAiHttpStatus(new Error('AI 请求失败（HTTP 500）：{}'), 524), false, 'should not misclassify other AI HTTP errors');
assert.equal(isRecoverableChapterCardError(new Error('AI 请求失败（HTTP 524）：{}')), true, 'chapter-card fallback should recover from HTTP 524');
assert.equal(isRecoverableChapterCardError(new Error('AI 未返回可解析的章节卡，请重试。')), true, 'chapter-card fallback should recover from parse failures');
assert.equal(isRecoverableChapterCardError(new Error('缺少 DeepSeek API Key')), false, 'chapter-card fallback should not hide configuration errors');
const cleanedLedgers = cleanAutomationLedgersAfterChapterDelete({
  foreshadowingLedger: [{ chapter: 2, item: '删除' }, { chapter: 4, item: '后移' }],
  readerExpectations: [{ chapter: 3, expectation: '保留并前移' }],
  commercialBeatLedger: [{ chapter: 1, beat: '保留' }, { chapter: 2, beat: '删除' }],
  characterStateMemory: [{ chapter: 5, character: 'A', state: '后移' }],
  powerSystemLedger: [{ chapter: 2, rule: '删除' }, { chapter: 6, rule: '后移' }],
  chapterFunctionCalendar: [{ chapter: 2, functionMode: '删除' }, { chapter: 7, functionMode: '后移' }],
}, [2]);
assert.deepEqual(cleanedLedgers.foreshadowingLedger.map((item) => item.chapter), [3], 'deleted chapter foreshadowing should be removed and later chapters shifted');
assert.deepEqual(cleanedLedgers.readerExpectations.map((item) => item.chapter), [2], 'reader expectations should shift after deletion');
assert.deepEqual(cleanedLedgers.commercialBeatLedger.map((item) => item.chapter), [1], 'deleted chapter commercial beats should be removed');
assert.deepEqual(cleanedLedgers.characterStateMemory.map((item) => item.chapter), [4], 'character memory should shift after deletion');
assert.deepEqual(cleanedLedgers.powerSystemLedger.map((item) => item.chapter), [5], 'system ledger should shift after deletion');
assert.deepEqual(cleanedLedgers.chapterFunctionCalendar.map((item) => item.chapter), [6], 'function calendar should shift after deletion');
const authorPersonaPrompt = buildAuthorPersonaPrompt({
  project: { title: '测试书', genre: '系统流', targetAudience: '网文读者', styleGuide: '幽默热血', automation: {} },
  inspiration: '主角穿越后绑定系统。',
  minimumWords: 1500000,
  targetChapters: 600,
});
assert.ok(authorPersonaPrompt.includes('作者人设'), 'author persona prompt should build without undefined planning variables');
const promptProject = {
  title: '测试书',
  genre: '系统流',
  targetAudience: '网文读者',
  styleGuide: '幽默热血',
  summary: '主角穿越后绑定系统。',
  worldSetting: '现代都市',
  characterProfiles: '主角：嘴硬但善良。',
  automation: { masterPlan: '长篇蓝图', authorPersona: '叙述口吻：轻松。' },
  chapters: [{ title: '第1章 开始', summary: '主角绑定系统。', content: '主角睁开眼，系统提示响起。' }],
};
const payloadProject = buildProjectPayload({ ...promptProject, automation: { ...promptProject.automation, lightweightGeneration: true } });
assert.equal(payloadProject.automation.lightweightGeneration, true, 'project payload should preserve lightweight generation mode');
const promptAutomation = promptProject.automation;
const promptChapter = createChapter({ title: '第2章 测试', summary: '主角做出选择。', content: '主角推开门，决定先活下去。' });
const promptCard = { title: '第2章 测试', summary: '主角做出选择。', hook: '门外有人。', readerExpectation: '读者想知道主角如何脱身。' };
assert.ok(buildChapterAuditPrompt(promptProject, promptChapter, 1).includes('章节级巡检'), 'chapter audit prompt should build');
assert.ok(buildChapterRewritePrompt(promptProject, promptChapter, 1, '报告').includes('发布前巡检报告'), 'chapter rewrite prompt should build');
assert.ok(buildAutomationExpressionRewritePrompt({ project: promptProject, automation: promptAutomation, chapter: promptChapter, originalChapter: promptChapter, card: promptCard, nextCard: null, chapterNumber: 2, auditText: '报告' }).includes('发布前表达层修订'), 'automation expression rewrite prompt should build');
assert.ok(buildAutomationContinuityValidationPrompt({ project: promptProject, automation: promptAutomation, originalChapter: promptChapter, revisedChapter: promptChapter, card: promptCard, nextCard: null, chapterNumber: 2, auditText: '报告' }).includes('校验自动修订'), 'automation continuity validation prompt should build');
assert.ok(buildAutomationLightCheckPrompt({ project: promptProject, automation: promptAutomation, chapter: promptChapter, card: promptCard, nextCard: null, chapterNumber: 2 }).includes('轻量发布前校验'), 'automation light check prompt should build');
assert.equal(typeof generateAndPersistQualityChapters, 'function', 'quality persistence path should be exported for regression coverage');
assert.ok(!formatChapterCard({ ...promptCard, openingType: 'time', dialogueDensity: 'high', humanTextureBeats: 'coffee' }, 2).includes('对话密度'), 'chapter card should default to story track only');
assert.ok(buildCommercialSerialGuide('chapter-card').includes('章节卡不是事件清单'), 'server should expose commercial chapter-card guide');
assert.ok(buildPlatformStrategyGuide({ title: '我在明日方舟搜打撤', genre: '明日方舟同人', premise: '穿越泰拉' }, { platformStrategy: { primary: 'ciweimao', pace: 'ciweimao', structure: 'qidian', publishTarget: 'ciweimao', tags: [] } }).includes('刺猬猫同人适配'), 'server platform guide should apply fanfic strategy');

const auditPrefixed = `FAIL\n原因：第二章节奏略快，以下为修订。\n### 第1章 修订一\n摘要：第一章摘要。\n正文：第一章正文。\n### 第2章 修订二\n摘要：第二章摘要。\n正文：第二章正文。\n### 第3章 修订三\n摘要：第三章摘要。\n正文：第三章正文。`;
const auditSections = extractGeneratedSections(auditPrefixed);
assert.equal(auditSections.length, 3, 'should discard FAIL preamble before chapters');
assert.ok(!auditSections[0].startsWith('FAIL'), 'FAIL preamble must not become a chapter');

const first = makeGeneratedChapter(sections[0], 'v1');
assert.equal(first.summary, '主角发现异常。');
assert.ok(first.content.includes('第一段正文'));
assert.ok(!first.summary.includes('第一段正文'), 'summary must not contain body');

const second = makeGeneratedChapter(sections[1], 'v1');
assert.equal(second.summary, '主角被迫入局。');
assert.equal(second.content, '这里是第二章正文。');

const missingBodyLabel = `### 第3章 夜谈\n摘要：两人交换情报。\n他们坐在茶楼角落。\n窗外雨声渐密。`;
const third = makeGeneratedChapter(missingBodyLabel, 'v1');
assert.equal(third.summary, '两人交换情报。他们坐在茶楼角落。窗外雨声渐密');
assert.ok(third.content.includes('茶楼角落'));
assert.ok(third.summary.includes('茶楼角落'), 'summary should use the opening 2-3 sentences when body is missing');

const hookHeavy = `### 第4章 交锋\n摘要：主角第一次正面试探。\n关键钩子：留下后续对手。\n正文：真正的交锋从这里开始。`;
const fourth = makeGeneratedChapter(hookHeavy, 'v1');
assert.equal(fourth.summary, '主角第一次正面试探。');
assert.ok(fourth.content.includes('真正的交锋'));
assert.ok(!fourth.content.includes('关键钩子'));

const hookAfterBody = `### 第5章\n摘要：主角进入旧楼。\n正文：主角推开旧楼大门，灰尘落在肩头。\n钩子：门后传来熟悉的声音。`;
const fifth = makeGeneratedChapter(hookAfterBody, 'v1');
assert.equal(fifth.title, '新章节', 'blank chapter title should get a safe fallback');
assert.equal(fifth.summary, '主角进入旧楼。');
assert.ok(fifth.content.includes('旧楼大门'));
assert.ok(!fifth.content.includes('钩子：'), 'hook after body must not enter content');
assert.ok(!fifth.content.includes('摘要：'), 'summary label must not enter content');

const metadataOnlyBeforeBody = `### 第6章 暗线\n本章摘要：主角发现账册疑点。\n章末钩子：账册最后一页被撕掉。\n主角没有立刻声张，而是把账册藏进袖中。`;
const sixth = makeGeneratedChapter(metadataOnlyBeforeBody, 'v1');
assert.equal(sixth.summary, '主角发现账册疑点。主角没有立刻声张，而是把账册藏进袖中');
assert.ok(sixth.content.includes('账册藏进袖中'));
assert.ok(!sixth.content.includes('章末钩子'));

const titledWithoutCardFallback = normalizeGeneratedChapters([hookAfterBody], [{ title: '第5章 旧楼疑云', summary: '卡片摘要' }], 'v1')[0];
assert.equal(titledWithoutCardFallback.title, '新章节');
assert.equal(titledWithoutCardFallback.summary, '主角进入旧楼。');

const missingFirstSlot = normalizeGeneratedChapters(
  [`### 第2章 真正第二章\n摘要：AI第二章摘要。\n正文：AI第二章正文。`],
  [{ title: '第1章 卡片一', summary: '卡片一摘要' }, { title: '第2章 卡片二', summary: '卡片二摘要' }],
  'v1',
  { startChapter: 1, batchCount: 2 },
);
assert.equal(missingFirstSlot[0], null, 'missing chapter 1 must stay empty for supplement instead of using chapter card');
assert.equal(missingFirstSlot[1].title, '第2章 真正第二章');
assert.equal(missingFirstSlot[1].summary, 'AI第二章摘要。');
assert.equal(missingFirstSlot[1].content, 'AI第二章正文。');
assert.notEqual(missingFirstSlot[1].summary, '卡片二摘要');

assert.equal(hasPacingRisk([{ title: '第1章', summary: '正常推进', content: '局部冲突' }], []), false);

const fallback = normalizePacingRepairChapters({
  text: 'FAIL\n### 第1章 修订\n摘要：修订后摘要。\n正文：修订后正文。',
  plannedCards: [{ title: '第1章', summary: '卡片摘要' }, { title: '第2章', summary: '卡片摘要2' }],
  originalChapters: [
    { title: '第1章 原始', summary: '原始摘要', content: '原始正文' },
    { title: '第2章 原始', summary: '原始摘要2', content: '原始正文2' },
  ],
  defaultVolumeId: 'v1',
  startChapter: 1,
  batchCount: 2,
});
assert.equal(fallback.chapters.length, 2);
assert.equal(fallback.chapters[1].summary, '原始摘要2');

const invalidRepair = normalizePacingRepairChapters({
  text: '### 第1章 缺失\n摘要：缺失。\n正文：缺失',
  plannedCards: [{ title: '第1章', summary: '卡片摘要' }],
  originalChapters: [{ title: '第1章 原始', summary: '原始摘要', content: '原始正文' }],
  defaultVolumeId: 'v1',
  startChapter: 1,
  batchCount: 1,
});
assert.equal(invalidRepair.chapters[0].content, '原始正文');
assert.equal(isInvalidGeneratedChapter({ content: '正文缺失' }), true);
assert.equal(isInvalidGeneratedChapter({ content: '这是有效正文。主角继续推进当前冲突。' }), false);
assert.equal(cleanStoredChapterContent('摘要：不该进正文。\n钩子：也不该进正文。\n正文：真正正文。'), '摘要：不该进正文。\n钩子：也不该进正文。\n正文：真正正文。');
assert.equal(cleanStoredChapterContent('正文：真正正文。'), '正文：真正正文。');
assert.equal(repairChapterMetaNarrationLocally('他摸到第5章顺手塞进兜里的儿童退烧药小瓶。'), '他摸到之前顺手塞进兜里的儿童退烧药小瓶。');
assert.equal(cleanStoredChapterContent('她想起前文提到的暗号。'), '她想起之前的暗号。');

const mixedRepair = normalizePacingRepairChapters({
  text: 'FAIL\n### 第1章 修订\n摘要：修订摘要。\n正文：修订正文。\n钩子：不能入正文。\n### 第2章 缺失\n摘要：缺失。\n正文：正文缺失',
  plannedCards: [{ title: '第1章', summary: '卡片摘要' }, { title: '第2章', summary: '卡片摘要2' }],
  originalChapters: [
    { title: '第1章 原始', summary: '原始摘要', content: '原始正文' },
    { title: '第2章 原始', summary: '原始摘要2', content: '原始正文2' },
  ],
  defaultVolumeId: 'v1',
  startChapter: 1,
  batchCount: 2,
});
assert.equal(mixedRepair.chapters[0].content, '修订正文。');
assert.equal(mixedRepair.chapters[1].content, '原始正文2');

const parsedDirectly = parseAiChapterText(`### 第1章 开场\n摘要：第一章摘要。\n正文：第一章正文。\n### 第2章 继续\n摘要：第二章摘要。\n正文：第二章正文。`, {
  startChapter: 1,
  batchCount: 3,
});
assert.equal(parsedDirectly.length, 2);
assert.equal(parsedDirectly[0].title, '第1章 开场');
assert.equal(parsedDirectly[0].summary, '第一章摘要。');
assert.equal(parsedDirectly[0].content, '第一章正文。');
assert.equal(parsedDirectly[1].title, '第2章 继续');

const importedTagged = importAiGeneratedChapters(`标题：雨夜来客\n摘要：女主在雨夜发现门外的人知道她的秘密。\n正文：雨水顺着屋檐砸下来，她握紧门把手，没有立刻开门。`, {
  startChapter: 9,
  batchCount: 1,
  defaultVolumeId: 'v1',
});
assert.equal(importedTagged[0].title, '第9章 雨夜来客');
assert.equal(importedTagged[0].summary, '女主在雨夜发现门外的人知道她的秘密。');
assert.equal(importedTagged[0].content, '雨水顺着屋檐砸下来，她握紧门把手，没有立刻开门。');

const importedStrict = importAiGeneratedChapters(`### 第10章 旧账\n摘要：主角发现旧账里藏着母亲失踪的线索。\n正文：账页边角被烧黑，只剩半枚印章还清晰。`, {
  startChapter: 10,
  batchCount: 1,
  defaultVolumeId: 'v1',
});
assert.equal(importedStrict[0].title, '第10章 旧账');
assert.equal(importedStrict[0].summary, '主角发现旧账里藏着母亲失踪的线索。');
assert.equal(importedStrict[0].content, '账页边角被烧黑，只剩半枚印章还清晰。');

const importedFullSummary = importAiGeneratedChapters(`### 第11章 多句摘要\n摘要：第一句摘要。第二句摘要必须保留。第三句也必须保留。\n正文：这一章的正文必须完整进入章节管理。`, {
  startChapter: 11,
  batchCount: 1,
  defaultVolumeId: 'v1',
});
assert.equal(importedFullSummary[0].summary, '第一句摘要。第二句摘要必须保留。第三句也必须保留。');
assert.equal(importedFullSummary[0].content, '这一章的正文必须完整进入章节管理。');

const bodyLikeSummary = importAiGeneratedChapters(`### 第22章 土路尽头的门\n摘要：信标器的绿灯在跳。不是那种每三秒一次的稳定闪烁——第一次跳到第四下时，第五下直接跳过。\n正文：信标器的绿灯在跳。魏杰和阿米娅沿着信标器继续赶路，抵达野外基站-07后发现入口和K留下的新提示，决定进入地下通道。`, {
  startChapter: 22,
  batchCount: 1,
  defaultVolumeId: 'v1',
});
assert.ok(/抵达|发现|决定|进入/.test(bodyLikeSummary[0].summary), `body-like summary should be rebuilt into plot summary, got: ${bodyLikeSummary[0].summary}`);
assert.ok(!bodyLikeSummary[0].summary.startsWith('信标器的绿灯在跳'), 'summary must not reuse body opening');

const chapterCardFromFirstSlot = importAiGeneratedChapters(`### 第81章 新场景开局\n卷：第一卷\n蓝图阶段：开局推进\n进度锁：本章只推进当下冲突\n本章只允许：进入新场景，触发新矛盾\n本章禁止：只写承接空话\n读者预期：看到新的行动和结果\n上一章遗留动作：承接上一章的结果\n伏笔规划：埋下一个新线索\n摘要：主角进入新场景，立刻遇到新的阻碍，并在本章末尾做出选择。\n关键钩子：新的代价出现。`, {
  startChapter: 81,
  batchCount: 1,
  defaultVolumeId: 'v1',
});
assert.equal(chapterCardFromFirstSlot[0].title, '第81章 新场景开局');
assert.ok(chapterCardFromFirstSlot[0].summary.includes('新场景'));

const importedBodyWithLabelLikeText = importAiGeneratedChapters(`### 第13章 不应截断\n摘要：主角读取密信。\n正文：她展开纸条，看见上面写着内容：今晚子时，到旧桥下见。\n摘要：这两个字是纸条原文的一部分，不是章节摘要。\n钩子：这两个字也是正文里的线索，不应该让正文在这里截断。\n她把纸条收进袖中，继续向前。`, {
  startChapter: 13,
  batchCount: 1,
  defaultVolumeId: 'v1',
});
assert.ok(importedBodyWithLabelLikeText[0].content.includes('内容：今晚子时'));
assert.ok(importedBodyWithLabelLikeText[0].content.includes('摘要：这两个字是纸条原文的一部分'));
assert.ok(importedBodyWithLabelLikeText[0].content.includes('钩子：这两个字也是正文里的线索'));
assert.ok(importedBodyWithLabelLikeText[0].content.includes('她把纸条收进袖中'));

const storedChapter = createChapter({
  title: '第12章 保存层不得改写',
  summary: '第一句摘要。第二句摘要保存后也必须保留。',
  content: '正文第一行。\n摘要：这是角色在正文中看到的文字，不应被保存层删除。\n正文第三行。',
});
assert.equal(storedChapter.summary, '第一句摘要。第二句摘要保存后也必须保留。');
assert.ok(storedChapter.content.includes('摘要：这是角色在正文中看到的文字'));
assert.ok(storedChapter.content.includes('正文第三行。'));

const looseCurrentChapter = makeSingleChapterFromLooseText('主角推门进屋，屋内灯光忽然熄灭。她屏住呼吸，听见有人在黑暗中叫出她的名字。', {
  chapterNumber: 7,
  defaultVolumeId: 'v1',
});
assert.equal(looseCurrentChapter.title, '第7章 新章节');
assert.equal(looseCurrentChapter.summary, '主角推门进屋，屋内灯光忽然熄灭。她屏住呼吸，听见有人在黑暗中叫出她的名字');
assert.ok(looseCurrentChapter.content.includes('屋内灯光忽然熄灭'));

const looseLabeledBody = makeSingleChapterFromLooseText('正文：主角沿着楼梯向下，发现墙上的划痕全都指向地下室。', {
  chapterNumber: 8,
  defaultVolumeId: 'v1',
});
assert.equal(looseLabeledBody.title, '第8章 新章节');

const parsedLooseDirectly = parseAiChapterText('主角推门进屋，屋内灯光忽然熄灭。她屏住呼吸，听见有人在黑暗中叫出她的名字。', {
  startChapter: 7,
  batchCount: 1,
});
assert.equal(parsedLooseDirectly[0].title, '第7章 新章节');
assert.equal(looseLabeledBody.summary, '主角沿着楼梯向下，发现墙上的划痕全都指向地下室');
assert.equal(looseLabeledBody.content, '主角沿着楼梯向下，发现墙上的划痕全都指向地下室。');

const chapterCardWithNarrativeFields = importAiGeneratedChapters(`### 第14章 旧案回声
开头方式：结果切入
开头锚点：一封旧信突然被翻出来
禁止开头：禁止精确时间打卡
叙事手法：flashback
叙事目的：先给旧案结果，再回推来源
摘要：旧案信息重新浮出。
正文：真正正文从这里开始。`, {
  startChapter: 14,
  batchCount: 1,
  defaultVolumeId: 'v1',
});
assert.equal(chapterCardWithNarrativeFields[0].content, '真正正文从这里开始。');

const naturalnessIssues = findNaturalnessIssues('不是犹豫，也不是确认——就是蹲下去。\n\n他拨开雪面。');
assert.ok(naturalnessIssues.some((issue) => issue.type === 'negative-reveal'), 'should detect negative reveal emphasis pattern');
assert.equal(classifyNaturalnessIssues(naturalnessIssues, '不是犹豫，也不是确认——就是蹲下去。'), 'medium');

const naturalnessHeavyIssues = findNaturalnessIssues('不是冲击波。不是爆炸。是一道光刃。\n\n**【提示】**\n\n真正的危险才刚刚开始。');
assert.ok(naturalnessHeavyIssues.length >= 3, 'should detect several naturalness issues');
assert.equal(classifyNaturalnessIssues(naturalnessHeavyIssues, naturalnessHeavyIssues.map((issue) => issue.text).join('\n')), 'heavy');

const horizontalRuleIssues = findNaturalnessIssues('---\n她抬头。');
assert.ok(horizontalRuleIssues.some((issue) => issue.type === 'markdown-noise'), 'should detect markdown horizontal rules');
assert.equal(cleanStoredChapterContent('---\n她抬头。'), '---\n她抬头。', 'stored chapter content should not rewrite user content');

const leakedNaturalnessChapter = [
  '不是钉子，不是螺丝，是一根带弯钩的把手。',
  '不是卡住了。是铁皮柜压在了盖板上。',
  '不是疑问句。',
  '不是刀具。更像某种生物组织结构边缘。',
  '不是自然光——是偏黄色的人工照明。',
  '不是推测，是判断。',
].join('\n\n');
const leakedNaturalnessIssues = findNaturalnessIssues(leakedNaturalnessChapter);
assert.ok(leakedNaturalnessIssues.some((issue) => issue.type === 'negative-comma-triple'), 'should detect comma-separated negative triple');
assert.ok(leakedNaturalnessIssues.some((issue) => issue.type === 'negative-period-reveal'), 'should detect period negative reveal');
assert.ok(leakedNaturalnessIssues.some((issue) => issue.type === 'negative-turn-density'), 'should detect chapter-level negative reveal density');
assert.ok(leakedNaturalnessIssues.some((issue) => issue.type === 'mechanical-negation-density'), 'should detect chapter-level mechanical negation density');
assert.equal(classifyNaturalnessIssues(leakedNaturalnessIssues, leakedNaturalnessChapter), 'heavy');

const localizedMechanicalNegation = findNaturalnessIssues([
  '信标器闪了一下。不是设备故障，而是信号被拉近了。',
  '牌子倒在路边。不是风吹倒的，是被人从插孔里撬出来的。',
  '编号露出两个数字。不是巧合能解释的密度了。',
].join('\n\n'));
assert.ok(localizedMechanicalNegation.some((issue) => issue.type === 'mechanical-negation-window-density'), 'should detect localized mechanical negation over budget');

const stiffTransitionIssues = findNaturalnessIssues('魏杰把信标器举过头顶转了半圈。方向没问题。阿米娅点头。没问黄光是什么意思，也没问为什么要弹两下。她先走了。');
assert.ok(stiffTransitionIssues.some((issue) => issue.type === 'stiff-transition'), 'should detect stiff nod/no-question/continue transitions');
assert.ok(stiffTransitionIssues.some((issue) => issue.type === 'missing-reaction-bridge'), 'should detect missing reaction bridge after key signal');
assert.equal(classifyNaturalnessIssues(stiffTransitionIssues, '魏杰把信标器举过头顶转了半圈。方向没问题。阿米娅点头。没问黄光是什么意思，也没问为什么要弹两下。她先走了。'), 'medium', 'critical transition issues should trigger medium repair');

const bridgedTransitionIssues = findNaturalnessIssues('黄光闪了一下。阿米娅脚步停了半拍，看向魏杰手里的信标器。魏杰把信标器朝前转了半圈，等绿灯重新稳定，才说：“方向没错。”她点头，绕开灌木继续往前。');
assert.equal(bridgedTransitionIssues.some((issue) => ['missing-reaction-bridge', 'stiff-transition'].includes(issue.type)), false, 'should allow key signal transitions with a light reaction bridge');

const standaloneNegativeIssues = findNaturalnessIssues('不是一个人。脚步声至少有两道。\n\n不是鞋印，像是拖拽痕迹。');
assert.ok(standaloneNegativeIssues.some((issue) => issue.type === 'negative-standalone-judgement'), 'should detect standalone negative judgement');
assert.equal(standaloneNegativeIssues.some((issue) => issue.type === 'plain-negative-density'), false, 'two negative observations should not trigger density by themselves');
assert.ok(findNaturalnessIssues('不是门锁坏了，插销从外面压住了。不是风吹倒的，支架有新撬痕。不是脚印，像拖拽痕迹。不是错觉，频道里确实有人声。').some((issue) => issue.type === 'plain-negative-density'), 'repeated mechanical negative observations should trigger density');
assert.equal(classifyNaturalnessIssues(standaloneNegativeIssues, '不是一个人。脚步声至少有两道。\n\n不是鞋印，像是拖拽痕迹。'), 'medium', 'two natural negative observations should not force heavy severity');
assert.equal(classifyNaturalnessIssues(findNaturalnessIssues('不是一个人。脚步声至少有两道。\n\n不是鞋印，像是拖拽痕迹。\n\n不是门锁坏了，插销从外面压住了。'), '不是一个人。脚步声至少有两道。\n\n不是鞋印，像是拖拽痕迹。\n\n不是门锁坏了，插销从外面压住了。'), 'medium', 'sentence-level negative density should stay soft unless extreme');
assert.equal(findNaturalnessIssues('阿米娅没有回头，只是点了一下头。他没有停下，继续往前走。').some((issue) => ['empty-comma-reveal', 'negative-turn-density'].includes(issue.type)), false, 'natural absence descriptions should not be treated as mechanical negative reveal');
assert.equal(findNaturalnessIssues('阿米娅没有回头，只是点了一下头。他没有停下，继续往前走。').some((issue) => /^mechanical-negation/.test(issue.type)), false, 'natural absence descriptions should not trigger mechanical negation density');

const choppySentenceIssues = findNaturalnessIssues('他用指甲扣住缝隙往上提。没动。再用力，地板纹丝不动。他换了个方向，从另一侧抠，手指探进去摸到边缘有金属的触感——是铁，埋在木板底下。');
assert.ok(choppySentenceIssues.some((issue) => issue.type === 'dash-explain-judgement'), 'should detect dash explanation judgement');
assert.equal(classifyNaturalnessIssues(findNaturalnessIssues('灰喉嘴角动了一下——不是笑，是某种介于嘲讽和失望之间的表情。'), '灰喉嘴角动了一下——不是笑，是某种介于嘲讽和失望之间的表情。'), 'none', 'single natural expression clarification should not pause writing by itself');
assert.ok(findNaturalnessIssues('他硬生生把咳嗽压回喉咙，后背紧贴着集装箱内壁，手指握着折叠刀的塑料握把，指甲掐进掌心。').some((issue) => issue.type === 'parallel-body-detail-overload'), 'should detect parallel body detail overload');
assert.ok(findNaturalnessIssues('转椅翻倒在地上，镜子碎成蛛网状，柜台倒在地上。').some((issue) => issue.type === 'parallel-scene-detail-overload'), 'should detect parallel scene detail overload');
assert.equal(findNaturalnessIssues('魏杰绕过翻倒的转椅，碎镜子在脚边反了一下光。他压低身子，钻进柜台后的缺口。').some((issue) => /^parallel-/.test(issue.type)), false, 'should allow environment details embedded in action');

const commaStackIssues = findNaturalnessIssues('她披着一件旧毛衣，肩膀上有块咖啡渍，颜色已经干了，在浅灰色的织物上晕成一圈不规则的阴影。');
assert.ok(commaStackIssues.some((issue) => issue.type === 'comma-stacked-long-sentence' || issue.type === 'overloaded-detail-sentence'), 'should detect comma-stacked detail sentences');
assert.ok(commaStackIssues.some((issue) => issue.type === 'patchwork-description'), 'should detect patchwork object descriptions');
const reflectedDetailIssues = findNaturalnessIssues('阿米娅的裤子口袋里，那枚碎片的位置，透过布料反射出一道非常细的光形——细得像一根针尖在黑暗里划过。');
assert.ok(reflectedDetailIssues.some((issue) => issue.type === 'overloaded-detail-sentence'), 'should detect overloaded reflective detail sentences');
assert.ok(reflectedDetailIssues.some((issue) => issue.type === 'fuzzy-subject-detail'), 'should detect fuzzy subject detail sentences');
const causeStateResultIssues = findNaturalnessIssues('他的指甲边缘还嵌着灰色的冻土印，昨晚没洗干净，现在干成了细末，一碰就掉在被单上。');
assert.ok(causeStateResultIssues.some((issue) => issue.type === 'cause-state-result-chop'), 'should detect chopped cause-state-result descriptions');
assert.ok(causeStateResultIssues.some((issue) => issue.type === 'overloaded-detail-sentence'), 'should detect overloaded dirt detail descriptions');
assert.equal(findNaturalnessIssues('指甲边缘还嵌着昨晚没洗干净的冻土，干成细末，一碰就掉在被单上。').some((issue) => ['comma-stacked-long-sentence', 'overloaded-detail-sentence'].includes(issue.type)), false, 'should allow compact logical detail sentence');
assert.equal(findNaturalnessIssues('她披着旧毛衣，肩头一块咖啡渍干透，在浅灰织物上晕出一圈不规则阴影。').some((issue) => ['comma-stacked-long-sentence', 'overloaded-detail-sentence'].includes(issue.type)), false, 'should allow fluent compressed stain detail');
assert.equal(findNaturalnessIssues('阿米娅裤袋里的碎片，透过布料映出一道极细的光，像针尖在黑暗里划过。').some((issue) => ['comma-stacked-long-sentence', 'overloaded-detail-sentence'].includes(issue.type)), false, 'should allow logical reflective detail sentence');
assert.equal(findNaturalnessIssues('昨晚没洗净的冻土印在指甲缝里干成了细屑，随着他的动作扑簌簌掉在被单上。').some((issue) => ['cause-state-result-chop', 'overloaded-detail-sentence'].includes(issue.type)), false, 'should allow fluent cause-state-result detail');
assert.equal(findNaturalnessIssues('她那件旧毛衣肩膀处的咖啡渍已经干透，在浅灰色织物上晕开一圈不规则的暗影。').some((issue) => ['patchwork-description', 'overloaded-detail-sentence'].includes(issue.type)), false, 'should allow fluent patchwork-free object detail');
assert.equal(findNaturalnessIssues('阿米娅口袋里的碎片隔着布料，透射出一道针尖般细碎的光影。').some((issue) => ['fuzzy-subject-detail', 'overloaded-detail-sentence'].includes(issue.type)), false, 'should allow fluent direct-subject reflective detail');
const dimensionIssues = findNaturalnessIssues('灰色金属面板被螺丝固定在墙基的水泥面上，螺丝孔周围有新旧交接的痕迹，旧灰浆和新嵌入的螺丝之间存在色差，边缘切割线还很锐利，像刚被人重新装上去。');
assert.ok(dimensionIssues.some((issue) => issue.type === 'detail-dimension-overload'), 'should detect overloaded detail dimensions beyond comma count');

const denseChoppyIssues = findNaturalnessIssues('他扣住缝隙。没动。他再用力。地板卡死。他换方向。手指探进去。');
assert.ok(denseChoppyIssues.some((issue) => issue.type === 'choppy-paragraph'), 'should detect dense choppy paragraph rhythm');

const inventoryScanIssues = findNaturalnessIssues('房间很小，一张行军床，一个铁皮柜，柜门半开着，里面空了。墙上挂着一件深色制服外套，袖子垂下来，袖口有一块深褐色的污渍，干透了很久。床头柜上放着通讯器，屏幕朝下，旁边还有半卷纱布。');
assert.ok(inventoryScanIssues.some((issue) => issue.type === 'inventory-scan-paragraph'), 'should detect inventory scan paragraphs');
assert.ok(inventoryScanIssues.some((issue) => issue.type === 'scene-asset-overload'), 'should detect overloaded scene asset scanning');
const medicalScanIssues = findNaturalnessIssues('一个临时医疗点。行军床，折叠担架靠墙放着，药品柜半开着，大部分架子是空的。地面有杂乱的脚印，沾着灰和暗色污渍。空气里有消毒水的气味。');
assert.ok(medicalScanIssues.some((issue) => issue.type === 'inventory-scan-paragraph'), 'should detect noun-state medical room scans');
assert.ok(medicalScanIssues.some((issue) => issue.type === 'scene-asset-overload'), 'should detect dense medical room asset scans');
const actionStaticDisconnectIssues = findNaturalnessIssues('他撑着上半身坐起来，脊柱咔咔响了几声。照明灯嵌在天花板里，冷白色，把整间屋子照得发白。行军床、靠在墙边的折叠担架、半开的药品柜，纱布和注射器裹在一起。外套还在身上，几处深色污渍。左手攥着金属瓶，右手腕缠着半截透气胶带，边角翻翘起来。');
assert.ok(actionStaticDisconnectIssues.some((issue) => issue.type === 'action-static-list-disconnect'), 'should detect static inventory after body action');
const doorStaticDisconnectIssues = findNaturalnessIssues('他把金属瓶放在床沿，按住额头。太阳穴那块皮肉跳得厉害。金属门紧闭，没有窗。墙边堆着几个空弹药箱，通讯终端嵌在墙上，屏幕亮着蓝光。');
assert.ok(doorStaticDisconnectIssues.some((issue) => issue.type === 'action-static-list-disconnect'), 'should detect static room list after pain action');
const staticRoomSummaryIssues = findNaturalnessIssues('这是个十来平米的临时安置点——两张行军床靠墙摆着，折叠担架塞在角落，药品柜半开，通讯终端还亮着冷蓝色的光。');
assert.ok(staticRoomSummaryIssues.some((issue) => issue.type === 'static-room-summary'), 'should detect static room summary lists');
assert.equal(classifyNaturalnessIssues(staticRoomSummaryIssues, '这是个十来平米的临时安置点——两张行军床靠墙摆着，折叠担架塞在角落，药品柜半开，通讯终端还亮着冷蓝色的光。'), 'heavy', 'static room summaries near opening should remain hard failures');
const embeddedMedicalIssues = findNaturalnessIssues('他扶着空了一半的药品柜站稳，指尖掠过冰冷的行军床架。这地方显然是个临时医疗点，地面凌乱的脚印和刺鼻的消毒水味盖不住那股烧焦的腐臭。');
assert.equal(embeddedMedicalIssues.some((issue) => ['inventory-scan-paragraph', 'scene-asset-overload', 'action-static-list-disconnect'].includes(issue.type)), false, 'should allow environment details embedded in action chain');
const actionChainIssues = findNaturalnessIssues('他扶着床沿站起来，先把通讯器按亮。屏幕闪了一下就黑了，他只好拔掉墙角那根松动的线，把机器塞进外套口袋，转身去听门外的脚步声。');
assert.equal(actionChainIssues.some((issue) => ['inventory-scan-paragraph', 'scene-asset-overload'].includes(issue.type)), false, 'should allow object details embedded in action chain');
const propDossierIssues = findNaturalnessIssues('纸上画着几条线，像是临时手绘的路线图，没有标注地名，只在其中一个交叉点画了个圈，圈旁边写着两个字：“撤离”。字迹潦草，写得很急。翻过纸，背面空白，没有签名，没有日期。');
assert.ok(propDossierIssues.some((issue) => issue.type === 'prop-dossier-description'), 'should detect prop dossier detail completion');
const leanPropIssues = findNaturalnessIssues('他把皱纸摊开，唯一被圈出的交叉口旁写着“撤离”。他没再看第二遍，直接把纸塞进口袋。');
assert.equal(leanPropIssues.some((issue) => issue.type === 'prop-dossier-description'), false, 'should allow one effective detail for a prop');
const moduleDossierIssues = findNaturalnessIssues('床边的黑色模块巴掌大小，扁平的矩形，表面没有接口，没有指示灯，没有任何标识。他拿起模块，很轻，边缘光滑，手感像某种复合材料。');
assert.ok(moduleDossierIssues.some((issue) => issue.type === 'prop-dossier-description'), 'should detect module dossier detail completion');
const leanModuleIssues = findNaturalnessIssues('他拿起黑色模块，掌心忽然一热，视野边缘跳出一行异常提示。');
assert.equal(leanModuleIssues.some((issue) => issue.type === 'prop-dossier-description'), false, 'should allow one effective module detail');
const flatSentenceChainIssues = findNaturalnessIssues('房间不大。坐直后视线几乎够到对面墙上的污渍。水泥地，行军床，一张折叠桌。头顶灯管亮着，不太亮，但足够看清自己的手。');
assert.ok(flatSentenceChainIssues.some((issue) => issue.type === 'sentence-chain-flatness' || issue.type === 'inventory-scan-paragraph'), 'should detect flat sentence chains');
const dialogBudget = buildParagraphBudgetGuide({ project: { styleGuide: '幽默且具有史诗感' }, automation: { authorPersona: '黑色幽默' }, card: { narrativePurpose: '主功能=dialogue_conflict', texturePlan: '小说感70%', humanTextureBeats: '对话拉扯' }, chapterNumber: 2 });
assert.ok(dialogBudget.includes('对话冲突段'), 'should include dialogue segment type when appropriate');
assert.ok(dialogBudget.includes('通用推进段'), 'should include generic progression segment');

const paragraphBudget = buildParagraphBudgetGuide({
  project: { styleGuide: '幽默且具有史诗感' },
  automation: { authorPersona: '黑色幽默，废墟史诗感' },
  card: { texturePlan: '小说感90%', humanTextureBeats: '身体受阻' },
  chapterNumber: 1,
});
assert.ok(paragraphBudget.includes('主物件可以被展开'), 'paragraph budget should describe primary object budget');
assert.ok(paragraphBudget.includes('心理描写使用功能许可证'), 'paragraph budget should include functional psychological description license');
assert.ok(paragraphBudget.includes('短促幽默'), 'paragraph budget should preserve humor style allocation');
assert.ok(paragraphBudget.includes('史诗预算'), 'paragraph budget should preserve epic style allocation');
const skeletonGuide = buildPositiveDraftingSkeletonGuide({ narrativePurpose: '主功能=action_pressure；副功能=investigation', allowedBeats: '醒来；通讯失败；模块异常；撤离' });
assert.ok(skeletonGuide.includes('目标 → 动作 → 反馈 → 新选择'), 'positive drafting skeleton should emphasize action structure');
assert.ok(skeletonGuide.includes('句式问题只在密度高'), 'positive drafting skeleton should treat sentence issues as soft problems');
assert.ok(buildPositiveDraftingSkeletonGuide({ narrativePurpose: '主功能=investigation', allowedBeats: '检查铭牌编号07；读取协议；模块异常' }).includes('调查线索章专用'), 'investigation chapters should include dedicated clue-writing skeleton');
assert.ok(buildPositiveDraftingSkeletonGuide({ narrativePurpose: '主功能=investigation', allowedBeats: '检查铭牌编号07；读取协议；模块异常' }).includes('不要写成“不是A，而是B”'), 'investigation skeleton should discourage mechanical negation');

const povShiftIssues = findNaturalnessIssues('魏杰按住额角坐起来，阿米娅在门边催他快走。我低笑一声，把金属瓶塞进口袋。');
assert.ok(povShiftIssues.some((issue) => issue.type === 'pov-shift'), 'should detect first-person narration inside third-person chapter');
assert.equal(findNaturalnessIssues('魏杰按住额角坐起来。阿米娅说：“我去门口看看。”他点了点头。').some((issue) => issue.type === 'pov-shift'), false, 'should allow first-person pronouns inside dialogue');

const nounFragmentIssues = findNaturalnessIssues('然后有人拍门。手掌砸在门板上的闷响，连着三下。');
assert.ok(nounFragmentIssues.some((issue) => issue.type === 'noun-fragment-sentence'), 'should detect noun fragment sentence');

const isolatedLabelIssues = findNaturalnessIssues('暗门。\n\n魏杰蹲下去。\n\n没地方躲。');
assert.ok(isolatedLabelIssues.some((issue) => issue.type === 'isolated-label-sentence'), 'should detect isolated label sentence');
assert.ok(isolatedLabelIssues.some((issue) => issue.type === 'isolated-label-density'), 'should detect isolated label density');

const dialogueCard = { summary: '两人在审问中互相试探，争吵后达成临时交易。', allowedBeats: '审问、争吵、试探、谈判' };
assert.equal(isHighDialogueChapter(dialogueCard), true, 'should identify high-dialogue chapter cards');
assert.equal(isHighDialogueChapter({ narrativePurpose: '主功能=investigation；副功能=dialogue_conflict；对话密度=high，因为本章靠套话推进线索' }), true, 'should identify structured high-dialogue chapter cards');
const dialogueIssues = findDialogueIssues('他看着她。\n“说。”\n“我不知道。”\n他转身离开。', dialogueCard);
assert.ok(dialogueIssues.some((issue) => issue.type === 'dialogue-too-sparse'), 'should detect sparse dialogue in high-dialogue chapter');

const textureDialogue = getNarrativeTextureMode({ summary: '两人在审问中谈判并互相试探。', openingType: 'dialogue', allowedBeats: '审问、交易、争吵' });
assert.equal(textureDialogue.primary, 'dialogue_conflict');

const textureStructured = getNarrativeTextureMode({ narrativePurpose: '主功能=investigation；副功能=relationship；叙述质感=小说感70%，电影感30%；重点=物件线索、关系回避、记忆触发', allowedBeats: '调查旧档案；比对编号；姜禾回避；消毒水触发短记忆' });
assert.equal(textureStructured.primary, 'investigation');
assert.equal(textureStructured.secondary, 'relationship');
assert.equal(isHighDialogueChapter({ narrativePurpose: '对话密度：60%；主功能=investigation；副功能=relationship' }), true, 'should treat high dialogue percentage as high dialogue');

const textureAction = getNarrativeTextureMode({ summary: '主角在坍塌中撤离，被敌人追杀。', allowedBeats: '逃生、追逐、坍塌、撤离' });
assert.equal(textureAction.primary, 'action_pressure');

const markdownCard = `### 第1章 我不是来应聘博士的，我就是博士
**卷：** 第1卷 初入切尔诺伯格
**开头锚点：** 博士睁眼时听到医疗干员喊醒了。
**禁止开头：** 禁止时间打卡。
**章节功能：** 主功能=action_pressure；副功能=worldbuilding
**对话密度：** medium（身份确认对话）
**正文禁区：**
1. 禁止元说明
2. 禁止提前干部出场
**本章只允许：**
1. 醒来
2. 系统激活
**本章禁止：**
1. 禁止阿米娅出场
2. 禁止凯尔希出场
**读者预期：** 主角到底是谁？
**伏笔规划：** 新埋伏笔=上一个存档点无法定位
**摘要：** 魏杰醒来并确认博士身份。
**关键钩子：** 系统闪过存档点异常。
---`;
assert.equal(extractLabeledField(markdownCard, ['开头锚点'], ['禁止开头']), '博士睁眼时听到医疗干员喊醒了。');
assert.equal(extractLabeledField(markdownCard, ['本章禁止'], ['读者预期', '摘要']), '1. 禁止阿米娅出场\n2. 禁止凯尔希出场');
assert.equal(cleanCardFieldText('** 系统闪过存档点异常。\n---\n**'), '系统闪过存档点异常。');
const parsedCard = parseGeneratedChapterCardSection({ section: markdownCard, order: 1, plannedOpening: { openingType: 'dialogue', narrativeMode: 'linear', openingBan: '禁止时间打卡。' }, project: { volumes: [{ title: '第1卷 初入切尔诺伯格' }] } });
assert.equal(parsedCard.functionMode, '主功能=action_pressure；副功能=worldbuilding');
assert.equal(parsedCard.draftingBan, '1. 禁止元说明\n2. 禁止提前干部出场');
assert.equal(parsedCard.allowedBeats.includes('主功能=action_pressure'), false, 'parsed card should not merge writing-control fields into story beats');
const storyOnlyCard = parseGeneratedChapterCardSection({ section: `### 第2章 A7前的刀尖
卷：第一卷
蓝图阶段：切尔诺伯格撤离前段
本章目标：找到A7撤退点坐标。
核心事件：魏杰搜到罗德岛对讲机并遇到受伤的灰喉。
出场人物：魏杰、灰喉。
关键物件/线索：破损对讲机；A7坐标；“别信任”的残缺语音。
本章结果：灰喉认出他右眼疤痕不对，拒绝信任。
进度锁：只推进到首次遭遇灰喉。
本章只允许：搜到对讲机，确认A7坐标，遇到灰喉。
本章禁止：不正式组队，不解释博士真相。
读者预期：魏杰能不能拿到撤离方向。
上一章遗留动作：承接魏杰躲开巡逻队后的搜刮。
伏笔规划：新埋伏笔=博士身份与右眼疤。
本章爽点：获得撤离坐标和协同提示。
平台适配：番茄节奏，章末具体危机。
系统规则：系统只预判风险和解锁一次掩护射击。
摘要：魏杰躲开巡逻队后搜到破损对讲机，收到A7坐标和“别信任”的残缺语音；接近撤退点时遇到受伤灰喉，灰喉因他右眼疤痕不对而拒绝信任。
关键钩子：两支巡逻队从东西两侧靠近，预计四十秒后合围。`, order: 2, project: { volumes: [{ title: '第一卷' }] } });
assert.equal(storyOnlyCard.chapterGoal, '找到A7撤退点坐标。');
assert.ok(storyOnlyCard.coreEvent.includes('对讲机'));
assert.ok(storyOnlyCard.keyClue.includes('A7坐标'));
const humanGuide = buildHumanWritingModuleGuide({ project: { styleGuide: '幽默且具有史诗感', characters: [] }, automation: { authorPersona: '短促吐槽，废墟史诗感', chapterCards: [storyOnlyCard] }, card: storyOnlyCard, chapterNumber: 2 });
assert.ok(humanGuide.includes('真人写作模块'), 'human writing module guide should be available to generation prompts');
assert.ok(humanGuide.includes('旧章节卡里的写法字段只能当弱信号'), 'human writing module should demote old writing-control fields');
const patternLibrary = buildHumanWritingPatternLibrary({ title: '我在明日方舟搜打撤', genre: '同人', premise: '魏杰穿越成博士，获得搜打撤系统', styleGuide: '诙谐幽默，具有史诗感' });
assert.ok(patternLibrary.includes('已经发生的麻烦'), 'pattern library should encode human web-novel opening habit without negative-template wording');
assert.ok(patternLibrary.includes('同人味来自角色认知差'), 'pattern library should encode fanwork adaptation');
assert.ok(patternLibrary.includes('系统只给目标'), 'pattern library should encode system-story adaptation');
const voiceModel = buildCharacterVoiceModel({ title: '我在明日方舟搜打撤', premise: '魏杰穿越成博士', styleGuide: '诙谐幽默' });
assert.ok(voiceModel.includes('魏杰口吻模型'), 'should build a Wei Jie specific voice model');
assert.ok(voiceModel.includes('怕死'), 'Wei Jie voice model should preserve cowardly-but-clever texture');
const systemGuide = buildHumanWritingSystemGuide({ project: { title: '我在明日方舟搜打撤', genre: '同人', premise: '魏杰穿越成博士，获得搜打撤系统', styleGuide: '诙谐幽默，具有史诗感' }, automation: {}, card: storyOnlyCard, chapterNumber: 2, scope: '测试' });
assert.ok(systemGuide.includes('写作习惯优先'), 'system guide should prioritize writing habits over detection rules');
assert.ok(systemGuide.includes('以真人网文作者口吻创作'), 'system guide should include human web-novel readability guide');
assert.ok(systemGuide.includes('手写原创风格创作'), 'system guide should include anti-AI readability wording');
assert.ok(systemGuide.includes('发生什么'), 'system guide should keep chapter card as story-only input');
assert.ok(buildStyleResolverGuide({ title: '我在明日方舟搜打撤', genre: '同人', premise: '魏杰穿越成博士，获得搜打撤系统', styleGuide: '诙谐幽默，具有史诗感' }).includes('fanwork'), 'style resolver should infer fanwork mode');
assert.ok(buildVoiceRosterGuide({ project: { title: '我在明日方舟搜打撤', premise: '魏杰穿越成博士', characters: [{ name: '灰喉', role: '罗德岛狙击干员' }] }, card: storyOnlyCard }).includes('灰喉'), 'voice roster should include card characters');
const noisyCard = sanitizeChapterCardForHumanEngine({ summary: '魏杰醒来。\n第1章必须让真人写作引擎有空间运作的核心要素：写法说明不要进正文。', hook: '刀尖抵住喉咙。' }, 1);
assert.equal(noisyCard.summary, '魏杰醒来。', 'chapter card sanitizer should remove writing-engine instruction noise');
const noHookCard = parseGeneratedChapterCardSection({ section: `### 第8章 旧频道\n摘要：魏杰找到旧对讲机，听见残缺频道里有人提到博士，并因此改变路线。\n章末交付物：频道最后传出“别信任”的残句。\n读者预期：读者想知道频道那头是谁。`, order: 8, project: { volumes: [{ title: '第一卷' }] } });
assert.ok(noHookCard.hook.length >= 6, 'missing hook should be filled from ending delivery or expectation');
assert.ok(getAutomationReviewPause(['第7章自然感硬检测仍未通过，已保存清洗稿并暂停：逗号堆叠长句']), 'naturalness hard pause should stop frontend loop');
const fallbackRhythmPlan = buildFallbackRhythmPlan(noHookCard, 8);
assert.ok(validateChapterRhythmPlan(fallbackRhythmPlan).pass, 'fallback rhythm plan should be valid');
assert.ok(fallbackRhythmPlan.includes('承压段') && fallbackRhythmPlan.includes('缓冲段') && fallbackRhythmPlan.includes('钩子段'), 'rhythm plan should include varied paragraph types');
const parsedBeatPlan = parseNarrativeBeatPlan(`【叙事拍1】
名称：脚步逼近
目标：让魏杰先处理眼前危险
事件：魏杰贴住集装箱，听见左侧玻璃响
人物：魏杰
信息：有人靠近但身份不明
视角：魏杰
可见：集装箱内侧和脚边碎玻璃
可听：左侧玻璃响和脚步变近
可推测：有人绕过来
不可断言：不能断言鞋子材质和具体身份
句法预算：260-430字；否定判断0个
停点：他把呼吸压下去

【叙事拍2】
名称：频道杂音
目标：让线索打断行动
事件：对讲机发出残缺语音
人物：魏杰
信息：A7撤退点出现
视角：魏杰
可见：对讲机指示灯
可听：静电和残词
可推测：频道还活着
不可断言：不能解释频道来源
句法预算：260-430字；否定判断0个
停点：他改变路线`);
assert.equal(parsedBeatPlan.length, 2, 'narrative beat parser should parse beat sections');
assert.equal(validateNarrativeBeatPlan(parsedBeatPlan).pass, false, 'two beats should not pass full chapter beat validation');
const fallbackBeats = buildFallbackNarrativeBeatPlan(noHookCard, 8);
assert.ok(validateNarrativeBeatPlan(fallbackBeats).pass, 'fallback narrative beat plan should pass validation');
assert.ok(formatNarrativeBeatPlan(fallbackBeats).includes('不可断言'), 'formatted beat plan should include POV permission boundaries');
assert.ok(getBeatGateIssues('不是风声，是脚步。不是错觉，是有人靠近。不是一个人，是两道影子。', noHookCard).length >= 1, 'beat gate should catch local mechanical negation');
const auditoryIssues = findNaturalnessIssues('皮靴碾碎碎玻璃的声音从左边巷口传来，隔着一个集装箱的距离。');
assert.ok(auditoryIssues.some((issue) => issue.type === 'auditory-overclaim'), 'naturalness gate should catch auditory POV overclaim');
assert.ok(translateIssuesToRevisionActions(auditoryIssues).includes('看不见来源的声音'), 'issue labels should be translated into writing actions');
assert.equal(polishMechanicalDraftLocally('正文。\n\n【短导演令】\n不该进正文。'), '正文。', 'local polish should remove leaked director directives');
const directorContext = buildChapterDirectorContext({
  project: { title: '我在明日方舟搜打撤', premise: '魏杰穿越成博士，获得搜打撤系统', characters: [{ name: '灰喉', role: '罗德岛狙击干员' }] },
  card: noHookCard,
  chapterNumber: 8,
});
const directorText = formatChapterDirectorContext(directorContext);
assert.ok(directorText.includes('状态机') && directorText.includes('信息预算') && directorText.includes('人物认知账本'), 'director context should include state, information and knowledge layers');
const compactDirector = formatCompactDirectorDirective(directorContext);
assert.ok(compactDirector.includes('短导演令') && compactDirector.length < directorText.length, 'compact director directive should be shorter than full planning context');
assert.equal(polishMechanicalDraftLocally('“博士？——不对，你右眼没有那道疤。”'), '“博士？，你右眼没有那道疤。”', 'local polish should not inject project-specific identity rewrites');
assert.equal(polishMechanicalDraftLocally('内心只剩下一个念头：我活了三十年，现在要靠喝奶变强？'), '内心只剩下一个念头：我活了三十年，现在要靠喝奶变强？', 'local polish should preserve explicit first-person interior monologue');
assert.equal(findNaturalnessIssues('杜震宇盯着碗。内心只剩下一个念头：我活了三十年，现在要靠喝奶变强？').some((issue) => issue.type === 'pov-shift'), false, 'explicit interior monologue should not be POV shift');
assert.equal(findNaturalnessIssues('她想张嘴反驳。想告诉她，我叫杜蓁蓁，上辈子活了二十多年。').some((issue) => issue.type === 'pov-shift'), false, 'interior monologue introduced by wanting to tell should not be POV shift');
assert.equal(findNaturalnessIssues('杜震宇盯着碗。他看了一眼门口。我走到门口，看见天黑了。').some((issue) => issue.type === 'pov-shift'), true, 'unmarked narrator first-person should still be POV shift');
assert.equal(classifyDashFunction('她伸出手——那只手小得像莲藕节。'), 'light_detail', 'light dash detail should be classified');
assert.equal(classifyDashFunction('“你先别——”门被踹开。'), 'dialogue_cut', 'dialogue interruption dash should be preserved');
assert.equal(classifyDashFunction('系统响了——这是绑定完成的提示。'), 'explanation', 'explanation dash should be classified');
assert.equal(normalizeDashUsage('她伸出手——那只手小得像莲藕节。'), '她伸出手，那只手小得像莲藕节。', 'light dash detail should merge into sentence');
assert.equal(normalizeDashUsage('【任务完成——奖励发放】'), '【任务完成：奖励发放】', 'system dash should become field separator');
assert.equal(normalizeDashUsage('“你先别——”门被踹开。'), '“你先别——”门被踹开。', 'dialogue cut dash should remain');
const infantPerceptionScope = buildPerceptionScope({ project: { premise: '转生成女婴，嘴里塞着脚，被倒拎着' }, card: { summary: '女婴醒来后发现自己被倒拎着，魔法少女系统绑定。', cast: '杜蓁蓁、魔法少女系统、师姐六、师姐七' }, chapterNumber: 1 });
assert.ok(formatPerceptionScopeForPrompt(infantPerceptionScope).includes('感知准入规则'), 'perception scope should be formatted for generation prompts');
const floatingCameraText = '嘴里塞着什么东西，软软的，还有点咸。她用力一吸，那东西往喉咙里又深了一点，猛地清醒过来，发现自己的脚正卡在嘴里，整个身体被悬空拎着。\n\n视野倒转。\n\n粉色的襁褓布垂下来，头顶是灰白的石质天花板。她蹬了蹬另一条腿，够不到任何东西。';
const perceptionIssues = findPerceptionIssues(floatingCameraText, infantPerceptionScope);
assert.ok(perceptionIssues.some((issue) => issue.type === 'camera-like-description'), 'perception gate should catch floating camera description');
assert.ok(perceptionIssues.some((issue) => issue.type === 'missing-cognition-verb'), 'perception gate should catch missing discovery verb after body action');
const groundedPerception = repairPerceptionLocally(floatingCameraText, infantPerceptionScope);
assert.ok(groundedPerception.includes('才意识到不是屋顶歪了'), 'perception repair should ground inverted vision in character cognition');
assert.ok(groundedPerception.includes('她费力转动眼珠'), 'perception repair should add a visible perception anchor');
assert.ok(groundedPerception.includes('这才发现脚尖连床沿都碰不到'), 'perception repair should connect action to cognition');
assert.equal(applyPerceptionGate(floatingCameraText, infantPerceptionScope).issues.length >= 2, true, 'perception gate should report repaired issues');
const staccatoOpening = '脸贴着冰凉。\n\n她被一记撞击声吵醒。像有什么东西砸在木头上。\n\n睁开眼。左半张脸压着湿冷的触感，鼻子里灌进一股枯草和泥土的气味。\n\n雪。脸颊下面是雪。雪化成水渗进布料，贴着皮肤，凉得她一个激灵。';
const rhythmIssues = findRhythmIssues(staccatoOpening);
assert.ok(rhythmIssues.some((issue) => issue.type === 'staccato-opening'), 'rhythm gate should catch staccato opening chains');
assert.ok(rhythmIssues.some((issue) => issue.type === 'isolated-sensation-fragment'), 'rhythm gate should catch isolated sensation fragments');
const repairedRhythm = repairRhythmLocally(staccatoOpening);
assert.ok(repairedRhythm.includes('脸颊贴着冰凉时'), 'rhythm repair should merge opening sensation into experience chain');
assert.ok(repairedRhythm.includes('她这才意识到脸颊下面压着的是雪'), 'rhythm repair should merge noun fragments into cognition chain');
assert.ok(!repairedRhythm.includes('雪。脸颊下面是雪。'), 'rhythm repair should remove repeated noun fragments');
assert.equal(repairRhythmLocally('她僵住了。\n\n手指停下了。'), '她僵在原地，刚抬起的手指也停在半空。', 'rhythm repair should merge action fragments');
assert.equal(repairRhythmLocally('不是脂粉香，像是草药混着雪化后的干净水汽。'), '那气味没有脂粉的甜腻，更像草药混着雪化后的干净水汽。', 'rhythm repair should turn negative reveal into positive evidence');
assert.equal(applyRhythmGate(staccatoOpening).issues.length >= 2, true, 'rhythm gate should report repaired rhythm issues');
assert.ok(findRhythmIssues('睁眼，一片模糊的暗红。\n\n风灌进来。冷，皮肤一阵阵发紧。\n\n不止冷，还有气味。').some((issue) => issue.type === 'staccato-opening'), 'rhythm gate should catch verb-fragment openings from generated drafts');
assert.ok(repairRhythmLocally('不止冷，还有气味。腐土腥甜，像铁锈，还有别的臭，烂肉和排泄物混在一起的味道。身体躺的地方不对，这不是产房，不是医院。').includes('冷意之外，腐土和铁锈似的腥甜气味也钻进鼻腔'), 'rhythm repair should merge cold and smell fragments into sensory chain');
assert.ok(repairRhythmLocally('我使劲撑地想爬起来。').startsWith('她使劲撑地'), 'rhythm repair should restore third-person action narration');
assert.ok(repairRhythmLocally('眼皮沉得睁不开，我挣扎了好一会儿才掀开一条缝。').includes('她挣扎了好一会儿'), 'rhythm repair should restore first-person narration after comma');
assert.ok(repairRhythmLocally('几粒灰从梁上簌簌落下来，落在我脸上。').includes('落在她脸上'), 'rhythm repair should restore first-person object references');
const sensoryFragments = '她抬手。手指软得像没有骨头。五指分不开。整只手像一只肉球。';
assert.ok(findRhythmIssues(sensoryFragments).some((issue) => issue.type === 'sensory-fragment-chain'), 'rhythm gate should catch consecutive sensory fragment chains');
assert.equal(repairRhythmLocally(sensoryFragments), '她抬起手，手指软得像没有骨头，五指也分不开，整只手像一只粉红色的肉球。', 'rhythm repair should join sensory fragments with commas');
const allowedShortBeats = '脚步声停了。\n\n她屏住呼吸。\n\n哭声断了。';
assert.equal(findRhythmIssues(allowedShortBeats).some((issue) => issue.type === 'sensory-fragment-chain' || issue.type === 'isolated-sensation-fragment'), false, 'rhythm gate should preserve allowed emphasis short sentences');
const rhythmContractCompiled = { chapterIntent: { goal: '女婴醒来并绑定系统', mainEvent: '醒来、身体错位、系统绑定' }, executionPack: { informationBudget: { explicit: '只明确身体限制和一个系统变化' } } };
const infantBodyContract = buildSceneRhythmContract({ scenePack: { title: '觉醒与错位', goal: '醒来，发现女婴身体限制' }, compiled: rhythmContractCompiled, card: { summary: '女婴醒来后发现身体无法控制，系统绑定。' } });
assert.ok(formatSceneRhythmContract(infantBodyContract).includes('身体尝试打包'), 'scene rhythm contract should pre-plan body limitation packaging');
assert.ok(formatSceneRhythmContract(infantBodyContract).includes('禁止连续'), 'scene rhythm contract should prevent repeated attempt-failure templates before generation');
const spiritRootContract = buildSceneRhythmContract({ scenePack: { title: '杂灵根揭底', goal: '灵根检测结果公布' }, compiled: rhythmContractCompiled, card: { summary: '检测出杂灵根，众人议论，主角理解处境。' } });
assert.ok(formatSceneRhythmContract(spiritRootContract).includes('重大信息反应桥'), 'scene rhythm contract should pre-plan key information digestion');
assert.ok(formatSceneRhythmContract(spiritRootContract).includes('杂灵根'), 'scene rhythm contract should name the key information to digest');
const sentencePatterns = buildSentencePatternLibrary({ project: { genre: '修仙 系统' }, card: { summary: '女婴醒来，系统绑定，巨兽逼近' }, scenePack: { title: '醒来 + 巨兽逼近' } });
assert.ok(sentencePatterns.perception.some((line) => line.includes('火把摇晃着暗红色火光')), 'sentence pattern library should provide canonical sensory syntax');
const syntaxContract = buildSyntaxContract({ scenePack: { title: '醒来 + 巨兽逼近', goal: '女婴醒来并发现危险' }, card: { summary: '祭坛火把、巨兽前爪拍近。' }, perceptionScope: infantPerceptionScope, rhythmContract: infantBodyContract });
assert.ok(formatSyntaxContract(syntaxContract).includes('主体 → 动作/状态 → 结果/感知'), 'syntax contract should enforce canonical word order before generation');
assert.ok(formatSyntaxContract(syntaxContract).includes('火把摇晃着暗红色火光'), 'syntax contract should include concrete corrected examples');
assert.ok(formatSceneRhythmContract(infantBodyContract).includes('现场证据 → 人物辨认/意识到 → 行动改变'), 'scene rhythm contract should pre-plan evidence-first reveals');
assert.ok(formatSyntaxContract(syntaxContract).includes('禁止“名词。是名词。”'), 'syntax contract should prevent fragmented identification before generation');
const detailBudget = buildDetailBudgetContract({ scenePack: { title: '巨兽逼近', goal: '祭坛震动，巨兽伸爪，主角逃离' }, card: { summary: '巨兽从裂缝出现，追击主角。' } });
assert.ok(formatDetailBudgetContract(detailBudget).includes('1个主动作'), 'detail budget contract should cap sentence load before generation');
assert.ok(findSyntaxIssues('火光摇晃的暗红色，火把。').some((issue) => issue.type === 'inverted-sensory-apposition'), 'syntax gate should catch inverted sensory apposition');
assert.equal(repairSyntaxLocally('火光摇晃的暗红色，火把。'), '火把摇晃着暗红色火光。', 'syntax gate should restore canonical sensory syntax');
assert.equal(repairSyntaxLocally('巨兽的前爪拍到她面前，距离不到一臂。'), '巨兽的前爪拍在她面前不到一臂的地方。', 'syntax gate should absorb distance afterthought into canonical phrase');
assert.ok(findSyntaxIssues('雪。是雪。').some((issue) => issue.type === 'fragmented-identification'), 'syntax gate should catch fragmented identification');
assert.equal(repairSyntaxLocally('雪。是雪。'), '眼角余光里大片白色被风卷着贴上脸颊，她这才意识到自己半张脸都埋在雪里。', 'syntax gate should rewrite fragmented identification into perception recognition');
assert.equal(repairRhythmLocally('不是风声，是脚步声。'), '风声里混进了细碎的脚步声。', 'rhythm repair should rewrite negative reveal into evidence-first reveal');
assert.ok(formatSceneRhythmContract(infantBodyContract).includes('禁止用“不是A，是B'), 'scene rhythm contract should prevent negative reveal before generation');
assert.equal(applySyntaxGate('火光摇晃的暗红色，火把。').issues.length, 1, 'syntax gate should report repaired syntax issues');
const continuityLedger = buildSceneContinuityLedger({ previousText: '火光从上方照下来。脚步声停在她头顶不到一巴掌远的地方。女人把她压在身下。', scenePack: { title: '手伸过来' }, card: {} });
assert.ok(formatSceneContinuityLedger(continuityLedger).includes('当前光源'), 'continuity ledger should summarize scene state before generation');
assert.ok(formatSceneContinuityLedger(continuityLedger).includes('不得突然写月光'), 'continuity ledger should prevent light-source contradictions');
const repetitionLedger = buildRepetitionLedger({ previousText: '脚步声停了。系统提示保持安静。她不能动。' });
assert.ok(formatRepetitionLedger(repetitionLedger).includes('脚步声已停'), 'repetition ledger should record already expressed danger beats');
assert.ok(formatRepetitionLedger(repetitionLedger).includes('不能再写“停了”'), 'repetition ledger should force escalation instead of repetition');
const helperLedger = buildSceneContinuityLedger({ previousText: '有人扶着她的后颈喂药。门外少女小声问：“啾啾师姐？”她说去重新煎一碗。' });
assert.ok(formatSceneContinuityLedger(helperLedger).includes('在场/近场人物'), 'continuity ledger should track helper presence');
assert.ok(formatSceneContinuityLedger(helperLedger).includes('如果后续场景仍受她影响'), 'continuity ledger should conditionally require helper handoff');
assert.ok(formatSceneContinuityLedger(helperLedger).includes('可不额外报备'), 'continuity ledger should avoid absolute bookkeeping for irrelevant helpers');
const interiorContract = buildInteriorMonologueContract({ card: { summary: '女婴转生，系统吐槽，主角慌乱' }, scenePack: { title: '系统警告' } });
assert.ok(formatInteriorMonologueContract(interiorContract).includes('内心独白只承担情绪反应'), 'interior monologue contract should prevent exposition transfer into thoughts');
assert.ok(formatInteriorMonologueContract(interiorContract).includes('不得在心声里使用“不是A，是B”'), 'interior monologue contract should block negative reveal in thoughts');
assert.ok(findInteriorMonologueIssues('她脑子里冒出一句：我他妈刚才不是被卡车创死了吗？这不是重生吗？').some((issue) => issue.type === 'interior-negative-reveal'), 'interior gate should catch negative reveal moved into thoughts');
assert.equal(repairInteriorMonologueLocally('她脑子里冒出一句：我他妈刚才不是被卡车创死了吗？这不是重生吗？'), '她脑子里乱成一团，骂人的念头还没成形，身体已经先一步失控。', 'interior gate should replace exposition-heavy thought with short emotional reaction');
const systemMessageContract = buildSystemMessageContract({ project: { premise: '魔法少女系统，性格像雌小鬼' }, scenePack: { title: '系统登场' } });
assert.ok(formatSystemMessageContract(systemMessageContract).includes('系统提示超过2项必须分行'), 'system message contract should require multi-line system panels');
assert.ok(formatSystemMessageContract(systemMessageContract).includes('雌小鬼'), 'system message contract should preserve system personality');
assert.ok(repairSystemMessageLocally('“滴。宿主意识确认。检测完成。身体绑定成功。当前世界定位：修真大陆。当前身体状态：新生儿。当前场景危险等级：三级。妖兽正在接近，预估到达时间：三百秒后。”').includes('\n'), 'system message repair should split long system panels into lines');
const fidelityContract = buildInspirationFidelityContract({ project: { premise: '杜震宇为了救人被卡车创死，转生成修仙世界的一个女婴身上，获得魔法少女系统（系统性格拟人化，类似于雌小鬼），通过自己的努力，奋斗和系统从草根逆袭到最强。文风搞笑、日常、热血，小说类型修仙、百合。', genre: '修仙 百合 系统 搞笑 日常 热血' }, card: { summary: '第一章转生女婴并绑定系统。' } });
assert.ok(formatInspirationFidelityContract(fidelityContract).includes('救人被卡车创死'), 'inspiration contract should preserve original inciting incident');
assert.ok(formatInspirationFidelityContract(fidelityContract).includes('不得改成灭门'), 'inspiration contract should forbid drifting to unrelated openings');
const genrePromise = buildGenrePromiseContract({ project: { premise: '杜震宇为了救人被卡车创死，转生成修仙世界的一个将死的萝莉身上，获得魔法少女系统（系统性格拟人化，类似于雌小鬼），通过自己的努力，奋斗和系统从草根逆袭到最强。文风搞笑、日常、热血，小说类型修仙、百合文，废萌', genre: '修仙 百合 系统 搞笑 日常 热血 废萌' } });
assert.ok(formatGenrePromiseContract(genrePromise).includes('修仙：境界'), 'genre promise should assign responsibilities to genre tags');
assert.ok(formatGenrePromiseContract(genrePromise).includes('废萌'), 'genre promise should preserve moe tone responsibility');
const openingHook = buildOpeningHookContract({ project: { premise: genrePromise.source }, card: { summary: '第一章转生成将死萝莉并绑定系统。' }, chapterNumber: 1 });
assert.ok(formatOpeningHookContract(openingHook).includes('强错位'), 'opening hook should choose a strong mismatch opening for chapter one');
const chapterFunction = buildChapterFunctionContract({ card: { summary: '第一章转生成将死萝莉并绑定系统。' }, chapterNumber: 1 });
assert.ok(formatChapterFunctionContract(chapterFunction).includes('立人设'), 'chapter function should define why the chapter exists');
const worldBudget = buildWorldExposureBudgetContract({ card: { summary: '第一章转生成修仙世界，系统绑定。' }, chapterNumber: 1 });
assert.ok(formatWorldExposureBudgetContract(worldBudget).includes('最多释放1个世界规则'), 'world exposure budget should limit exposition before drafting');
const detailSelection = buildDetailSelectionContract({ scenePack: { title: '将死萝莉醒来', goal: '确认破屋、身体濒死、系统绑定' }, card: { summary: '主角在破屋中醒来，身体濒死。' }, chapterNumber: 1 });
assert.ok(formatDetailSelectionContract(detailSelection).includes('最多允许'), 'detail selection should limit detail count before drafting');
assert.ok(formatDetailSelectionContract(detailSelection).includes('禁写'), 'detail selection should explicitly forbid low-function detail lists');
const environmentScan = '发黄的木头房梁横在视野上方。椽子露在外面，布满灰尘。蛛网从墙角垂下来，轻轻晃着。光线极暗，只一扇巴掌大的窗户透进来灰白色的光，勉强照亮一小片空间。霉味混着一股酸臭钻进鼻腔，那是很久没洗澡的人身上才会有的味道。胸口的刺痛随着每次呼吸拉扯着肺叶。';
assert.ok(findEnvironmentScanIssues(environmentScan).some((issue) => issue.type === 'opening-detail-overload'), 'environment scan gate should catch overloaded opening detail scans');
assert.equal(repairEnvironmentScanLocally(environmentScan), '她费力撑开眼，只看见发黄的房梁和一点灰白窗光。霉味混着酸臭钻进鼻腔，刚吸进去半口，胸口的刺痛就把肺叶扯住。', 'environment scan repair should compress static details into action-linked details');
assert.equal(applyEnvironmentScanGate(environmentScan).issues.length >= 1, true, 'environment scan gate should report repaired scan issues');
const dialoguePurpose = buildDialoguePurposeContract({ card: { summary: '系统和主角互相吐槽，主角求救。', cast: '杜蓁蓁、魔法少女系统' }, scenePack: { title: '系统登场 + 求救' } });
assert.ok(formatDialoguePurposeContract(dialoguePurpose).includes('系统每次说话必须'), 'dialogue purpose should make system dialogue action-changing');
const dialogueContract = buildDialogueDensityContract({ card: { summary: '系统和主角互相吐槽，主角求救。', cast: '杜蓁蓁、魔法少女系统' }, scenePack: { title: '系统登场 + 求救' } });
assert.ok(formatDialogueDensityContract(dialogueContract).includes('至少2轮'), 'dialogue contract should require enough dialogue in dialogue-heavy packs');
const dialogueNaturalnessIssues = findDialogueIssues(`“快。”
她停了一下，没立刻接话。
“行。”
他看向门禁槽。
“所以。”
她避开他的视线。
“别看背面。别补签。”
他把卡片扣回桌上。
“你们先往门口退，我来关维护气闸。”
她低头确认伤员位置。
“可以，但只够撑十秒。”
他咽回后半句话。
“先把线固定住，碎布和门禁片都别碰。”
她没回答，只把手套递过去。`, { summary: '两人对峙并交换情报。' });
assert.ok(dialogueNaturalnessIssues.some((issue) => issue.type === 'dialogue-fragment-command'), 'dialogue gate should catch fragment commands');
assert.ok(dialogueNaturalnessIssues.some((issue) => issue.type === 'dialogue-bare-status'), 'dialogue gate should catch bare status replies');
assert.ok(dialogueNaturalnessIssues.some((issue) => issue.type === 'dialogue-orphan-connector'), 'dialogue gate should catch orphaned connectors');
assert.ok(dialogueNaturalnessIssues.some((issue) => issue.type === 'dialogue-negative-command-chain'), 'dialogue gate should catch negative command chains');
assert.ok(translateIssuesToRevisionActions(dialogueNaturalnessIssues).includes('半截命令补对象'), 'dialogue issues should translate to concrete revision actions');
assert.notEqual(classifyNaturalnessIssues(dialogueNaturalnessIssues.filter((issue) => ['dialogue-fragment-command', 'dialogue-bare-status', 'dialogue-orphan-connector'].includes(issue.type)), '高对话样本文本'), 'heavy', 'soft dialogue micro-issues alone should not force heavy rewrite');
assert.equal(findDialogueIssues(`“别看”
他把卡片扣住。
“行。”
她伸手去摸门锁。
“现在。”
他停了一下。
“别回门。”
她看向侧廊。`, { summary: '主角撤离旧门禁区域。' }).length, 0, 'dialogue gate should not hard-repair normal short replies outside high-dialogue chapters');
assert.equal(findDialogueIssues('“行。”\n他点头。', { summary: '普通动作段。' }).length, 0, 'dialogue gate should ignore tiny dialogue samples');
assert.ok(buildInformationBudget(noHookCard).repeatAvoidance.includes('不要再用对话完整解释'), 'information budget should prevent repeated dialogue exposition');
assert.ok(buildCharacterKnowledgeLedger({ project: { premise: '魏杰穿越成博士' }, card: { cast: '魏杰、灰喉、系统', summary: '灰喉怀疑魏杰' } }).some((line) => line.includes('误会')), 'knowledge ledger should track character misunderstandings');
assert.ok(buildActionCausalityChain(noHookCard).every((line) => line.includes('下一步')), 'action chain should force causal transitions');
assert.ok(formatAiUsageReport({ calls: 2, promptTokens: 100, completionTokens: 30, totalTokens: 130 }).includes('总tokens：130'), 'AI usage report should include token totals');
const compiledChapter = compileChapterForGeneration({
  project: { title: '转生成女婴后，魔法少女系统逼我修仙', genre: '修仙 百合 系统', premise: '杜震宇转生成女婴，获得魔法少女系统', styleGuide: '搞笑 日常 热血' },
  automation: {},
  card: {
    title: '第1章 她死了',
    chapterGoal: '杜震宇救人后死亡，转生成修仙世界女婴并绑定魔法少女系统',
    coreEvent: '死亡、转生、系统绑定',
    cast: '杜震宇、魔法少女系统、接生婆、母亲',
    keyClue: '雌小鬼式系统短讯',
    chapterResult: '主角意识到自己成了女婴，系统要求她活下去',
    hook: '系统弹出第一个任务',
    systemRule: '系统只给短讯、嘲讽、限制和奖励',
  },
  chapterNumber: 1,
});
assert.ok(compiledChapter.chapterIntent.goal.includes('杜震宇'), 'chapter compiler should structure chapter intent');
assert.equal(routeGenerationMode(compiledChapter), 'quality', 'first chapter with system identity conflict should use quality mode');
const humanPlan = directHumanWriting({ project: { genre: '修仙 百合 系统', premise: '转生成女婴，魔法少女系统', styleGuide: '搞笑 日常 热血 雌小鬼' }, compiled: compiledChapter, card: { summary: '女婴绑定魔法少女系统' }, chapterNumber: 1 });
assert.ok(humanPlan.selectedStrategies.systemMove.includes('嘴欠'), 'human writing director should choose system-story strategy');
const scenePacks = buildScenePacks({ compiled: compiledChapter, beats: buildFallbackNarrativeBeatPlan({ chapterGoal: '死亡转生', keyClue: '系统绑定', chapterResult: '第一个任务', hook: '任务弹出' }, 1) });
assert.ok(scenePacks.length <= 3 && scenePacks[0].targetWords.includes('700'), 'scene pack generator should use fewer larger scene packs');
assert.ok(formatCompiledPackForDraft({ compiled: compiledChapter, strategy: humanPlan.selectedStrategies, scenePack: scenePacks[0] }).includes('场景包1'), 'scene pack prompt should be small and current-pack focused');
const usefulLongCardSummary = '魏杰在系统预判警报帮助下，躲开第一支整合运动巡逻队，潜行至一处民用防空洞。搜刮中获得破损的罗德岛制式对讲机，通过加密频道收到A7撤退点坐标确认信号，但静电中隐约听到“博士……别……信任……”的碎片语音。他在接近A7途中发现一名受伤的罗德岛近卫干员灰喉，系统弹出“首次战术协同”提示并解锁“掩护射击”指令。';
assert.ok(isUsefulCardSummary(usefulLongCardSummary), 'long but concrete chapter-card summaries should be accepted');
assert.ok(resolveStoredChapterSummary({ summary: usefulLongCardSummary }, '坏正文').startsWith('魏杰在系统预判警报帮助下'), 'stored summary should prefer valid card summary');
assert.equal(findNaturalnessIssues('灰喉盯着他说：“你不是博士。”\n魏杰举起双手：“我不是故意的。”\n绿毛虫说：“本虫不是战斗型。”').some((issue) => issue.type === 'plain-negative-density'), false, 'natural dialogue negation should not trigger density');
const userChapterIssues = findNaturalnessIssues(`对讲机在腰间震了一下。

极短的沙沙声，像有人往频道里吹了口气。

魏杰没管——集装箱外，皮靴碾过碎玻璃的声音往东南方向移了七八米，停了。

【预判警报：敌方单位距集装箱3.2米，移动方向SE，预计离开警戒范围还需17秒。】

他扶着集装箱壁往外探了一眼——巷子空了。两个红色三角已经移出视野边缘，只剩一根被炸弯的钢筋还在风里晃。

不是他的。他浑身摸了一遍，连个蹭破皮的地方都没找到。

灰喉盯着他右眼角。

“你不是博士——你是谁的棋子？”`);
assert.notEqual(classifyNaturalnessIssues(userChapterIssues, userChapterIssues.map((issue) => issue.text).join('\n')), 'heavy', 'normal action/suspense chapter should not be a hard naturalness failure');
const negativeExplainIssues = findNaturalnessIssues('它不再是剧情节点，也不是玩家嘴里一句“刀了”。它变成了一条旧留言，一块金属牌，一个被反复避开的交接备注，安静地躺在废墟深处。');
assert.ok(negativeExplainIssues.some((issue) => issue.type === 'negative-negative-explain'), 'naturalness gate should catch negative-negative-explain sentence shape');
assert.ok(negativeExplainIssues.some((issue) => issue.type === 'triple-noun-enumeration'), 'naturalness gate should catch triple noun enumeration');
const negativeExplainActions = translateIssuesToRevisionActions(negativeExplainIssues);
assert.ok(negativeExplainActions.includes('否定、否定、再解释'), 'negative-negative issues should translate to concrete revision action');
assert.ok(negativeExplainActions.includes('三项名词排比'), 'triple noun enumeration should translate to concrete revision action');
assert.equal(findNaturalnessIssues('他摸到一条裂开的识别带，立刻停住手。').some((issue) => issue.type === 'triple-noun-enumeration'), false, 'single concrete noun detail should not trigger triple enumeration');
assert.doesNotThrow(() => assertEnoughChapterCards({ automation: { chapterCards: [{}, {}, {}] }, startChapter: 2, batchCount: 2 }));
assert.throws(() => assertEnoughChapterCards({ automation: { chapterCards: [{}] }, startChapter: 1, batchCount: 2 }), /章节卡不足/);

console.log('parser tests passed');
