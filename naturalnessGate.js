export const detailFlowIssueTypes = [
  'comma-stacked-long-sentence',
  'parallel-body-detail-overload',
  'parallel-scene-detail-overload',
  'overloaded-detail-sentence',
  'fuzzy-subject-detail',
  'patchwork-description',
  'cause-state-result-chop',
  'inventory-scan-paragraph',
  'scene-asset-overload',
  'prop-dossier-description',
  'action-static-list-disconnect',
  'sentence-chain-flatness',
  'static-room-summary',
  'detail-dimension-overload',
];

export const structuralDetailIssueTypes = [
  'prop-dossier-description',
  'inventory-scan-paragraph',
  'scene-asset-overload',
  'action-static-list-disconnect',
  'static-room-summary',
  'pov-shift',
];

export function classifyNaturalnessIssues(issues = [], content = '', normalizeText = (value) => (typeof value === 'string' ? value : '')) {
  if (!issues.length) return 'none';
  const textLength = normalizeText(content).length;
  const importantCount = issues.filter((issue) => {
    const index = issue.index || 0;
    return index < 500 || index > Math.max(0, textLength - 500) || issue.type === 'markdown-noise';
  }).length;
  const negativeIssueCount = issues.filter((issue) => /^negative|^empty|plain-negative|^mechanical-negation/.test(issue.type)).length;
  const hardIssueCount = issues.filter((issue) => ['pov-shift', 'markdown-noise', 'static-room-summary', 'action-static-list-disconnect'].includes(issue.type)).length;
  const structuralIssueCount = issues.filter((issue) => structuralDetailIssueTypes.includes(issue.type)).length;
  const dashExplainCount = issues.filter((issue) => issue.type === 'dash-explain-judgement').length;
  const sentenceIssueCount = issues.filter((issue) => ['short-flow-chain', 'short-dialogue-chain', 'choppy-paragraph', 'action-chain-fragmented', 'isolated-short-sentence-density', 'noun-fragment-sentence', 'noun-fragment-density', 'isolated-label-sentence', 'isolated-label-density', 'comma-stacked-long-sentence', 'parallel-body-detail-overload', 'parallel-scene-detail-overload', 'overloaded-detail-sentence', 'fuzzy-subject-detail', 'patchwork-description', 'cause-state-result-chop', 'sentence-chain-flatness', 'detail-dimension-overload', 'triple-noun-enumeration'].includes(issue.type)).length
    + (dashExplainCount >= 3 ? dashExplainCount : 0);
  const transitionIssueCount = issues.filter((issue) => ['stiff-transition', 'missing-reaction-bridge', 'unmotivated-action-shift'].includes(issue.type)).length;
  const criticalTransitionCount = issues.filter((issue) => issue.type === 'missing-reaction-bridge' && issue.critical).length;
  const strongNegativeIssueCount = issues.filter((issue) => ['negative-reveal', 'negative-negative-explain', 'negative-negative-affirm', 'negative-comma-triple', 'negative-triple', 'negative-dash-reveal', 'negative-period-reveal', 'negative-turn-density', 'mechanical-negation-density', 'mechanical-negation-window-density'].includes(issue.type)).length;
  const dialogueIssueCount = issues.filter((issue) => /^dialogue-/.test(issue.type)).length;
  const hardDialogueIssueCount = issues.filter((issue) => ['dialogue-too-sparse', 'dialogue-too-aligned', 'dialogue-over-explains', 'dialogue-negative-command-chain', 'dialogue-negative-list'].includes(issue.type)).length;
  if (issues.some((issue) => issue.type === 'pov-shift')) return 'heavy';
  if (hardIssueCount >= 2) return 'heavy';
  if (issues.some((issue) => ['markdown-noise', 'static-room-summary', 'action-static-list-disconnect'].includes(issue.type) && (issue.index || 0) < 500)) return 'heavy';
  if (structuralIssueCount >= 3) return 'heavy';
  if (hardDialogueIssueCount >= 1 || dialogueIssueCount >= 5) return 'heavy';
  if (transitionIssueCount >= 4 && (negativeIssueCount >= 2 || sentenceIssueCount >= 2 || structuralIssueCount >= 1)) return 'heavy';
  if (criticalTransitionCount >= 1 || transitionIssueCount >= 2) return 'medium';
  if (negativeIssueCount > 0
    && negativeIssueCount <= 3
    && issues.every((issue) => /^negative|^empty|plain-negative|^mechanical-negation/.test(issue.type))
    && !issues.some((issue) => ['negative-reveal', 'negative-negative-explain', 'negative-negative-affirm', 'negative-comma-triple', 'negative-triple', 'negative-dash-reveal', 'negative-period-reveal', 'empty-reveal', 'mechanical-negation-density', 'mechanical-negation-window-density'].includes(issue.type))) {
    return 'medium';
  }
  if (negativeIssueCount >= 6 && strongNegativeIssueCount >= 3) return 'heavy';
  if (negativeIssueCount >= 3 || sentenceIssueCount >= 3) return 'medium';
  if (issues.length >= 6 || importantCount >= 3) return 'medium';
  if (issues.length >= 2 || importantCount >= 1) return 'medium';
  return 'light';
}

export function isDetailFlowIssue(issue = {}) {
  return detailFlowIssueTypes.includes(issue.type);
}

export function isStructuralDetailIssue(issue = {}) {
  return structuralDetailIssueTypes.includes(issue.type);
}

export function isLocalNaturalnessRepairIssue(issue = {}) {
  return !['negative-turn-density', 'plain-negative-density', 'mechanical-negation-density', 'mechanical-negation-window-density', 'isolated-short-sentence-density', 'dialogue-too-sparse', 'dialogue-too-aligned'].includes(issue.type);
}

export function pickNaturalnessRepairIssue(issues = [], excludeTypes = []) {
  const excluded = new Set(excludeTypes);
  const priority = [
    'pov-shift',
    'static-room-summary',
    'action-static-list-disconnect',
    'inventory-scan-paragraph',
    'scene-asset-overload',
    'missing-reaction-bridge',
    'stiff-transition',
    'unmotivated-action-shift',
    'comma-stacked-long-sentence',
    'parallel-body-detail-overload',
    'parallel-scene-detail-overload',
    'overloaded-detail-sentence',
    'fuzzy-subject-detail',
    'patchwork-description',
    'cause-state-result-chop',
    'detail-dimension-overload',
    'short-flow-chain',
    'short-dialogue-chain',
    'sentence-chain-flatness',
    'prop-dossier-description',
    'negative-reveal',
    'negative-negative-explain',
    'negative-negative-affirm',
    'negative-comma-triple',
    'negative-period-reveal',
    'negative-comma-reveal',
    'negative-standalone-judgement',
    'mechanical-negation-window-density',
    'mechanical-negation-density',
    'empty-reveal',
    'empty-comma-reveal',
    'dash-explain-judgement',
    'noun-fragment-sentence',
    'triple-noun-enumeration',
    'isolated-label-sentence',
    'dialogue-negative-list',
    'dialogue-negative-command-chain',
    'choppy-paragraph',
    'action-chain-fragmented',
  ];
  return priority.map((type) => issues.find((issue) => issue.type === type && !excluded.has(type))).find(Boolean)
    || issues.find((issue) => isLocalNaturalnessRepairIssue(issue) && !excluded.has(issue.type));
}
