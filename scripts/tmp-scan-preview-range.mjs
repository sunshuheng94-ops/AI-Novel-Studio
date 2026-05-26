import fs from 'node:fs/promises';

const filePath = process.argv[2];
const startChapter = Number(process.argv[3]) || 1;
if (!filePath) throw new Error('Usage: node scripts/tmp-scan-preview-range.mjs <file> <startChapter>');

const text = await fs.readFile(filePath, 'utf8');
const sections = text.split(/=== 第\d+章 \/ 章节卡：/).slice(1);
const report = [];
const commandHits = [];

sections.forEach((section, index) => {
  const body = (section.split('\n正文：\n')[1] || '').split('\n\n警告：')[0] || '';
  const paragraphs = body.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  const issues = [];

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const simileCount = (paragraph.match(/像/g) || []).length;
    if (simileCount >= 2) issues.push({ type: 'simileDense', paragraph: paragraphIndex + 1, count: simileCount, text: paragraph.slice(0, 180) });
    if (/不是[^。！？]{1,45}是[^。！？]{1,90}|不是[^。！？]{1,45}不是[^。！？]{1,90}|不像[^。！？]{1,45}也不像/.test(paragraph)) {
      issues.push({ type: 'contrast', paragraph: paragraphIndex + 1, text: paragraph.slice(0, 180) });
    }
    if (/(?:^|[。！？\n])\s*[^。！？\n]{1,4}[。！？]\s*(?:\n+\s*)?(?:[^。！？\n]{1,4}[。！？]\s*){2,}/.test(paragraph)) {
      issues.push({ type: 'shortBurst', paragraph: paragraphIndex + 1, text: paragraph.slice(0, 180) });
    }
    if (/(?:残骸|运输车|车|资源点|武器|目标|机会|风险|爆炸物|可爆物|控场|封路)[。！？]\s*(?:\n+\s*)?(?:[^。！？\n]{1,12}[。！？]\s*){1,}/.test(paragraph)) {
      issues.push({ type: 'resourceLabels', paragraph: paragraphIndex + 1, text: paragraph.slice(0, 180) });
    }
    if (/上一章|前文|章节卡|蓝图|第\s*[一二三四五六七八九十百千万两〇零\d]+\s*章(?=\s*(?:里|中|的|顺手|拿|捡))/.test(paragraph)) {
      issues.push({ type: 'meta', paragraph: paragraphIndex + 1, text: paragraph.slice(0, 180) });
    }
    if (/“[^”]{0,8}[。！？][^”]{0,8}[。！？][^”]{0,10}[。！？]”/.test(paragraph)) {
      commandHits.push({ chapter: startChapter + index, paragraph: paragraphIndex + 1, text: paragraph.slice(0, 180) });
    }
  });

  const title = section.match(/### ([^\n]+)/)?.[1] || `第${startChapter + index}章`;
  report.push({ chapter: startChapter + index, title, paragraphs: paragraphs.length, issues });
});

console.log(JSON.stringify({ report, commandHits }, null, 2));
