import { FIT_KEY_GATES, FIT_UNCONFIRMED_GATE_PENALTY, MIN_FIT_SKILL_REQUIREMENTS } from '../../shared/vacancyFitPercent';
import { createHash } from 'node:crypto';
import { VACANCY_FIT_ALGORITHM_VERSION, VACANCY_FIT_GATE_NAMES, type VacancyFitGates, type VacancyFitRequirementAssessment, type VacancyFitResult } from '../../shared/vacancyFit';
import { isResumeEvidenceEligible, type ResumeEvidenceCandidate } from './resumeEvidenceEligibility';
import { isImportedMemoryId } from './resumeImport';
import { vacancySourceText, type VacancyRequirement } from './vacancyRequirements';

export interface VacancyFitFact extends ResumeEvidenceCandidate { readonly candidateId: string }
export interface VacancyFitInput {
  readonly candidateId: string;
  readonly vacancyId: string;
  readonly description: string;
  readonly profileContextHash?: string;
  /** Отпечаток до B580: только для чтения старого кэша, в ключ не входит. */
  readonly legacyProfileContextHash?: string;
  readonly requirements: readonly VacancyRequirement[];
  readonly facts: readonly VacancyFitFact[];
  /** Authoritative rule/owner evidence gates, never model-generated probabilities. */
  readonly gates: VacancyFitGates;
  readonly assessments?: readonly VacancyFitRequirementAssessment[];
}
export interface VacancyFitAssessor {
  assess(input: { readonly requirements: readonly VacancyRequirement[]; readonly facts: readonly VacancyFitFact[] }): Promise<readonly VacancyFitRequirementAssessment[]>;
}

function sourcedRequirements(input: VacancyFitInput): readonly VacancyRequirement[] {
  const description = normalizedSource(input.description);
  const seen = new Set<string>();
  return input.requirements.filter((requirement) => {
    if (!requirement.id.trim() || seen.has(requirement.id) || requirement.origin === 'inferred' || !requirement.sourceQuote.trim() || !description.includes(normalizedSource(requirement.sourceQuote))) return false;
    seen.add(requirement.id);
    return true;
  }).sort((a, b) => Number(b.hard || b.stopFactor) - Number(a.hard || a.stopFactor) || a.id.localeCompare(b.id));
}
/**
 * Fewer skill requirements than this give no percent (B510-r): on prod 22.10 one condition
 * («Высшее образование») made «100 %, 1 из 1». 3 hides 29 % of model-labelled vacancies (155 of 540).
 */
export const MIN_SKILL_REQUIREMENTS = MIN_FIT_SKILL_REQUIREMENTS;
/** Unconfirmed key conditions lower the ceiling, so «100 %» needs a confirmed role, region and permit. */
const KEY_GATES = FIT_KEY_GATES;
const UNCONFIRMED_GATE_PENALTY = FIT_UNCONFIRMED_GATE_PENALTY;

/** Experience and model skills count; conditions (education, language, format, permit) do not. */
export function isSkillRequirement(requirement: VacancyRequirement): boolean {
  return requirement.kind === 'experience' || (requirement.skill ?? requirement.kind === 'other');
}

/** Quotes are spans of the decoded text: `&eacute;` and `&rsquo;` dropped sourced quotes until B562-r. */
function normalizedSource(value: string): string {
  return vacancySourceText(value).replace(/\s+/gu, ' ').trim();
}
/**
 * A fact from the candidate's own imported resume or profile is evidence while still `proposed`
 * (same rule as the pitch, B266): on prod 24.10 a LinkedIn import left all 64 of the owner's facts
 * proposed, and 787 vacancies read «no_eligible_facts». Facts said only in chat still need a confirm.
 */
function isImportedEvidence(fact: VacancyFitFact): boolean {
  return fact.status === 'proposed' && isImportedMemoryId(fact.id) && isResumeEvidenceEligible({ ...fact, status: 'confirmed' });
}
function eligibleFacts(input: VacancyFitInput): readonly VacancyFitFact[] {
  const counts = new Map<string, number>();
  for (const fact of input.facts) counts.set(fact.id, (counts.get(fact.id) ?? 0) + 1);
  return input.facts.filter((fact) => fact.candidateId === input.candidateId && counts.get(fact.id) === 1 && (isResumeEvidenceEligible(fact) || isImportedEvidence(fact)) && fact.sourceMessageIds.every((id) => id.trim().length > 0));
}

/** SHA hashes are transient; persistent tenant indexes are keyed HMACs in the store. */
export function vacancyFitFingerprint(
  input: VacancyFitInput,
  algorithmVersion = VACANCY_FIT_ALGORITHM_VERSION,
): { vacancyHash: string; profileHash: string; algorithmVersion: string } {
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const importedIds = input.facts.filter(isImportedEvidence).map((fact) => fact.id);
  return {
    vacancyHash: hash([input.vacancyId, input.description, input.requirements]),
    // B562: a profile whose evidence includes imported facts gets a new key, so its result cached
    // without them (and the completed queue row) is not reused; confirmed-only profiles keep theirs.
    profileHash: hash([input.candidateId, input.facts, input.gates, input.profileContextHash, ...(importedIds.length ? [{ importedEvidence: importedIds }] : [])]),
    algorithmVersion,
  };
}

/** Validates model claims against exact candidate-owned source text. Missing facts are unknown. */
export function evaluateVacancyFit(input: VacancyFitInput, now = new Date().toISOString()): VacancyFitResult {
  const facts = eligibleFacts(input);
  const factMap = new Map(facts.map((fact) => [fact.id, fact]));
  const gates = Object.fromEntries(VACANCY_FIT_GATE_NAMES.map((name) => {
    const gate = input.gates[name];
    const invalidEvidence = gate.evidence?.some((entry) => !entry.quote.trim() || !factMap.get(entry.factId)?.statement.includes(entry.quote));
    return [name, invalidEvidence ? { status: 'unknown', reason: 'gate_evidence_unverified' } : gate];
  })) as unknown as VacancyFitGates;
  const requirements = sourcedRequirements(input);
  const assessments: VacancyFitRequirementAssessment[] = requirements.map((requirement) => {
    const claims = input.assessments?.filter((claim) => claim.requirementId === requirement.id) ?? [];
    const claim = claims.length === 1 ? claims[0] : undefined;
    if (!claim || !['matched', 'unmatched'].includes(claim.status) || !Array.isArray(claim.evidence) || !claim.evidence.length || claim.evidence.some((entry) => typeof entry.quote !== 'string' || !entry.quote.trim() || !factMap.get(entry.factId)?.statement.includes(entry.quote))) return { requirementId: requirement.id, status: 'unknown', evidence: [] };
    return { requirementId: requirement.id, status: claim.status, evidence: claim.evidence.map(({ factId, quote }) => ({ factId, quote })) };
  });
  // Owner 28.10: a model answer that confirms nothing is «0 из N», not «no percent». Without an
  // answer (no claims at all) the requirements are not assessed yet.
  const answered = (input.assessments?.length ?? 0) > 0;
  const blocked = VACANCY_FIT_GATE_NAMES.some((name) => gates[name].status === 'blocked');
  // Неподтверждённые ворота не прячут процент (почти у всех профилей регион, формат и право на работу
  // не подтверждены), а остаются в результате как «неизвестно» и снижают потолок процента.
  const unknownGate = VACANCY_FIT_GATE_NAMES.some((name) => gates[name].status !== 'matched');
  const skillIds = new Set(requirements.filter(isSkillRequirement).map((item) => item.id));
  const skills = assessments.filter((item) => skillIds.has(item.requirementId));
  const conditions = assessments.filter((item) => !skillIds.has(item.requirementId));
  const reason = blocked ? 'blocked_gate' : !requirements.length ? 'no_requirements' : skills.length < MIN_SKILL_REQUIREMENTS ? 'too_few_skills'
    : !facts.length ? 'no_eligible_facts' : !answered && !skills.some((item) => item.status !== 'unknown') ? 'assessment_unavailable' : 'assessed';
  const matchedIds = new Set(skills.filter((item) => item.status === 'matched').map((item) => item.requirementId));
  const required = requirements.filter((item) => skillIds.has(item.id) && (item.hard || item.stopFactor));
  const canScore = reason === 'assessed';
  const ceiling = 100 - UNCONFIRMED_GATE_PENALTY * KEY_GATES.filter((name) => gates[name].status !== 'matched').length;
  const percent = (matched: number, total: number) => canScore && total ? Math.min(ceiling, Math.round(matched / total * 100)) : null;
  const count = (items: readonly VacancyFitRequirementAssessment[]) => ({
    matched: items.filter((item) => item.status === 'matched').length, total: items.length, unknown: items.filter((item) => item.status === 'unknown').length,
  });
  return {
    candidateId: input.candidateId, vacancyId: input.vacancyId, algorithmVersion: VACANCY_FIT_ALGORITHM_VERSION,
    status: blocked ? 'blocked' : canScore ? 'assessed' : 'unknown', gates,
    calculatedAt: now, dataState: !canScore ? 'unknown' : unknownGate || skills.some((item) => item.status === 'unknown') ? 'partial' : 'confirmed',
    coveragePercent: percent(matchedIds.size, skills.length),
    requiredCoverage: { matched: required.filter((item) => matchedIds.has(item.id)).length, total: required.length, percent: percent(required.filter((item) => matchedIds.has(item.id)).length, required.length) },
    coverage: count(skills), conditionCoverage: count(conditions),
    // Unanswered keeps no claims: read back from the store it must stay unanswered, not 0 %.
    assessments: reason === 'assessment_unavailable' && !answered ? [] : assessments, reason,
  };
}

/** The injected assessor is never reached for blocked gates or absent source data. */
export async function assessVacancyFit(input: VacancyFitInput, assessor?: VacancyFitAssessor): Promise<VacancyFitResult> {
  const prerequisite = evaluateVacancyFit({ ...input, assessments: undefined });
  if (prerequisite.reason !== 'assessment_unavailable' || !assessor) return prerequisite;
  try {
    const assessments = await assessor.assess({ requirements: sourcedRequirements(input), facts: eligibleFacts(input) });
    return evaluateVacancyFit({ ...input, assessments });
  } catch {
    return prerequisite;
  }
}
