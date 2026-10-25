import { describe, expect, it } from 'vitest';
import { MIN_ROLE_SAMPLE } from '../../shared/poolRoleHypotheses';
import {
  buildRoleSkillCases,
  buildRoleSkillRequirementSummaries,
  countFreshActiveRoleVacancies,
  evaluateRoleReadiness,
  isRoleSkillAssessmentStale,
  validateRoleSkillEvaluation,
  type RoleAssessmentVacancy,
  type RoleSkillGrade,
  type RoleSkillModelEvaluation,
  type RoleSkillReadinessSkill,
} from './roleSkillAssessment';

const ROLE_ID = 'role-product-lead';
const ASSESSED_AT = '2026-07-12T00:00:00.000Z';
const NOW = '2026-10-10T00:00:00.000Z';
const CANDIDATE_ANSWER =
  'Сначала сравнила стоимость операций, затем проверила влияние на конверсию.';

function vacancy(
  index: number,
  overrides: Partial<RoleAssessmentVacancy> = {},
): RoleAssessmentVacancy {
  const id = `vacancy-${index}`;
  return {
    id,
    roleId: ROLE_ID,
    status: 'active',
    freshness: 'fresh',
    requirements: [
      {
        id: `requirement-${index}`,
        skillId: 'unit-economics',
        statement: 'Оценивать экономику продуктового решения.',
        sourceRefs: [
          {
            id: `source-${index}`,
            vacancyId: id,
            observedAt: '2026-10-09T12:00:00.000Z',
          },
        ],
      },
    ],
    ...overrides,
  };
}

function readinessSkill(
  id: string,
  grade: RoleSkillGrade,
  isKeySkill = false,
): RoleSkillReadinessSkill {
  return { id, grade, isKeySkill };
}

function validModelEvaluation(
  overrides: Partial<RoleSkillModelEvaluation> = {},
): RoleSkillModelEvaluation {
  return {
    grade: 'confirmed',
    criteria: [
      {
        criterionId: 'decision-evidence',
        grade: 'confirmed',
        explanation: 'Ответ связывает экономику решения с измеренным эффектом.',
        candidateExcerpt: 'Сначала сравнила стоимость операций',
        sourceRefIds: ['source-0'],
      },
    ],
    ...overrides,
  };
}

describe('role skill assessment domain', () => {
  it('counts unique active fresh vacancies and uses the shared sample threshold', () => {
    const sevenEligible = Array.from({ length: MIN_ROLE_SAMPLE - 1 }, (_, index) => vacancy(index));
    const ineligible = [
      { ...vacancy(100), status: 'closed' as const },
      { ...vacancy(101), freshness: 'stale' as const },
      vacancy(102, { roleId: 'role-engineer' }),
    ];
    const belowThreshold = [...sevenEligible, sevenEligible[0]!, ...ineligible];

    expect(MIN_ROLE_SAMPLE).toBe(8);
    expect(countFreshActiveRoleVacancies(belowThreshold, ROLE_ID)).toBe(MIN_ROLE_SAMPLE - 1);
    expect(buildRoleSkillCases(belowThreshold, ROLE_ID)).toEqual([]);

    const atThreshold = [...belowThreshold, vacancy(7)];
    expect(countFreshActiveRoleVacancies(atThreshold, ROLE_ID)).toBe(MIN_ROLE_SAMPLE);
    expect(buildRoleSkillCases(atThreshold, ROLE_ID)).not.toHaveLength(0);
  });

  it('builds cases only from requirements with valid dated source references', () => {
    const vacancies = Array.from({ length: MIN_ROLE_SAMPLE }, (_, index) => vacancy(index));
    vacancies[0] = vacancy(0, {
      requirements: [
        ...vacancies[0]!.requirements,
        {
          id: 'requirement-without-source',
          skillId: 'forecasting',
          statement: 'Прогнозировать продуктовые показатели.',
          sourceRefs: [],
        },
        {
          id: 'requirement-with-undated-source',
          skillId: 'experimentation',
          statement: 'Планировать эксперименты.',
          sourceRefs: [{ id: 'undated-source', vacancyId: 'vacancy-0', observedAt: '' }],
        },
        {
          id: 'requirement-with-invalid-date',
          skillId: 'research',
          statement: 'Проверять продуктовые гипотезы.',
          sourceRefs: [
            { id: 'invalid-date-source', vacancyId: 'vacancy-0', observedAt: 'yesterday' },
          ],
        },
      ],
    });

    const cases = buildRoleSkillCases(vacancies, ROLE_ID);
    const caseRequirementIds = cases.map((item) => item.requirementId);
    const caseSources = cases.flatMap((item) => item.sourceRefs);

    expect(caseRequirementIds).toContain('requirement-0');
    expect(caseRequirementIds).not.toContain('requirement-without-source');
    expect(caseRequirementIds).not.toContain('requirement-with-undated-source');
    expect(caseRequirementIds).not.toContain('requirement-with-invalid-date');
    expect(caseSources.length).toBeGreaterThan(0);
    expect(caseSources.every((source) => Number.isFinite(Date.parse(source.observedAt)))).toBe(
      true,
    );
  });

  it('accepts only strict grades and criterion explanations grounded in the exact answer and allowed sources', () => {
    const criteria = [{ id: 'decision-evidence', description: 'Названо основание решения.' }];
    const allowedSourceRefs = [
      { id: 'source-0', vacancyId: 'vacancy-0', observedAt: '2026-10-09T12:00:00.000Z' },
    ];
    const result = validateRoleSkillEvaluation({
      candidateAnswer: CANDIDATE_ANSWER,
      criteria,
      allowedSourceRefs,
      modelEvaluation: validModelEvaluation(),
    });

    expect(result).toEqual({
      candidateAnswer: CANDIDATE_ANSWER,
      grade: 'confirmed',
      criteria: [
        {
          criterionId: 'decision-evidence',
          grade: 'confirmed',
          explanation: 'Ответ связывает экономику решения с измеренным эффектом.',
          candidateExcerpt: 'Сначала сравнила стоимость операций',
          sourceRefIds: ['source-0'],
        },
      ],
    });
    expect(Object.keys(result).sort()).toEqual(['candidateAnswer', 'criteria', 'grade']);
  });

  it('rejects unknown grades, foreign evidence references, and paraphrased answer excerpts', () => {
    const input = {
      candidateAnswer: CANDIDATE_ANSWER,
      criteria: [{ id: 'decision-evidence', description: 'Названо основание решения.' }],
      allowedSourceRefs: [
        { id: 'source-0', vacancyId: 'vacancy-0', observedAt: '2026-10-09T12:00:00.000Z' },
      ],
    };
    const invalidGrade = {
      ...validModelEvaluation(),
      grade: 'weak',
    } as unknown as RoleSkillModelEvaluation;
    const foreignSource = validModelEvaluation({
      criteria: [
        {
          criterionId: 'decision-evidence',
          grade: 'confirmed',
          explanation: 'Основание подтверждено.',
          candidateExcerpt: 'Сначала сравнила стоимость операций',
          sourceRefIds: ['source-from-another-role'],
        },
      ],
    });
    const paraphrasedAnswer = validModelEvaluation({
      criteria: [
        {
          criterionId: 'decision-evidence',
          grade: 'confirmed',
          explanation: 'Основание подтверждено.',
          candidateExcerpt: 'Сначала оценила затраты на операции',
          sourceRefIds: ['source-0'],
        },
      ],
    });

    expect(() =>
      validateRoleSkillEvaluation({ ...input, modelEvaluation: invalidGrade }),
    ).toThrow();
    expect(() =>
      validateRoleSkillEvaluation({ ...input, modelEvaluation: foreignSource }),
    ).toThrow();
    expect(() =>
      validateRoleSkillEvaluation({ ...input, modelEvaluation: paraphrasedAnswer }),
    ).toThrow();
  });

  it('keeps an answer quote off only by spacing or the final period as the answer span (B564)', () => {
    const result = validateRoleSkillEvaluation({
      candidateAnswer: CANDIDATE_ANSWER,
      criteria: [{ id: 'decision-evidence', description: 'Названо основание решения.' }],
      allowedSourceRefs: [
        { id: 'source-0', vacancyId: 'vacancy-0', observedAt: '2026-10-09T12:00:00.000Z' },
      ],
      modelEvaluation: validModelEvaluation({
        criteria: [
          {
            criterionId: 'decision-evidence',
            grade: 'confirmed',
            explanation: 'Основание подтверждено.',
            candidateExcerpt: 'Сначала  сравнила стоимость операций.',
            sourceRefIds: ['source-0'],
          },
        ],
      }),
    });

    expect(result.criteria[0]!.candidateExcerpt).toBe('Сначала сравнила стоимость операций,');
  });

  it('rejects a summary grade that does not follow the individual criteria', () => {
    const input = {
      candidateAnswer: CANDIDATE_ANSWER,
      criteria: [{ id: 'decision-evidence', description: 'Названо основание решения.' }],
      allowedSourceRefs: [
        { id: 'source-0', vacancyId: 'vacancy-0', observedAt: '2026-10-09T12:00:00.000Z' },
      ],
      modelEvaluation: validModelEvaluation({
        grade: 'not_confirmed',
      }),
    };

    expect(() => validateRoleSkillEvaluation(input)).toThrow(/evaluation_grade_mismatch/u);
  });

  it('marks an assessment stale at 90 days, but not immediately before the boundary', () => {
    expect(isRoleSkillAssessmentStale('2026-07-12T00:00:00.001Z', NOW)).toBe(false);
    expect(isRoleSkillAssessmentStale(ASSESSED_AT, NOW)).toBe(true);
  });

  it('requires three confirmed skills out of five, including every key skill', () => {
    const readySkills = [
      readinessSkill('unit-economics', 'confirmed', true),
      readinessSkill('product-discovery', 'confirmed', true),
      readinessSkill('analytics', 'confirmed'),
      readinessSkill('experimentation', 'partial'),
      readinessSkill('leadership', 'not_confirmed'),
    ];
    const missesKeySkill = [
      readinessSkill('unit-economics', 'confirmed', true),
      readinessSkill('product-discovery', 'partial', true),
      readinessSkill('analytics', 'confirmed'),
      readinessSkill('experimentation', 'confirmed'),
      readinessSkill('leadership', 'not_confirmed'),
    ];
    const belowThree = [
      readinessSkill('unit-economics', 'confirmed', true),
      readinessSkill('product-discovery', 'confirmed', true),
      readinessSkill('analytics', 'partial'),
      readinessSkill('experimentation', 'partial'),
      readinessSkill('leadership', 'not_confirmed'),
    ];

    expect(evaluateRoleReadiness(readySkills)).toMatchObject({ ready: true, confirmedCount: 3 });
    expect(evaluateRoleReadiness(missesKeySkill)).toMatchObject({
      ready: false,
      confirmedCount: 3,
      missingKeySkillIds: ['product-discovery'],
    });
    expect(evaluateRoleReadiness(belowThree)).toMatchObject({ ready: false, confirmedCount: 2 });
  });
});

describe('repeated requirements in a sparse text-extracted sample (B509)', () => {
  function withSkills(index: number, skillIds: readonly string[]): RoleAssessmentVacancy {
    const id = `vacancy-${index}`;
    return vacancy(index, {
      requirements: skillIds.map((skillId) => ({
        id: `requirement-${index}-${skillId}`,
        skillId,
        statement: skillId,
        sourceRefs: [
          {
            id: `source-${index}-${skillId}`,
            vacancyId: id,
            observedAt: '2026-10-09T12:00:00.000Z',
          },
        ],
      })),
    });
  }

  it('counts repetition among vacancies with extracted requirements, not among all of them', () => {
    // 300 vacancies, only 10 have extracted requirements: each skill in 2 of those 10.
    const skills = ['a', 'b', 'c', 'd', 'e'];
    const extracted = Array.from({ length: 10 }, (_, index) =>
      withSkills(index, [skills[index % 5]!, skills[(index + 1) % 5]!]),
    );
    const empty = Array.from({ length: 290 }, (_, index) => withSkills(100 + index, []));
    const sample = [...extracted, ...empty];
    expect(
      buildRoleSkillRequirementSummaries(sample, ROLE_ID).map((item) => item.skillId),
    ).toHaveLength(5);
    expect(buildRoleSkillCases(sample, ROLE_ID)).toHaveLength(3);
  });

  it('still drops a skill seen in one vacancy and one below the 20 % share', () => {
    const extracted = [
      ...Array.from({ length: 4 }, (_, index) => withSkills(index, ['common'])),
      withSkills(10, ['rare', 'common']),
      ...Array.from({ length: 15 }, (_, index) => withSkills(20 + index, ['filler'])),
      withSkills(40, ['twice']),
      withSkills(41, ['twice']),
    ];
    const ids = buildRoleSkillRequirementSummaries(extracted, ROLE_ID).map((item) => item.skillId);
    expect(ids).toContain('common');
    expect(ids).toContain('filler');
    expect(ids).not.toContain('rare');
    expect(ids).not.toContain('twice');
  });
});
