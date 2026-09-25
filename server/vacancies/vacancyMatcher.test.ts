import { describe, expect, it } from 'vitest';
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
      expect(explanation.levelMatch).toBe('target');
    });

    it('не называет уровень, когда кандидат его не указал', () => {
      const explanation = matchCandidateWithVacancy(strongCandidate, sampleCluster);
      expect(explanation.levelMatch).toBeUndefined();
    });

    it('не называет уровень, когда заголовок вакансии не даёт сигнала об уровне', () => {
      const explanation = matchCandidateWithVacancy(
        { ...strongCandidate, targetLevel: 'head' },
        { ...sampleCluster, canonicalTitle: 'Frontend Engineer' },
      );
      expect(explanation.levelMatch).toBeUndefined();
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
  });
});
