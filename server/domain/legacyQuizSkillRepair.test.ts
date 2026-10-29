import { describe, expect, it } from 'vitest';
import { EMPTY_RESUME_DRAFT, type ResumeDraft } from './resumeDraft';
import { repairLegacyQuizSkills } from './legacyQuizSkillRepair';

function draftWith(skills: NonNullable<ResumeDraft['skills']>): ResumeDraft {
  return { ...EMPTY_RESUME_DRAFT, skills };
}

describe('repairLegacyQuizSkills (Blinov, 29.10)', () => {
  it('moves the confirmation onto the profile skill and drops the quiz-title duplicate', () => {
    const draft = draftWith([
      { id: 'sk-hh', name: 'Docker' },
      { id: 'sk-php', name: 'PHP' },
      {
        id: 'skill-56567297',
        name: 'Docker & Контейнеризация сервисов',
        status: 'подтверждён',
        source: 'Банк квизов LinkedIn',
        verifiedAt: '2026-10-28',
      },
    ]);

    const repair = repairLegacyQuizSkills(draft);

    expect(repair.changes).toEqual([
      { kind: 'merged', from: 'Docker & Контейнеризация сервисов', into: 'Docker' },
    ]);
    expect(repair.draft.skills).toEqual([
      {
        id: 'sk-hh',
        name: 'Docker',
        status: 'подтверждён',
        source: 'квиз openqareer',
        verifiedAt: '2026-10-28',
      },
      { id: 'sk-php', name: 'PHP' },
    ]);
  });

  it('renames a lone quiz-title skill to the skill name with the honest source', () => {
    const repair = repairLegacyQuizSkills(
      draftWith([
        {
          id: 'skill-1',
          name: 'Docker & Контейнеризация сервисов',
          status: 'подтверждён',
          source: 'Банк квизов LinkedIn',
          verifiedAt: '2026-10-28',
        },
      ]),
    );

    expect(repair.draft.skills).toEqual([
      {
        id: 'skill-1',
        name: 'Docker',
        status: 'подтверждён',
        source: 'квиз openqareer',
        verifiedAt: '2026-10-28',
      },
    ]);
  });

  it('relabels the source of a skill the old bank confirmed under its own name', () => {
    const repair = repairLegacyQuizSkills(
      draftWith([{ id: 'sk', name: 'Docker', status: 'подтверждён', source: 'Банк квизов hh.ru' }]),
    );

    expect(repair.draft.skills?.[0]?.source).toBe('квиз openqareer');
    expect(repair.changes).toEqual([{ kind: 'relabeled', skill: 'Docker' }]);
  });

  it('does not let a failed duplicate overwrite a confirmed skill', () => {
    const repair = repairLegacyQuizSkills(
      draftWith([
        {
          id: 'a',
          name: 'Docker',
          status: 'подтверждён',
          source: 'квиз openqareer',
          verifiedAt: '2026-10-29',
        },
        {
          id: 'b',
          name: 'Docker & Контейнеризация сервисов',
          status: 'не подтверждён',
          source: 'Банк квизов LinkedIn',
        },
      ]),
    );

    expect(repair.draft.skills).toEqual([
      {
        id: 'a',
        name: 'Docker',
        status: 'подтверждён',
        source: 'квиз openqareer',
        verifiedAt: '2026-10-29',
      },
    ]);
  });

  it('is idempotent and leaves a clean profile alone', () => {
    const clean = draftWith([
      { id: 'sk', name: 'Docker', status: 'подтверждён', source: 'квиз openqareer' },
    ]);

    const repair = repairLegacyQuizSkills(clean);

    expect(repair.changes).toEqual([]);
    expect(repair.draft).toBe(clean);
  });
});
