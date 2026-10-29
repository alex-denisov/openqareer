import { createHash } from 'node:crypto';
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
    // f1 came from a skill check, so every requirement it confirms counts in full (owner 29.10).
    checkedFactIds: ['f1'],
    gates: { role: { status: 'matched', reason: 'role checked' }, level: { status: 'matched', reason: 'level checked' }, region: { status: 'matched', reason: 'unrestricted' }, workAuthorization: { status: 'matched', reason: 'checked' }, workFormat: { status: 'matched', reason: 'checked' } },
    assessments: [
      { requirementId: 'r1', status: 'matched', evidence: [{ factId: 'f1', quote: 'TypeScript services' }] },
      { requirementId: 's2', status: 'matched', evidence: [{ factId: 'f1', quote: 'Node' }] },
      { requirementId: 's3', status: 'matched', evidence: [{ factId: 'f1', quote: 'SQL' }] },
    ],
  };
}

describe('verified vacancy fit coverage', () => {
  describe('half credit (owner 29.10)', () => {
    const facts = (input: VacancyFitInput) => [...input.facts, { ...input.facts[0], id: 'f2', statement: 'Stated SQL in the profile.' }];
    const assessments = [
      { requirementId: 'r1', status: 'matched' as const, evidence: [{ factId: 'f1', quote: 'TypeScript services' }] },
      { requirementId: 's2', status: 'matched' as const, evidence: [{ factId: 'f2', quote: 'SQL' }] },
      { requirementId: 's3', status: 'unmatched' as const, evidence: [{ factId: 'f2', quote: 'SQL' }] },
    ];
    it('counts a checked requirement 1, a stated one 0.5 and a missing one 0', () => {
      const input = fitInput();
      const result = evaluateVacancyFit({ ...input, facts: facts(input), assessments });
      expect(result.coveragePercent).toBe(50);
      expect(result.coverage).toEqual({ matched: 2, total: 3, unknown: 0, checked: 1 });
      expect(result.assessments.map((item) => item.checked ?? false)).toEqual([true, false, false]);
    });
    it('treats every requirement as unchecked without a skill check', () => {
      const result = evaluateVacancyFit({ ...fitInput(), checkedFactIds: [] });
      expect(result.coveragePercent).toBe(50);
      expect(result.coverage.checked).toBe(0);
    });
    it('keeps the profile key unchanged without checked facts and changes it with them', () => {
      const input = fitInput();
      const plain = vacancyFitFingerprint({ ...input, checkedFactIds: [] });
      expect(vacancyFitFingerprint({ ...input, checkedFactIds: undefined })).toEqual(plain);
      expect(vacancyFitFingerprint(input).profileHash).not.toBe(plain.profileHash);
    });
  });
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
    // Owner 29.10: unconfirmed gates no longer cap the percent.
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
  it('a model answer that confirms nothing is 0 %, not «no percent» (owner, 28.10)', () => {
    const unknown = fitInput().requirements.map((item) => ({ requirementId: item.id, status: 'unknown' as const, evidence: [] }));
    const result = evaluateVacancyFit({ ...fitInput(), assessments: unknown });
    expect(result.reason).toBe('assessed');
    expect(result.coveragePercent).toBe(0);
    expect(result.coverage).toEqual({ matched: 0, total: 3, unknown: 3, checked: 0 });
    expect(result.dataState).toBe('partial');
  });
  it('without a model answer there is still no number', () => {
    const result = evaluateVacancyFit({ ...fitInput(), assessments: undefined });
    expect(result.reason).toBe('assessment_unavailable');
    expect(result.coveragePercent).toBeNull();
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
      expect(result.coverage).toEqual({ matched: 3, total: 3, unknown: 0, checked: 3 });
      expect(result.conditionCoverage).toEqual({ matched: 1, total: 1, unknown: 0, checked: 1 });
      expect(result.requiredCoverage.total).toBe(1);
    });

    it('counts a model condition as a condition even when the rules call it other', () => {
      expect(isSkillRequirement({ ...education, kind: 'other', skill: false })).toBe(false);
      expect(isSkillRequirement({ ...education, kind: 'experience', skill: false })).toBe(true);
      expect(isSkillRequirement({ ...education, kind: 'other', skill: undefined })).toBe(true);
    });

    it('no longer caps the percent for an unconfirmed role, region or work permit', () => {
      const input = fitInput();
      const unknown = { status: 'unknown' as const, reason: 'not confirmed' };
      const result = evaluateVacancyFit({ ...input, gates: { ...input.gates, role: unknown, region: unknown, workAuthorization: unknown, workFormat: unknown } });
      expect(result).toMatchObject({ coveragePercent: 100, dataState: 'partial', requiredCoverage: { percent: 100 } });
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

describe('imported profile facts as fit evidence (B562)', () => {
  // Prod 24.10: a LinkedIn import left all 64 of the owner's facts `proposed`, so 787 vacancies
  // read «no_eligible_facts» and none showed a percent. The import is the candidate's own profile.
  const imported = (input: VacancyFitInput) => ({ ...input.facts[0], id: 'impe12a7b15ff-resp-1-1', status: 'proposed' });
  const withImported = (input: VacancyFitInput): VacancyFitInput => ({
    ...input, facts: [imported(input)],
    assessments: input.assessments?.map((claim) => ({ ...claim, evidence: claim.evidence.map((entry) => ({ ...entry, factId: 'impe12a7b15ff-resp-1-1' })) })),
  });

  it('scores a vacancy against a proposed fact that came from a profile import', () => {
    // Imported, not checked by a skill check: half credit (owner 29.10).
    const result = evaluateVacancyFit(withImported(fitInput()));
    expect(result).toMatchObject({ reason: 'assessed', coveragePercent: 50 });
  });
  it('still refuses a proposed fact the candidate only said in chat', () => {
    const input = fitInput();
    const result = evaluateVacancyFit({ ...input, facts: [{ ...input.facts[0], status: 'proposed' }] });
    expect(result.reason).toBe('no_eligible_facts');
  });
  it('refuses imported facts that are sensitive or not facts', () => {
    const input = withImported(fitInput());
    for (const fact of [{ ...input.facts[0], sensitive: true }, { ...input.facts[0], kind: 'hypothesis' }]) {
      expect(evaluateVacancyFit({ ...input, facts: [fact] }).reason).toBe('no_eligible_facts');
    }
  });
  it('a profile with imported evidence gets a new cache key, a confirmed-only profile keeps its key', () => {
    const confirmed = { ...fitInput(), checkedFactIds: [] };
    const before = vacancyFitFingerprint(confirmed).profileHash;
    expect(vacancyFitFingerprint({ ...confirmed }).profileHash).toBe(before);
    const legacy = vacancyFitFingerprint(withImported(confirmed)).profileHash;
    // The legacy hash of the same input (facts, gates, context) must not be reused: its cached
    // result was computed without the imported facts and its queue row is already completed.
    const input = withImported(confirmed);
    const old = createHash('sha256').update(JSON.stringify([input.candidateId, input.facts, input.gates, input.profileContextHash])).digest('hex');
    expect(legacy).not.toBe(old);
    expect(before).toBe(createHash('sha256').update(JSON.stringify([confirmed.candidateId, confirmed.facts, confirmed.gates, confirmed.profileContextHash])).digest('hex'));
  });
});

describe('requirement provenance on entity-encoded descriptions (B562-r)', () => {
  it('keeps a quote decoded from &eacute; and &rsquo;: the extractor stores the decoded span', () => {
    const input = fitInput();
    const description =
      '<p>Votre profil:</p><ul><li>Exp&eacute;rience TypeScript</li><li>Node d&rsquo;abord</li><li>SQL&nbsp;avanc&eacute;</li></ul>';
    const quotes = ['Expérience TypeScript', 'Node d’abord', 'SQL avancé'];
    const requirements = input.requirements.map((item, index) => ({
      ...item,
      sourceQuote: quotes[index],
    }));
    const result = evaluateVacancyFit({ ...input, description, requirements });
    expect(result.coverage).toEqual({ matched: 3, total: 3, unknown: 0, checked: 3 });
    expect(result.coveragePercent).toBe(100);
  });
});
