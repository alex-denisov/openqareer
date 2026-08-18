import { describe, expect, it } from 'vitest';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import { matchCandidateWithVacancy, type CandidateMatchProfile } from './vacancyMatcher';

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

  it('evaluates strong fit with high score and detailed matching points', () => {
    const explanation = matchCandidateWithVacancy(strongCandidate, sampleCluster);
    expect(explanation.matchScore).toBeGreaterThanOrEqual(75);
    expect(explanation.fitLevel).toBe('strong');
    expect(explanation.matchingPoints.length).toBeGreaterThanOrEqual(2);
    expect(explanation.missingPoints).toContain('GraphQL');
    expect(explanation.summary).toContain('Сильное совпадение');
  });

  it('evaluates low fit for mismatched roles and skillsets honestly', () => {
    const explanation = matchCandidateWithVacancy(partialCandidate, sampleCluster);
    expect(explanation.matchScore).toBeLessThan(50);
    expect(explanation.fitLevel).toBe('low');
    expect(explanation.missingPoints.length).toBeGreaterThanOrEqual(3);
  });
});
