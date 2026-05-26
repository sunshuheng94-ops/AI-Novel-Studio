export function createPromptComposer(deps) {
  return {
    buildPositiveDraftingSkeletonGuide(card = {}) {
      return deps.buildPositiveDraftingSkeletonGuide(card);
    },
    buildGenerationPrompt(parts = []) {
      return parts.filter(Boolean).join('\n');
    },
    buildRepairPrompt(parts = []) {
      return parts.filter(Boolean).join('\n\n');
    },
  };
}
