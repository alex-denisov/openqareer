import { describe, expect, it, vi } from 'vitest';
import { assessVacancyFit, evaluateVacancyFit, isSkillRequirement, MIN_SKILL_REQUIREMENTS, vacancyFitFingerprint, type VacancyFitInput } from './vacancyFit';

export function fitInput(candidateId = 'candidate-a'): VacancyFitInput {
  return {
    candidateId, vacancyId: 'v1', description: 'Required: TypeScript. Node. SQL.',
    requirements: [
      { id: 'r1', text: 'TypeScript', sourceQuote: 'Required: TypeScript', origin: 'explicit', importance: 'high', kind: 'experience', hard: true, stopFactor: false },
      // Two optional skills: a percent needs MIN_SKILL_REQUIREMENTS (3) skill requirements (B510-r).
      { id: 's2', text: 'Node', sourceQuote: 'Node', origin: 'structural', importance: 'medium', kind: 'other', hard: false, stopFactor: false },
      { id: 's3', text: 'SQL', sourceQuote: 'SQL', origin: 'structural', importance: 'medium', kind: 'other', hard: false, stopFactor: false },
    ],
    facts: [{ id: 'f1', candidateId, kind: 'fact', status: 'confirmed', statement: 'I built TypeScript services on Node with SQL.', sourceMessageIds: ['m1'], sensitive: false }],
    gates: { role: { status: 'matched', reason: 'role checked' }, level: { status: 'matched', reason: 'level checked' }, region: { status: 'matched', reason: 'unrestricted' }, workAuthorization: { status: 'matched', reason: 'checked' }, workFormat: { status: 'matched', reason: 'checked' } },
    assessments: [
      { requirementId: 'r1', status: 'matched', evidence: [{ factId: 'f1', quote: 'TypeScript services' }] },
      { requirementId: 's2', status: 'matched', evidence: [{ factId: 'f1', quote: 'Node' }] },
      { requirementId: 's3', status: 'matched', evidence: [{ factId: 'f1', quote: 'SQL' }] },
    ],
  };
}

describe('verified vacancy fit coverage', () => {
  it('reports equal evidence coverage separately from required coverage', () => {
    const input = fitInput();
    const result = evaluateVacancyFit(input);
    expect(result.coveragePercent).toBe(100);
    expect(result.requiredCoverage).toEqual({ matched: 1, total: 1, percent: 100 });
    expect(result.assessments[0].evidence[0].factId).toBe('f1');
  });
  it('does not score a blocked gate or invoke a model', async () => {
    const input = fitInput();
    const assessor = { assess: vi.fn() };
    const result = await assessVacancyFit({ ...input, gates: { ...input.gates, role: { status: 'blocked', reason: 'other role' } } }, assessor);
    expect(result.coveragePercent).toBeNull();
    expect(result.requiredCoverage.percent).toBeNull();
    expect(assessor.assess).not.toHaveBeenCalled();
  });
  it('scores requirements while unconfirmed gates stay listed as unknown, never as matched', async () => {
    const input = fitInput();
    const assessor = { assess: vi.fn().mockResolvedValue(input.assessments) };
    const gates = { ...input.gates, region: { status: 'unknown' as const, reason: 'not chosen' }, workAuthorization: { status: 'unknown' as const, reason: 'not stated' } };
    const result = await assessVacancyFit({ ...input, gates, assessments: undefined }, assessor);
    expect(assessor.assess).toHaveBeenCalledTimes(1);
    // Unconfirmed region and work permit lower the ceiling by 10 points each (B510-r).
    expect(result.coveragePercent).toBe(80);
    expect(result.status).toBe('assessed');
    expect(result.dataState).toBe('partial');
    expect(result.gates.region.status).toBe('unknown');
    expect(result.gates.workAuthorization.status).toBe('unknown');
  });
  it.each(['candidate', 'quote', 'status', 'sensitive', 'provenance', 'source'] as const)('rejects invalid %s evidence without inventing a failure', (invalid) => {
    const input = fitInput();
    const fact = { ...input.facts[0] };
    if (invalid === 'candidate') fact.candidateId = 'other';
    if (invalid === 'status') fact.status = 'proposed';
    if (invalid === 'sensitive') fact.sensitive = true;
    if (invalid === 'provenance') fact.sourceMessageIds = [];
    const result = evaluateVacancyFit({ ...input, facts: [fact], ...(invalid === 'source' ? { description: 'Something else' } : {}), ...(invalid === 'quote' ? { assessments: [{ requirementId: 'r1', status: 'matched', evidence: [{ factId: 'f1', quote: 'Rust' }] }] } : {}) });
    expect(result.coverage.matched).toBe(0);
    expect(result.assessments.every((a) => a.status !== 'unmatched')).toBe(true);
  });
  it('returns no number when every requirement remains unknown', () => {
    const result = evaluateVacancyFit({ ...fitInput(), assessments: [] }, '2026-10-18T10:00:00.000Z');
    expect(result.coveragePercent).toBeNull();
    expect(result.requiredCoverage.percent).toBeNull();
    expect(result.dataState).toBe('unknown');
    expect(result.calculatedAt).toBe('2026-10-18T10:00:00.000Z');
  });
  it('marks partial evidence while keeping missing facts unknown', () => {
    const input = fitInput();
    const result = evaluateVacancyFit({ ...input, requirements: [...input.requirements, { ...input.requirements[0], id: 'r2' }] });
    expect(result.coveragePercent).toBe(75);
    expect(result.coverage.unknown).toBe(1);
    expect(result.dataState).toBe('partial');
  });
  it('ignores inferred requirements for stop factors and numeric coverage', () => {
    const input = fitInput();
    const result = evaluateVacancyFit({ ...input, requirements: [...input.requirements, { ...input.requirements[0], id: 'r2', origin: 'inferred', hard: true, stopFactor: true }] });
    expect(result.coverage.total).toBe(3);
    expect(result.coveragePercent).toBe(100);
  });
  describe('honest percent on prod data 22.10 (B510-r)', () => {
    const education = { id: 'edu', text: 'Высшее образование', sourceQuote: 'Высшее образование', origin: 'explicit' as const, importance: 'high' as const, kind: 'education' as const, hard: true, stopFactor: false, label: 'Высшее образование', skill: false };
    const withEducation = (input: VacancyFitInput): VacancyFitInput => ({
      ...input, description: `${input.description} Высшее образование.`, requirements: [...input.requirements, education],
      facts: [{ ...input.facts[0], statement: `${input.facts[0].statement} Высшее образование.` }],
      assessments: [...(input.assessments ?? []), { requirementId: 'edu', status: 'matched', evidence: [{ factId: 'f1', quote: 'Высшее образование' }] }],
    });

    it('gives no percent for one condition: «1 из 1» was «Высшее образование»', async () => {
      const input = withEducation(fitInput());
      const assessor = { assess: vi.fn() };
      const result = await assessVacancyFit({ ...input, requirements: [education], assessments: undefined }, assessor);
      expect(result).toMatchObject({ reason: 'too_few_skills', coveragePercent: null, status: 'unknown' });
      expect(assessor.assess).not.toHaveBeenCalled();
    });

    it(`needs ${MIN_SKILL_REQUIREMENTS} skill requirements for a percent`, () => {
      const input = fitInput();
      const two = evaluateVacancyFit({ ...input, requirements: input.requirements.slice(0, 2) });
      expect(two).toMatchObject({ reason: 'too_few_skills', coveragePercent: null });
      expect(evaluateVacancyFit(input).coveragePercent).toBe(100);
    });

    it('lists conditions apart and never counts them in the percent', () => {
      const result = evaluateVacancyFit(withEducation(fitInput()));
      expect(result.coverage).toEqual({ matched: 3, total: 3, unknown: 0 });
      expect(result.conditionCoverage).toEqual({ matched: 1, total: 1, unknown: 0 });
      expect(result.requiredCoverage.total).toBe(1);
    });

    it('counts a model condition as a condition even when the rules call it other', () => {
      expect(isSkillRequirement({ ...education, kind: 'other', skill: false })).toBe(false);
      expect(isSkillRequirement({ ...education, kind: 'experience', skill: false })).toBe(true);
      expect(isSkillRequirement({ ...education, kind: 'other', skill: undefined })).toBe(true);
    });

    it('keeps 100 % only for a confirmed role, region and work permit', () => {
      const input = fitInput();
      const unknown = { status: 'unknown' as const, reason: 'not confirmed' };
      const result = evaluateVacancyFit({ ...input, gates: { ...input.gates, role: unknown, region: unknown, workAuthorization: unknown, workFormat: unknown } });
      expect(result).toMatchObject({ coveragePercent: 70, dataState: 'partial', requiredCoverage: { percent: 70 } });
    });
  });
  it('does not score without eligible facts or requirements', async () => {
    const assessor = { assess: vi.fn() };
    expect((await assessVacancyFit({ ...fitInput(), facts: [] }, assessor)).coveragePercent).toBeNull();
    expect((await assessVacancyFit({ ...fitInput(), requirements: [] }, assessor)).coveragePercent).toBeNull();
    expect(assessor.assess).not.toHaveBeenCalled();
  });
  it('does not trust unmatched without evidence and invokes assessor once after gates', async () => {
    const input = fitInput();
    const assessor = { assess: vi.fn().mockResolvedValue([{ requirementId: 'r1', status: 'unmatched', evidence: [] }]) };
    const result = await assessVacancyFit(input, assessor);
    expect(assessor.assess).toHaveBeenCalledOnce();
    expect(result.assessments[0].status).toBe('unknown');
  });
  it('changes fingerprint when facts, gate or requirement sources change', () => {
    const input = fitInput();
    const original = vacancyFitFingerprint(input);
    expect(vacancyFitFingerprint({ ...input, facts: [] })).not.toEqual(original);
    expect(vacancyFitFingerprint({ ...input, description: 'changed' })).not.toEqual(original);
    expect(vacancyFitFingerprint({ ...input, gates: { ...input.gates, role: { status: 'unknown', reason: 'changed' } } })).not.toEqual(original);
  });
});
