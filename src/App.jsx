import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Bot, GitBranch, Keyboard, Megaphone, Plus, Save, ShieldAlert, Sparkles, Trash2, Users } from 'lucide-react';
import Live2DAssistant from './Live2DAssistant';
import { useApiClient } from './hooks/useApiClient';

const defaultProjectForm = {
  title: '',
  genre: '女频 / 都市',
  premise: '',
  targetAudience: '',
  styleGuide: '',
};

const defaultAuthForm = {
  username: '',
  password: '',
  displayName: '',
};

const defaultAiConfig = {
  apiKey: '',
  model: 'deepseek-v4-flash',
  baseUrl: 'https://api.deepseek.com',
  activeProfile: 'deepseek',
  modelRouting: 'mixed',
  profiles: {
    deepseek: { label: 'DeepSeek', apiKey: '', model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com' },
    gpt55: { label: 'GPT-5.5 中转站', apiKey: '', model: 'gpt-5.5', baseUrl: '' },
  },
};

const assistantStateLabels = {
  default: '默认',
  haoqi: '好奇',
  qizi: '待机',
  zhentou: '点头',
  linghun: '灵魂',
  yaotou: '摇头',
  keshui: '瞌睡',
  scene1: '动作1',
};

const defaultCharacter = {
  name: '',
  role: '',
  goal: '',
  secret: '',
  traits: '',
  arc: '',
};

const defaultRelation = {
  from: '',
  to: '',
  type: '',
  detail: '',
};

const defaultTimelineEvent = {
  title: '',
  phase: '',
  impact: '',
  order: 1,
};

const defaultVolume = {
  title: '',
  positioning: '',
  goal: '',
  endingHook: '',
};

const openingTypeOptions = [
  { value: 'conflict', label: '冲突切入' },
  { value: 'action', label: '动作切入' },
  { value: 'dialogue', label: '对话切入' },
  { value: 'result', label: '结果切入' },
  { value: 'object', label: '物件切入' },
  { value: 'sensory', label: '感官切入' },
  { value: 'inner', label: '内心切入' },
  { value: 'scene', label: '场景切入' },
  { value: 'time', label: '时间切入' },
];

const narrativeModeOptions = [
  { value: 'linear', label: '顺叙' },
  { value: 'flashback', label: '插叙' },
  { value: 'reverse', label: '倒叙' },
  { value: 'parallel', label: '并行' },
  { value: 'fragment', label: '碎片回忆' },
  { value: 'delayed', label: '延迟交代' },
  { value: 'misdirection', label: '误导式' },
];

const openingTypeCycle = ['conflict', 'action', 'dialogue', 'object', 'sensory', 'result', 'inner', 'action', 'object', 'result'];

function createDefaultChapterCardControl(order) {
  return {
    functionMode: '主功能=transition_setup；副功能=无',
    dialogueDensity: 'medium（按本章冲突自然安排对话，不强行解释设定）',
    texturePlan: '小说感70%，电影感30%；重点=当前小目标、人物反应、具体物件和选择代价',
    humanTextureBeats: `第${order}章独有的身体状态、生活杂质、对话错位、情绪泄漏或物件触感`,
    draftingBan: '禁止说明书式解释、否定排除式冲击、分镜碎句、模板章末钩子',
    endingDelivery: `第${order}章结尾必须交付一个具体后果，不只写留下悬念`,
  };
}

const aiModes = [
  { key: 'continue', label: '章节续写', prompt: '请延续当前章节，保持人物口吻、世界观一致，并在结尾保留下一章钩子。' },
  { key: 'rewrite', label: '润色改写', prompt: '请在不改变情节核心的前提下润色文字，增强画面感、节奏感和网文可读性。' },
  { key: 'outline', label: '剧情拆解', prompt: '请按网文连载思路拆解后续剧情，给出分章建议、爽点、冲突和回收伏笔。' },
  { key: 'character', label: '人物加深', prompt: '请补强人物动机、秘密、情绪爆点和与主线冲突的关系。' },
];

const navigationTabs = [
  { key: 'overview', label: '总览', icon: BookOpen },
  { key: 'settings', label: '作品设定', icon: Sparkles },
  { key: 'chapters', label: '章节编辑', icon: BookOpen },
  { key: 'chapterCards', label: '章节卡库', icon: GitBranch },
  { key: 'ai', label: 'AI 创作与长篇引擎', icon: Bot },
  { key: 'inspect', label: '检查修订', icon: ShieldAlert },
  { key: 'story', label: '分卷时间线', icon: GitBranch },
  { key: 'characters', label: '角色关系图', icon: Users },
  { key: 'compliance', label: '审查发布', icon: ShieldAlert },
];

const shortcutItems = [
  ['Ctrl/Cmd + S', '保存当前作品'],
  ['Ctrl/Cmd + N', '新增章节'],
  ['Ctrl/Cmd + Enter', '调用 AI 生成'],
  ['Ctrl/Cmd + Shift + G', '生成前三章'],
  ['Ctrl/Cmd + 1-9', '切换左侧模块'],
  ['Ctrl/Cmd + /', '显示快捷键'],
  ['Esc', '关闭快捷键面板'],
];

const defaultAutomationDraft = {
  inspiration: '',
  minimumWords: 1500000,
  targetChapters: 600,
  batchCount: 3,
  lightweightGeneration: false,
  targetProgress: 60,
  chapterCardTargetChapter: 60,
  repairStartChapter: 1,
  repairEndChapter: 1,
  repairInstruction: '',
};

const platformModeOptions = [
  { value: 'fanqie', label: '番茄' },
  { value: 'qidian', label: '起点' },
  { value: 'ciweimao', label: '刺猬猫' },
];

const automationLedgerLimits = {
  foreshadowingLedger: 240,
  readerExpectations: 160,
  commercialBeatLedger: 160,
  characterStateMemory: 300,
  characterLongTermSummary: 80,
  powerSystemLedger: 200,
  chapterFunctionCalendar: 240,
};

function getPlatformStrategy(project) {
  return project?.automation?.platformStrategy || {
    primary: 'ciweimao',
    pace: 'fanqie',
    structure: 'qidian',
    publishTarget: 'fanqie',
    tags: ['明日方舟同人', '系统', '搜打撤', '群像', '幽默史诗'],
  };
}

const appVersion = '1.8.3';

const changelogItems = [
  {
    version: '1.8.3',
    date: '2026-05-29',
    title: '句子流动性守门',
    changes: [
      '轻量生成新增句子流动性约束，减少把“解释少”误写成短句链、缺词台词或分镜标签。',
      '自然度检测新增连续短句链、短台词链和“不A、不B、也不C”清单腔识别，并用连接修复保持句子自然承接。',
      '章节卡生成进一步去正文复述化，摘要优先保持目标、事件、结果、限制和钩子的剧情轨道。',
    ],
  },
  {
    version: '1.8.2',
    date: '2026-05-29',
    title: '100章大阶段检查',
    changes: [
      '在20章阶段检查之外新增100章大检查，自动复盘主线偏移、卷结构、角色成长、伏笔拖欠和爽点密度。',
      '自动写到20/40/60/80章触发普通阶段检查，写到100/200/300章触发100章大阶段检查并生成报告。',
      '检查报告末尾新增阶段建议，明确提示是否需要继续写、重排章节卡、重新自动分卷或保存建议到蓝图。',
    ],
  },
  {
    version: '1.8.1',
    date: '2026-05-29',
    title: '长篇记忆容量与角色长期摘要',
    changes: [
      '长篇自动写作台账扩容：角色记忆300条、伏笔240条、期待160条、爽点160条、系统规则200条、功能日历240条。',
      '新增角色长期摘要，按角色压缩长期关系和口吻变化，写作时会与最近记忆一起带入。',
      '自动写作进度区改为台账容量卡片，显示当前数量/上限和进度条，方便判断长篇记忆是否接近满额。',
    ],
  },
  {
    version: '1.8.0',
    date: '2026-05-29',
    title: '蓝图完整性守门',
    changes: [
      '长篇蓝图生成新增完整结束标记，模型必须输出【蓝图完】才会视为完整蓝图。',
      '如果蓝图疑似被截断，系统会自动继续请求模型补全剩余内容，避免只保存前半段规划。',
      '自动补全后仍不完整时会阻止覆盖旧蓝图，并提示重试或降低参考章节数。',
    ],
  },
  {
    version: '1.7.9',
    date: '2026-05-27',
    title: '蓝图可手动保存，角色记忆台账修复',
    changes: [
      '长篇蓝图改为可编辑文本框，用户可以手动修改并保存，后续分卷、章节卡、自动写作和检查点都会读取新版蓝图。',
      '修复角色记忆台账只识别旧项目固定角色名的问题，现在会从角色库、章节卡出场人物和正文中抽取角色。',
      '自动写作中心新增“重建自动写作台账”，可根据已有正文和章节卡补回角色记忆、伏笔、期待、爽点和系统规则。',
    ],
  },
  {
    version: '1.7.8',
    date: '2026-05-27',
    title: '逐章流式自动写作与二次元工作台',
    changes: [
      '继续自动写作和写到指定进度改为逐章流式：每章 token 实时返回，保存后才进入下一章。',
      '轻量模式复用原有轻量生成逻辑，只把首稿和补写兜底切换为流式，尽量保持原有质量保险。',
      '自动写作中心重排为 Start / Plan / Quest / Maintain 任务卡片，按钮层级和流程更清楚。',
      '非概览页新增右下角 Live2D 助手坞，靠近时自动虚化且不遮挡页面点击。',
      '桌面开发启动优先读取安装版数据目录，方便预览真实已写章节。',
    ],
  },
  {
    version: '1.7.7',
    date: '2026-05-27',
    title: '升级启动指南与自然读感守门',
    changes: [
      '重做进入软件后的使用指导弹窗，按当前版本的真实工作流展示模型配置、蓝图、章节卡、流式预览、轻量模式和发布检查。',
      '继续自动写作和写到指定进度改为逐章流式生成：每章 token 实时返回，单章完整结束后再解析、清理并保存。',
      '继续压低旁白里的“否定、否定、再解释/升格”和三项名词排比句式，减少生硬作者总结感。',
      '对话自然度检测改为更温和的密度触发，保留紧急短句，优先处理连续清单式命令和状态播报。',
    ],
  },
  {
    version: '1.7.6',
    date: '2026-05-27',
    title: '章节卡和当前章支持流式预览',
    changes: [
      '自动排章节卡改为流式接收模型输出，前端实时显示章节卡草稿，完整解析成功后再写入数据库。',
      '生成第一章/当前章新增流式正文预览，模型边写边显示草稿，结束后解析、清理并保存最终稿。',
      '继续保留取消请求、章节卡降级和最终保存校验；流式只改善等待体验，不边生成边落库。',
    ],
  },
  {
    version: '1.7.5',
    date: '2026-05-25',
    title: '减少分镜式短句和伪留白',
    changes: [
      '新增“短句留白资格”：短句、断行和留白只在强情绪、危险瞬间、角色不敢说完、重大发现落点、对话打断或章末钩子处少量使用。',
      '普通观察、否定判断、位置判断、动作安排、信息确认、声音/重量/速度描述不再默认拆成连续孤立短句。',
      '新增“碎片判断合并”：针对“没有A。也没有B。”“不A。不B。”“很慢。很重。”这类句群，优先合并成自然表达或接入动作、感受、风险和下一步判断。',
    ],
  },
  {
    version: '1.7.4',
    date: '2026-05-25',
    title: '章节卡返回不可解析内容时也自动降级',
    changes: [
      '章节卡生成不再只对 HTTP 524 降级；当模型已返回内容但格式不可解析时，也会自动进入降级链路。',
      '降级顺序保持为：正常批次失败后改成1章一批，再失败则临时切换 DeepSeek 生成本批章节卡。',
      '配置错误等不可恢复问题仍会直接提示，不会被降级逻辑吞掉。',
    ],
  },
  {
    version: '1.7.3',
    date: '2026-05-25',
    title: '章节卡超时自动降级，删除章节同步清台账',
    changes: [
      '章节卡生成遇到 HTTP 524 时会自动降级：先按当前批次生成，失败后改成1章一批，再失败则临时切换 DeepSeek 生成本批章节卡。',
      'DeepSeek 只作为章节卡 524 兜底，不改变全局模型设置；本批完成后下一轮仍回到原来的章节卡模型流程。',
      '删除章节时同步清理对应伏笔、期待、爽点、角色记忆、系统规则和章节功能日历，并自动前移后续台账章节号。',
    ],
  },
  {
    version: '1.7.2',
    date: '2026-05-25',
    title: '让主角先正常说话，再保留人设点缀',
    changes: [
      '新增正常对话优先级：求救、指挥、安抚、拒绝、确认信息、承认害怕和安排撤离时，先把正常对话和行动信息说清。',
      '吐槽、调侃、梗和抽象比喻降到正常表达之后；能正常说清时默认正常说清，只有确实承担嘴硬、遮掩害怕、缓冲关系或推动行动时才短促补一句。',
      '新增人设表达分层：降低吐槽不等于抹掉性格，优先用词气、停顿、回避、先动手后解释、骂半句又咽回去、害怕但仍行动等方式体现主角。',
    ],
  },
  {
    version: '1.7.1',
    date: '2026-05-25',
    title: '降低高压段吐槽和游戏化梗密度',
    changes: [
      '新增“吐槽保留资格”：调侃、梗和夸张比喻只有在遮掩害怕、缓冲尴尬、暴露误判、减轻队友恐慌、推动关系或帮助下决心时才保留。',
      '新增“游戏化梗降级”：高压真实伤痛、救人、撤离、被追杀、队友失联时，减少出生点、野怪、支线、存档点、集火、客服、VIP、差评等游戏/网络标签。',
      '继续保留主角嘴硬和人物风格，但更多通过动作、停顿、身体反应、现场判断、骂半句又吞回去等方式体现。',
    ],
  },
  {
    version: '1.7.0',
    date: '2026-05-25',
    title: '增强句子自然承接和台词逻辑',
    changes: [
      '新增泛用“句子自然承接”规则：台词、判断和动作句会更顺着人物处境、注意力、情绪和选择自然长出来。',
      '普通短句、停顿和情绪反应仍可留白；只有像孤立标签、任务条目、抽象口号、突兀判断或断开的命令时才补承接。',
      '强化省略句、取舍句、空间/设备指令的自然感，减少“掐”“不开深处”“状态报告清单”这类需要读者回推的表达。',
    ],
  },
  {
    version: '1.6.9',
    date: '2026-05-25',
    title: '保护高压段判断链，减少梗打断行动',
    changes: [
      '新增高压判断链保护：撤离、救人、伤情恶化、倒计时、敌人逼近、门禁/陷阱触发时，优先完成“看见问题 → 判断代价 → 安排动作”。',
      '吐槽和梗不能插在判断与行动之间；如果会打断处理问题，会要求改成身体反应、停顿、咽回话或手指发抖等正常反应。',
      '继续保留幽默和主角口吻，但让它服从剧情压力、人物状态、环境和关系氛围。',
    ],
  },
  {
    version: '1.6.8',
    date: '2026-05-25',
    title: '按剧情压力调节幽默停留时间',
    changes: [
      '新增泛用幽默功能规则：吐槽、梗和夸张比喻不再作为默认反应，而应承担遮掩害怕、暴露误判、缓冲关系尴尬、推动判断或显示立场等功能。',
      '幽默停留时间会参考剧情压力、人物状态、周围环境和关系氛围；高压动作段更快回到动作和代价，低压过渡和关系拉扯可多留一点口吻余味。',
      '幽默形式跟随主角人设，避免把所有主角都写成网络梗复述者。',
    ],
  },
  {
    version: '1.6.7',
    date: '2026-05-25',
    title: '进一步收敛主角吐槽和梗密度',
    changes: [
      '主角默认先像正常人反应：怕、疼、犹豫、判断、护人、误判和改动作，吐槽与梗只作为少量点缀。',
      '高压、追逐、受伤和求援段进一步降低吐槽权重，连续两段都靠吐槽收尾时会要求改成动作、沉默或身体反应。',
      '强比喻、抽象梗和“不是A，是B”式反差句继续降频，避免主角像抽象梗复述机器。',
      '规则保持泛用，换新小说会走通用主角口吻，不会套用魏杰专属口吻。',
    ],
  },
  {
    version: '1.6.6',
    date: '2026-05-25',
    title: '优化轻量模式自然口令与短句链',
    changes: [
      '轻量生成模式新增泛用短句链修复，把“物件/判断/行动”式标签短句自然合并为观察和判断，避免无限项目补丁。',
      '紧急口令会按语义轻修：推/拉/挪物件会补动作关系，看/听/注意类口令会补最小感知过渡，保留短促感但减少僵硬。',
      '进一步收敛高压段吐槽、强比喻和“不是A，是B”式反差句，减少连续抽象排比和摄像机扫街式环境描写。',
      '存储摘要优先使用章节卡摘要，减少 AI 摘要跑偏或正文抽句拼接导致的坏摘要。',
      '清理部分项目专属正文硬替换，降低换小说后误伤正文和破坏自然读感的风险。',
    ],
  },
  {
    version: '1.6.5',
    date: '2026-05-24',
    title: '细化轻量模式标签短句控制',
    changes: [
      '轻量生成模式明确限制“有武器/能反打/捡”“爆炸物/封路/控场”等玩家脑内标签短句。',
      '计数、重复尝试、撬门和开锁过程不再默认拆成“一、二、三”“没动、再撬、还是没动”式独立短句。',
      '编号和路线信息会要求说明来源，避免“B-17。下层-03。右偏六。”像在念标签。',
      '打包缓存改到项目 .cache，安装后数据目录改到安装目录旁，减少 C 盘缓存增长。',
    ],
  },
  {
    version: '1.6.4',
    date: '2026-05-24',
    title: '收敛轻量模式吐槽密度',
    changes: [
      '轻量生成模式新增吐槽和类比预算，避免同一段连续堆两个以上游戏梗或夸张比喻。',
      '保持短句可用，但限制成组短句过密出现，让动作、危险和吐槽更自然地贴在一起。',
    ],
  },
  {
    version: '1.6.3',
    date: '2026-05-24',
    title: '轻量正文读感与检查点适配优化',
    changes: [
      '统一安装包、窗口和任务栏图标资源，修复安装后图标不一致的问题。',
      '检查点报告适配当前逐章保存、轻量生成、章节卡和作者人设写作链路。',
      '轻量生成模式限制连续标签短句和过密独立短句，减少“药。真药。”“活捉。又是活捉。”这类伪冲击写法。',
      '新增正文元叙事泄漏兜底修复，避免“第5章顺手塞进兜里”“上一章里”等章节标签进入正文。',
    ],
  },
  {
    version: '1.6.2',
    date: '2026-05-24',
    title: '修复指定进度轻量模式并更新图标',
    changes: [
      '修复写到指定进度开启轻量生成模式时报 lightweight 未定义的问题。',
      '软件图标改为使用根目录 123.jpg 生成，后续打包会自动沿用新图标。',
    ],
  },
  {
    version: '1.6.1',
    date: '2026-05-24',
    title: '修复轻量模式开关自动关闭',
    changes: [
      '轻量生成模式现在会随项目保存持久化，不会被自动保存返回的旧项目状态覆盖。',
      '新增回归校验，确保项目保存响应保留轻量生成模式状态。',
    ],
  },
  {
    version: '1.6.0',
    date: '2026-05-24',
    title: '轻量模式界面与台账清理优化',
    changes: [
      '轻量生成模式改为更醒目的模式卡片，明确说明会作用于当前章、继续自动写作和写到指定进度。',
      '手动清空自动写作台账不再删除章节卡，只清空连续性记忆、伏笔、期待、爽点、角色记忆、系统规则、功能日历和检查点等运行态。',
      '重新生成长篇蓝图仍会重置章节卡，避免新旧蓝图章节卡混用。',
    ],
  },
  {
    version: '1.5.9',
    date: '2026-05-24',
    title: '新增轻量生成模式',
    changes: [
      '自动写作中心新增轻量生成模式开关，开启后跳过场景包、叙事拍和多层重控制。',
      '轻量模式保留蓝图、作者人设、章节卡、最近上下文和系统格式修复，更接近单次自然直写。',
      '生成第一章/当前章、继续自动写作、写到指定进度都会跟随该开关。',
    ],
  },
  {
    version: '1.5.8',
    date: '2026-05-24',
    title: '动作章与对话自然度优化',
    changes: [
      '对话密度按场景压力调整，不再追求固定轮数；追逐和战斗喊话可带判断、误判、急躁或威胁。',
      '段落类型不再硬轮换，连续行动段允许存在，但关键行动点会更重视阻碍、反馈和选择变化。',
      '高速追逐、受伤和求援段会降低幽默/史诗感权重，优先写顺动作因果。',
      '增加本地修复，尽量把“【打】近距离冲突不利”这类半框系统提示修成整行【打：近距离冲突不利】格式。',
    ],
  },
  {
    version: '1.5.7',
    date: '2026-05-24',
    title: '改善动作章省略感',
    changes: [
      '动作章根据场景需要补足必要过渡、身体反馈和环境后果，减少分镜提纲感。',
      '追逐和战斗喊话允许报状态，但会引导加入少量判断、误判、急躁或威胁。',
      '规则保持温和，不强制每个动作都补解释。',
    ],
  },
  {
    version: '1.5.6',
    date: '2026-05-24',
    title: '规范系统提示格式',
    changes: [
      '正文生成提示中要求系统弹窗独立成行，并用【】包住整行。',
      '避免出现“【搜】附近可回收物资”这类只有标签进框的半框格式。',
      '保留 1.5.5 的当前章单章质量生成链路。',
    ],
  },
  {
    version: '1.5.5',
    date: '2026-05-24',
    title: '当前章接入单章质量模式',
    changes: [
      '生成第一章/当前章改为按选中章节卡生成，并写回当前章节位置。',
      '当前章生成复用自动写作的真人网文口吻、章节卡剧情轨道和单章质量链路。',
      '保留 1.5.4 的三章排卡、最近 5 张卡参考和文风落点规则。',
    ],
  },
  {
    version: '1.5.4',
    date: '2026-05-24',
    title: '章节卡三章一批',
    changes: [
      '自动排章节卡按 3 章一批请求，减少单次规划负担和章节卡过载。',
      '章节卡续排参考最近 5 张卡，减少支线惯性，同时保留连续性。',
      '保留 1.5.3 的单章质量生成与逐章保存链路。',
    ],
  },
  {
    version: '1.5.3',
    date: '2026-05-24',
    title: '单章质量生成与逐章保存',
    changes: [
      '自动生成章节和写到指定进度默认使用单章质量生成链路，保留场景包/quality 内部结构，但跳过外层重复自然感终检、发布前审校和整章重生。',
      '写到指定进度改为每生成一章就立即保存并更新台账，避免等待整批结束才落库。',
      '保留 20 章检查点、章节卡校验、蓝图/作者人设/上下文承接和台账更新，降低长线写作等待时间。',
    ],
  },
  {
    version: '1.5.2',
    date: '2026-05-23',
    title: '生成过程模型显示与台账清理确认',
    changes: [
      '生成蓝图、作者人设、自动分卷、章节卡、正文、写到指定进度、检查点报告、章节巡检和修订时，状态栏会显示当前阶段实际使用的 AI 模型。',
      '自动写作进度提示中同步显示阶段模型，混合模式下可清楚区分 DeepSeek 规划和 GPT-5.5 正文/章节卡调用。',
      '清空自动写作台账增加二次确认，避免误触后需要重新排章节卡。',
      '生成新蓝图时会自动重置自动写作运行态台账，避免旧伏笔、期待、爽点和系统规则污染新规划。',
    ],
  },
  {
    version: '1.5.0',
    date: '2026-05-23',
    title: '双模型自动写作与场景包正文引擎',
    changes: [
      '新增 DeepSeek / GPT-5.5 中转站双模型配置，支持混合模式：DeepSeek 负责蓝图、分卷、检查点，GPT-5.5 负责章节卡、正文、补字和修订。',
      '自动正文升级为场景包链路：每章拆成 2-3 个场景包，后续场景包继承本章已生成内容，降低人物、物件和动作断裂。',
      '新增类型常识、风格纹理、标题核心卖点、逃生互动等生成前合同，让穿越者常识、系统性格、标题卖点和逃生章关系钩子更稳定。',
      '强化系统提示、短句链、否定判断、环境扫描、感知来源和句式自然感 Gate，减少 AI 味和“不是/没有”密度。',
      '前端新增自动写作模型策略，可选择混合模式或当前模型全流程，换书后同样生效。',
    ],
  },
  {
    version: '1.4.1',
    date: '2026-05-22',
    title: '稳定连载模式与自动记忆链路修复',
    changes: [
      '自动写作改为稳定连载模式：先生成本章动作链，再按动作链生成正文，降低跑偏、清单化和反复修稿概率。',
      '章节摘要不再信任 AI 输出，优先使用章节卡摘要；章节卡摘要质量不合格时自动回退为本地剧情摘要。',
      '修复自然感暂停后前端继续写下一章的问题，后端会返回暂停信号，前端收到后立即停止自动推进。',
      '蓝图人物卡解析兼容“人物/角色、定位/角色定位、成长线/弧光”等宽松字段，提升角色库自动导入成功率。',
      '章节卡钩子新增兜底：缺少关键钩子时会从章末交付物、读者预期、伏笔和爽点中补出可追踪钩子。',
      '修复前端版本号仍显示旧版本的问题。',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-05-22',
    title: '平台策略与结构化自动记忆',
    changes: [
      '长篇蓝图、章节卡、自动写作、检查点和范围修订接入平台策略，支持刺猬猫口味、番茄节奏和起点长篇结构组合。',
      '自动排章节卡新增本章爽点、平台适配、系统规则字段，并写入后续正文生成提示。',
      '每章生成后自动更新伏笔、读者期待、爽点、角色状态、系统规则和章节功能日历。',
      '阶段检查会读取结构化记忆，20章检查连续性，100章大检查复盘卷结构、主线偏移、角色成长和后续操作建议。',
      '前端 AI 长篇中心新增平台策略配置和自动记忆计数展示。',
    ],
  },
  {
    version: '1.3.2',
    date: '2026-05-21',
    title: '章节卡字段导入与控制参数拆分',
    changes: [
      '章节卡解析兼容 Markdown 加粗字段名，修复摘要、钩子、开头锚点和本章允许/禁止字段串联的问题。',
      '章节卡管理页正式拆出章节功能、对话密度、叙述质感、人味锚点、正文禁区和章末交付物六个控制字段。',
      '自动写正文前会检查章节卡数量是否足够，不足时提示先自动排章节卡，避免无卡生成导致质感预算失效。',
      '手动新增章节卡会自动填充新版控制参数模板，后续自动写作能稳定读取主功能/副功能等信号。',
    ],
  },
  {
    version: '1.3.1',
    date: '2026-05-21',
    title: '章节卡控制台与叙述质感升级',
    changes: [
      '自动排章节卡新增章节功能、对话密度、叙述质感、人味锚点、正文禁区和章末交付物规划，并写入现有章节卡字段供正文生成使用。',
      '自动写作会优先识别主功能/副功能，例如调查推理、对话冲突、关系变化、内心创伤和高压行动，让小说感与电影感预算更贴合本章功能。',
      '高对话章节识别支持结构化对话密度和百分比写法，审问、谈判、争吵、试探等章节会更稳定启用对话预算。',
      '生成链路增加 Markdown 横线兜底清理，减少正文开头偶发排版痕迹。',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-05-21',
    title: '自然感硬检测与局部修复',
    changes: [
      '自动写作新增本地自然感检测，零 token 扫描“不是A，也不是B——就是C”“不是A。不是B。是C。”等 AI 强调句式。',
      '中度问题优先只把命中片段发给 AI 局部修复，避免整章重写导致生成时间和 token 成本明显增加。',
      '轻度问题只记录提示，不打断自动写作；重度问题局部修复后仍保留发布前完整修订提醒。',
      '自然阅读守门规则补充“没有A，也没有B——只有C”“与其说A，不如说B”等高 AI 味结构。',
    ],
  },
  {
    version: '1.2.8',
    date: '2026-05-21',
    title: '正文自然阅读感优化',
    changes: [
      '新增自然阅读感守门，禁止正文出现 Markdown 加粗、星号、标题符号和列表式排版痕迹。',
      '限制“不是A。不是B。是C。”等机械短句排比，减少伪电影感断句。',
      '降低解释型心理和战术总结口吻，要求更多通过动作、物件、停顿和后果呈现。',
      '要求对话加入少量非功能性自然杂质，场景加入生活/环境杂质，章末钩子改为具体后果。',
      '轻量发布前审校会把 Markdown 痕迹、三连短句和模板钩子判定为需要重写。',
    ],
  },
  {
    version: '1.2.7',
    date: '2026-05-21',
    title: '章节卡排布稳定性优化',
    changes: [
      '自动排章节卡改为每 5 章调用一次 AI，降低单次返回不全导致中断的概率。',
      '保留作者人设驱动的开头方式权重编排和最近重复惩罚。',
    ],
  },
  {
    version: '1.2.6',
    date: '2026-05-21',
    title: '作者人设驱动的开头编排',
    changes: [
      '自动排章节卡时，开头方式改为后端权重编排，不再由 AI 自行全部填成冲突切入。',
      '开头方式权重会参考当前作品的作者人设卡、题材、文风和灵感，换书后自动适配不同写法。',
      '新增章节功能判断和最近重复惩罚，避免同一批章节连续重复同一种开头方式。',
      '手动新增章节卡也会按基础开头方式循环分配，减少默认模板感。',
      '检查修订页新增删除当前检查点报告功能，删除后会自动切换到上一条历史报告。',
    ],
  },
  {
    version: '1.2.5',
    date: '2026-05-21',
    title: '正文元叙事泄露拦截',
    changes: [
      '自动写作、补写、扩写和修订 prompt 新增正文元叙事禁令，禁止正文出现“第X章开始”“上一章里”“前文提到”等章节编号表达。',
      '轻量发布前审校会把章节编号、章节卡、蓝图等面向作者的表达判定为需要重写。',
      '要求 AI 用剧情内事件锚点替代章节编号，例如“从拿到那枚徽章起”。',
    ],
  },
  {
    version: '1.2.4',
    date: '2026-05-21',
    title: '安装版端口稳定性修复',
    changes: [
      '修复安装后自动运行时 3001 端口被占用导致主进程弹出 JavaScript 错误的问题。',
      '内嵌后端启动改为自动尝试可用端口，避免旧进程或开发服务占用固定端口。',
      '保留章节开头反模板、叙事手法权重轮换、章节卡开头策略字段和开发态隐藏启动优化。',
    ],
  },
  {
    version: '1.2.3',
    date: '2026-05-21',
    title: '开头策略与开发态优化',
    changes: [
      '章节卡新增开头方式、开头锚点、禁止开头、叙事手法、叙事目的字段，用于控制首段和叙事节奏。',
      '自动写作加入章节开头反模板和权重轮换策略，默认顺叙，每 10 章少量插入插叙、倒叙或延迟交代。',
      '开发态启动改为隐藏后台拉起，不再弹出多余命令框，并支持自动接入已有 session 直接进入项目。',
      '更新开发态公告，提醒新版会优先避开精确时间打卡式开头。',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-05-20',
    title: '作者人设卡与风格统一',
    changes: [
      '新增基于灵感自动生成的作者人设卡，用来统一整本书的叙述人格。',
      '作者人设会注入蓝图、章节卡和自动写作，帮助保持口吻、节奏和留白一致。',
      '人设强调口语、碎、随意、矛盾、藏，并明确压制工整、干净、模板、标准、顺滑。',
      '分卷、章节卡、一致性修订也会参考作者人设，减少整本书风格漂移。',
    ],
  },
  {
    version: '1.1.3',
    date: '2026-05-20',
    title: '导出 TXT 入口优化',
    changes: [
      '将导出 TXT 放回顶部作品操作区，打开作品后即可直接导出。',
      '在总览快捷入口新增导出 TXT，减少寻找成本。',
      '保留导出工程 JSON，方便备份完整项目数据。',
    ],
  },
  {
    version: '1.1.2',
    date: '2026-05-20',
    title: '章节字数底线与修订后补字',
    changes: [
      '将章节目标下调并稳定到 2000+，默认更适合短章与长章均衡。',
      '新增修订后补字流程，只允许在同场景内补足动作、细节、反应、伏笔，不改剧情骨架。',
      '如果补字后仍低于最低字数，流程会直接暂停，不会落库短章节。',
      '修复自动写作循环中遇到空章节时提前中断的问题。',
    ],
  },
  {
    version: '1.1.1',
    date: '2026-05-20',
    title: '连贯性记忆与反模板写作增强',
    changes: [
      '自动排章节卡新增读者预期、上一章遗留动作和伏笔规划字段。',
      '自动写作和写到指定进度会持续带入连续性记忆、伏笔账本和角色口吻防漂移检查。',
      '优化人类化不均匀表达要求，降低段落、句式和对话过度工整的问题。',
      '调整系统提示策略，允许关键节点使用完整任务/奖励面板，但要求短块呈现并由人物动作承接。',
      '补充高频 AI 套话拦截，如心跳漏拍、瞳孔一缩、事情复杂、暗流涌动等。',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-05-20',
    title: '长篇自动写作与公告中心',
    changes: [
      '新增公告入口，可在软件内查看每个版本的更新日志。',
      '自动写作改为生成前强化提示词、生成后轻量校验，前三章或风险章节再完整修订。',
      '章节生成更贴近番茄小说阅读节奏，降低模板化表达和 AI 味。',
      '失败或高风险章节会保存当前稿并暂停人工确认，避免自动流程误覆盖。',
    ],
  },
  {
    version: '1.0.1',
    date: '2026-05-20',
    title: 'Live2D 助手与长篇稳定性修复',
    changes: [
      '接入本地 Live2D 助手，支持多种动作切换。',
      '自动写作改为每章一次 DeepSeek 调用，提升标题、摘要、正文导入稳定性。',
      '章节卡只作为 AI 提示上下文，不再污染章节管理数据。',
      '修复保存层清洗正文、编辑后回滚、安装版后端启动等问题。',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-05-20',
    title: '桌面版初始发布',
    changes: [
      '完成本地多用户账号、作品库、章节编辑和基础 AI 创作。',
      '提供长篇蓝图、自动分卷、章节卡、批量生成正文工作流。',
      '提供番茄发布准备、敏感词检查、TXT 导出和 Electron 安装包。',
    ],
  },
];

const deepSeekModelOptions = [
  { value: 'deepseek-v4-flash', label: 'deepseek-v4-flash' },
  { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
];

const chapterCardBatchSize = 3;

function normalizeDeepSeekModel(model = '') {
  return deepSeekModelOptions.some((option) => option.value === model) ? model : 'deepseek-v4-flash';
}

function normalizeAiConfig(config = {}) {
  const profiles = {
    ...defaultAiConfig.profiles,
    ...(config.profiles || {}),
  };
  profiles.deepseek = {
    ...defaultAiConfig.profiles.deepseek,
    ...(profiles.deepseek || {}),
    model: normalizeDeepSeekModel(profiles.deepseek?.model || config.model),
    apiKey: profiles.deepseek?.apiKey ?? config.apiKey ?? '',
    baseUrl: profiles.deepseek?.baseUrl || config.baseUrl || defaultAiConfig.baseUrl,
  };
  profiles.gpt55 = {
    ...defaultAiConfig.profiles.gpt55,
    ...(profiles.gpt55 || {}),
  };
  const activeProfile = profiles[config.activeProfile] ? config.activeProfile : 'deepseek';
  const active = profiles[activeProfile];
  return {
    ...defaultAiConfig,
    ...config,
    activeProfile,
    modelRouting: config.modelRouting === 'active' ? 'active' : 'mixed',
    profiles,
    apiKey: active.apiKey || '',
    model: active.model || defaultAiConfig.model,
    baseUrl: active.baseUrl || defaultAiConfig.baseUrl,
  };
}

function updateAiProfile(config, profileKey, patch) {
  const nextProfiles = {
    ...(config.profiles || defaultAiConfig.profiles),
    [profileKey]: {
      ...(config.profiles?.[profileKey] || defaultAiConfig.profiles[profileKey] || {}),
      ...patch,
    },
  };
  return normalizeAiConfig({ ...config, profiles: nextProfiles });
}

function switchAiProfile(config, activeProfile) {
  return normalizeAiConfig({ ...config, activeProfile });
}

function getAiProfileLabel(config = {}, profileKey = config.activeProfile) {
  const profile = config.profiles?.[profileKey];
  if (!profile) return '未配置';
  return `${profile.label || profileKey} · ${profile.model || '未填模型'}`;
}

function getAiUsageSummary(config = {}) {
  if (config.modelRouting === 'active') {
    return `当前模型全流程：${getAiProfileLabel(config, config.activeProfile)}`;
  }
  return `混合模式：规划/分卷/检查点用 ${getAiProfileLabel(config, 'deepseek')}；章节卡/正文/补字/修订用 ${getAiProfileLabel(config, 'gpt55')}`;
}

function getStageAiLabel(config = {}, stage = 'active') {
  if (config.modelRouting === 'active') return getAiProfileLabel(config, config.activeProfile);
  if (['planning', 'volume', 'checkpoint', 'audit'].includes(stage)) return getAiProfileLabel(config, 'deepseek');
  if (['chapter-card', 'writing', 'rewrite', 'repair', 'first-three'].includes(stage)) return getAiProfileLabel(config, 'gpt55');
  return getAiProfileLabel(config, config.activeProfile);
}

function withAiLabel(text, config = {}, stage = 'active') {
  return `${text}｜AI：${getStageAiLabel(config, stage)}`;
}

const chapterSummaryLabels = ['本章摘要', '章节摘要', '摘要', '简介'];
const chapterHookLabels = ['关键钩子', '章末钩子', '钩子', '悬念'];
const chapterContentLabels = ['章节正文', '正文'];
const allChapterFieldLabels = [...chapterSummaryLabels, ...chapterHookLabels, ...chapterContentLabels];

function makeLabelPattern(labels) {
  return labels.join('|');
}

function findFieldLabel(text, labels, startAt = 0) {
  const matcher = new RegExp(`(^|\\n)\\s*(?:${makeLabelPattern(labels)})[:：]\\s*`, 'g');
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

function stripChapterNumber(title = '') {
  return title.replace(/^第\s*[一二三四五六七八九十百千万两〇零\d]+\s*章\s*/, '').trim();
}

function cleanImportedChapterTitle(rawTitle = '', fallbackTitle = '新章节') {
  const title = rawTitle
    .replace(/^#+\s*/, '')
    .replace(new RegExp(`\\s*(?:/\\s*)?(?:${makeLabelPattern(allChapterFieldLabels)})[:：][\\s\\S]*$`), '')
    .trim();
  const fallback = fallbackTitle.trim() || '新章节';
  if (!stripChapterNumber(title) && stripChapterNumber(fallback)) return fallback;
  return title || fallback;
}

function isChapterMetadataLine(line = '') {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (new RegExp(`^(?:${makeLabelPattern(allChapterFieldLabels)})[:：]`).test(trimmed)) return true;
  if (/^(FAIL|PASS|缺失|未生成|无正文|正文缺失|本章缺失|本章未生成)$/i.test(trimmed.replace(/\s+/g, ''))) return true;
  if (/^原因[:：].{0,120}$/.test(trimmed)) return true;
  return false;
}

function sanitizeImportedContent(value = '') {
  return value
    .split('\n')
    .filter((line) => !isChapterMetadataLine(line))
    .join('\n')
    .trim();
}

function makeChapter(volumeId = '') {
  return {
    id: crypto.randomUUID(),
    title: `第${Date.now().toString().slice(-4)}章 新章节`,
    summary: '',
    content: '',
    status: 'draft',
    volumeId,
    updatedAt: new Date().toISOString(),
  };
}

function countWords(text = '') {
  return text.replace(/\s+/g, '').length;
}

function normalizeChapterOutput(text = '') {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/([^\n])\s*(?:\/\s*)?((?:本章摘要|章节摘要|摘要|简介)[:：])/g, '$1\n$2')
    .replace(/([^\n])\s*(?:\/\s*)?((?:关键钩子|章末钩子|钩子|悬念)[:：])/g, '$1\n$2')
    .replace(/([^\n])\s*(?:\/\s*)?((?:章节正文|正文)[:：])/g, '$1\n$2')
    .replace(/(?:^|\n)\s*(?:#{1,6}\s*)?(第\s*[一二三四五六七八九十百千万两〇零\d]+\s*章[^\n]*)/g, '\n### $1')
    .replace(/^\n+/, '')
    .trim();
}

export default function App() {
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState(defaultAuthForm);
  const [token, setToken] = useState(() => localStorage.getItem('novel-token') || '');
  const [currentUser, setCurrentUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedChapterId, setSelectedChapterId] = useState('');
  const [projectForm, setProjectForm] = useState(defaultProjectForm);
  const [activeTab, setActiveTab] = useState('overview');
  const [aiConfig, setAiConfig] = useState(() => {
    const saved = localStorage.getItem('deepseek-config');
    if (!saved) return defaultAiConfig;
    try {
      const parsed = JSON.parse(saved);
      return normalizeAiConfig(parsed);
    } catch {
      return defaultAiConfig;
    }
  });
  const [aiMode, setAiMode] = useState(aiModes[0].key);
  const [aiExtraPrompt, setAiExtraPrompt] = useState('');
  const [chapterTargetWords, setChapterTargetWords] = useState(2200);
  const [aiOutput, setAiOutput] = useState('');
  const [streamPreview, setStreamPreview] = useState({ active: false, phase: '', text: '' });
  const [publishChecklist, setPublishChecklist] = useState([]);
  const [sensitiveKeywords, setSensitiveKeywords] = useState([]);
  const [chapterAuditReport, setChapterAuditReport] = useState('');
  const [status, setStatus] = useState('就绪');
  const [loading, setLoading] = useState(false);
  const [writingProgress, setWritingProgress] = useState(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [showWelcomeGuide, setShowWelcomeGuide] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [assistantPose, setAssistantPose] = useState('default');
  const [assistantDockSoftened, setAssistantDockSoftened] = useState(false);
  const [checkpointPanel, setCheckpointPanel] = useState({ retentionCount: 20, currentReport: '', reports: [] });
  const [automationDraft, setAutomationDraft] = useState(defaultAutomationDraft);
  const [authorPersonaDraft, setAuthorPersonaDraft] = useState('');
  const [blueprintDraft, setBlueprintDraft] = useState('');
  const [chapterJumpValue, setChapterJumpValue] = useState('');
  const [chapterCardFilter, setChapterCardFilter] = useState({ start: '', end: '' });

  const [characterForm, setCharacterForm] = useState(defaultCharacter);
  const [relationForm, setRelationForm] = useState(defaultRelation);
  const [timelineForm, setTimelineForm] = useState(defaultTimelineEvent);
  const [volumeForm, setVolumeForm] = useState(defaultVolume);
  const [selectedChapterIds, setSelectedChapterIds] = useState([]);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState([]);
  const [selectedChapterCardIds, setSelectedChapterCardIds] = useState([]);
  const [selectedChapterCardId, setSelectedChapterCardId] = useState('');
  const projectsRef = useRef([]);
  const selectedProjectIdRef = useRef('');
  const autoSaveTimerRef = useRef(null);
  const localProjectVersionRef = useRef(0);
  const stopAiWritingRef = useRef(false);
  const currentAiAbortRef = useRef(null);
  const assistantDockRef = useRef(null);
  const api = useApiClient(token);

  useEffect(() => {
    localStorage.setItem('deepseek-config', JSON.stringify(aiConfig));
  }, [aiConfig]);

  useEffect(() => {
    if (!import.meta.env.DEV || token) return;
    let cancelled = false;
    async function loadDevSession() {
      try {
        const response = await fetch('/api/auth/dev-session');
        if (!response.ok) return;
        const data = await response.json();
        if (!data?.token || cancelled) return;
        localStorage.setItem('novel-token', data.token);
        setToken(data.token);
      } catch {}
    }
    loadDevSession();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  useEffect(() => {
    if (!token) return;
    bootstrap();
  }, [token]);

  useEffect(() => {
    if (token) setShowWelcomeGuide(true);
  }, [token]);

  useEffect(() => {
    if (!selectedProject) return;
    loadCheckpointPanel();
  }, [selectedProjectId]);

  const selectedProject = useMemo(
    () => projects.find((item) => item.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );

  const selectedChapter = useMemo(
    () => selectedProject?.chapters.find((item) => item.id === selectedChapterId) || null,
    [selectedProject, selectedChapterId],
  );

  const selectedChapterIndex = useMemo(
    () => selectedProject?.chapters.findIndex((item) => item.id === selectedChapterId) ?? -1,
    [selectedProject, selectedChapterId],
  );

  const currentTabMeta = navigationTabs.find((item) => item.key === activeTab) || navigationTabs[0];

  const totalProjectWords = useMemo(
    () => (selectedProject?.chapters || []).reduce((sum, chapter) => sum + countWords(chapter.content), 0),
    [selectedProject],
  );

  const currentWrittenChapterCount = useMemo(() => (
    (selectedProject?.chapters || []).filter((chapter, index) => !(index === 0 && chapter.title === '第1章 开场' && !chapter.summary && !chapter.content)).length
  ), [selectedProject]);

  const automationStage = selectedProject?.automation?.status || 'idle';
  const assistantIsProcessing = loading || Boolean(writingProgress);
  const activeAssistantState = assistantIsProcessing ? 'processing' : assistantPose;
  const hasMasterPlan = Boolean(selectedProject?.automation?.masterPlan);
  const chapterCardCount = selectedProject?.automation?.chapterCards?.length || 0;
  const nextWorkflowAction = !hasMasterPlan
    ? { label: '生成长篇蓝图', tab: 'ai' }
    : !selectedProject?.volumes?.length
      ? { label: '自动分卷', tab: 'ai' }
      : !chapterCardCount
        ? { label: '自动排章节卡', tab: 'ai' }
        : { label: '继续自动写作', tab: 'ai' };
  const automationSteps = [
    { label: '蓝图', done: Boolean(selectedProject?.automation?.masterPlan) },
    { label: '分卷', done: Boolean(selectedProject?.volumes?.length) },
    { label: `章节卡 ${chapterCardCount}`, done: chapterCardCount > 0 },
    { label: `正文 ${currentWrittenChapterCount}`, done: currentWrittenChapterCount > 0 },
    { label: `检查点 ${selectedProject?.automation?.lastCheckpointAt || 0}`, done: Boolean(selectedProject?.automation?.lastCheckpointAt) },
  ];

  useEffect(() => {
    if (!selectedProject || activeTab === 'overview') {
      setAssistantDockSoftened(false);
      return undefined;
    }

    let frameId = 0;
    const padding = 10;
    const handlePointerMove = (event) => {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => {
        const rect = assistantDockRef.current?.getBoundingClientRect();
        if (!rect) return;
        const inside = event.clientX >= rect.left - padding
          && event.clientX <= rect.right + padding
          && event.clientY >= rect.top - padding
          && event.clientY <= rect.bottom + padding;
        setAssistantDockSoftened(inside);
      });
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [selectedProject, activeTab]);

  const filteredChapterCards = useMemo(() => {
    const cards = selectedProject?.automation?.chapterCards || [];
    const start = Number(chapterCardFilter.start) || 1;
    const end = Number(chapterCardFilter.end) || Number.POSITIVE_INFINITY;
    return cards.filter((card) => card.order >= start && card.order <= end);
  }, [selectedProject, chapterCardFilter]);

  const selectedChapterCard = useMemo(
    () => (selectedProject?.automation?.chapterCards || []).find((item) => item.id === selectedChapterCardId) || filteredChapterCards[0] || null,
    [selectedProject, selectedChapterCardId, filteredChapterCards],
  );

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      const isMod = event.metaKey || event.ctrlKey;
      const tagName = event.target?.tagName;

      if (event.key === 'Escape' && showShortcuts) {
        setShowShortcuts(false);
        return;
      }

      if (!isMod) return;

      const key = event.key.toLowerCase();

      if (key === 's') {
        event.preventDefault();
        saveProject();
        return;
      }

      if (key === 'n') {
        event.preventDefault();
        addChapter();
        return;
      }

      if (key === 'enter') {
        event.preventDefault();
        runAi();
        return;
      }

      if (key === '/' || key === '?') {
        event.preventDefault();
        setShowShortcuts((current) => !current);
        return;
      }

      if (event.shiftKey && key === 'g') {
        event.preventDefault();
        generateFirstThreeChapters();
        return;
      }

      if (/^[1-9]$/.test(key)) {
        event.preventDefault();
        const tabs = ['overview', 'settings', 'chapters', 'chapterCards', 'ai', 'inspect', 'story', 'characters', 'compliance'];
        setActiveTab(tabs[Number(key) - 1]);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showShortcuts, selectedProject, selectedChapter, aiMode, aiExtraPrompt, aiConfig, projects]);

  async function bootstrap() {
    try {
      const me = await api('/api/auth/me');
      setCurrentUser(me.user);
      const [projectData, templateData] = await Promise.all([
        api('/api/projects'),
        api('/api/publish/templates'),
      ]);
      const settings = await api('/api/settings/ai');
      setProjects(projectData);
      setPublishChecklist(templateData.checklist || []);
      setSensitiveKeywords(templateData.sensitiveKeywords || []);
      setAiConfig(normalizeAiConfig(settings));
      if (projectData[0]) {
        setSelectedProjectId(projectData[0].id);
        setSelectedChapterId(projectData[0].chapters[0]?.id || '');
      }
    } catch (error) {
      if (error.message === '未登录' || error.message === '登录已失效') {
        localStorage.removeItem('novel-token');
        setToken('');
        setCurrentUser(null);
        setStatus(error.message || '登录已失效');
        return;
      }
      setStatus(error.message || '初始化失败');
    }
  }

  async function loadCheckpointPanel() {
    if (!selectedProject) return;
    try {
      const data = await api(`/api/projects/${selectedProject.id}/automation/checkpoints`);
      setCheckpointPanel({
        retentionCount: data.retentionCount || 20,
        currentReport: data.currentReport || '',
        reports: data.reports || [],
      });
    } catch {
      setCheckpointPanel({ retentionCount: 20, currentReport: '', reports: [] });
    }
  }

  async function updateCheckpointRetentionCount(value) {
    if (!selectedProject) return;
    try {
      const data = await api(`/api/projects/${selectedProject.id}/automation/checkpoints`, {
        method: 'PUT',
        body: JSON.stringify({ retentionCount: value }),
      });
      setCheckpointPanel((current) => ({
        ...current,
        retentionCount: data.retentionCount || value,
        reports: data.reports || [],
      }));
      setProjects((current) => current.map((item) => (item.id === selectedProject.id ? {
        ...item,
        automation: {
          ...item.automation,
          checkpointRetentionCount: data.retentionCount || value,
          checkpointReports: data.reports || [],
        },
      } : item)));
      setStatus('已更新检查点保留数量');
    } catch (error) {
      setStatus(error.message || '更新检查点保留数量失败');
    }
  }

  async function deleteCurrentCheckpointReport() {
    if (!selectedProject) return;
    if (!checkpointPanel.currentReport && !checkpointPanel.reports.length) {
      setStatus('当前没有可删除的检查点报告');
      return;
    }
    const confirmed = window.confirm('确定删除当前最新检查点报告吗？删除后会切换到上一条历史报告。');
    if (!confirmed) return;
    try {
      const data = await api(`/api/projects/${selectedProject.id}/automation/checkpoints/current`, {
        method: 'DELETE',
      });
      setCheckpointPanel({
        retentionCount: data.retentionCount || 20,
        currentReport: data.currentReport || '',
        reports: data.reports || [],
      });
      setProjects((current) => current.map((item) => (item.id === data.project.id ? data.project : item)));
      setStatus(data.currentReport ? '已删除当前检查点报告，已切换到上一条' : '已删除当前检查点报告');
    } catch (error) {
      setStatus(error.message || '删除检查点报告失败');
    }
  }

  function cancelAiWriting() {
    stopAiWritingRef.current = true;
    currentAiAbortRef.current?.abort();
    setWritingProgress((current) => current ? { ...current, note: '正在中断，当前请求取消后会停止' } : current);
    setStatus('正在中断 AI 写作');
  }

  function isAbortError(error) {
    return error?.name === 'AbortError';
  }

  async function apiWithAiAbort(url, options = {}) {
    const controller = new AbortController();
    currentAiAbortRef.current = controller;
    try {
      return await api(url, { ...options, signal: controller.signal });
    } finally {
      if (currentAiAbortRef.current === controller) {
        currentAiAbortRef.current = null;
      }
    }
  }

  async function apiStreamWithAiAbort(url, { body, onEvent } = {}) {
    const controller = new AbortController();
    currentAiAbortRef.current = controller;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || '请求失败');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('浏览器未返回可读取的流');
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          onEvent?.(JSON.parse(line));
        }
      }
      if (buffer.trim()) onEvent?.(JSON.parse(buffer));
    } finally {
      if (currentAiAbortRef.current === controller) {
        currentAiAbortRef.current = null;
      }
    }
  }

  useEffect(() => {
    if (selectedProject && !selectedProject.chapters.some((item) => item.id === selectedChapterId)) {
      setSelectedChapterId(selectedProject.chapters[0]?.id || '');
    }
  }, [selectedProject, selectedChapterId]);

  useEffect(() => {
    setBlueprintDraft(selectedProject?.automation?.masterPlan || '');
  }, [selectedProjectId, selectedProject?.automation?.masterPlan]);

  useEffect(() => {
    setSelectedChapterIds([]);
    setSelectedCharacterIds([]);
    setSelectedChapterCardIds([]);
  }, [selectedProjectId]);

  function toggleIdSelection(setter, id, checked) {
    setter((current) => checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id));
  }

  function updateSelectedProject(field, value) {
    if (!selectedProject) return;
    const nextProject = { ...selectedProject, [field]: value };
    localProjectVersionRef.current += 1;
    setProjects((current) => current.map((item) => (item.id === nextProject.id ? nextProject : item)));
    scheduleAutoSave();
  }

  function getLatestSelectedProject() {
    return projectsRef.current.find((item) => item.id === selectedProjectIdRef.current) || null;
  }

  function scheduleAutoSave() {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      saveProject(undefined, { silent: true });
    }, 1200);
  }

  function updateSelectedChapter(field, value) {
    if (!selectedProject || !selectedChapter) return;
    const chapters = selectedProject.chapters.map((item) => item.id === selectedChapter.id ? { ...item, [field]: value, updatedAt: new Date().toISOString() } : item);
    updateSelectedProject('chapters', chapters);
  }

  function updateChapterCard(cardId, field, value) {
    if (!selectedProject) return;
    const chapterCards = (selectedProject.automation?.chapterCards || []).map((card) => (
      card.id === cardId ? { ...card, [field]: value } : card
    ));
    updateSelectedProject('automation', {
      ...selectedProject.automation,
      chapterCards,
      progressNotes: '章节卡已手动调整，后续自动写作会按修改后的章节卡执行',
    });
  }

  function updatePlatformStrategy(field, value) {
    if (!selectedProject) return;
    const strategy = getPlatformStrategy(selectedProject);
    updateSelectedProject('automation', {
      ...selectedProject.automation,
      platformStrategy: {
        ...strategy,
        [field]: field === 'tags' ? value.split(/[，,、/\n]/).map((item) => item.trim()).filter(Boolean) : value,
      },
      progressNotes: '平台策略已更新，后续蓝图、章节卡、自动写作和检查点会按新策略执行',
    });
  }

  function updateAutomationOption(field, value) {
    if (!selectedProject) return;
    updateSelectedProject('automation', {
      ...selectedProject.automation,
      [field]: value,
      progressNotes: field === 'lightweightGeneration'
        ? `轻量生成模式已${value ? '开启' : '关闭'}`
        : selectedProject.automation?.progressNotes,
    });
  }

  function getLedgerCount(key) {
    return selectedProject?.automation?.[key]?.length || 0;
  }

  async function deleteChapterCard(cardId) {
    if (!selectedProject) return;
    const chapterCards = (selectedProject.automation?.chapterCards || [])
      .filter((card) => card.id !== cardId)
      .map((card, index) => ({
        ...card,
        order: index + 1,
        title: card.title.replace(/^第\s*\d+\s*章\s*/, `第${index + 1}章 `),
      }));
    updateSelectedProject('automation', {
      ...selectedProject.automation,
      chapterCards,
      progressNotes: '章节卡已删除并重新排序',
    });
    await saveProject({
      ...selectedProject,
      automation: {
        ...selectedProject.automation,
        chapterCards,
        progressNotes: '章节卡已删除并重新排序',
      },
    }, { silent: true });
  }

  function addChapterCardBatch() {
    if (!selectedProject) return;
    const count = Math.max(1, Number(window.prompt('要批量新增多少张章节卡？', '3')) || 0);
    if (!count) return;
    const existing = selectedProject.automation?.chapterCards || [];
    const chapterCards = [
      ...existing,
      ...Array.from({ length: count }).map((_, index) => {
        const order = existing.length + index + 1;
        const controls = createDefaultChapterCardControl(order);
        return {
          id: crypto.randomUUID(),
          order,
          title: `第${order}章 未命名章节`,
          volumeName: selectedProject.volumes[0]?.title || '',
          paceStage: selectedProject.volumes[0]?.title ? `${selectedProject.volumes[0].title}前段` : '',
          openingType: openingTypeCycle[(order - 1) % openingTypeCycle.length],
          openingAnchor: `抓住第${order}章独有的冲突或异常`,
          openingBan: '禁止默认用精确时间+地点+动作打卡式开头',
          narrativeMode: order <= 3 ? 'linear' : ((order - 4) % 10 === 0 ? 'delayed' : (order - 4) % 10 === 2 ? 'flashback' : (order - 4) % 10 === 4 ? 'reverse' : 'linear'),
          narrativePurpose: '顺叙推进本章冲突',
          ...controls,
          progressLock: `第${order}章只允许推进当前小冲突`,
          allowedBeats: '',
          forbiddenBeats: '禁止提前进入后续大冲突',
          summary: '',
          hook: '',
          status: 'planned',
        };
      }),
    ];
    updateSelectedProject('automation', {
      ...selectedProject.automation,
      chapterCards,
      progressNotes: `已手动新增 ${count} 张章节卡`,
    });
  }

  async function deleteSelectedChapterCards() {
    if (!selectedProject || !selectedChapterCardIds.length) return;
    const confirmed = window.confirm(`确定删除选中的 ${selectedChapterCardIds.length} 张章节卡吗？`);
    if (!confirmed) return;
    const chapterCards = (selectedProject.automation?.chapterCards || [])
      .filter((card) => !selectedChapterCardIds.includes(card.id))
      .map((card, index) => ({
        ...card,
        order: index + 1,
        title: card.title.replace(/^第\s*\d+\s*章\s*/, `第${index + 1}章 `),
      }));
    setSelectedChapterCardIds([]);
    updateSelectedProject('automation', {
      ...selectedProject.automation,
      chapterCards,
      progressNotes: `已批量删除章节卡，当前剩余 ${chapterCards.length} 张`,
    });
    await saveProject({
      ...selectedProject,
      automation: {
        ...selectedProject.automation,
        chapterCards,
        progressNotes: `已批量删除章节卡，当前剩余 ${chapterCards.length} 张`,
      },
    }, { silent: true });
  }

  async function deleteAllChapterCards() {
    if (!selectedProject) return;
    const count = selectedProject.automation?.chapterCards?.length || 0;
    if (!count) {
      setStatus('当前没有章节卡');
      return;
    }
    const confirmed = window.confirm(`确定删除全部 ${count} 张章节卡吗？此操作不会删除已生成章节。`);
    if (!confirmed) return;
    setSelectedChapterCardIds([]);
    updateSelectedProject('automation', {
      ...selectedProject.automation,
      chapterCards: [],
      progressNotes: '已删除全部章节卡',
    });
    await saveProject({
      ...selectedProject,
      automation: {
        ...selectedProject.automation,
        chapterCards: [],
        progressNotes: '已删除全部章节卡',
      },
    }, { silent: true });
  }

  async function handleAuth(event) {
    event.preventDefault();
    try {
      const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const payload = authMode === 'login'
        ? { username: authForm.username, password: authForm.password }
        : authForm;
      const data = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || '认证失败');
        return result;
      });
      localStorage.setItem('novel-token', data.token);
      setToken(data.token);
      setCurrentUser(data.user);
      setAuthForm(defaultAuthForm);
      setStatus(`${authMode === 'login' ? '登录' : '注册'}成功`);
    } catch (error) {
      setStatus(error.message || '认证失败');
    }
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {}
    localStorage.removeItem('novel-token');
    setToken('');
    setCurrentUser(null);
    setProjects([]);
    setSelectedProjectId('');
    setSelectedChapterId('');
  }

  async function createProject(event) {
    event.preventDefault();
    try {
      const project = await api('/api/projects', {
        method: 'POST',
        body: JSON.stringify(projectForm),
      });
      setProjects((current) => [project, ...current]);
      setSelectedProjectId(project.id);
      setSelectedChapterId(project.chapters[0]?.id || '');
      setShowCreateProject(false);
      setAutomationDraft((current) => ({
        ...current,
        inspiration: project.automation?.inspiration || project.premise || '',
        minimumWords: project.automation?.minimumWords || 1500000,
        targetChapters: project.automation?.targetChapters || 600,
      }));
      setProjectForm(defaultProjectForm);
      setStatus(`已创建作品：${project.title}`);
    } catch (error) {
      setStatus(error.message || '创建失败');
    }
  }

  async function saveProject(project, options = {}) {
    const targetProject = project || getLatestSelectedProject();
    if (!targetProject) return;
    const requestVersion = localProjectVersionRef.current;
    try {
      const saved = await api(`/api/projects/${targetProject.id}`, {
        method: 'PUT',
        body: JSON.stringify(targetProject),
      });
      if (requestVersion === localProjectVersionRef.current) {
        setProjects((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      }
      if (!options.silent) setStatus(`已保存：${saved.title}`);
    } catch (error) {
      if (!options.silent) setStatus(error.message || '保存失败');
    }
  }

  async function addChapter() {
    if (!selectedProject) return;
    const volumeId = selectedProject.volumes[0]?.id || '';
    const nextProject = { ...selectedProject, chapters: [...selectedProject.chapters, makeChapter(volumeId)] };
    setProjects((current) => current.map((item) => (item.id === nextProject.id ? nextProject : item)));
    setSelectedChapterId(nextProject.chapters.at(-1).id);
    await saveProject(nextProject);
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
    const cleanLedger = (items = []) => (Array.isArray(items) ? items : [])
      .map((item) => ({ ...item, chapter: remapChapter(item.chapter) }))
      .filter((item) => item.chapter !== null);

    return {
      ...automation,
      foreshadowingLedger: cleanLedger(automation.foreshadowingLedger),
      readerExpectations: cleanLedger(automation.readerExpectations),
      commercialBeatLedger: cleanLedger(automation.commercialBeatLedger),
      characterStateMemory: cleanLedger(automation.characterStateMemory),
      powerSystemLedger: cleanLedger(automation.powerSystemLedger),
      chapterFunctionCalendar: cleanLedger(automation.chapterFunctionCalendar),
    };
  }

  async function deleteChapter() {
    if (!selectedProject || !selectedChapter) return;
    if (selectedProject.chapters.length <= 1) {
      setStatus('至少保留一个章节');
      return;
    }

    const confirmed = window.confirm(`确定删除章节《${selectedChapter.title}》吗？`);
    if (!confirmed) return;

    const deletedChapterNumber = selectedProject.chapters.findIndex((item) => item.id === selectedChapter.id) + 1;
    const remainingChapters = selectedProject.chapters.filter((item) => item.id !== selectedChapter.id);
    const nextProject = {
      ...selectedProject,
      chapters: remainingChapters,
      automation: cleanAutomationLedgersAfterChapterDelete(selectedProject.automation || {}, [deletedChapterNumber]),
    };
    setProjects((current) => current.map((item) => (item.id === nextProject.id ? nextProject : item)));
    setSelectedChapterId(remainingChapters[0]?.id || '');
    await saveProject(nextProject);
    setStatus('章节已删除');
  }

  async function addChapterBatch() {
    if (!selectedProject) return;
    const count = Math.max(1, Number(window.prompt('要批量新增多少章？', '5')) || 0);
    if (!count) return;
    const volumeId = selectedProject.volumes[0]?.id || '';
    const chapters = [...selectedProject.chapters, ...Array.from({ length: count }).map(() => makeChapter(volumeId))];
    const nextProject = { ...selectedProject, chapters };
    setProjects((current) => current.map((item) => (item.id === nextProject.id ? nextProject : item)));
    setSelectedChapterId(chapters.at(-1)?.id || selectedChapterId);
    await saveProject(nextProject);
    setStatus(`已批量新增 ${count} 章`);
  }

  async function deleteSelectedChapters() {
    if (!selectedProject || !selectedChapterIds.length) return;
    if (selectedProject.chapters.length - selectedChapterIds.length < 1) {
      setStatus('至少保留一个章节');
      return;
    }
    const confirmed = window.confirm(`确定删除选中的 ${selectedChapterIds.length} 个章节吗？`);
    if (!confirmed) return;
    const deletedChapterNumbers = selectedProject.chapters
      .map((chapter, chapterIndex) => (selectedChapterIds.includes(chapter.id) ? chapterIndex + 1 : null))
      .filter(Boolean);
    const chapters = selectedProject.chapters.filter((chapter) => !selectedChapterIds.includes(chapter.id));
    const nextProject = { ...selectedProject, chapters, automation: cleanAutomationLedgersAfterChapterDelete(selectedProject.automation || {}, deletedChapterNumbers) };
    setSelectedChapterIds([]);
    setProjects((current) => current.map((item) => (item.id === nextProject.id ? nextProject : item)));
    setSelectedChapterId(chapters[0]?.id || '');
    await saveProject(nextProject);
    setStatus(`已批量删除 ${selectedChapterIds.length} 章`);
  }

  async function copyCurrentChapterContent() {
    if (!selectedChapter) {
      setStatus('请先选择章节');
      return;
    }
    if (!selectedChapter.content) {
      setStatus('当前章节正文为空');
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(selectedChapter.content);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = selectedChapter.content;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setStatus(`已复制《${selectedChapter.title}》正文`);
    } catch {
      setStatus('复制失败，请检查系统剪贴板权限');
    }
  }

  async function generateCurrentChapter() {
    if (!selectedProject || !selectedChapter) return;
    try {
      setLoading(true);
      const chapterNumber = selectedChapterIndex >= 0 ? selectedChapterIndex + 1 : 1;
      const lightweight = Boolean(selectedProject.automation?.lightweightGeneration);
      setWritingProgress({ label: '生成当前章', current: 0, total: 1, chapter: chapterNumber, note: withAiLabel(`正在按${lightweight ? '轻量生成模式' : '章节卡'}生成第 ${chapterNumber} 章`, aiConfig, 'writing') });
      setStatus(withAiLabel(`正在按${lightweight ? '轻量生成模式' : '新版本单章质量模式'}生成第 ${chapterNumber} 章`, aiConfig, 'writing'));
      if (!lightweight) {
        const data = await apiWithAiAbort(`/api/projects/${selectedProject.id}/automation/generate-current`, {
          method: 'POST',
          body: JSON.stringify({ ...aiConfig, chapterId: selectedChapter.id, chapterNumber, lightweight }),
        });
        setProjects((current) => current.map((item) => (item.id === data.project.id ? data.project : item)));
        setSelectedChapterId(data.chapter?.id || selectedChapter.id);
        setAiOutput(data.text || data.chapter?.content || '');
        setChapterAuditReport('');
        setWritingProgress({ label: '生成当前章', current: 1, total: 1, chapter: chapterNumber, note: `已完成第 ${chapterNumber} 章` });
        setStatus((data.warnings || []).length ? `已生成当前章，但有警告：${data.warnings.join('；')}` : `已按新版本单章质量模式生成第 ${chapterNumber} 章`);
        return;
      }
      let savedData = null;
      setStreamPreview({ active: true, phase: '正在连接流式生成', text: '' });
      await apiStreamWithAiAbort(`/api/projects/${selectedProject.id}/automation/generate-current/stream`, {
        body: JSON.stringify({ ...aiConfig, chapterId: selectedChapter.id, chapterNumber, lightweight }),
        onEvent: (event) => {
          if (event.type === 'phase') {
            setStreamPreview((current) => ({ ...current, active: true, phase: event.text || '' }));
            setWritingProgress((current) => current ? { ...current, note: event.text || current.note } : current);
          }
          if (event.type === 'token') {
            setStreamPreview((current) => ({ ...current, active: true, text: `${current.text}${event.text || ''}` }));
          }
          if (event.type === 'saved') savedData = event;
          if (event.type === 'error') throw new Error(event.message || '当前章节流式生成失败');
        },
      });
      if (!savedData?.project) throw new Error('流式生成未返回保存结果');
      setProjects((current) => current.map((item) => (item.id === savedData.project.id ? savedData.project : item)));
      setSelectedChapterId(savedData.chapter?.id || selectedChapter.id);
      setAiOutput(savedData.output || savedData.chapter?.content || '');
      setChapterAuditReport('');
      setWritingProgress({ label: '生成当前章', current: 1, total: 1, chapter: chapterNumber, note: `已完成第 ${chapterNumber} 章` });
      setStatus(`已流式生成并保存第 ${chapterNumber} 章`);
    } catch (error) {
      setStatus(isAbortError(error) || /中断|Abort/i.test(error.message || '') ? '已中断当前章节生成' : error.message || '当前章节生成失败');
    } finally {
      currentAiAbortRef.current = null;
      setStreamPreview({ active: false, phase: '', text: '' });
      setWritingProgress(null);
      setLoading(false);
    }
  }

  async function addVolume(event) {
    event.preventDefault();
    if (!selectedProject || !volumeForm.title) return;
    const nextProject = { ...selectedProject, volumes: [...selectedProject.volumes, { id: crypto.randomUUID(), ...volumeForm }] };
    setVolumeForm(defaultVolume);
    setProjects((current) => current.map((item) => (item.id === nextProject.id ? nextProject : item)));
    await saveProject(nextProject);
  }

  async function deleteVolume(volumeId) {
    if (!selectedProject) return;
    if (selectedProject.volumes.length <= 1) {
      setStatus('至少保留一个分卷');
      return;
    }

    const targetVolume = selectedProject.volumes.find((item) => item.id === volumeId);
    const confirmed = window.confirm(`确定删除分卷《${targetVolume?.title || '未命名卷'}》吗？相关章节会自动转到第一卷。`);
    if (!confirmed) return;

    const remainingVolumes = selectedProject.volumes.filter((item) => item.id !== volumeId);
    const fallbackVolumeId = remainingVolumes[0]?.id || '';
    const fallbackVolumeName = remainingVolumes[0]?.title || '';
    const chapters = selectedProject.chapters.map((chapter) => (
      chapter.volumeId === volumeId ? { ...chapter, volumeId: fallbackVolumeId, updatedAt: new Date().toISOString() } : chapter
    ));
    const chapterCards = (selectedProject.automation?.chapterCards || []).map((card) => (
      card.volumeName === targetVolume?.title ? { ...card, volumeName: fallbackVolumeName } : card
    ));
    const nextProject = {
      ...selectedProject,
      volumes: remainingVolumes,
      chapters,
      automation: {
        ...selectedProject.automation,
        chapterCards,
        progressNotes: `已删除分卷《${targetVolume?.title || ''}》`,
      },
    };
    setProjects((current) => current.map((item) => (item.id === nextProject.id ? nextProject : item)));
    await saveProject(nextProject);
    setStatus(`已删除分卷《${targetVolume?.title || ''}》`);
  }

  async function addCharacter(event) {
    event.preventDefault();
    if (!selectedProject || !characterForm.name) return;
    const nextProject = { ...selectedProject, characters: [...selectedProject.characters, { id: crypto.randomUUID(), ...characterForm }] };
    setCharacterForm(defaultCharacter);
    setProjects((current) => current.map((item) => (item.id === nextProject.id ? nextProject : item)));
    await saveProject(nextProject);
  }

  async function addCharacterBatch() {
    if (!selectedProject) return;
    const count = Math.max(1, Number(window.prompt('要批量新增多少个角色？', '5')) || 0);
    if (!count) return;
    const characters = [
      ...selectedProject.characters,
      ...Array.from({ length: count }).map((_, index) => ({
        id: crypto.randomUUID(),
        ...defaultCharacter,
        name: `新角色${selectedProject.characters.length + index + 1}`,
      })),
    ];
    const nextProject = { ...selectedProject, characters };
    setProjects((current) => current.map((item) => (item.id === nextProject.id ? nextProject : item)));
    await saveProject(nextProject);
    setStatus(`已批量新增 ${count} 个角色`);
  }

  async function deleteSelectedCharacters() {
    if (!selectedProject || !selectedCharacterIds.length) return;
    const confirmed = window.confirm(`确定删除选中的 ${selectedCharacterIds.length} 个角色吗？`);
    if (!confirmed) return;
    const characters = selectedProject.characters.filter((character) => !selectedCharacterIds.includes(character.id));
    const nextProject = { ...selectedProject, characters };
    setSelectedCharacterIds([]);
    setProjects((current) => current.map((item) => (item.id === nextProject.id ? nextProject : item)));
    await saveProject(nextProject);
    setStatus(`已批量删除 ${selectedCharacterIds.length} 个角色`);
  }

  async function addRelation(event) {
    event.preventDefault();
    if (!selectedProject || !relationForm.from || !relationForm.to) return;
    const nextProject = { ...selectedProject, relations: [...selectedProject.relations, { id: crypto.randomUUID(), ...relationForm }] };
    setRelationForm(defaultRelation);
    setProjects((current) => current.map((item) => (item.id === nextProject.id ? nextProject : item)));
    await saveProject(nextProject);
  }

  async function addTimelineEvent(event) {
    event.preventDefault();
    if (!selectedProject || !timelineForm.title) return;
    const timeline = [...selectedProject.timeline, { id: crypto.randomUUID(), ...timelineForm }].sort((a, b) => a.order - b.order);
    const nextProject = { ...selectedProject, timeline };
    setTimelineForm(defaultTimelineEvent);
    setProjects((current) => current.map((item) => (item.id === nextProject.id ? nextProject : item)));
    await saveProject(nextProject);
  }

  async function runAi() {
    if (!selectedProject || !selectedChapter) return;
    const currentMode = aiModes.find((item) => item.key === aiMode);
    const userPrompt = [
      `作品名：${selectedProject.title}`,
      `类型：${selectedProject.genre}`,
      `目标读者：${selectedProject.targetAudience}`,
      `一句话 premise：${selectedProject.premise}`,
      `文风要求：${selectedProject.styleGuide}`,
      `世界观：${selectedProject.worldSetting}`,
      `角色资料：${selectedProject.characters.map((item) => `${item.name}/${item.role}/${item.goal}`).join('；')}`,
      `关系图：${selectedProject.relations.map((item) => `${item.from}-${item.type}-${item.to}`).join('；')}`,
      `时间线：${selectedProject.timeline.map((item) => `${item.order}.${item.title}`).join('；')}`,
      `大纲：${selectedProject.outline}`,
      `当前章节：${selectedChapter.title}`,
      `章节摘要：${selectedChapter.summary}`,
      `章节正文：${selectedChapter.content}`,
      `任务：${currentMode?.prompt || ''}`,
      `目标字数：控制在${chapterTargetWords}字左右，可上下浮动10%，但不能低于2000字。`,
      `额外要求：${aiExtraPrompt}`,
      '请只输出当前这一章需要的内容，不要提前写下一章。请直接输出中文正文内容，不要解释。',
    ].join('\n\n');
    try {
      setLoading(true);
      const data = await api('/api/ai/generate', {
        method: 'POST',
        body: JSON.stringify({ ...aiConfig, userPrompt, temperature: 0.95 }),
      });
      setAiOutput(data.text || '');
      setStatus('AI 生成完成');
    } catch (error) {
      setStatus(error.message || 'AI 生成失败');
    } finally {
      setLoading(false);
    }
  }

  async function saveAiSettings() {
    try {
      await api('/api/settings/ai', {
        method: 'PUT',
        body: JSON.stringify(aiConfig),
      });
      setStatus('全局 API 设置已保存');
    } catch (error) {
      setStatus(error.message || 'API 设置保存失败');
    }
  }

  function appendAiToChapter() {
    if (!selectedChapter || !aiOutput) return;
    updateSelectedChapter('content', selectedChapter.content ? `${selectedChapter.content}\n\n${aiOutput}` : aiOutput);
    setStatus('AI 内容已追加');
  }

  function viewMasterPlan() {
    const plan = selectedProject?.automation?.masterPlan || '';
    if (!plan) {
      setStatus('还没有长篇蓝图，请先生成长篇蓝图');
      return;
    }
    setAiOutput(plan);
    setActiveTab('ai');
    setStatus('已打开长篇蓝图');
  }

  async function checkCompliance() {
    if (!selectedProject) return;
    try {
      const report = await api(`/api/projects/${selectedProject.id}/compliance-check`, {
        method: 'POST',
        body: JSON.stringify({ project: selectedProject }),
      });
      const nextProject = { ...selectedProject, compliance: report };
      setProjects((current) => current.map((item) => (item.id === nextProject.id ? nextProject : item)));
      setStatus(`审查完成，风险等级：${report.riskLevel}`);
    } catch (error) {
      setStatus(error.message || '审查失败');
    }
  }

  async function toggleChecklistItem(item, checked) {
    if (!selectedProject) return;
    const checklistState = checked
      ? Array.from(new Set([...(selectedProject.checklistState || []), item]))
      : (selectedProject.checklistState || []).filter((current) => current !== item);
    const nextProject = { ...selectedProject, checklistState };
    setProjects((current) => current.map((project) => (project.id === nextProject.id ? nextProject : project)));
    await saveProject(nextProject, { silent: true });
  }

  async function generateFirstThreeChapters() {
    if (!selectedProject) return;
    try {
      setLoading(true);
      const data = await api('/api/ai/first-three-chapters', {
        method: 'POST',
        body: JSON.stringify({ ...aiConfig, project: selectedProject }),
      });
      setAiOutput(data.text || '');
      const firstVolumeId = selectedProject.volumes[0]?.id || '';
      const parsed = await api('/api/ai/parse-chapters', {
        method: 'POST',
        body: JSON.stringify({
          text: data.text || '',
          startChapter: 1,
          batchCount: 3,
          defaultVolumeId: firstVolumeId,
        }),
      });
      const generated = parsed.chapters || [];
      if (!generated.length) {
        setStatus('生成成功，但没有匹配到标准章节格式');
        return;
      }
      const nextProject = {
        ...selectedProject,
        chapters: generated.map((chapter) => ({ ...chapter, volumeId: firstVolumeId })),
      };
      setProjects((current) => current.map((item) => (item.id === nextProject.id ? nextProject : item)));
      setSelectedChapterId(nextProject.chapters[0]?.id || '');
      await saveProject(nextProject);
      setStatus('已一键生成前三章');
    } catch (error) {
      setStatus(error.message || '生成失败');
    } finally {
      setLoading(false);
    }
  }

  async function generateLongFormPlan() {
    if (!selectedProject) return;
    try {
      setLoading(true);
      setStatus(withAiLabel('正在生成长篇蓝图', aiConfig, 'planning'));
      const data = await api(`/api/projects/${selectedProject.id}/automation/plan`, {
        method: 'POST',
        body: JSON.stringify({
          ...aiConfig,
          inspiration: automationDraft.inspiration,
          minimumWords: Number(automationDraft.minimumWords) || 1500000,
          targetChapters: Number(automationDraft.targetChapters) || 600,
        }),
      });
      setAiOutput(data.text || '');
      setProjects((current) => current.map((item) => (item.id === data.project.id ? data.project : item)));
      setAuthorPersonaDraft(data.project?.automation?.authorPersona || data.authorPersona || '');
      setStatus('已生成长篇自动写作蓝图');
    } catch (error) {
      setStatus(error.message || '长篇规划失败');
    } finally {
      setLoading(false);
    }
  }

  async function loadAuthorPersona() {
    if (!selectedProject) return;
    try {
      const data = await api(`/api/projects/${selectedProject.id}/automation/author-persona`, {
        method: 'GET',
      });
      setAuthorPersonaDraft(data.authorPersona || data.source || '');
      setAiOutput(data.authorPersona || data.source || '');
      setStatus(data.authorPersona ? '已加载作者人设卡' : '已加载可生成作者人设的蓝图片段');
    } catch (error) {
      setStatus(error.message || '加载作者人设失败');
    }
  }

  async function generateAuthorPersona() {
    if (!selectedProject) return;
    try {
      setLoading(true);
      setStatus(withAiLabel('正在生成/更新作者人设卡', aiConfig, 'planning'));
      const data = await api(`/api/projects/${selectedProject.id}/automation/author-persona`, {
        method: 'POST',
        body: JSON.stringify({ ...aiConfig }),
      });
      setAuthorPersonaDraft(data.authorPersona || '');
      setAiOutput(data.authorPersona || data.text || '');
      setProjects((current) => current.map((item) => (item.id === data.project.id ? data.project : item)));
      setStatus('已生成作者人设卡');
    } catch (error) {
      setStatus(error.message || '生成作者人设失败');
    } finally {
      setLoading(false);
    }
  }

  async function saveAuthorPersona() {
    if (!selectedProject) return;
    try {
      setLoading(true);
      const data = await api(`/api/projects/${selectedProject.id}/automation/author-persona`, {
        method: 'PUT',
        body: JSON.stringify({ authorPersona: authorPersonaDraft }),
      });
      setAuthorPersonaDraft(data.authorPersona || '');
      setProjects((current) => current.map((item) => (item.id === data.project.id ? data.project : item)));
      setStatus('已保存作者人设卡');
    } catch (error) {
      setStatus(error.message || '保存作者人设失败');
    } finally {
      setLoading(false);
    }
  }

  async function saveBlueprintDraft() {
    if (!selectedProject) return;
    const nextProject = {
      ...selectedProject,
      automation: {
        ...selectedProject.automation,
        masterPlan: blueprintDraft,
        progressNotes: '用户已手动更新长篇蓝图，后续分卷、章节卡和自动写作会按新版蓝图执行',
      },
    };
    try {
      setLoading(true);
      const saved = await api(`/api/projects/${selectedProject.id}`, {
        method: 'PUT',
        body: JSON.stringify(nextProject),
      });
      setProjects((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      setAiOutput(saved.automation?.masterPlan || '');
      setStatus('已保存手动修改后的长篇蓝图');
    } catch (error) {
      setStatus(error.message || '保存蓝图失败');
    } finally {
      setLoading(false);
    }
  }

  async function rebuildAutomationLedgers() {
    if (!selectedProject) return;
    try {
      setLoading(true);
      const data = await api(`/api/projects/${selectedProject.id}/automation/rebuild-ledgers`, {
        method: 'POST',
      });
      setProjects((current) => current.map((item) => (item.id === data.project.id ? data.project : item)));
      setStatus(`已重建台账：角色记忆 ${data.project.automation?.characterStateMemory?.length || 0} 条`);
    } catch (error) {
      setStatus(error.message || '重建自动写作台账失败');
    } finally {
      setLoading(false);
    }
  }

  async function generateLongFormBatch() {
    if (!selectedProject) return;
    const total = Math.max(1, Number(automationDraft.batchCount) || 3);
    const startChapter = currentWrittenChapterCount + 1;
    let generatedCount = 0;
    let pauseMessage = '';
    try {
      setLoading(true);
      stopAiWritingRef.current = false;
      setAiOutput('');
      setStreamPreview({ active: true, phase: '准备逐章流式自动写作', text: '' });
      setWritingProgress({ label: '继续自动写作', current: 0, total, chapter: startChapter, note: withAiLabel(`准备写第 ${startChapter} 章`, aiConfig, 'writing') });

      for (let index = 0; index < total; index += 1) {
        if (stopAiWritingRef.current) break;
        const chapterNumber = startChapter + index;
        setWritingProgress({ label: '继续自动写作', current: index, total, chapter: chapterNumber, note: withAiLabel(`正在写第 ${chapterNumber} 章`, aiConfig, 'writing') });
        setStatus(withAiLabel(`正在写第 ${chapterNumber} 章（${index + 1}/${total}）`, aiConfig, 'writing'));

        let data = null;
        setStreamPreview({ active: true, phase: `正在连接第 ${chapterNumber} 章流式生成`, text: '' });
        await apiStreamWithAiAbort(`/api/projects/${selectedProject.id}/automation/generate-next/stream`, {
          body: JSON.stringify({
            ...aiConfig,
            targetChapter: chapterNumber,
            targetProgress: startChapter + total - 1,
            lightweight: Boolean(selectedProject.automation?.lightweightGeneration),
          }),
          onEvent: (event) => {
            if (event.type === 'phase') {
              setStreamPreview((current) => ({ ...current, active: true, phase: event.text || '' }));
              setWritingProgress((current) => current ? { ...current, note: event.text || current.note } : current);
            }
            if (event.type === 'token') {
              setStreamPreview((current) => ({ ...current, active: true, text: `${current.text}${event.text || ''}` }));
            }
            if (event.type === 'saved') data = event;
            if (event.type === 'error') throw new Error(event.message || '自动写作流式生成失败');
          },
        });
        if (!data?.project) throw new Error('自动写作流式生成未返回保存结果');

        generatedCount += data.chapters?.length || 0;
        setAiOutput((current) => [current, data.output || data.text].filter(Boolean).join('\n\n'));
        setProjects((current) => current.map((item) => (item.id === data.project.id ? data.project : item)));
        setSelectedChapterId(data.project.chapters.at(-1)?.id || selectedChapterId);
        setWritingProgress({ label: '继续自动写作', current: index + 1, total, chapter: chapterNumber, note: `已完成第 ${chapterNumber} 章` });

        if (data.pausedForReview || data.project.automation?.waitingForReview || data.project.automation?.status === 'review' || data.project.automation?.status === 'checkpoint') {
          pauseMessage = data.project.automation?.progressNotes || `第 ${chapterNumber} 章需要确认，已暂停自动写作`;
          setStatus(pauseMessage);
          break;
        }
        if (!data.chapters?.length) break;
      }

      setStatus(stopAiWritingRef.current
        ? `已中断自动写作，本轮完成 ${generatedCount} 章`
        : pauseMessage
          ? pauseMessage
          : `已逐章流式生成 ${generatedCount} 章`);
    } catch (error) {
      setStatus(isAbortError(error) ? `已中断自动写作，本轮完成 ${generatedCount} 章` : error.message || '批量生成失败');
    } finally {
      setWritingProgress((current) => current ? { ...current, current: generatedCount, note: stopAiWritingRef.current ? `已中断，本轮完成 ${generatedCount} 章` : generatedCount ? `本轮完成 ${generatedCount} 章` : '本轮未完成章节' } : null);
      currentAiAbortRef.current = null;
      setStreamPreview({ active: false, phase: '', text: '' });
      setLoading(false);
    }
  }

  async function autoSplitVolumes() {
    if (!selectedProject) return;
    try {
      setLoading(true);
      setStatus(withAiLabel('正在自动分卷', aiConfig, 'volume'));
      const data = await api(`/api/projects/${selectedProject.id}/automation/auto-volumes`, {
        method: 'POST',
        body: JSON.stringify(aiConfig),
      });
      setAiOutput(data.text || '');
      setProjects((current) => current.map((item) => (item.id === data.project.id ? data.project : item)));
      setStatus('已自动分卷');
    } catch (error) {
      setStatus(error.message || '自动分卷失败');
    } finally {
      setLoading(false);
    }
  }

  async function generateChapterCards() {
    if (!selectedProject) return;
    const targetChapter = Number(automationDraft.chapterCardTargetChapter) || Number(automationDraft.targetChapters) || 600;
    const existingCount = selectedProject.automation?.chapterCards?.length || 0;
    const totalNeeded = Math.max(0, targetChapter - existingCount);
    const batchStart = existingCount + 1;
    let generatedCount = 0;
    let latestCardCount = existingCount;
    try {
      setLoading(true);
      stopAiWritingRef.current = false;
      if (totalNeeded <= 0) throw new Error(`章节卡已排到第 ${existingCount} 章，目标章节必须更大`);
      setAiOutput('');
      setWritingProgress({ label: '自动排章节卡', current: 0, total: totalNeeded || 0, chapter: batchStart, note: withAiLabel(`准备补排第 ${batchStart}-${targetChapter} 章`, aiConfig, 'chapter-card') });

      let currentTarget = Math.min(existingCount + chapterCardBatchSize, targetChapter);
      while (latestCardCount < targetChapter) {
        if (stopAiWritingRef.current) break;
        const previousCardCount = latestCardCount;
        setWritingProgress({ label: '自动排章节卡', current: generatedCount, total: totalNeeded, chapter: batchStart, note: withAiLabel(`正在补排第 ${batchStart}-${Math.min(currentTarget, targetChapter)} 章`, aiConfig, 'chapter-card') });
        setStatus(withAiLabel(`正在自动补排章节卡（第 ${batchStart}-${Math.min(currentTarget, targetChapter)} 章，${generatedCount}/${totalNeeded}）`, aiConfig, 'chapter-card'));

        let data = null;
        setStreamPreview({ active: true, phase: '正在连接章节卡流式生成', text: '' });
        await apiStreamWithAiAbort(`/api/projects/${selectedProject.id}/automation/chapter-cards/stream`, {
          body: JSON.stringify({ ...aiConfig, targetChapter: Math.min(currentTarget, targetChapter) }),
          onEvent: (event) => {
            if (event.type === 'phase') {
              setStreamPreview((current) => ({ ...current, active: true, phase: event.text || '' }));
              setWritingProgress((current) => current ? { ...current, note: event.text || current.note } : current);
            }
            if (event.type === 'token') {
              setStreamPreview((current) => ({ ...current, active: true, text: `${current.text}${event.text || ''}` }));
            }
            if (event.type === 'saved') data = event;
            if (event.type === 'error') throw new Error(event.message || '章节卡流式生成失败');
          },
        });
        if (!data?.project) throw new Error('章节卡流式生成未返回保存结果');

        const nextCount = data.project.automation?.chapterCards?.length || 0;
        latestCardCount = nextCount;
        generatedCount = nextCount - existingCount;
        setAiOutput((current) => [current, data.output].filter(Boolean).join('\n\n'));
        setProjects((current) => current.map((item) => (item.id === data.project.id ? data.project : item)));
        setWritingProgress({ label: '自动排章节卡', current: generatedCount, total: totalNeeded, chapter: Math.min(currentTarget, targetChapter), note: `已排到第 ${nextCount} 张章节卡` });

        if (nextCount >= targetChapter) break;
        if (nextCount <= previousCardCount) break;
        currentTarget = Math.min(currentTarget + chapterCardBatchSize, targetChapter);
      }

      setStatus(stopAiWritingRef.current ? `已中断自动排章节卡，本轮完成 ${generatedCount} 张` : `已自动补排到第 ${Math.min(targetChapter, latestCardCount)} 章`);
    } catch (error) {
      setStatus(isAbortError(error) || /中断|Abort/i.test(error.message || '') ? `已中断自动排章节卡，本轮完成 ${generatedCount} 张` : error.message || '章节卡生成失败');
    } finally {
      setWritingProgress((current) => current ? { ...current, note: stopAiWritingRef.current ? `已中断，本轮完成 ${generatedCount} 张章节卡` : generatedCount ? `本轮完成 ${generatedCount} 张章节卡` : '本轮未完成章节卡' } : null);
      currentAiAbortRef.current = null;
      setStreamPreview({ active: false, phase: '', text: '' });
      setLoading(false);
    }
  }

  async function openChapterView() {
    if (!selectedProject) return;
    setActiveTab('chapters');
  }

  async function openChapterCardView() {
    if (!selectedProject) return;
    setActiveTab('chapterCards');
  }

  function jumpToChapter() {
    if (!selectedProject) return;
    const chapterNumber = Math.max(1, Number(chapterJumpValue) || 1);
    const chapter = selectedProject.chapters[chapterNumber - 1];
    if (!chapter) {
      setStatus(`没有第 ${chapterNumber} 章`);
      return;
    }
    setSelectedChapterId(chapter.id);
    setStatus(`已跳到第 ${chapterNumber} 章`);
  }

  async function writeToTargetProgress() {
    if (!selectedProject) return;
    const target = Number(automationDraft.targetProgress) || 60;
    const startCount = currentWrittenChapterCount;
    const total = Math.max(0, target - startCount);
    let completed = 0;
    let reachedCheckpoint = false;
    let pauseMessage = '';
    try {
      setLoading(true);
      stopAiWritingRef.current = false;
      if (total <= 0) throw new Error('目标进度必须大于当前章节数');
      setAiOutput('');
      setStreamPreview({ active: true, phase: '准备逐章流式推进', text: '' });
      setWritingProgress({ label: '写到指定进度', current: 0, total, chapter: startCount + 1, note: withAiLabel(`准备写到第 ${target} 章`, aiConfig, 'writing') });

      for (let chapterNumber = startCount + 1; chapterNumber <= target; chapterNumber += 1) {
        if (stopAiWritingRef.current) break;
        setWritingProgress({ label: '写到指定进度', current: completed, total, chapter: chapterNumber, note: withAiLabel(`正在写第 ${chapterNumber} 章`, aiConfig, 'writing') });
        setStatus(withAiLabel(`正在写第 ${chapterNumber} 章，目标第 ${target} 章（${completed + 1}/${total}）`, aiConfig, 'writing'));

        let data = null;
        setStreamPreview({ active: true, phase: `正在连接第 ${chapterNumber} 章流式生成`, text: '' });
        await apiStreamWithAiAbort(`/api/projects/${selectedProject.id}/automation/generate-next/stream`, {
          body: JSON.stringify({
            ...aiConfig,
            targetChapter: chapterNumber,
            targetProgress: target,
            stopAtCheckpoint: true,
            lightweight: Boolean(selectedProject.automation?.lightweightGeneration),
          }),
          onEvent: (event) => {
            if (event.type === 'phase') {
              setStreamPreview((current) => ({ ...current, active: true, phase: event.text || '' }));
              setWritingProgress((current) => current ? { ...current, note: event.text || current.note } : current);
            }
            if (event.type === 'token') {
              setStreamPreview((current) => ({ ...current, active: true, text: `${current.text}${event.text || ''}` }));
            }
            if (event.type === 'saved') data = event;
            if (event.type === 'error') throw new Error(event.message || '自动推进流式生成失败');
          },
        });
        if (!data?.project) throw new Error('自动推进流式生成未返回保存结果');

        completed += data.chapters?.length || 0;
        reachedCheckpoint = Boolean(data.reachedCheckpoint);
        setAiOutput((current) => [current, data.output || data.text].filter(Boolean).join('\n\n'));
        setProjects((current) => current.map((item) => (item.id === data.project.id ? data.project : item)));
        setSelectedChapterId(data.project.chapters.at(-1)?.id || selectedChapterId);
        setWritingProgress({ label: '写到指定进度', current: completed, total, chapter: chapterNumber, note: `已完成第 ${chapterNumber} 章` });

        if (data.pausedForReview || data.project.automation?.waitingForReview || data.project.automation?.status === 'review' || data.project.automation?.status === 'checkpoint') {
          pauseMessage = data.project.automation?.progressNotes || `第 ${chapterNumber} 章需要确认，已暂停自动推进`;
          setStatus(pauseMessage);
          break;
        }
        if (reachedCheckpoint || !data.chapters?.length) break;
      }

      setStatus(stopAiWritingRef.current ? `已中断自动推进，本轮完成 ${completed} 章` : pauseMessage || (reachedCheckpoint ? '已到检查点，请先确认' : '已自动推进到新的写作进度'));
    } catch (error) {
      setStatus(isAbortError(error) ? `已中断自动推进，本轮完成 ${completed} 章` : error.message || '自动推进失败');
    } finally {
      setWritingProgress((current) => current ? { ...current, current: completed, note: stopAiWritingRef.current ? `已中断，本轮完成 ${completed} 章` : completed ? `本轮完成 ${completed} 章` : '本轮未完成章节' } : null);
      currentAiAbortRef.current = null;
      setStreamPreview({ active: false, phase: '', text: '' });
      setLoading(false);
    }
  }

  async function runCheckpointReview(kind = '') {
    if (!selectedProject) return;
    const label = kind === 'major' ? '100章大阶段检查报告' : '阶段检查报告';
    try {
      setLoading(true);
      setStatus(withAiLabel(`正在生成${label}`, aiConfig, 'checkpoint'));
      const data = await api(`/api/projects/${selectedProject.id}/automation/checkpoint`, {
        method: 'POST',
        body: JSON.stringify({ ...aiConfig, kind }),
      });
      setAiOutput(data.text || '');
      setProjects((current) => current.map((item) => (item.id === data.project.id ? data.project : item)));
      setCheckpointPanel((current) => ({
        ...current,
        currentReport: data.project.automation?.checkpointReport || data.text || '',
        reports: data.project.automation?.checkpointReports || current.reports,
        retentionCount: data.project.automation?.checkpointRetentionCount || current.retentionCount || 20,
      }));
      setStatus(`已完成${data.label || label}，等待你确认`);
    } catch (error) {
      setStatus(error.message || '检查点分析失败');
    } finally {
      setLoading(false);
    }
  }

  async function saveCheckpointAdviceToBlueprint() {
    if (!selectedProject || !checkpointPanel.currentReport) return;
    const addition = [
      '',
      `【阶段检查建议｜第${currentWrittenChapterCount || selectedProject.chapters.length}章】`,
      checkpointPanel.currentReport,
    ].join('\n');
    const nextProject = {
      ...selectedProject,
      automation: {
        ...selectedProject.automation,
        masterPlan: `${selectedProject.automation?.masterPlan || ''}${addition}`,
        progressNotes: '已将阶段检查建议追加到长篇蓝图，后续分卷、章节卡和自动写作会参考新版蓝图',
      },
    };
    try {
      setLoading(true);
      const saved = await api(`/api/projects/${selectedProject.id}`, {
        method: 'PUT',
        body: JSON.stringify(nextProject),
      });
      setProjects((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      setBlueprintDraft(saved.automation?.masterPlan || '');
      setStatus('已把阶段检查建议追加到长篇蓝图');
    } catch (error) {
      setStatus(error.message || '保存检查建议到蓝图失败');
    } finally {
      setLoading(false);
    }
  }

  async function rerankFutureChapterCardsFromCheckpoint() {
    if (!selectedProject) return;
    const targetChapter = Number(automationDraft.chapterCardTargetChapter) || Number(selectedProject.automation?.targetChapters) || 600;
    const keepCount = currentWrittenChapterCount;
    const existingCards = selectedProject.automation?.chapterCards || [];
    if (targetChapter <= keepCount) {
      setStatus(`目标章节必须大于当前正文进度第 ${keepCount} 章`);
      return;
    }
    const nextProject = {
      ...selectedProject,
      automation: {
        ...selectedProject.automation,
        chapterCards: existingCards.slice(0, keepCount),
        progressNotes: `已保留前 ${keepCount} 张章节卡，准备按阶段检查建议重排后续章节卡`,
      },
    };
    try {
      setLoading(true);
      const saved = await api(`/api/projects/${selectedProject.id}`, {
        method: 'PUT',
        body: JSON.stringify(nextProject),
      });
      setProjects((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      setAutomationDraft((current) => ({ ...current, chapterCardTargetChapter: targetChapter }));
      setStatus(`已截断到第 ${keepCount} 张章节卡。请切到自动写作中心点击“自动排章节卡”，重排到第 ${targetChapter} 章。`);
      setActiveTab('automate');
    } catch (error) {
      setStatus(error.message || '准备重排章节卡失败');
    } finally {
      setLoading(false);
    }
  }

  async function resumeAfterReview() {
    if (!selectedProject) return;
    try {
      const data = await api(`/api/projects/${selectedProject.id}/automation/resume`, {
        method: 'POST',
      });
      setProjects((current) => current.map((item) => (item.id === data.project.id ? data.project : item)));
      setStatus('已确认蓝图一致性，可继续自动写作');
    } catch (error) {
      setStatus(error.message || '恢复自动写作失败');
    }
  }

  async function resetAutomationRuntime() {
    if (!selectedProject) return;
    const confirmed = window.confirm('确定清空自动写作运行态台账吗？这会清空连续性记忆、伏笔台账、读者期待、爽点、角色记忆、系统规则、功能日历和检查点报告，但会保留章节卡、已写章节、蓝图和分卷。');
    if (!confirmed) return;
    const doubleConfirmed = window.confirm('请再次确认：章节卡会保留，后续自动写作会沿用现有章节卡，但运行态台账会重新开始。确定继续吗？');
    if (!doubleConfirmed) return;
    try {
      setLoading(true);
      const data = await api(`/api/projects/${selectedProject.id}/automation/reset-runtime`, {
        method: 'POST',
      });
      setProjects((current) => current.map((item) => (item.id === data.project.id ? data.project : item)));
      setCheckpointPanel((current) => ({ ...current, currentReport: '', reports: [] }));
      setStatus('已清空自动写作运行态台账，章节卡已保留');
    } catch (error) {
      setStatus(error.message || '清空自动写作台账失败');
    } finally {
      setLoading(false);
    }
  }

  async function repairChapterRange() {
    if (!selectedProject) return;
    try {
      setLoading(true);
      setStatus(withAiLabel(`正在修订第 ${Number(automationDraft.repairStartChapter) || 1}-${Number(automationDraft.repairEndChapter) || Number(automationDraft.repairStartChapter) || 1} 章`, aiConfig, 'repair'));
      const data = await api(`/api/projects/${selectedProject.id}/automation/repair-range`, {
        method: 'POST',
        body: JSON.stringify({
          ...aiConfig,
          startChapter: Number(automationDraft.repairStartChapter) || 1,
          endChapter: Number(automationDraft.repairEndChapter) || Number(automationDraft.repairStartChapter) || 1,
          repairInstruction: automationDraft.repairInstruction,
        }),
      });
      setAiOutput(data.text || '');
      setProjects((current) => current.map((item) => (item.id === data.project.id ? data.project : item)));
      setSelectedChapterId(data.chapters[0]?.id || selectedChapterId);
      setStatus(`已修订 ${data.chapters.length} 章，内容已写回章节管理`);
    } catch (error) {
      setStatus(error.message || '章节范围修订失败');
    } finally {
      setLoading(false);
    }
  }

  async function auditCurrentChapter() {
    if (!selectedProject || !selectedChapter) return;
    if (!selectedChapter.content) {
      setStatus('当前章节正文为空，无法巡检');
      return;
    }

    try {
      setLoading(true);
      setStatus(withAiLabel('正在巡检当前章节', aiConfig, 'audit'));
      const data = await api(`/api/projects/${selectedProject.id}/chapters/${selectedChapter.id}/audit`, {
        method: 'POST',
        body: JSON.stringify({ ...aiConfig, project: selectedProject }),
      });
      setChapterAuditReport(data.report || '');
      setAiOutput(data.report || '');
      setStatus('已完成当前章节巡检');
    } catch (error) {
      setStatus(error.message || '当前章节巡检失败');
    } finally {
      setLoading(false);
    }
  }

  async function rewriteCurrentChapterByAudit() {
    if (!selectedProject || !selectedChapter) return;
    if (!selectedChapter.content) {
      setStatus('当前章节正文为空，无法修订');
      return;
    }

    try {
      setLoading(true);
      setStatus(withAiLabel('正在按巡检建议修订当前章节', aiConfig, 'rewrite'));
      const data = await api(`/api/projects/${selectedProject.id}/chapters/${selectedChapter.id}/audit-rewrite`, {
        method: 'POST',
        body: JSON.stringify({ ...aiConfig, project: selectedProject, auditText: chapterAuditReport }),
      });
      setProjects((current) => current.map((item) => (item.id === data.project.id ? data.project : item)));
      setSelectedChapterId(data.chapter?.id || selectedChapterId);
      setChapterAuditReport(data.report || '');
      setAiOutput(data.report || '');
      setStatus('已根据巡检建议修订当前章节');
    } catch (error) {
      setStatus(error.message || '当前章节修订失败');
    } finally {
      setLoading(false);
    }
  }

  function exportProject() {
    if (!selectedProject) return;
    const blob = new Blob([JSON.stringify(selectedProject, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedProject.title || 'novel-project'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportProjectTxt() {
    if (!selectedProject) return;
    const content = [
      selectedProject.title,
      '',
      `类型：${selectedProject.genre}`,
      `目标读者：${selectedProject.targetAudience || ''}`,
      '',
      '简介',
      selectedProject.summary || '',
      '',
      ...selectedProject.chapters.flatMap((chapter) => [chapter.title, '', chapter.content || '', '', '']),
    ].join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedProject.title || 'novel-project'}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function deleteProject() {
    if (!selectedProject) return;
    const confirmed = window.confirm(`确定删除作品《${selectedProject.title}》吗？`);
    if (!confirmed) return;

    try {
      await api(`/api/projects/${selectedProject.id}`, { method: 'DELETE' });
      const remaining = projects.filter((item) => item.id !== selectedProject.id);
      setProjects(remaining);
      setSelectedProjectId(remaining[0]?.id || '');
      setSelectedChapterId(remaining[0]?.chapters[0]?.id || '');
      setStatus('作品已删除');
    } catch (error) {
      setStatus(error.message || '删除失败');
    }
  }

  if (!token || !currentUser) {
    return (
      <div className="auth-shell">
        <div className="auth-card panel">
          <p className="eyebrow">AI Novel Studio Desktop</p>
          <h1>本地多用户小说工作台</h1>
          <p className="muted">支持独立账号、独立作品库、DeepSeek 创作和番茄发布准备。</p>
          <div className="auth-switch">
            <button type="button" className={authMode === 'login' ? 'chip active' : 'chip'} onClick={() => setAuthMode('login')}>登录</button>
            <button type="button" className={authMode === 'register' ? 'chip active' : 'chip'} onClick={() => setAuthMode('register')}>注册</button>
          </div>
          <form className="form-panel" onSubmit={handleAuth}>
            <input placeholder="账号" value={authForm.username} onChange={(event) => setAuthForm((current) => ({ ...current, username: event.target.value }))} />
            {authMode === 'register' ? (
              <input placeholder="显示名" value={authForm.displayName} onChange={(event) => setAuthForm((current) => ({ ...current, displayName: event.target.value }))} />
            ) : null}
            <input type="password" placeholder="密码" value={authForm.password} onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))} />
            <button type="submit">{authMode === 'login' ? '登录进入工作台' : '注册并进入工作台'}</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell enhanced">
      <aside className="sidebar">
        <div className="brand-panel app-brand">
          <p className="eyebrow">AI Novel Studio</p>
          <h1>创作终端</h1>
          <p className="muted">{currentUser.displayName} / v{appVersion}</p>
        </div>

        <div className="panel sidebar-section project-switcher">
          <div className="section-header">
            <h2>当前作品</h2>
            <button type="button" className="secondary small" onClick={() => setShowCreateProject(true)}>新建</button>
          </div>
          <div className="sidebar-meta">
            <span>{projects.length} 部作品</span>
            <span>{selectedProject?.chapters.length || 0} 章</span>
          </div>
          <select value={selectedProjectId} onChange={(event) => {
            const project = projects.find((item) => item.id === event.target.value);
            setSelectedProjectId(event.target.value);
            setSelectedChapterId(project?.chapters[0]?.id || '');
          }}>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
          </select>
        </div>

        <div className="panel sidebar-section">
          <div className="section-header">
            <h2>导航</h2>
            <span>{currentTabMeta.label}</span>
          </div>
          <div className="nav-list">
            {navigationTabs.map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={activeTab === item.key ? 'nav-item active' : 'nav-item'}
                  onClick={() => setActiveTab(item.key)}
                >
                  <span className="nav-item-index">{index + 1}</span>
                  <Icon size={16} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="sidebar-footer">
          <button type="button" className="secondary" onClick={() => saveProject()}><Save size={16} /> 保存</button>
          <button type="button" className="secondary" onClick={() => setShowChangelog(true)}><Megaphone size={16} /> 公告</button>
          <button type="button" className="secondary" onClick={() => setShowShortcuts(true)}><Keyboard size={16} /> 快捷键</button>
          <button type="button" className="secondary" onClick={logout}>退出登录</button>
        </div>
      </aside>

      <main className="workspace">
        {selectedProject ? (
          <>
            <section className="page-header panel">
              <div>
                <p className="eyebrow">{currentTabMeta.label}</p>
                <h2>{selectedProject.title}</h2>
                <p className="muted">{selectedProject.genre} / {selectedProject.targetAudience || '待补充读者定位'} / {selectedProject.chapters.length} 章</p>
              </div>
              <div className={assistantIsProcessing ? 'assistant-card is-processing' : 'assistant-card'}>
                <div className="assistant-status-icon"><Bot size={22} /></div>
                <div>
                  <strong>AI 助手</strong>
                  <span>{aiConfig.profiles?.[aiConfig.activeProfile]?.label || aiConfig.model || 'deepseek-v4-flash'} · {aiConfig.model || 'deepseek-v4-flash'}</span>
                  <small>{assistantIsProcessing ? '处理中' : '待命中'}</small>
                </div>
              </div>
              <div className="hero-actions row">
                <button type="button" className="secondary" onClick={() => saveProject()}>保存作品</button>
                <button type="button" className="secondary" onClick={exportProjectTxt}>导出TXT</button>
                <button type="button" className="secondary" onClick={exportProject}>导出工程</button>
                <button type="button" className="secondary" onClick={() => setActiveTab('settings')}>作品设定</button>
                <button type="button" className="secondary" onClick={deleteProject}><Trash2 size={16} /> 删除作品</button>
              </div>
            </section>

            {activeTab === 'overview' ? (
              <section className="overview-hero panel">
                <div className="overview-hero-copy">
                  <p className="eyebrow">Project Status</p>
                  <h2>{selectedProject.title}</h2>
                  <p className="muted">{selectedProject.summary || selectedProject.premise || '完善作品设定后，AI 会基于这些资料生成蓝图、章节卡和正文。'}</p>
                  <div className="hero-metric-row">
                    <span><strong>{currentWrittenChapterCount}</strong> 已写章节</span>
                    <span><strong>{chapterCardCount}</strong> 章节卡</span>
                    <span><strong>{selectedProject.volumes.length}</strong> 分卷</span>
                  </div>
                </div>
                <div className="assistant-showcase-card">
                  <div className="assistant-status-bubble">
                    <span className={assistantIsProcessing ? 'status-dot active' : 'status-dot'} />
                    <strong>AI 助手</strong>
                    <small>{assistantIsProcessing ? '处理中' : selectedProject.automation?.progressNotes || '待命中'}</small>
                  </div>
                  <Live2DAssistant state={activeAssistantState} />
                  <div className="assistant-pose-row">
                    {Object.keys(assistantStateLabels).map((pose) => (
                      <button key={pose} type="button" className={assistantPose === pose ? 'chip active small' : 'chip small'} onClick={() => setAssistantPose(pose)} disabled={assistantIsProcessing}>
                        {assistantStateLabels[pose]}
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            ) : null}

            <section className="dashboard-grid">
              <article className="stat-card accent-pink">
                <span>章节</span>
                <strong>{selectedProject.chapters.length}</strong>
                <small>当前章节：{selectedChapter?.title || '未选择'}</small>
              </article>
              <article className="stat-card accent-blue">
                <span>总字数</span>
                <strong>{totalProjectWords}</strong>
                <small>目标：{selectedProject.automation?.minimumWords || 1500000}</small>
              </article>
              <article className="stat-card accent-violet">
                <span>角色</span>
                <strong>{selectedProject.characters.length}</strong>
                <small>人物卡与关系网</small>
              </article>
              <article className="stat-card accent-mint">
                <span>自动写作</span>
                <strong>{automationStage}</strong>
                <small>{selectedProject.automation?.progressNotes || '等待启动'}</small>
              </article>
            </section>

            <section className="workflow-strip panel">
              <div>
                <p className="eyebrow">Quick Quest</p>
                <h2>下一步：{nextWorkflowAction.label}</h2>
                <p className="muted">推荐流程：蓝图 → 分卷 → 章节卡 → 批量写作 → 20 章检查点。</p>
              </div>
              <div className="hero-actions row">
                <button type="button" onClick={() => setActiveTab(nextWorkflowAction.tab)}>进入长篇引擎</button>
                <button type="button" className="secondary" onClick={() => setActiveTab('chapters')}>编辑章节</button>
                <button type="button" className="secondary" onClick={() => setActiveTab('characters')}>整理角色</button>
                <button type="button" className="secondary" onClick={() => setActiveTab('chapterCards')}>查看章节卡</button>
              </div>
            </section>

            <section className="phase-strip panel">
              <div className="section-header">
                <h2>当前阶段</h2>
                <span>{selectedProject.automation?.progressNotes || '等待启动'}</span>
              </div>
              <div className="phase-steps">
                {automationSteps.map((step) => (
                  <span key={step.label} className={step.done ? 'phase-step done' : 'phase-step'}>{step.label}</span>
                ))}
              </div>
            </section>

            {activeTab === 'overview' ? (
              <section className="dashboard-layout">
                <div className="panel overview-quick-card">
                  <div className="section-header">
                    <h2>下一步</h2>
                    <span>{nextWorkflowAction.label}</span>
                  </div>
                  <div className="quick-entry-grid">
                    <button type="button" onClick={() => setActiveTab(nextWorkflowAction.tab)}>执行下一步</button>
                    <button type="button" onClick={() => setActiveTab('chapters')}>进入章节管理</button>
                    <button type="button" className="secondary" onClick={exportProjectTxt}>导出TXT</button>
                    <button type="button" className="secondary" onClick={() => setActiveTab('chapterCards')}>进入章节卡管理</button>
                    <button type="button" className="secondary" onClick={() => setActiveTab('inspect')}>进入检查修订</button>
                  </div>
                  <p className="muted">当前写到第 {currentWrittenChapterCount} 章，章节卡 {chapterCardCount} 张，下一个检查点：第 {Math.ceil((currentWrittenChapterCount + 1) / 20) * 20} 章。</p>
                </div>
                <div className="panel dashboard-notes">
                  <div className="section-header"><h2>最近章节</h2><button type="button" className="secondary small" onClick={() => setActiveTab('chapters')}>打开编辑器</button></div>
                  {(selectedProject.chapters || []).slice(-5).reverse().map((chapter) => (
                    <article key={chapter.id} className="mini-card">
                      <strong>{chapter.title}</strong>
                      <small>{countWords(chapter.content)} 字 / {chapter.summary || '暂无摘要'}</small>
                    </article>
                  ))}
                </div>
                <div className="panel dashboard-notes">
                  <div className="section-header"><h2>蓝图状态</h2><button type="button" className="secondary small" onClick={viewMasterPlan}>查看全文</button></div>
                  <p>{selectedProject.automation?.masterPlan ? '蓝图已生成，后续章节和章节卡会参考蓝图推进。' : '尚未生成蓝图，请进入 AI 流程生成。'}</p>
                  <p className="muted">AI 输出摘要：{aiOutput ? aiOutput.slice(0, 160) : '暂无最近输出'}</p>
                </div>
              </section>
            ) : null}

            {activeTab === 'settings' ? (
              <section className="grid-2 overview-grid">
                <div className="panel settings-panel">
                  <div className="section-header"><h2>作品设定</h2><span>核心资料</span></div>
                  <input value={selectedProject.title} onChange={(event) => updateSelectedProject('title', event.target.value)} />
                  <input value={selectedProject.genre} onChange={(event) => updateSelectedProject('genre', event.target.value)} />
                  <textarea value={selectedProject.premise} onChange={(event) => updateSelectedProject('premise', event.target.value)} placeholder="一句话 premise" />
                  <textarea value={selectedProject.summary} onChange={(event) => updateSelectedProject('summary', event.target.value)} placeholder="故事简介" />
                  <textarea value={selectedProject.worldSetting} onChange={(event) => updateSelectedProject('worldSetting', event.target.value)} placeholder="世界观" />
                  <textarea value={selectedProject.characterProfiles} onChange={(event) => updateSelectedProject('characterProfiles', event.target.value)} placeholder="角色概览" />
                  <textarea value={selectedProject.outline} onChange={(event) => updateSelectedProject('outline', event.target.value)} placeholder="主线大纲" />
                  <textarea value={selectedProject.notes} onChange={(event) => updateSelectedProject('notes', event.target.value)} placeholder="灵感与伏笔" />
                </div>
                <div className="panel blueprint-panel">
                  <div className="section-header">
                    <h2>长篇蓝图</h2>
                    <div className="row wrap">
                      <button type="button" className="secondary small" onClick={viewMasterPlan}>在 AI 输出中查看</button>
                      <button type="button" className="small" onClick={saveBlueprintDraft} disabled={loading}>保存蓝图修改</button>
                    </div>
                  </div>
                  <textarea
                    className="blueprint-editor"
                    placeholder="还没有蓝图。进入“AI 创作与长篇引擎”后点击“生成长篇蓝图”，或在这里手动写入/粘贴蓝图。"
                    value={blueprintDraft}
                    onChange={(event) => setBlueprintDraft(event.target.value)}
                  />
                  <p className="muted">保存后会保留你手动修改的蓝图，后续分卷、章节卡、自动写作和检查点都会读取这里的版本。</p>
                </div>
                <div className="panel blueprint-panel">
                  <div className="section-header">
                    <h2>作者人设卡</h2>
                    <div className="row wrap">
                      <button type="button" className="secondary small" onClick={loadAuthorPersona}>查看/读取</button>
                      <button type="button" className="secondary small" onClick={generateAuthorPersona} disabled={loading}>生成/更新</button>
                      <button type="button" className="secondary small" onClick={saveAuthorPersona} disabled={loading}>保存修改</button>
                    </div>
                  </div>
                  <textarea
                    className="persona-editor"
                    placeholder="作者人设卡会在这里显示，可手动修改后保存。"
                    value={authorPersonaDraft}
                    onChange={(event) => setAuthorPersonaDraft(event.target.value)}
                  />
                  <p className="muted">如果已有蓝图，不需要重跑蓝图，直接查看、生成或修改作者人设卡即可。</p>
                </div>
              </section>
            ) : null}

            {activeTab === 'chapters' ? (
              <section className="panel chapter-page">
                <div className="section-header">
                  <h2>章节管理</h2>
                  <div className="row wrap">
                    <input className="inline-number" type="number" min="1" placeholder="跳到第几章" value={chapterJumpValue} onChange={(event) => setChapterJumpValue(event.target.value)} />
                    <button type="button" className="secondary small" onClick={jumpToChapter}>跳转</button>
                    <button type="button" className="secondary small" onClick={addChapter}>新增章节</button>
                    <button type="button" className="secondary small" onClick={addChapterBatch}>批量新增</button>
                    <button type="button" className="secondary small" onClick={copyCurrentChapterContent} disabled={!selectedChapter?.content}>复制当前正文</button>
                    <button type="button" className="secondary small" onClick={deleteSelectedChapters} disabled={!selectedChapterIds.length}>删除选中</button>
                    <button type="button" className="secondary small" onClick={deleteChapter}>删除当前</button>
                  </div>
                </div>
                <div className="chapter-page-layout">
                  <div className="chapter-list chapter-list-large">
                    {selectedProject.chapters.map((chapter) => (
                      <label key={chapter.id} className={chapter.id === selectedChapterId ? 'chapter-item active selectable' : 'chapter-item selectable'}>
                        <input
                          type="checkbox"
                          checked={selectedChapterIds.includes(chapter.id)}
                          onChange={(event) => toggleIdSelection(setSelectedChapterIds, chapter.id, event.target.checked)}
                        />
                        <button type="button" className="chapter-open" onClick={() => setSelectedChapterId(chapter.id)}>
                          <strong>{chapter.title}</strong>
                          <span>{selectedProject.volumes.find((item) => item.id === chapter.volumeId)?.title || '未分卷'} / {countWords(chapter.content)} 字</span>
                        </button>
                      </label>
                    ))}
                  </div>
                  {selectedChapter ? (
                    <div className="chapter-editor chapter-editor-large">
                      <input value={selectedChapter.title} onChange={(event) => updateSelectedChapter('title', event.target.value)} />
                      <select value={selectedChapter.volumeId || ''} onChange={(event) => updateSelectedChapter('volumeId', event.target.value)}>
                        {selectedProject.volumes.map((volume) => <option key={volume.id} value={volume.id}>{volume.title}</option>)}
                      </select>
                      <textarea value={selectedChapter.summary} onChange={(event) => updateSelectedChapter('summary', event.target.value)} placeholder="本章摘要" />
                      <textarea className="chapter-content chapter-content-large" value={selectedChapter.content} onChange={(event) => updateSelectedChapter('content', event.target.value)} placeholder="开始写正文..." />
                      <div className="metrics-row"><span>当前字数：{countWords(selectedChapter.content)}</span><span>更新时间：{selectedChapter.updatedAt?.slice(0, 16).replace('T', ' ')}</span></div>
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            {activeTab === 'chapterCards' ? (
              <section className="panel chapter-card-page">
                <div className="section-header">
                  <h2>章节卡管理</h2>
                  <div className="row wrap">
                    <span>{selectedProject?.automation?.chapterCards?.length || 0} 张</span>
                    <input className="inline-number" type="number" min="1" placeholder="起始章" value={chapterCardFilter.start} onChange={(event) => setChapterCardFilter((current) => ({ ...current, start: event.target.value }))} />
                    <input className="inline-number" type="number" min="1" placeholder="结束章" value={chapterCardFilter.end} onChange={(event) => setChapterCardFilter((current) => ({ ...current, end: event.target.value }))} />
                    <button type="button" className="secondary small" onClick={() => setChapterCardFilter({ start: '', end: '' })}>清空筛选</button>
                    <button type="button" className="secondary small" onClick={addChapterCardBatch}>批量新增</button>
                    <button type="button" className="secondary small" onClick={deleteSelectedChapterCards} disabled={!selectedChapterCardIds.length}>删除选中</button>
                    <button type="button" className="secondary small" onClick={deleteAllChapterCards}>删除全部</button>
                  </div>
                </div>
                  <div className="chapter-card-board">
                    <div className="chapter-card-index-list">
                      {filteredChapterCards.length ? filteredChapterCards.map((card) => (
                        <button key={card.id} type="button" className={selectedChapterCard?.id === card.id ? 'chapter-card-index active' : 'chapter-card-index'} onClick={() => setSelectedChapterCardId(card.id)}>
                          <strong>#{card.order}</strong>
                          <span>{card.title}</span>
                        </button>
                      )) : <p className="muted">暂无章节卡，点击“自动排章节卡”生成。</p>}
                    </div>
                    {selectedChapterCard ? (
                      <article className="chapter-card-edit chapter-card-detail story-card-frame">
                        <div className="story-card-topline">
                          <label className="card-check"><input type="checkbox" checked={selectedChapterCardIds.includes(selectedChapterCard.id)} onChange={(event) => toggleIdSelection(setSelectedChapterCardIds, selectedChapterCard.id, event.target.checked)} /><span className="chapter-badge">#{selectedChapterCard.order}</span></label>
                          <span className="volume-tag">{selectedChapterCard.volumeName || '未分卷'}</span>
                          <button type="button" className="secondary small" onClick={() => deleteChapterCard(selectedChapterCard.id)}>删</button>
                        </div>
                        <div className="story-card-title-zone">
                          <input value={selectedChapterCard.title} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'title', event.target.value)} />
                          <input placeholder="所属分卷" value={selectedChapterCard.volumeName || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'volumeName', event.target.value)} />
                        </div>
                        <div className="story-card-section">
                          <span>摘要</span>
                          <textarea placeholder="本章摘要" value={selectedChapterCard.summary || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'summary', event.target.value)} />
                        </div>
                        <div className="story-card-section accent">
                          <span>钩子</span>
                          <textarea placeholder="关键钩子" value={selectedChapterCard.hook || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'hook', event.target.value)} />
                        </div>
                        <div className="story-card-section">
                          <span>控制参数</span>
                          <p className="muted">新版本章节卡优先管理剧情轨道：目标、事件、人物、线索、结果、伏笔、爽点和系统规则。下方写法字段属于高级弱信号，通常不需要手动维护。</p>
                        </div>
                        <div className="story-card-section-grid">
                          <textarea placeholder="本章目标" value={selectedChapterCard.chapterGoal || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'chapterGoal', event.target.value)} />
                          <textarea placeholder="核心事件" value={selectedChapterCard.coreEvent || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'coreEvent', event.target.value)} />
                          <textarea placeholder="出场人物" value={selectedChapterCard.cast || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'cast', event.target.value)} />
                          <textarea placeholder="关键物件/线索" value={selectedChapterCard.keyClue || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'keyClue', event.target.value)} />
                          <textarea placeholder="本章结果" value={selectedChapterCard.chapterResult || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'chapterResult', event.target.value)} />
                          <textarea placeholder="读者预期" value={selectedChapterCard.readerExpectation || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'readerExpectation', event.target.value)} />
                          <textarea placeholder="上一章遗留动作" value={selectedChapterCard.openAction || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'openAction', event.target.value)} />
                          <textarea placeholder="伏笔规划" value={selectedChapterCard.foreshadowing || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'foreshadowing', event.target.value)} />
                          <textarea placeholder="本章爽点/文风落点：信息爽、关系爽、系统短讯、魏杰嘴硬、同人触点、废墟选择等" value={selectedChapterCard.commercialBeat || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'commercialBeat', event.target.value)} />
                          <textarea placeholder="系统规则" value={selectedChapterCard.systemRule || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'systemRule', event.target.value)} />
                        </div>
                        <div className="story-card-section">
                          <span>高级弱信号</span>
                          <p className="muted">这些字段主要兼容旧章节卡。正文生成会优先读取上方剧情轨道和作者人设。</p>
                        </div>
                        <div className="story-card-section-grid">
                          <textarea placeholder="章节功能：主功能=investigation；副功能=relationship" value={selectedChapterCard.functionMode || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'functionMode', event.target.value)} />
                          <textarea placeholder="对话密度：low / medium / high（原因）" value={selectedChapterCard.dialogueDensity || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'dialogueDensity', event.target.value)} />
                          <textarea placeholder="叙述质感：小说感70%，电影感30%；重点=..." value={selectedChapterCard.texturePlan || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'texturePlan', event.target.value)} />
                          <textarea placeholder="人味锚点：身体状态、生活杂质、记忆触发、对话错位" value={selectedChapterCard.humanTextureBeats || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'humanTextureBeats', event.target.value)} />
                          <textarea placeholder="正文禁区：禁止说明书式解释、否定排除式冲击..." value={selectedChapterCard.draftingBan || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'draftingBan', event.target.value)} />
                          <textarea placeholder="章末交付物：本章结尾必须交付的具体后果" value={selectedChapterCard.endingDelivery || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'endingDelivery', event.target.value)} />
                        </div>
                        <div className="story-card-section-grid">
                          <textarea placeholder="蓝图阶段" value={selectedChapterCard.paceStage || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'paceStage', event.target.value)} />
                          <select value={selectedChapterCard.openingType || 'scene'} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'openingType', event.target.value)}>
                            {openingTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                          <select value={selectedChapterCard.narrativeMode || 'linear'} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'narrativeMode', event.target.value)}>
                            {narrativeModeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                          <textarea placeholder="进度锁" value={selectedChapterCard.progressLock || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'progressLock', event.target.value)} />
                          <textarea placeholder="本章只允许" value={selectedChapterCard.allowedBeats || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'allowedBeats', event.target.value)} />
                          <textarea placeholder="本章禁止" value={selectedChapterCard.forbiddenBeats || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'forbiddenBeats', event.target.value)} />
                          <textarea placeholder="开头锚点" value={selectedChapterCard.openingAnchor || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'openingAnchor', event.target.value)} />
                          <textarea placeholder="禁止开头" value={selectedChapterCard.openingBan || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'openingBan', event.target.value)} />
                          <textarea placeholder="叙事目的" value={selectedChapterCard.narrativePurpose || ''} onChange={(event) => updateChapterCard(selectedChapterCard.id, 'narrativePurpose', event.target.value)} />
                        </div>
                      </article>
                    ) : null}
                  </div>
              </section>
            ) : null}

            {activeTab === 'inspect' ? (
              <section className="inspect-layout">
                <div className="panel checkpoint-box">
                  <div className="section-header">
                    <h2>检查点报告</h2>
                    <span>{checkpointPanel.reports.length} 条</span>
                  </div>
                  <div className="row wrap">
                    <button type="button" className="secondary" onClick={() => runCheckpointReview()} disabled={loading}>立即做阶段检查</button>
                    <button type="button" className="secondary" onClick={() => runCheckpointReview('major')} disabled={loading}>立即做100章大检查</button>
                    <button type="button" className="secondary" onClick={resumeAfterReview} disabled={loading || !selectedProject.automation?.waitingForReview}>用户确认后继续</button>
                    <button type="button" className="secondary" onClick={rerankFutureChapterCardsFromCheckpoint} disabled={loading || !checkpointPanel.currentReport}>重排后续章节卡</button>
                    <button type="button" className="secondary" onClick={autoSplitVolumes} disabled={loading || !checkpointPanel.currentReport}>重新自动分卷</button>
                    <button type="button" className="secondary" onClick={saveCheckpointAdviceToBlueprint} disabled={loading || !checkpointPanel.currentReport}>保存检查建议到蓝图</button>
                    <label className="field-label checkpoint-retention">
                      <span>保留条数</span>
                      <input type="number" min="1" value={checkpointPanel.retentionCount} onChange={(event) => setCheckpointPanel((current) => ({ ...current, retentionCount: Number(event.target.value) || 20 }))} />
                    </label>
                    <button type="button" className="secondary" onClick={() => updateCheckpointRetentionCount(checkpointPanel.retentionCount)}>保存保留条数</button>
                    <button type="button" className="secondary" onClick={loadCheckpointPanel}>刷新报告</button>
                    <button type="button" className="secondary" onClick={deleteCurrentCheckpointReport} disabled={!checkpointPanel.currentReport && !checkpointPanel.reports.length}>删除当前报告</button>
                  </div>
                  <textarea value={checkpointPanel.currentReport || ''} readOnly placeholder="最新检查点报告" />
                  <div className="checkpoint-history">
                    {checkpointPanel.reports.slice().reverse().map((report, index) => (
                      <article key={`${report.createdAt || index}-${index}`} className="checkpoint-item">
                        <strong>{report.createdAt ? report.createdAt.slice(0, 19).replace('T', ' ') : `报告 ${index + 1}`} {report.kind === 'major' ? '｜100章大检查' : report.kind === 'standard' ? '｜阶段检查' : ''}</strong>
                        <p>{report.report}</p>
                      </article>
                    ))}
                  </div>
                </div>
                <div className="panel repair-box">
                  <div className="section-header"><h2>按报告修订章节</h2><span>写回章节管理</span></div>
                  <div className="risk-box">
                    <strong>章节级巡检</strong>
                    <p>检查 AI 痕迹、平台风险分级、章节改写建议、番茄前三章/章节钩子与爽点适配。</p>
                    <div className="hero-actions row wrap">
                      <button type="button" className="secondary" onClick={auditCurrentChapter} disabled={loading || !selectedChapter?.content}>巡检当前章节</button>
                      <button type="button" onClick={rewriteCurrentChapterByAudit} disabled={loading || !selectedChapter?.content}>按巡检建议修订当前章</button>
                    </div>
                    <textarea value={chapterAuditReport} onChange={(event) => setChapterAuditReport(event.target.value)} placeholder="当前章节巡检报告会显示在这里，也可以手动补充修订要求后点击修订。" />
                  </div>
                  <div className="range-grid">
                    <input type="number" min="1" max={selectedProject.chapters.length} placeholder="起始章" value={automationDraft.repairStartChapter} onChange={(event) => setAutomationDraft((current) => ({ ...current, repairStartChapter: Number(event.target.value) || 1 }))} />
                    <input type="number" min="1" max={selectedProject.chapters.length} placeholder="结束章" value={automationDraft.repairEndChapter} onChange={(event) => setAutomationDraft((current) => ({ ...current, repairEndChapter: Number(event.target.value) || 1 }))} />
                  </div>
                  <textarea placeholder="补充修订要求，例如：压慢节奏，只保留局部冲突；反派只让下级代理人试探，不提前暴露终局反派。" value={automationDraft.repairInstruction} onChange={(event) => setAutomationDraft((current) => ({ ...current, repairInstruction: event.target.value }))} />
                  <button type="button" onClick={repairChapterRange} disabled={loading || !selectedProject.automation?.checkpointReport}>根据一致性报告自动修订指定章节</button>
                  <div className="risk-box">
                    <strong>最近修订结果</strong>
                    <p>{selectedProject.automation?.lastRepairReport || '尚未执行章节修订'}</p>
                  </div>
                </div>
              </section>
            ) : null}

            {activeTab === 'story' ? (
              <section className="grid-2 story-layout">
                <div className="panel">
                  <div className="section-header"><h2>分卷管理</h2><span>{selectedProject.volumes.length} 卷</span></div>
                  <form className="form-panel" onSubmit={addVolume}>
                    <input placeholder="卷名" value={volumeForm.title} onChange={(event) => setVolumeForm((current) => ({ ...current, title: event.target.value }))} />
                    <textarea placeholder="定位，例如：新手村、逆袭开局" value={volumeForm.positioning} onChange={(event) => setVolumeForm((current) => ({ ...current, positioning: event.target.value }))} />
                    <textarea placeholder="本卷目标" value={volumeForm.goal} onChange={(event) => setVolumeForm((current) => ({ ...current, goal: event.target.value }))} />
                    <textarea placeholder="卷末钩子" value={volumeForm.endingHook} onChange={(event) => setVolumeForm((current) => ({ ...current, endingHook: event.target.value }))} />
                    <button type="submit">新增卷</button>
                  </form>
                  <div className="card-grid scroll-panel">
                    {selectedProject.volumes.map((volume) => (
                      <article key={volume.id} className="mini-card">
                        <div className="section-header">
                          <h3>{volume.title}</h3>
                          <button type="button" className="secondary small" onClick={() => deleteVolume(volume.id)}>删除卷</button>
                        </div>
                        <p>{volume.positioning || '未写定位'}</p>
                        <small>{volume.goal || '未写目标'}</small>
                      </article>
                    ))}
                  </div>
                </div>

                <div className="panel">
                  <div className="section-header"><h2>时间线</h2><span>{selectedProject.timeline.length} 事件</span></div>
                  <form className="form-panel" onSubmit={addTimelineEvent}>
                    <input placeholder="事件标题" value={timelineForm.title} onChange={(event) => setTimelineForm((current) => ({ ...current, title: event.target.value }))} />
                    <input placeholder="阶段，例如：开篇、第一卷中段" value={timelineForm.phase} onChange={(event) => setTimelineForm((current) => ({ ...current, phase: event.target.value }))} />
                    <input placeholder="序号" type="number" value={timelineForm.order} onChange={(event) => setTimelineForm((current) => ({ ...current, order: Number(event.target.value) || 1 }))} />
                    <textarea placeholder="影响与后果" value={timelineForm.impact} onChange={(event) => setTimelineForm((current) => ({ ...current, impact: event.target.value }))} />
                    <button type="submit">新增事件</button>
                  </form>
                  <div className="timeline-list scroll-panel">
                    {selectedProject.timeline.map((item) => (
                      <article key={item.id} className="timeline-item">
                        <strong>{item.order}. {item.title}</strong>
                        <span>{item.phase}</span>
                        <p>{item.impact}</p>
                      </article>
                    ))}
                  </div>
                </div>
              </section>
            ) : null}

            {activeTab === 'characters' ? (
              <section className="grid-2 character-layout">
                <div className="panel">
                  <div className="section-header">
                    <h2>角色库</h2>
                    <div className="row wrap">
                      <span>{selectedProject.characters.length} 人</span>
                      <button type="button" className="secondary small" onClick={addCharacterBatch}>批量新增</button>
                      <button type="button" className="secondary small" onClick={deleteSelectedCharacters} disabled={!selectedCharacterIds.length}>删除选中</button>
                    </div>
                  </div>
                  <form className="form-panel" onSubmit={addCharacter}>
                    <input placeholder="角色名" value={characterForm.name} onChange={(event) => setCharacterForm((current) => ({ ...current, name: event.target.value }))} />
                    <input placeholder="身份 / 定位" value={characterForm.role} onChange={(event) => setCharacterForm((current) => ({ ...current, role: event.target.value }))} />
                    <textarea placeholder="角色目标" value={characterForm.goal} onChange={(event) => setCharacterForm((current) => ({ ...current, goal: event.target.value }))} />
                    <textarea placeholder="秘密 / 隐藏线" value={characterForm.secret} onChange={(event) => setCharacterForm((current) => ({ ...current, secret: event.target.value }))} />
                    <textarea placeholder="性格标签" value={characterForm.traits} onChange={(event) => setCharacterForm((current) => ({ ...current, traits: event.target.value }))} />
                    <textarea placeholder="人物弧光" value={characterForm.arc} onChange={(event) => setCharacterForm((current) => ({ ...current, arc: event.target.value }))} />
                    <button type="submit">新增角色</button>
                  </form>
                  <div className="card-grid scroll-panel">
                    {selectedProject.characters.map((character) => (
                      <article key={character.id} className="mini-card selectable-card">
                        <label className="card-check">
                          <input
                            type="checkbox"
                            checked={selectedCharacterIds.includes(character.id)}
                            onChange={(event) => toggleIdSelection(setSelectedCharacterIds, character.id, event.target.checked)}
                          />
                          <span>{character.name}</span>
                        </label>
                        <h3>{character.name}</h3>
                        <p>{character.role}</p>
                        <small>{character.goal}</small>
                      </article>
                    ))}
                  </div>
                </div>

                <div className="panel">
                  <div className="section-header"><h2>关系图</h2><span>{selectedProject.relations.length} 条关系</span></div>
                  <form className="form-panel" onSubmit={addRelation}>
                    <input placeholder="角色 A" value={relationForm.from} onChange={(event) => setRelationForm((current) => ({ ...current, from: event.target.value }))} />
                    <input placeholder="角色 B" value={relationForm.to} onChange={(event) => setRelationForm((current) => ({ ...current, to: event.target.value }))} />
                    <input placeholder="关系类型，例如：敌对、师徒、暧昧" value={relationForm.type} onChange={(event) => setRelationForm((current) => ({ ...current, type: event.target.value }))} />
                    <textarea placeholder="关系说明" value={relationForm.detail} onChange={(event) => setRelationForm((current) => ({ ...current, detail: event.target.value }))} />
                    <button type="submit">新增关系</button>
                  </form>
                  <div className="relation-map scroll-panel">
                    {selectedProject.relations.map((relation) => (
                      <article key={relation.id} className="relation-card">
                        <strong>{relation.from}</strong>
                        <span>{relation.type}</span>
                        <strong>{relation.to}</strong>
                        <p>{relation.detail}</p>
                      </article>
                    ))}
                  </div>
                </div>
              </section>
            ) : null}

            {activeTab === 'ai' ? (
              <section className="grid-2 ai-layout">
                <div className="panel ai-panel">
                  <div className="section-header"><h2>全局 API 设置</h2><span>选择当前 AI 模型</span></div>
                  <label className="field-label">
                    <span>当前使用模型</span>
                    <select value={aiConfig.activeProfile} onChange={(event) => setAiConfig((current) => switchAiProfile(current, event.target.value))}>
                      <option value="deepseek">DeepSeek</option>
                      <option value="gpt55">GPT-5.5 中转站</option>
                    </select>
                  </label>
                  <label className="field-label">
                    <span>自动写作模型策略</span>
                    <select value={aiConfig.modelRouting} onChange={(event) => setAiConfig((current) => normalizeAiConfig({ ...current, modelRouting: event.target.value }))}>
                      <option value="mixed">混合模式：DeepSeek 规划，GPT-5.5 写章节</option>
                      <option value="active">当前模型全流程</option>
                    </select>
                  </label>
                  <div className="risk-box">
                    <strong>当前 AI 模型</strong>
                    <p>{getAiUsageSummary(aiConfig)}</p>
                    <p>当前选择：{getAiProfileLabel(aiConfig, aiConfig.activeProfile)}</p>
                  </div>
                  <div className="section-header"><h2>DeepSeek</h2><span>便宜/规划/常规生成</span></div>
                  <input type="password" placeholder="DeepSeek API Key" value={aiConfig.profiles?.deepseek?.apiKey || ''} onChange={(event) => setAiConfig((current) => updateAiProfile(current, 'deepseek', { apiKey: event.target.value }))} />
                  <input placeholder="DeepSeek Base URL" value={aiConfig.profiles?.deepseek?.baseUrl || ''} onChange={(event) => setAiConfig((current) => updateAiProfile(current, 'deepseek', { baseUrl: event.target.value }))} />
                  <select value={aiConfig.profiles?.deepseek?.model || 'deepseek-v4-flash'} onChange={(event) => setAiConfig((current) => updateAiProfile(current, 'deepseek', { model: event.target.value }))}>
                    {deepSeekModelOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <div className="section-header"><h2>GPT-5.5 中转站</h2><span>高质量正文/润色</span></div>
                  <input type="password" placeholder="GPT-5.5 API Key" value={aiConfig.profiles?.gpt55?.apiKey || ''} onChange={(event) => setAiConfig((current) => updateAiProfile(current, 'gpt55', { apiKey: event.target.value }))} />
                  <input placeholder="GPT-5.5 Base URL，例如 https://www.cctq.ai/v1" value={aiConfig.profiles?.gpt55?.baseUrl || ''} onChange={(event) => setAiConfig((current) => updateAiProfile(current, 'gpt55', { baseUrl: event.target.value }))} />
                  <input placeholder="GPT-5.5 模型名，例如 gpt-5.5" value={aiConfig.profiles?.gpt55?.model || 'gpt-5.5'} onChange={(event) => setAiConfig((current) => updateAiProfile(current, 'gpt55', { model: event.target.value }))} />
                  <button type="button" className="secondary" onClick={saveAiSettings}>保存 API 设置</button>
                  <label className="field-label">
                    <span>检查点保留条数</span>
                    <input type="number" min="1" value={checkpointPanel.retentionCount} onChange={(event) => setCheckpointPanel((current) => ({ ...current, retentionCount: Number(event.target.value) || 20 }))} />
                  </label>
                  <div className="hero-actions row">
                    <button type="button" className="secondary" onClick={() => updateCheckpointRetentionCount(checkpointPanel.retentionCount)}>保存保留条数</button>
                    <button type="button" className="secondary" onClick={loadCheckpointPanel}>查看最新检查点</button>
                  </div>
                  <div className="section-header"><h2>常规写作助手</h2><span>当前章节</span></div>
                  <div className="mode-row">
                    {aiModes.map((mode) => (
                      <button key={mode.key} type="button" className={mode.key === aiMode ? 'chip active' : 'chip'} onClick={() => setAiMode(mode.key)}>{mode.label}</button>
                    ))}
                  </div>
                  <div className="panel slider-panel">
                    <div className="section-header">
                      <strong>章节目标字数</strong>
                      <span>{chapterTargetWords} 字</span>
                    </div>
                    <input
                      type="range"
                      min="2000"
                      max="3200"
                      step="200"
                      value={chapterTargetWords}
                      onChange={(event) => setChapterTargetWords(Number(event.target.value))}
                    />
                    <div className="slider-labels">
                      <span>2000</span>
                      <span>2400</span>
                      <span>3200</span>
                    </div>
                  </div>
                  <textarea placeholder="额外要求" value={aiExtraPrompt} onChange={(event) => setAiExtraPrompt(event.target.value)} />
                  <div className="hero-actions row">
                    <button type="button" onClick={runAi} disabled={loading}>{loading ? '生成中...' : '开始生成'}</button>
                    <button type="button" className="secondary" onClick={appendAiToChapter}>追加到当前章节</button>
                  </div>
                </div>
                <div className="panel automation-panel">
                  <div className="section-header"><h2>150 万字长篇自动写作中心</h2><span><Sparkles size={16} /></span></div>
                  <textarea
                    placeholder="输入一个灵感、脑洞、故事种子，AI 会先规划一部长篇，最终规模由 AI 自己判断，但最低 150 万字。"
                    value={automationDraft.inspiration}
                    onChange={(event) => setAutomationDraft((current) => ({ ...current, inspiration: event.target.value }))}
                  />
                  <label className="field-label">
                    <span>最低总字数</span>
                    <input
                      type="number"
                      placeholder="最低总字数"
                      value={automationDraft.minimumWords}
                      onChange={(event) => setAutomationDraft((current) => ({ ...current, minimumWords: Number(event.target.value) || 1500000 }))}
                    />
                  </label>
                  <label className="field-label">
                    <span>参考章节数</span>
                    <input
                      type="number"
                      placeholder="参考章节数"
                      value={automationDraft.targetChapters}
                      onChange={(event) => setAutomationDraft((current) => ({ ...current, targetChapters: Number(event.target.value) || 600 }))}
                    />
                  </label>
                  <label className="field-label">
                    <span>单次生成章节数</span>
                    <input
                      type="number"
                      placeholder="单次生成章节数"
                      value={automationDraft.batchCount}
                      onChange={(event) => setAutomationDraft((current) => ({ ...current, batchCount: Number(event.target.value) || 3 }))}
                    />
                  </label>
                  <label className="field-label">
                    <span>自动推进到第几章</span>
                    <input
                      type="number"
                      placeholder="自动推进到第几章"
                      value={automationDraft.targetProgress}
                      onChange={(event) => setAutomationDraft((current) => ({ ...current, targetProgress: Number(event.target.value) || 60 }))}
                    />
                  </label>
                  <label className="field-label">
                    <span>章节卡自动排到第几章</span>
                    <input
                      type="number"
                      placeholder="章节卡自动排到第几章"
                      value={automationDraft.chapterCardTargetChapter}
                      onChange={(event) => setAutomationDraft((current) => ({ ...current, chapterCardTargetChapter: Number(event.target.value) || 60 }))}
                    />
                  </label>
                  <div className={`mode-card ${selectedProject.automation?.lightweightGeneration ? 'enabled' : ''}`}>
                    <div>
                      <span className="mode-pill">正文生成模式</span>
                      <h3>轻量生成模式</h3>
                      <p>跳过场景包、叙事拍和多层重控制，只保留蓝图、作者人设、章节卡、最近上下文和格式修复，更接近单次自然直写。</p>
                      <small>作用范围：生成第一章/当前章、继续自动写作、写到指定进度。</small>
                    </div>
                    <label className="mode-switch" title="切换轻量生成模式">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedProject.automation?.lightweightGeneration)}
                        onChange={(event) => updateAutomationOption('lightweightGeneration', event.target.checked)}
                      />
                      <span>{selectedProject.automation?.lightweightGeneration ? '已开启' : '已关闭'}</span>
                    </label>
                  </div>
                  <div className="panel slider-panel">
                    <div className="section-header"><strong>平台策略</strong><span>自动写作总开关</span></div>
                    <label className="field-label">
                      <span>主平台口味</span>
                      <select value={getPlatformStrategy(selectedProject).primary} onChange={(event) => updatePlatformStrategy('primary', event.target.value)}>
                        {platformModeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="field-label">
                      <span>阅读节奏适配</span>
                      <select value={getPlatformStrategy(selectedProject).pace} onChange={(event) => updatePlatformStrategy('pace', event.target.value)}>
                        {platformModeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="field-label">
                      <span>长篇结构约束</span>
                      <select value={getPlatformStrategy(selectedProject).structure} onChange={(event) => updatePlatformStrategy('structure', event.target.value)}>
                        {platformModeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label className="field-label">
                      <span>发布目标</span>
                      <select value={getPlatformStrategy(selectedProject).publishTarget} onChange={(event) => updatePlatformStrategy('publishTarget', event.target.value)}>
                        {platformModeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <textarea
                      placeholder="题材标签，用逗号分隔，例如：明日方舟同人，系统，搜打撤，群像，幽默史诗"
                      value={(getPlatformStrategy(selectedProject).tags || []).join('，')}
                      onChange={(event) => updatePlatformStrategy('tags', event.target.value)}
                    />
                    <small>推荐当前项目：主平台刺猬猫、节奏番茄、结构起点。</small>
                  </div>
                  <div className="automation-command-deck">
                    <article className="command-card command-primary">
                      <span>Start</span>
                      <strong>启动写作</strong>
                      <button type="button" onClick={generateCurrentChapter} disabled={loading}>生成第一章/当前章</button>
                    </article>
                    <article className="command-card">
                      <span>Plan</span>
                      <strong>规划阶段</strong>
                      <div className="command-buttons">
                        <button type="button" onClick={generateLongFormPlan} disabled={loading}>{loading ? '处理中...' : '生成长篇蓝图'}</button>
                        <button type="button" className="secondary" onClick={viewMasterPlan}>查看蓝图</button>
                        <button type="button" className="secondary" onClick={autoSplitVolumes} disabled={loading}>自动分卷</button>
                        <button type="button" className="secondary" onClick={generateChapterCards} disabled={loading}>自动排章节卡</button>
                      </div>
                    </article>
                    <article className="command-card command-glow">
                      <span>Quest</span>
                      <strong>推进连载</strong>
                      <div className="command-buttons two">
                        <button type="button" onClick={generateLongFormBatch} disabled={loading}>继续自动写作</button>
                        <button type="button" onClick={writeToTargetProgress} disabled={loading}>写到指定进度</button>
                      </div>
                    </article>
                    <article className="command-card command-muted">
                      <span>Maintain</span>
                      <strong>维护</strong>
                      <div className="command-buttons two">
                        <button type="button" className="secondary" onClick={rebuildAutomationLedgers} disabled={loading}>重建自动写作台账</button>
                        <button type="button" className="secondary" onClick={resetAutomationRuntime} disabled={loading}>清空自动写作台账</button>
                      </div>
                    </article>
                  </div>
                  {writingProgress && loading ? (
                    <button type="button" className="danger" onClick={cancelAiWriting}>中断 AI 写作</button>
                  ) : null}
                  {writingProgress ? (
                    <div className="writing-progress">
                      <div className="writing-progress-top">
                        <strong>{writingProgress.label}</strong>
                        <span>{writingProgress.current}/{writingProgress.total}</span>
                      </div>
                      <div className="progress-track">
                        <div className="progress-fill" style={{ width: `${Math.min(100, Math.round((writingProgress.current / Math.max(writingProgress.total, 1)) * 100))}%` }} />
                      </div>
                      <p>{writingProgress.note}</p>
                      <small>当前处理：第 {writingProgress.chapter} 章</small>
                    </div>
                  ) : null}
                  {streamPreview.active || streamPreview.text ? (
                    <div className="stream-preview">
                      <div className="writing-progress-top">
                        <strong>流式预览</strong>
                        <span>{streamPreview.active ? '生成中' : '已结束'}</span>
                      </div>
                      <p>{streamPreview.phase || '正在接收模型输出'}</p>
                      <pre>{streamPreview.text || '等待首个 token...'}</pre>
                    </div>
                  ) : null}
                  <div className="risk-box">
                    <strong>自动写作进度</strong>
                    <p>AI模型：{getAiUsageSummary(aiConfig)}</p>
                    <p>最低字数：{selectedProject.automation?.minimumWords || 1500000}</p>
                    <p>当前规划：{selectedProject.automation?.targetWords || selectedProject.automation?.minimumWords || 1500000}</p>
                    <p>已生成：{totalProjectWords}</p>
                    <p>状态：{selectedProject.automation?.status || 'idle'}</p>
                    <p>章节卡：{selectedProject.automation?.chapterCards?.length || 0}</p>
                    <p>检查点：第 {selectedProject.automation?.lastCheckpointAt || 0} 章</p>
                    <p>平台策略：{getPlatformStrategy(selectedProject).primary} / {getPlatformStrategy(selectedProject).pace} / {getPlatformStrategy(selectedProject).structure}</p>
                    <div className="ledger-meter-grid">
                      {[
                        ['foreshadowingLedger', '伏笔台账'],
                        ['readerExpectations', '读者期待'],
                        ['commercialBeatLedger', '爽点台账'],
                        ['characterStateMemory', '角色记忆'],
                        ['characterLongTermSummary', '角色摘要'],
                        ['powerSystemLedger', '系统规则'],
                        ['chapterFunctionCalendar', '功能日历'],
                      ].map(([key, label]) => {
                        const count = getLedgerCount(key);
                        const limit = automationLedgerLimits[key];
                        const percent = Math.min(100, Math.round((count / Math.max(limit, 1)) * 100));
                        return (
                          <div key={key} className={percent >= 90 ? 'ledger-meter is-full' : 'ledger-meter'}>
                            <span>{label}</span>
                            <strong>{count} / {limit}</strong>
                            <div className="ledger-track"><i style={{ width: `${percent}%` }} /></div>
                          </div>
                        );
                      })}
                    </div>
                    <p>{selectedProject.automation?.progressNotes || '尚未开始自动长篇流程'}</p>
                  </div>
                  <textarea className="ai-output" value={aiOutput} onChange={(event) => setAiOutput(event.target.value)} placeholder="AI 输出、长篇蓝图或批量章节会显示在这里" />
                </div>
              </section>
            ) : null}

            {activeTab === 'compliance' ? (
              <section className="grid-2 compliance-layout">
                <div className="panel">
                  <div className="section-header"><h2>番茄发布中心</h2><button type="button" onClick={checkCompliance}>敏感词与规范检查</button></div>
                  <input placeholder="作者笔名" value={selectedProject.publishConfig.penName} onChange={(event) => updateSelectedProject('publishConfig', { ...selectedProject.publishConfig, penName: event.target.value })} />
                  <textarea placeholder="作品简介" value={selectedProject.publishConfig.blurb} onChange={(event) => updateSelectedProject('publishConfig', { ...selectedProject.publishConfig, blurb: event.target.value })} />
                  <textarea placeholder="卖点提炼" value={selectedProject.publishConfig.sellingPoints} onChange={(event) => updateSelectedProject('publishConfig', { ...selectedProject.publishConfig, sellingPoints: event.target.value })} />
                  <textarea placeholder="封面 brief" value={selectedProject.publishConfig.coverBrief} onChange={(event) => updateSelectedProject('publishConfig', { ...selectedProject.publishConfig, coverBrief: event.target.value })} />
                  <textarea placeholder="更新计划" value={selectedProject.publishConfig.releasePlan} onChange={(event) => updateSelectedProject('publishConfig', { ...selectedProject.publishConfig, releasePlan: event.target.value })} />
                  <div className="checklist">
                    {publishChecklist.map((item) => (
                      <label key={item} className="check-item">
                        <input
                          type="checkbox"
                          checked={(selectedProject.checklistState || []).includes(item)}
                          onChange={(event) => toggleChecklistItem(item, event.target.checked)}
                        />
                        <span>{item}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="panel">
                  <div className="section-header"><h2>审查报告</h2><span>{selectedProject.compliance?.riskLevel || 'unknown'}</span></div>
                  <div className="risk-box">
                    <strong>命中敏感词</strong>
                    <p>{selectedProject.compliance?.flaggedKeywords?.join('、') || '未命中'}</p>
                  </div>
                  <div className="risk-box">
                    <strong>平台规则检查</strong>
                    {(selectedProject.compliance?.tomatoRules || []).map((rule) => (
                      <article key={rule.key} className={rule.pass ? 'rule-card pass' : 'rule-card risk'}>
                        <strong>{rule.label}</strong>
                        <p>{rule.note}</p>
                      </article>
                    ))}
                  </div>
                  <div className="risk-box">
                    <strong>修改建议</strong>
                    {(selectedProject.compliance?.suggestions || []).length ? (
                      (selectedProject.compliance?.suggestions || []).map((item) => <p key={item}>- {item}</p>)
                    ) : <p>暂无建议</p>}
                  </div>
                  <div className="risk-box">
                    <strong>内置敏感词样例</strong>
                    <p>{sensitiveKeywords.join('、')}</p>
                  </div>
                </div>
              </section>
            ) : null}
          </>
        ) : (
          <section className="panel empty-state"><h2>先创建一部作品</h2><p>左侧填写作品信息后即可开始创作。</p></section>
        )}
      </main>
      {selectedProject && activeTab !== 'overview' ? (
        <aside ref={assistantDockRef} className={[assistantIsProcessing ? 'live2d-dock is-processing' : 'live2d-dock', assistantDockSoftened ? 'is-softened' : ''].filter(Boolean).join(' ')}>
          <div className="live2d-dock-bubble">
            <span className={assistantIsProcessing ? 'status-dot active' : 'status-dot'} />
            <strong>{assistantIsProcessing ? '正在陪你跑生成' : '看板娘待命中'}</strong>
            <small>{writingProgress?.note || status || selectedProject.automation?.progressNotes || '需要我时就点一下姿态。'}</small>
          </div>
          <Live2DAssistant state={activeAssistantState} />
          <div className="live2d-dock-actions">
            {Object.keys(assistantStateLabels).slice(0, 5).map((pose) => (
              <button key={pose} type="button" className={assistantPose === pose ? 'chip active small' : 'chip small'} onClick={() => setAssistantPose(pose)} disabled={assistantIsProcessing}>
                {assistantStateLabels[pose]}
              </button>
            ))}
          </div>
        </aside>
      ) : null}
      {showShortcuts ? (
        <div className="shortcut-overlay" onClick={() => setShowShortcuts(false)}>
          <section className="panel shortcut-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-header">
              <h2>快捷键中心</h2>
              <button type="button" className="secondary small" onClick={() => setShowShortcuts(false)}>关闭</button>
            </div>
            <div className="shortcut-grid">
              {shortcutItems.map(([combo, label]) => (
                <div key={combo} className="shortcut-row large">
                  <kbd>{combo}</kbd>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}
      {showChangelog ? (
        <div className="shortcut-overlay" onClick={() => setShowChangelog(false)}>
          <section className="panel shortcut-modal changelog-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-header">
              <div>
                <p className="eyebrow">Release Notes</p>
                <h2>版本公告</h2>
              </div>
              <button type="button" className="secondary small" onClick={() => setShowChangelog(false)}>关闭</button>
            </div>
            <div className="changelog-list">
              {changelogItems.map((item) => (
                <article key={item.version} className="changelog-item">
                  <div className="changelog-title">
                    <div>
                      <strong>v{item.version}</strong>
                      <p>{item.title}</p>
                    </div>
                    <span>{item.date}</span>
                  </div>
                  <ul>
                    {item.changes.map((change) => <li key={change}>{change}</li>)}
                  </ul>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}
      {showWelcomeGuide ? (
        <div className="shortcut-overlay" onClick={() => setShowWelcomeGuide(false)}>
          <section className="panel shortcut-modal welcome-modal" onClick={(event) => event.stopPropagation()}>
            <div className="welcome-hero">
              <div>
                <p className="eyebrow">AI Novel Studio v{appVersion}</p>
                <h2>从蓝图到正文的自动连载控制台</h2>
                <p>当前版本优先做三件事：章节卡只管剧情轨道，正文支持流式预览，生成后用自然读感守门减少说明腔、清单式台词和机械排比。</p>
              </div>
              <button type="button" className="secondary small" onClick={() => setShowWelcomeGuide(false)}>进入工作台</button>
            </div>

            <div className="welcome-quick-grid">
              <article>
                <span>01</span>
                <strong>配置模型</strong>
                <p>在“AI 助手”里保存 DeepSeek 和 GPT-5.5。混合路由会让规划更轻、正文更稳。</p>
              </article>
              <article>
                <span>02</span>
                <strong>生成蓝图</strong>
                <p>先写清作品灵感、题材、读者和文风，再生成长篇蓝图与作者人设。</p>
              </article>
              <article>
                <span>03</span>
                <strong>排章节卡</strong>
                <p>章节卡默认只写目标、事件、人物、线索、结果和钩子，不再规定正文口吻。</p>
              </article>
              <article>
                <span>04</span>
                <strong>流式写正文</strong>
                <p>当前章和章节卡支持实时预览；草稿展示不直接落库，完成清理后再保存。</p>
              </article>
            </div>

            <div className="welcome-focus">
              <div>
                <p className="eyebrow">Recommended Path</p>
                <h3>推荐自动写作路径</h3>
              </div>
              <ol>
                <li>新建作品，填入核心设定和文风要求。</li>
                <li>生成长篇蓝图，再自动分卷。</li>
                <li>每次排 3 章章节卡，确认剧情轨道没有跑偏。</li>
                <li>打开轻量生成模式写当前章，观察流式预览。</li>
                <li>每 20 章做检查点，修正伏笔、角色状态和后续章节卡。</li>
              </ol>
            </div>

            <div className="welcome-note-grid">
              <article>
                <strong>自然读感守门</strong>
                <p>会优先压“不是A，也不是B，而是C”、三项名词排比、孤立状态台词和 Markdown 痕迹。普通短句、紧急命令和自然反驳会尽量保留。</p>
              </article>
              <article>
                <strong>章节卡怎么改</strong>
                <p>只改剧情事实：本章目标、关键物件、出场人物、结果、章末钩子。不要把章节卡写成正文风格说明书。</p>
              </article>
              <article>
                <strong>什么时候人工看</strong>
                <p>模型连续超时、章节卡不可解析、自然度硬检测未过、或检查点提示人物状态冲突时，先停下来确认。</p>
              </article>
            </div>
          </section>
        </div>
      ) : null}
      {showCreateProject ? (
        <div className="shortcut-overlay" onClick={() => setShowCreateProject(false)}>
          <section className="panel shortcut-modal create-project-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-header">
              <div>
                <p className="eyebrow">New Project</p>
                <h2>新建作品</h2>
              </div>
              <button type="button" className="secondary small" onClick={() => setShowCreateProject(false)}>关闭</button>
            </div>
            <form className="form-panel" onSubmit={createProject}>
              <label className="field-label">
                <span>作品名</span>
                <input autoFocus placeholder="作品名" value={projectForm.title} onChange={(event) => setProjectForm((current) => ({ ...current, title: event.target.value }))} required />
              </label>
              <label className="field-label">
                <span>类型</span>
                <input placeholder="类型，例如：女频 / 都市" value={projectForm.genre} onChange={(event) => setProjectForm((current) => ({ ...current, genre: event.target.value }))} />
              </label>
              <label className="field-label">
                <span>目标读者</span>
                <input placeholder="目标读者" value={projectForm.targetAudience} onChange={(event) => setProjectForm((current) => ({ ...current, targetAudience: event.target.value }))} />
              </label>
              <label className="field-label">
                <span>一句话 premise</span>
                <textarea placeholder="一句话 premise" value={projectForm.premise} onChange={(event) => setProjectForm((current) => ({ ...current, premise: event.target.value }))} />
              </label>
              <label className="field-label">
                <span>文风要求</span>
                <textarea placeholder="文风要求" value={projectForm.styleGuide} onChange={(event) => setProjectForm((current) => ({ ...current, styleGuide: event.target.value }))} />
              </label>
              <div className="hero-actions row">
                <button type="submit">创建作品</button>
                <button type="button" className="secondary" onClick={() => setShowCreateProject(false)}>取消</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      <div className="status-bar">{status}</div>
    </div>
  );
}
