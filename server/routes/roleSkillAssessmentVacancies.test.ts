import { describe, expect, it } from 'vitest';
import { toAssessmentVacancies } from './roleSkillAssessmentRoutes';

type Matched = Parameters<typeof toAssessmentVacancies>[0];

describe('toAssessmentVacancies', () => {
  it('does not offer a job title as a skill to check', () => {
    const now = new Date('2026-11-04T00:00:00.000Z');
    const matched = [
      {
        cluster: {
          id: 'cluster-1',
          status: 'active',
          skills: ['CTO', 'VP-Of-Engineering', 'Customer-Success-Manager', 'Kafka'],
          sources: [
            { sourceId: 'src', sourceName: 'hh.ru', observedAt: '2026-11-03T00:00:00.000Z' },
          ],
        },
        explanation: { roleMatch: 'target' },
      },
    ] as unknown as Matched;
    const [vacancy] = toAssessmentVacancies(matched, 'role', now);
    expect(vacancy.requirements.map((requirement) => requirement.statement)).toEqual(['Kafka']);
  });
});
