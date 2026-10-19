import { describe, expect, it, vi } from 'vitest';
import { assessVacancyFit, evaluateVacancyFit, vacancyFitFingerprint, type VacancyFitInput } from './vacancyFit';

export function fitInput(candidateId = 'candidate-a'): VacancyFitInput {
  return {
    candidateId, vacancyId: 'v1', description: 'Required: TypeScript',
    requirements: [{ id: 'r1', text: 'TypeScript', sourceQuote: 'Required: TypeScript', origin: 'explicit', importance: 'high', kind: 'experience', hard: true, stopFactor: false }],
    facts: [{ id: 'f1', candidateId, kind: 'fact', status: 'confirmed', statement: 'I built TypeScript services.', sourceMessageIds: ['m1'], sensitive: false }],
    gates: { role: { status: 'matched', reason: 'role checked' }, level: { status: 'matched', reason: 'level checked' }, region: { status: 'matched', reason: 'unrestricted' }, workAuthorization: { status: 'matched', reason: 'checked' }, workFormat: { status: 'matched', reason: 'checked' } },
    assessments: [{ requirementId: 'r1', status: 'matched', evidence: [{ factId: 'f1', quote: 'TypeScript services' }] }],
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
    expect(result.coveragePercent).toBe(100);
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
    expect(result.coveragePercent).toBe(50);
    expect(result.coverage.unknown).toBe(1);
    expect(result.dataState).toBe('partial');
  });
  it('ignores inferred requirements for stop factors and numeric coverage', () => {
    const input = fitInput();
    const result = evaluateVacancyFit({ ...input, requirements: [...input.requirements, { ...input.requirements[0], id: 'r2', origin: 'inferred', hard: true, stopFactor: true }] });
    expect(result.coverage.total).toBe(1);
    expect(result.coveragePercent).toBe(100);
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
