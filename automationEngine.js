export function createAutomationEngine(deps) {
  return {
    generateChapter(options) {
      return deps.generateAutomationChapter(options);
    },
    generateChaptersSequential(options) {
      return deps.generateAutomationChaptersSequential(options);
    },
    ensureChapterNaturalness(options) {
      return deps.ensureAutomationChapterNaturalness(options);
    },
  };
}
