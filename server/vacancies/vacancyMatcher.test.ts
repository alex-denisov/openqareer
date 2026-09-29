import { describe, expect, it } from 'vitest';
import { compareMatchedVacancies } from '../../shared/vacancyMatchOrder';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import { matchCandidateWithVacancy, type CandidateMatchProfile } from './vacancyMatcher';
import { lintTextQuality } from '../../shared/textQualityLinter';

describe('Explainable Vacancy Matcher', () => {
  const sampleCluster: VacancyCluster = {
    id: 'cluster-1',
    canonicalTitle: 'Lead Frontend Engineer (React/TypeScript)',
    canonicalCompany: 'Tech Unicorn',
    isRemote: true,
    skills: ['React', 'TypeScript', 'Node.js', 'GraphQL', 'Team Leadership'],
    primaryUrl: 'https://example.com/job/1',
    sources: [
      {
        sourceType: 'hh',
        sourceId: 'hh',
        sourceUrl: 'https://hh.ru/1',
        observedAt: '2026-08-18T00:00:00.000Z',
      },
    ],
    firstObservedAt: '2026-08-18T00:00:00.000Z',
    lastSeenAt: '2026-08-18T00:00:00.000Z',
    descriptionSummary: 'Leading a frontend team building high-performance web applications.',
    status: 'active',
    vacanciesCount: 1,
  };

  const strongCandidate: CandidateMatchProfile = {
    candidateId: 'cand-1',
    targetRoles: ['Lead Frontend Engineer', 'Engineering Manager'],
    confirmedSkills: ['React', 'TypeScript', 'Node.js', 'Team Leadership', 'Architecture'],
    confirmedFacts: [
      'Руководил frontend-командой из 8 инженеров',
      'Проектировал SPA на React и TypeScript',
    ],
    preferredRemote: true,
  };

  const partialCandidate: CandidateMatchProfile = {
    candidateId: 'cand-2',
    targetRoles: ['Python Backend Developer'],
    confirmedSkills: ['Python', 'Django', 'PostgreSQL'],
    confirmedFacts: ['Разрабатывал API на Django'],
    preferredRemote: true,
  };

  it('counts the requirements it could check instead of scoring the candidate', () => {
    const explanation = matchCandidateWithVacancy(strongCandidate, sampleCluster);
    expect(explanation.requirements).toEqual({ matched: 4, total: 5 });
    expect(explanation.roleMatch).toBe('target');
    expect(explanation.matchingPoints.length).toBeGreaterThanOrEqual(2);
    expect(explanation.missingPoints).toContain('GraphQL');
    expect(explanation.summary).toContain('4 из 5');
  });

  it('names a role that does not match the candidate targets', () => {
    const explanation = matchCandidateWithVacancy(partialCandidate, sampleCluster);
    expect(explanation.roleMatch).toBe('none');
    expect(explanation.requirements).toEqual({ matched: 0, total: 5 });
    expect(explanation.missingPoints.length).toBeGreaterThanOrEqual(3);
  });

  /**
   * PRB-016: раньше вакансия без перечисленных требований получала 30 баллов
   * из 50 — соответствие выдумывалось из отсутствия данных.
   */
  it('says there is nothing to compare when the vacancy lists no requirements', () => {
    const explanation = matchCandidateWithVacancy(strongCandidate, {
      ...sampleCluster,
      skills: [],
    });
    expect(explanation.requirements).toBeUndefined();
    expect(explanation.summary).toContain('не перечислила требований');
    expect(explanation).not.toHaveProperty('matchScore');
    expect(explanation).not.toHaveProperty('fitLevel');
  });
  /**
   * Объяснение подбора — текст, который читает кандидат. Штампов в нём быть не
   * должно, и проверять это должен тест, а не внимательность (B210).
   */
  describe('объяснение подбора написано без штампов', () => {
    it('ни одна фраза объяснения не берётся из реестра штампов', () => {
      const explanation = matchCandidateWithVacancy(strongCandidate, sampleCluster);
      const texts = [
        explanation.summary,
        ...explanation.matchingPoints,
        ...explanation.missingPoints,
      ];
      expect(texts.flatMap((text) => lintTextQuality(text))).toEqual([]);
    });

    it('вакансия без требований объясняется без штампов тоже', () => {
      const explanation = matchCandidateWithVacancy(strongCandidate, {
        ...sampleCluster,
        skills: [],
      });
      expect(lintTextQuality(explanation.summary)).toEqual([]);
    });
  });

  describe('«совпадает по фактам профиля» — привязка к id, а не только к строке', () => {
    it('приписывает id факта совпавшему навыку, когда факт известен', () => {
      const explanation = matchCandidateWithVacancy(
        {
          ...strongCandidate,
          confirmedSkillFacts: [{ id: 'fact-42', label: 'React' }],
        },
        sampleCluster,
      );
      const reactFact = explanation.matchingFacts?.find((entry) =>
        entry.text.includes('React'),
      );
      expect(reactFact?.factId).toBe('fact-42');
    });

    it('не выдумывает id, когда факт для совпавшего навыка не передан', () => {
      const explanation = matchCandidateWithVacancy(strongCandidate, sampleCluster);
      const reactFact = explanation.matchingFacts?.find((entry) =>
        entry.text.includes('React'),
      );
      expect(reactFact?.factId).toBeUndefined();
    });

    it('содержит ту же строку и тот же порядок, что matchingPoints', () => {
      const explanation = matchCandidateWithVacancy(strongCandidate, sampleCluster);
      expect(explanation.matchingFacts?.map((entry) => entry.text)).toEqual(
        explanation.matchingPoints,
      );
    });
  });

  describe('level-match — третий fit-dot рядом с ролью и гео', () => {
    it('называет уровень целевым, когда заголовок вакансии совпадает с уровнем кандидата', () => {
      const explanation = matchCandidateWithVacancy(
        { ...strongCandidate, targetLevel: 'lead' },
        sampleCluster,
      );
      expect(explanation.levelMatch).toBe('match');
    });

    it('не называет уровень, когда кандидат его не указал', () => {
      const explanation = matchCandidateWithVacancy(strongCandidate, sampleCluster);
      expect(explanation.levelMatch).toBe('unknown');
    });

    it('не называет уровень, когда заголовок вакансии не даёт сигнала об уровне', () => {
      const explanation = matchCandidateWithVacancy(
        { ...strongCandidate, targetLevel: 'head' },
        { ...sampleCluster, canonicalTitle: 'Frontend Engineer' },
      );
      expect(explanation.levelMatch).toBe('unknown');
    });
  });

  describe('semanticRoleFunctions (B267 S3)', () => {
    const ctoCandidate: CandidateMatchProfile = {
      candidateId: 'cand-cto',
      targetRoles: ['CTO'],
      confirmedSkills: [],
      confirmedFacts: [],
      semanticRoleFunctions: ['eng-mgmt'],
      targetLevel: 'c-level',
    };

    it('target — функция и уровень совпали', () => {
      const explanation = matchCandidateWithVacancy(ctoCandidate, {
        ...sampleCluster,
        canonicalTitle: 'CTO',
      });
      expect(explanation.roleMatch).toBe('target');
    });

    it('partial — функция совпала, уровень соседний', () => {
      const explanation = matchCandidateWithVacancy(ctoCandidate, {
        ...sampleCluster,
        canonicalTitle: 'VP of Engineering',
      });
      expect(explanation.roleMatch).toBe('partial');
    });

    it('labels a product role as adjacent and keeps it below campaign-function matches', () => {
      const explanation = matchCandidateWithVacancy(ctoCandidate, {
        ...sampleCluster,
        canonicalTitle: 'Product Manager',
      });
      expect(explanation.roleMatch).toBe('partial');
      expect(explanation.adjacentRole).toBe(true);
      expect(explanation.summary).toContain('к смежной продуктовой роли');
    });

    it('orders a target-function partial match above an adjacent product role', () => {
      const targetFunction = {
        cluster: { firstObservedAt: '2026-09-20T00:00:00.000Z' },
        explanation: { roleMatch: 'partial' as const, requirements: { matched: 1, total: 2 } },
      };
      const adjacentFunction = {
        cluster: { firstObservedAt: '2026-09-24T00:00:00.000Z' },
        explanation: {
          roleMatch: 'partial' as const,
          adjacentRole: true,
          requirements: { matched: 2, total: 2 },
        },
      };
      expect(compareMatchedVacancies(targetFunction, adjacentFunction)).toBeLessThan(0);
    });

    it('keeps an SQL-selected semantic role when the rules level disagrees', () => {
      const explanation = matchCandidateWithVacancy(ctoCandidate, {
        ...sampleCluster,
        canonicalTitle: 'Engineering Manager',
      });
      expect(explanation.roleMatch).toBe('partial');
    });

    it('partial — уровень кандидата неизвестен, известна только функция', () => {
      const explanation = matchCandidateWithVacancy(
        { ...ctoCandidate, targetLevel: undefined },
        { ...sampleCluster, canonicalTitle: 'VP of Engineering' },
      );
      expect(explanation.roleMatch).toBe('partial');
    });

    it('none — функция не совпала, продажи не проходят как совпадение', () => {
      const explanation = matchCandidateWithVacancy(ctoCandidate, {
        ...sampleCluster,
        canonicalTitle: 'VP of Channel Sales',
      });
      expect(explanation.roleMatch).toBe('none');
    });

    it('none — operations-only campaigns reject a mixed marketing title', () => {
      const roleExplanation = matchCandidateWithVacancy(
        { ...ctoCandidate, semanticRoleFunctions: ['ops'], targetRoles: ['COO'] },
        { ...sampleCluster, canonicalTitle: 'Marketing Creative & Operations' },
      );
      const titleExplanation = matchCandidateWithVacancy(
        { ...ctoCandidate, semanticRoleFunctions: ['ops'], targetRoles: ['COO'] },
        { ...sampleCluster, canonicalTitle: 'Chief of Staff VP Operations Marketing Advertising Ecommerce' },
      );
      expect(roleExplanation.roleMatch).toBe('none');
      expect(titleExplanation.roleMatch).toBe('none');
    });

    it('matches an abbreviation in brackets of a candidate skill (B307)', () => {
      const candidate: CandidateMatchProfile = {
        candidateId: 'cand-ai',
        targetRoles: ['Head of AI'],
        confirmedSkills: ['Artificial Intelligence (AI)'],
        confirmedFacts: [],
      };
      const cluster: VacancyCluster = { ...sampleCluster, canonicalTitle: 'Head of AI', skills: ['AI'] };
      expect(matchCandidateWithVacancy(candidate, cluster).requirements).toEqual({ matched: 1, total: 1 });
    });

    it('matches management skill synonyms to canonical requirements (B307)', () => {
      const cooCandidate: CandidateMatchProfile = {
        candidateId: 'cand-coo',
        targetRoles: ['COO', 'Операционный директор'],
        confirmedSkills: [
          'Руководство командой',
          'P&L Management',
          'Business Strategy',
        ],
        confirmedFacts: [],
        confirmedSkillFacts: [
          { id: 'fact-team', label: 'Руководство командой' },
          { id: 'fact-pnl', label: 'P&L Management' },
        ],
      };
      const cooCluster: VacancyCluster = {
        ...sampleCluster,
        canonicalTitle: 'Операционный директор',
        skills: [
          'управление командой',
          'управление P&L',
          'Бюджетирование',
        ],
      };

      const explanation = matchCandidateWithVacancy(cooCandidate, cooCluster);
      expect(explanation.requirements).toEqual({ matched: 2, total: 3 });
      expect(explanation.matchingPoints).toEqual(
        expect.arrayContaining([
          'Подтверждённый навык: управление командой',
          'Подтверждённый навык: управление P&L',
        ]),
      );
      expect(explanation.matchingFacts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ factId: 'fact-team' }),
          expect.objectContaining({ factId: 'fact-pnl' }),
        ]),
      );
      expect(explanation.missingPoints).toContain('Бюджетирование');
    });
  });
});
