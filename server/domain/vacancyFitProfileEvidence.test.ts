import { describe, expect, it } from 'vitest';
import { assessVacancyFit, type VacancyFitAssessor, type VacancyFitInput } from './vacancyFit';
import {
  MAX_PROFILE_EVIDENCE_FACTS,
  MAX_PROFILE_EVIDENCE_CHARS,
  vacancyFitEvidenceFacts,
} from './vacancyFitProfileEvidence';

const memoryFact = {
  id: 'f1',
  kind: 'fact',
  status: 'confirmed',
  statement: 'Руководил разработкой, почта me@example.com',
  sourceMessageIds: ['m1'],
  sensitive: false,
};
const hypothesis = {
  id: 'h1',
  kind: 'hypothesis',
  status: 'proposed',
  statement: 'Может подойти роль CTO',
  sourceMessageIds: ['m2'],
  sensitive: false,
};
const draft = {
  candidate: {
    headline: 'CIO, IT director',
    about: 'Отвечаю за ИТ-стратегию. Пишите: +7 900 123-45-67',
  },
  experience: [
    {
      id: 'e1',
      chronologyMemoryId: 'c1',
      title: 'CIO',
      employer: 'Acme',
      startDate: '2019-01',
      current: true,
      bulletMemoryIds: [],
      skills: ['ITIL'],
    },
  ],
  skills: [
    { id: 's1', name: 'IT budget management' },
    { id: 's2', name: 'IT team leadership' },
  ],
  education: [{ id: 'ed1', evidenceMemoryId: 'x', institution: 'МГТУ', qualification: 'Инженер' }],
  languages: [{ id: 'l1', evidenceMemoryId: 'y', name: 'English', cefr: 'C1' }],
  certifications: [{ id: 'c1', name: 'PMP', issuer: 'PMI' }],
  projects: [{ id: 'p1', name: 'ERP rollout', description: 'SAP S/4 for 3 000 users' }],
};
const snapshot = { memory: [memoryFact, hypothesis], resume: { draft } } as never;

describe('vacancy fit evidence from the whole profile (01.11)', () => {
  it('sends memory facts and every profile section with an id, provenance and a cleaned statement', () => {
    const facts = vacancyFitEvidenceFacts('cand', snapshot);
    const by = (id: string) => facts.find((fact) => fact.id === id);
    expect(by('f1')).toMatchObject({
      evidenceSource: 'memory',
      statement: 'Руководил разработкой, почта [contact removed]',
    });
    expect(by('h1')).toBeUndefined();
    expect(by('profile:skill:s1')).toMatchObject({
      evidenceSource: 'profile',
      statement: 'IT budget management',
      candidateId: 'cand',
    });
    expect(by('profile:headline')?.statement).toBe('CIO, IT director');
    expect(by('profile:about')?.statement).toBe('Отвечаю за ИТ-стратегию. Пишите: [phone removed]');
    expect(by('profile:experience:e1')?.statement).toContain('CIO');
    expect(by('profile:experience:e1')?.statement).toContain('ITIL');
    expect(by('profile:education:ed1')?.statement).toContain('МГТУ');
    expect(by('profile:language:l1')?.statement).toContain('C1');
    expect(by('profile:certificate:c1')?.statement).toContain('PMP');
    expect(by('profile:project:p1')?.statement).toContain('SAP S/4');
  });

  it('bounds the number and length of profile facts', () => {
    const skills = Array.from({ length: 500 }, (_, index) => ({
      id: `s${index}`,
      name: `Skill ${index}`,
    }));
    const big = {
      memory: [],
      resume: { draft: { ...draft, skills, candidate: { about: 'x'.repeat(5000) } } },
    } as never;
    const facts = vacancyFitEvidenceFacts('cand', big);
    expect(facts.length).toBeLessThanOrEqual(MAX_PROFILE_EVIDENCE_FACTS);
    expect(Math.max(...facts.map((fact) => fact.statement.length))).toBeLessThanOrEqual(
      MAX_PROFILE_EVIDENCE_CHARS,
    );
  });

  // 02.11: a bare skill tag is partial at most — the match is found, but counts half.
  it('matches «Бюджетирование ИТ» against an «IT budget management» skill entry as partial', async () => {
    const facts = vacancyFitEvidenceFacts('cand', snapshot);
    const requirement = (id: string, text: string) => ({
      id,
      text,
      sourceQuote: text,
      origin: 'explicit' as const,
      importance: 'high' as const,
      kind: 'experience' as const,
      hard: false,
      stopFactor: false,
    });
    const requirements = [
      requirement('r1', 'Бюджетирование ИТ'),
      requirement('r2', 'Управление ИТ-командой'),
      requirement('r3', 'Опыт SAP'),
    ];
    const words: Record<string, RegExp> = { r1: /budget/iu, r2: /team/iu, r3: /SAP/u };
    // A fake assessor that reads only what it was sent, like the model.
    const assessor: VacancyFitAssessor = {
      assess: async (sent) =>
        sent.requirements.map((item) => {
          const fact = sent.facts.find((entry) => words[item.id].test(entry.statement));
          return fact
            ? {
                requirementId: item.id,
                status: 'matched',
                evidence: [{ factId: fact.id, quote: fact.statement.match(words[item.id])![0] }],
              }
            : { requirementId: item.id, status: 'unknown', evidence: [] };
        }),
    };
    const gate = { status: 'unknown' as const, reason: 'x' };
    const input: VacancyFitInput = {
      candidateId: 'cand',
      vacancyId: 'v',
      description: requirements.map((item) => item.text).join('. '),
      requirements,
      facts,
      gates: { role: gate, level: gate, region: gate, workAuthorization: gate, workFormat: gate },
    };
    const result = await assessVacancyFit(input, assessor);
    expect(result.assessments.map((item) => item.status)).toEqual([
      'partial',
      'partial',
      'matched',
    ]);
    expect(result.coveragePercent).toBe(67);
  });
});
