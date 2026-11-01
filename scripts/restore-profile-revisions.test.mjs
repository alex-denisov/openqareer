import { describe, expect, it } from 'vitest';
import { planRestore } from './restore-profile-revisions.mjs';

const itil = JSON.stringify({ name: 'ITIL', status: 'подтверждён', source: 'квиз openqareer', verifiedAt: '2026-10-29' });
const dockerOld = JSON.stringify({ name: 'Docker', status: 'подтверждён', source: 'Банк квизов LinkedIn', verifiedAt: '2026-10-28' });

const revisions = [
  { id: 'r1', section: 'experience', experienceId: 'skill:docker', revertedAt: null, createdAt: '2026-10-28T13:06:45Z', appliedText: dockerOld },
  { id: 'r2', section: 'experience', experienceId: 'skill:itil', revertedAt: null, createdAt: '2026-10-29T15:08:56Z', appliedText: itil },
  { id: 'r3', section: 'about', experienceId: null, revertedAt: '2026-10-30T00:00:00Z', createdAt: '2026-10-29T16:00:00Z', appliedText: 'x' },
];

const draft = {
  candidate: {},
  experience: [],
  education: [],
  languages: [],
  skills: [{ id: 'imp-skill-1', name: 'Docker', status: 'подтверждён', source: 'квиз openqareer', verifiedAt: '2026-10-29' }],
};

describe('restore-profile-revisions planRestore', () => {
  it('re-adds a lost confirmed skill, keeps a newer quiz result, ignores reverted revisions', () => {
    const plan = planRestore(draft, revisions);
    expect(plan.report.map((line) => [line.revisionId, line.outcome])).toEqual([
      ['r1', 'kept-newer'],
      ['r2', 'added'],
    ]);
    expect(plan.draft.skills.map((skill) => [skill.name, skill.source])).toEqual([
      ['Docker', 'квиз openqareer'],
      ['ITIL', 'квиз openqareer'],
    ]);
  });

  it('is idempotent', () => {
    const once = planRestore(draft, revisions);
    const twice = planRestore(once.draft, revisions);
    expect(twice.changed).toBe(false);
    expect(twice.draft).toEqual(once.draft);
  });
});
