import { describe, expect, it, vi } from 'vitest';

const ROWS = 40;
vi.mock('./roleSkillAssessmentRoutes', () => ({
  readRoleSnapshot: async () => ({
    state: 'matched',
    vacancies: Array.from({ length: ROWS }, (_, index) => ({
      cluster: {
        id: `v${index}`,
        status: 'active',
        skills: [],
        sources: [{ sourceId: 's', observedAt: new Date().toISOString() }],
      },
      explanation: { roleMatch: 'target' },
    })),
  }),
}));
vi.mock('./roleSkillRequirementSource', () => ({
  createRoleRequirementReader: () => ({
    pendingCount: () => 0,
    skillsFor: () => {
      const until = performance.now() + 5;
      while (performance.now() < until);
      return ['SQL'];
    },
  }),
}));

const { readSamples } = await import('./roleSkillDemandRoutes');

describe('B702 part 2 (prod 24.11: 2385 ms of the event loop): skill demand is read in slices', () => {
  it('queued work runs between the rows of a role', async () => {
    let longestMs = 0;
    let last = performance.now();
    const timer = setInterval(() => {
      longestMs = Math.max(longestMs, performance.now() - last);
      last = performance.now();
    }, 1);
    await readSamples({} as never, 'c', ['CTO', 'COO']);
    clearInterval(timer);
    // 2 roles x 40 rows x 5 ms: 400 ms in one piece before.
    expect(longestMs).toBeLessThan(200);
  });
});
