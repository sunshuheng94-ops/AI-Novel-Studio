export const platformModeLabels = {
  fanqie: '番茄',
  qidian: '起点',
  ciweimao: '刺猬猫',
};

export function buildCommercialSerialGuide(scope = 'general') {
  const base = [
    '商业连载校准（服务故事结构，不要在正文中明说）：',
    '1. 主线优先理解为主角行动线：读者要看见主角为什么必须行动、做出什么选择、选择怎样改变局面。',
    '2. 每个阶段都要兑现题材承诺：爽点可以是资源、线索、能力熟练度、关系变化、地位认可、喘息窗口、误会解除或反差收益，不必每章大战，但不能长期只有铺垫。',
    '3. 金手指、系统、天赋或原作认知必须改变主角解决问题的方式；如果只提供提示、名词或解释，就要让它尽快转成行动方案、战斗优势、搜刮路线、关系筹码或撤离窗口。',
    '4. 线索不要连续滚成新线索：优先在3-5章内转化为行动、资源、选择、反制、阶段答案或新的明确目标。',
    '5. 反套路不能反爽点；可以克制、日常、悬疑或慢热，但读者仍要周期性获得成长、反馈、认可、解决问题或期待升级。',
  ];
  if (scope === 'chapter-card') {
    return [
      ...base,
      '章节卡落地要求：章节卡不是事件清单。每章优先明确：主角为什么必须行动、主角做出什么选择、这个选择改变了什么、本章给读者什么小收获。',
      '现有字段含义必须写实：读者预期=读者打开本章最想看到什么被回应；本章爽点=读者本章拿到的明确反馈；主角主动选择=主角亲自决定怎么做；主角拿回的主动权=局面因主角发生的变化；本章小收获=资源、线索、关系、能力、地位、喘息、误会解除或下一步准备。',
      '允许修整章和日常章，但也要有生活小目标、关系变化、资源整理、误会解除、能力熟练度或下一步准备；不要连续多章只新增线索、只验证物件、只被动挨压。',
    ].join('\n');
  }
  if (scope === 'checkpoint') {
    return [
      ...base,
      '检查点诊断要求：检查最近章节是否持续兑现题材承诺。重点看主角行动力、金手指解法、爽点/收获密度、线索兑现、读者期待回应和平台口味。若发现问题，请给后续3-5章可直接写入章节卡的修正方向，不要泛泛建议。',
    ].join('\n');
  }
  if (scope === 'blueprint') {
    return [
      ...base,
      '蓝图落地要求：不要输出写作理论，要输出具体规划。必须明确题材承诺、主角需求缺口、金手指/能力解法、前3万字核心看点、每卷爽点循环、平台适配边界和阶段兑现节奏。',
    ].join('\n');
  }
  return base.join('\n');
}

export function buildPlatformStrategyGuideText({ project = {}, automation = {}, strategy = {}, normalizeText = defaultNormalizeText } = {}) {
  const platformText = [project.title, project.genre, project.premise, project.summary, project.targetAudience, project.styleGuide, automation.inspiration, automation.masterPlan]
    .map(normalizeText)
    .join('\n');
  const isFanFiction = /同人|原作|综漫|二创|明日方舟|宝可梦|方舟|博士|罗德岛|泰拉|拉鲁拉斯|新叶喵/.test(platformText);
  const isAnimeOriginal = /二次元|轻小说|宅|美少女|萌|日常|魔法少女|校园|异世界/.test(platformText);
  return [
    '平台策略（影响章节卡、正文、审校，不要在正文中明说）：',
    `主平台口味：${platformModeLabels[strategy.primary] || strategy.primary}`,
    `阅读节奏适配：${platformModeLabels[strategy.pace] || strategy.pace}`,
    `长篇结构约束：${platformModeLabels[strategy.structure] || strategy.structure}`,
    `发布目标：${platformModeLabels[strategy.publishTarget] || strategy.publishTarget}`,
    strategy.tags?.length ? `题材标签：${strategy.tags.join(' / ')}` : '',
    strategy.primary === 'ciweimao' ? '刺猬猫基础口味：重视二次元气质、角色互动、宅味反差和明确厨力；梗必须服务剧情，不能压扁人物和主线。' : '',
    strategy.primary === 'ciweimao' && isFanFiction ? '刺猬猫同人适配：优先兑现原作角色交互、遗憾推进、名场面变体和角色还原；主角可以改变局面，但不要把原作人气角色写成只会衬托主角的工具人。' : '',
    strategy.primary === 'ciweimao' && !isFanFiction && isAnimeOriginal ? '刺猬猫二次元原创适配：角色要有功能性和互动幻想，萌点、反差、关系推进要转化为剧情选择或阶段收益，不只停留在外貌标签。' : '',
    strategy.primary === 'fanqie' || strategy.pace === 'fanqie' ? '番茄节奏：开头快、冲突早、目标明确、每章有结果或奖励感，章末钩子要具体。前期尽快展示核心卖点，主角不要长期只被动挨压；节奏快不等于碎句多，普通信息仍要自然承接，避免把“解释少”写成缺词、短句链或分镜标签。' : '',
    strategy.structure === 'qidian' ? '起点结构：体系自洽、能力有代价、反派梯度清楚、伏笔可长线但必须阶段推进，升级和权力边界要可追踪，禁止临时外挂。' : '',
  ].filter(Boolean).join('\n');
}

function defaultNormalizeText(value = '') {
  return typeof value === 'string' ? value : String(value ?? '');
}
