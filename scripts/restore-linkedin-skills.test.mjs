import { describe, expect, it } from 'vitest';
import { planSkillRestore } from './restore-linkedin-skills.mjs';

const draft = {
  targetRole: 'CTO',
  skills: [
    { id: 'imp-skill-1', evidenceMemoryId: 'm1', name: 'n8n' },
    {
      id: 'skill-1',
      name: 'ITIL',
      status: 'подтверждён',
      source: 'квиз openqareer',
      verifiedAt: '2026-10-29',
    },
  ],
};

describe('planSkillRestore', () => {
  it('appends only the missing skills and keeps every existing entry as it is', () => {
    const plan = planSkillRestore(draft, ['N8N', 'itil', 'DevOps', 'Linux', 'DevOps']);
    expect(plan.added).toEqual(['DevOps', 'Linux']);
    expect(plan.draft.skills.slice(0, 2)).toEqual(draft.skills);
    expect(plan.draft.skills.slice(2).map((s) => [s.name, s.source])).toEqual([
      ['DevOps', 'LinkedIn'],
      ['Linux', 'LinkedIn'],
    ]);
    expect(plan.draft.targetRole).toBe('CTO');
    expect(draft.skills).toHaveLength(2);
  });

  it('is idempotent', () => {
    const once = planSkillRestore(draft, ['DevOps']).draft;
    const twice = planSkillRestore(once, ['DevOps']);
    expect(twice.added).toEqual([]);
    expect(twice.draft).toEqual(once);
  });

  it('drops blank and overlong names', () => {
    expect(planSkillRestore(draft, ['  ', 'x'.repeat(200)]).added).toEqual([]);
  });
});
