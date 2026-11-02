import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isVacancyFitEvidence, vacancyFitFingerprint, type VacancyFitInput } from './vacancyFit';
import { isImportedMemoryId } from './resumeImport';
import { isResumeEvidenceEligible } from './resumeEvidenceEligibility';
import { fitInput } from './vacancyFit.test';

/** The formula the stored keys were written with: a faster path must give the same hashes. */
function referenceFingerprint(input: VacancyFitInput, algorithmVersion: string, factScope: 'evidence' | 'all') {
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const counts = new Map<string, number>();
  for (const fact of input.facts) counts.set(fact.id, (counts.get(fact.id) ?? 0) + 1);
  const imported = (fact: VacancyFitInput['facts'][number]) =>
    fact.status === 'proposed' && isImportedMemoryId(fact.id) && isResumeEvidenceEligible({ ...fact, status: 'confirmed' });
  const facts = factScope === 'all' ? input.facts
    : input.facts.filter((fact) => fact.candidateId === input.candidateId && counts.get(fact.id) === 1 && isVacancyFitEvidence(fact));
  const importedIds = input.facts.filter(imported).map((fact) => fact.id);
  const checkedIds = [...(input.checkedFactIds ?? [])].sort();
  return {
    vacancyHash: hash([input.vacancyId, input.description, input.requirements]),
    profileHash: hash([input.candidateId, facts, input.gates, input.profileContextHash, ...(importedIds.length ? [{ importedEvidence: importedIds }] : []), ...(checkedIds.length ? [{ checkedEvidence: checkedIds }] : [])]),
    algorithmVersion,
  };
}

describe('vacancyFitFingerprint keeps the stored keys while reusing the profile part (prod 03.11)', () => {
  const base = fitInput();
  const facts = [
    ...base.facts,
    { ...base.facts[0], id: 'f2', candidateId: 'other', statement: 'Not mine.' },
    { ...base.facts[0], id: 'f1', statement: 'Duplicate id is not evidence.' },
    { ...base.facts[0], id: 'imp0123456789-experience-0', status: 'proposed' as const, statement: 'Imported line.' },
    { ...base.facts[0], id: 'h1', kind: 'hypothesis' as const, statement: 'A consultant hypothesis.' },
  ];
  const variants: VacancyFitInput[] = [
    base,
    { ...base, facts },
    { ...base, facts, profileContextHash: undefined, checkedFactIds: undefined },
    { ...base, facts, profileContextHash: 'stamp-b', checkedFactIds: ['z', 'a'] },
    { ...base, facts, vacancyId: 'v2', description: 'Другой текст', gates: { ...base.gates, role: { status: 'unknown', reason: 'changed' } } },
    { ...base, facts: [] },
  ];
  it.each(['evidence', 'all'] as const)('matches the reference formula for every variant (%s)', (scope) => {
    for (const version of ['v-current', 'v-old']) {
      for (const input of variants) {
        // Twice: the second call reads the reused profile part.
        expect(vacancyFitFingerprint(input, version, scope)).toEqual(referenceFingerprint(input, version, scope));
        expect(vacancyFitFingerprint(input, version, scope)).toEqual(referenceFingerprint(input, version, scope));
      }
    }
  });
  it('sees a different candidate on the same facts array', () => {
    const other = { ...base, facts, candidateId: 'other' };
    expect(vacancyFitFingerprint(other)).toEqual(referenceFingerprint(other, vacancyFitFingerprint(other).algorithmVersion, 'evidence'));
    expect(vacancyFitFingerprint(other).profileHash).not.toBe(vacancyFitFingerprint({ ...base, facts }).profileHash);
  });
});
