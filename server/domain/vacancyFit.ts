import { createHash } from 'node:crypto';
import { VACANCY_FIT_ALGORITHM_VERSION, VACANCY_FIT_GATE_NAMES, type VacancyFitGates, type VacancyFitRequirementAssessment, type VacancyFitResult } from '../../shared/vacancyFit';
import { isResumeEvidenceEligible, type ResumeEvidenceCandidate } from './resumeEvidenceEligibility';
import type { VacancyRequirement } from './vacancyRequirements';

export interface VacancyFitFact extends ResumeEvidenceCandidate { readonly candidateId: string }
export interface VacancyFitInput {
  readonly candidateId: string;
  readonly vacancyId: string;
  readonly description: string;
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
function normalizedSource(value: string): string {
  return value.replace(/<[^>]*>/gu, ' ').replace(/&nbsp;/gu, ' ').replace(/&amp;/gu, '&').replace(/&#39;/gu, "'").replace(/&quot;/gu, '"').replace(/\s+/gu, ' ').trim();
}
function eligibleFacts(input: VacancyFitInput): readonly VacancyFitFact[] {
  const counts = new Map<string, number>();
  for (const fact of input.facts) counts.set(fact.id, (counts.get(fact.id) ?? 0) + 1);
  return input.facts.filter((fact) => fact.candidateId === input.candidateId && counts.get(fact.id) === 1 && isResumeEvidenceEligible(fact) && fact.sourceMessageIds.every((id) => id.trim().length > 0));
}

/** SHA hashes are transient; persistent tenant indexes are keyed HMACs in the store. */
export function vacancyFitFingerprint(input: VacancyFitInput): { vacancyHash: string; profileHash: string; algorithmVersion: string } {
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return {
    vacancyHash: hash([input.vacancyId, input.description, input.requirements]),
    profileHash: hash([input.candidateId, input.facts, input.gates]),
    algorithmVersion: VACANCY_FIT_ALGORITHM_VERSION,
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
  const blocked = VACANCY_FIT_GATE_NAMES.some((name) => gates[name].status === 'blocked');
  const unknown = VACANCY_FIT_GATE_NAMES.some((name) => gates[name].status !== 'matched');
  const reason = blocked ? 'blocked_gate' : unknown ? 'unknown_gate' : !requirements.length ? 'no_requirements' : !facts.length ? 'no_eligible_facts' : !assessments.some((item) => item.status !== 'unknown') ? 'assessment_unavailable' : 'assessed';
  const matchedIds = new Set(assessments.filter((item) => item.status === 'matched').map((item) => item.requirementId));
  const required = requirements.filter((item) => item.hard || item.stopFactor);
  const matched = assessments.filter((item) => item.status === 'matched').length;
  const canScore = reason === 'assessed';
  return {
    candidateId: input.candidateId, vacancyId: input.vacancyId, algorithmVersion: VACANCY_FIT_ALGORITHM_VERSION,
    status: blocked ? 'blocked' : canScore ? 'assessed' : 'unknown', gates,
    calculatedAt: now, dataState: !canScore ? 'unknown' : assessments.some((item) => item.status === 'unknown') ? 'partial' : 'confirmed',
    coveragePercent: canScore ? Math.round(matched / requirements.length * 100) : null,
    requiredCoverage: { matched: required.filter((item) => matchedIds.has(item.id)).length, total: required.length, percent: canScore && required.length ? Math.round(required.filter((item) => matchedIds.has(item.id)).length / required.length * 100) : null },
    coverage: { matched, total: requirements.length, unknown: assessments.filter((item) => item.status === 'unknown').length },
    assessments, reason,
  };
}

/** The injected assessor is never reached for blocked/unknown gates or absent source data. */
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
