import assert from 'node:assert/strict';
import { buildCommercialSerialGuide, buildPlatformStrategyGuideText } from '../commercialSerialGuide.js';

const chapterCardGuide = buildCommercialSerialGuide('chapter-card');
assert.ok(chapterCardGuide.includes('章节卡不是事件清单'), 'chapter-card guide should prevent event-list cards');
assert.ok(chapterCardGuide.includes('主角为什么必须行动'), 'chapter-card guide should require protagonist motivation');
assert.ok(chapterCardGuide.includes('本章小收获'), 'chapter-card guide should preserve chapter reward guidance');
assert.ok(chapterCardGuide.includes('不要连续多章只新增线索'), 'chapter-card guide should guard clue-loop pacing');

const checkpointGuide = buildCommercialSerialGuide('checkpoint');
assert.ok(checkpointGuide.includes('主角行动力'), 'checkpoint guide should diagnose protagonist agency');
assert.ok(checkpointGuide.includes('金手指解法'), 'checkpoint guide should diagnose power-system usefulness');
assert.ok(checkpointGuide.includes('后续3-5章'), 'checkpoint guide should require actionable next-card fixes');

const blueprintGuide = buildCommercialSerialGuide('blueprint');
assert.ok(blueprintGuide.includes('题材承诺'), 'blueprint guide should require genre promise');
assert.ok(blueprintGuide.includes('前3万字核心看点'), 'blueprint guide should protect early sell');
assert.ok(blueprintGuide.includes('不要输出写作理论'), 'blueprint guide should force concrete planning');

const fanqieGuide = buildPlatformStrategyGuideText({
  project: { title: '测试书', genre: '系统流', premise: '主角绑定系统后求生。' },
  automation: {},
  strategy: { primary: 'fanqie', pace: 'fanqie', structure: 'fanqie', publishTarget: 'fanqie', tags: ['系统'] },
});
assert.ok(fanqieGuide.includes('前期尽快展示核心卖点'), 'fanqie guide should require early sell');
assert.ok(fanqieGuide.includes('主角不要长期只被动挨压'), 'fanqie guide should address passive protagonist risk');

const ciweimaoFanficGuide = buildPlatformStrategyGuideText({
  project: { title: '我在明日方舟搜打撤', genre: '明日方舟同人', premise: '主角穿越泰拉。' },
  automation: {},
  strategy: { primary: 'ciweimao', pace: 'ciweimao', structure: 'qidian', publishTarget: 'ciweimao', tags: ['同人'] },
});
assert.ok(ciweimaoFanficGuide.includes('刺猬猫同人适配'), 'ciweimao fanfic guide should detect fan fiction');
assert.ok(ciweimaoFanficGuide.includes('原作角色交互'), 'ciweimao fanfic guide should preserve original-character interaction');

const ciweimaoOriginalGuide = buildPlatformStrategyGuideText({
  project: { title: '魔法少女修仙', genre: '二次元原创', premise: '修仙世界里的魔法少女日常。' },
  automation: {},
  strategy: { primary: 'ciweimao', pace: 'ciweimao', structure: 'ciweimao', publishTarget: 'ciweimao', tags: ['二次元'] },
});
assert.ok(ciweimaoOriginalGuide.includes('刺猬猫二次元原创适配'), 'ciweimao original guide should detect anime-style original fiction');
assert.ok(!ciweimaoOriginalGuide.includes('刺猬猫同人适配'), 'ciweimao original guide should not apply fanfic rules');

const qidianGuide = buildPlatformStrategyGuideText({
  project: { title: '体系升级', genre: '玄幻', premise: '主角修炼升级。' },
  automation: {},
  strategy: { primary: 'qidian', pace: 'qidian', structure: 'qidian', publishTarget: 'qidian', tags: [] },
});
assert.ok(qidianGuide.includes('体系自洽'), 'qidian guide should require coherent systems');
assert.ok(qidianGuide.includes('升级和权力边界要可追踪'), 'qidian guide should protect upgrade boundaries');

console.log('commercial guide tests passed');
