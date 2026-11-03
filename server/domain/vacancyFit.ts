import { MIN_FIT_SKILL_REQUIREMENTS, PARTIAL_REQUIREMENT_CREDIT } from '../../shared/vacancyFitPercent';
import { createHash, type Hash } from 'node:crypto';
import { VACANCY_FIT_ALGORITHM_VERSION, VACANCY_FIT_GATE_NAMES, type VacancyFitConditionBlock, type VacancyFitGates, type VacancyFitRequirementAssessment, type VacancyFitResult } from '../../shared/vacancyFit';
import { isResumeEvidenceEligible, type ResumeEvidenceCandidate } from './resumeEvidenceEligibility';
import { isImportedMemoryId } from './resumeImport';
import { minimizeModelText } from '../providers/modelInputPrivacy';
import { impliedSoftRole, isCompensationLine, isSoftRequirementText } from './vacancyRequirementKind';
import { vacancySourceText, type VacancyRequirement } from './vacancyRequirements';

export interface VacancyFitFact extends ResumeEvidenceCandidate {
  readonly candidateId: string;
  /** `memory`: a dossier row; `profile`: a section of the resume draft (skills, about, projects…). */
  readonly evidenceSource?: 'memory' | 'profile';
}
export interface VacancyFitInput {
  readonly candidateId: string;
  readonly vacancyId: string;
  readonly description: string;
  readonly profileContextHash?: string;
  /** Отпечаток до B580: только для чтения старого кэша, в ключ не входит. */
  readonly legacyProfileContextHash?: string;
  /** B580 stamp over every memory row: its results are read once and moved to the evidence-only key. */
  readonly previousProfileContextHash?: string;
  /** Stamp with role names (before 29.10): its result moves to the current key once. */
  readonly roleScopedProfileContextHash?: string;
  readonly requirements: readonly VacancyRequirement[];
  readonly facts: readonly VacancyFitFact[];
  /** Authoritative rule/owner evidence gates, never model-generated probabilities. */
  readonly gates: VacancyFitGates;
  readonly assessments?: readonly VacancyFitRequirementAssessment[];
  /** Facts a skill check wrote to the profile: a requirement they confirm counts in full (owner 29.10). */
  readonly checkedFactIds?: readonly string[];
}
export interface VacancyFitAssessor {
  assess(input: { readonly requirements: readonly VacancyRequirement[]; readonly facts: readonly VacancyFitFact[] }): Promise<readonly VacancyFitRequirementAssessment[]>;
}

function sourcedRequirements(input: VacancyFitInput): readonly VacancyRequirement[] {
  const description = normalizedSource(input.description);
  const seen = new Set<string>();
  return input.requirements.filter((requirement) => {
    if (!requirement.id.trim() || seen.has(requirement.id) || isGenericSkillTag(requirement) || isCompensationLine(requirement.text) || requirement.origin === 'inferred' || !requirement.sourceQuote.trim() || !description.includes(normalizedSource(requirement.sourceQuote))) return false;
    seen.add(requirement.id);
    return true;
  }).sort((a, b) => Number(b.hard || b.stopFactor) - Number(a.hard || a.stopFactor) || a.id.localeCompare(b.id));
}
/**
 * Fewer skill requirements than this give no percent (B510-r): on prod 22.10 one condition
 * («Высшее образование») made «100 %, 1 из 1». 3 hides 29 % of model-labelled vacancies (155 of 540).
 */
export const MIN_SKILL_REQUIREMENTS = MIN_FIT_SKILL_REQUIREMENTS;

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
function isImportedEvidence(fact: ResumeEvidenceCandidate): boolean {
  return fact.status === 'proposed' && isImportedMemoryId(fact.id) && isResumeEvidenceEligible({ ...fact, status: 'confirmed' });
}
/** A memory row the percent may cite; hypotheses and open questions of the consultant are not. */
export function isVacancyFitEvidence(fact: ResumeEvidenceCandidate): boolean {
  return (isResumeEvidenceEligible(fact) || isImportedEvidence(fact)) && fact.sourceMessageIds.every((id) => id.trim().length > 0);
}
function eligibleFacts(input: VacancyFitInput): readonly VacancyFitFact[] {
  const counts = new Map<string, number>();
  for (const fact of input.facts) counts.set(fact.id, (counts.get(fact.id) ?? 0) + 1);
  return input.facts.filter((fact) => fact.candidateId === input.candidateId && counts.get(fact.id) === 1 && isVacancyFitEvidence(fact));
}

/** Soft traits weigh a quarter of a skill; hard or mandatory requirements one and a half (03.11). */
const SOFT_WEIGHT = 0.25;
const HARD_WEIGHT = 1.5;

export type VacancyFitFactScope = 'evidence' | 'all';

interface ProfilePart {
  /** SHA-256 state after `[candidateId,facts,` — copied, never updated in place. */
  readonly prefix: Hash;
  readonly importedIds: readonly string[];
}
/**
 * Prod CPU profile 03.11: every shown row hashed the whole profile 6–10 times (current, earlier and
 * previous-version keys), 3.9 of 21 busy seconds. The facts are one array per profile read, so the
 * hash state after them is kept for that array and each key hashes only its own tail.
 */
const profileParts = new WeakMap<readonly VacancyFitFact[], Map<string, ProfilePart>>();
const json = (value: unknown) => JSON.stringify(value) ?? 'null';
function profilePart(input: VacancyFitInput, factScope: VacancyFitFactScope): ProfilePart {
  const byKey = profileParts.get(input.facts) ?? new Map<string, ProfilePart>();
  profileParts.set(input.facts, byKey);
  const key = `${factScope}\u0000${input.candidateId}`;
  const known = byKey.get(key);
  if (known) return known;
  const facts = factScope === 'all' ? input.facts : eligibleFacts(input);
  const part = {
    prefix: createHash('sha256').update(`[${json(input.candidateId)},${json(facts)},`),
    importedIds: input.facts.filter(isImportedEvidence).map((fact) => fact.id),
  };
  byKey.set(key, part);
  return part;
}

/** SHA hashes are transient; persistent tenant indexes are keyed HMACs in the store. */
export function vacancyFitFingerprint(
  input: VacancyFitInput,
  algorithmVersion = VACANCY_FIT_ALGORITHM_VERSION,
  factScope: VacancyFitFactScope = 'evidence',
): { vacancyHash: string; profileHash: string; algorithmVersion: string } {
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  // B580-r: the consultant writes hypotheses and open questions every few seconds; keyed by them,
  // every percent was reset (469 «profile_changed» jobs on prod 29.10). `all` reads older keys.
  const { prefix, importedIds } = profilePart(input, factScope);
  const checkedIds = [...(input.checkedFactIds ?? [])].sort();
  // B562: a profile whose evidence includes imported facts gets a new key, so its result cached
  // without them (and the completed queue row) is not reused; confirmed-only profiles keep theirs.
  // The same bytes as hash([candidateId, facts, gates, profileContextHash, ...extra]).
  const tail = [input.gates, input.profileContextHash, ...(importedIds.length ? [{ importedEvidence: importedIds }] : []), ...(checkedIds.length ? [{ checkedEvidence: checkedIds }] : [])];
  return {
    vacancyHash: hash([input.vacancyId, input.description, input.requirements]),
    profileHash: prefix.copy().update(`${tail.map(json).join(',')}]`).digest('hex'),
    algorithmVersion,
  };
}

/** The model sees privacy-cleaned statements, so its quotes are checked against the same text (01.11). */
function quotes(fact: VacancyFitFact | undefined, quote: string): boolean {
  return !!fact && (fact.statement.includes(quote) || minimizeModelText(fact.statement).includes(quote));
}

/** A bare profile tag («Executive Leadership») says the word, not the work behind it. */
const isTagFact = (factId: string) => factId.startsWith('profile:skill:');
const SKILLS_TAIL = 'навыки: ';
/** 02.11 audit: «Linux» quoted from the skills list of a place is a tag as much as a skills-list entry. */
function isTagEvidence(fact: VacancyFitFact | undefined, entry: { readonly factId: string; readonly quote: string }): boolean {
  if (isTagFact(entry.factId)) return true;
  const tail = fact?.statement.lastIndexOf(SKILLS_TAIL) ?? -1;
  return tail >= 0 && fact!.statement.indexOf(entry.quote.trim(), tail) >= 0 && !fact!.statement.slice(0, tail).includes(entry.quote.trim());
}

/**
 * 02.11: tag-only evidence is partial at most. One strong quote may back any number of
 * requirements in full (owner 02.11 audit: the cap of two turned a strong profile into partials).
 */
function withEvidenceRules(items: readonly VacancyFitRequirementAssessment[], factMap: ReadonlyMap<string, VacancyFitFact>): VacancyFitRequirementAssessment[] {
  return items.map((item) => {
    const tagOnly = item.evidence.every((entry) => isTagEvidence(factMap.get(entry.factId), entry));
    return item.status === 'matched' && tagOnly ? { ...item, status: 'partial' } : item;
  });
}

/** Where the candidate lives: the resume draft section or the imported contact line. */
const isLocationFact = (factId: string) => factId === 'profile:location' || (isImportedMemoryId(factId) && factId.endsWith('-location'));
const NON_LOCATION_CONDITIONS: readonly string[] = ['education', 'language', 'license'];
/** 02.11 audit: «Dubai» was the sole quote of five unmatched skills (MS Office, communication…). */
const acceptsLocationEvidence = (requirement: VacancyRequirement) => !isSkillRequirement(requirement) && !NON_LOCATION_CONDITIONS.includes(requirement.kind);

/** Bare soft-skill tags a job board appends to every posting (Indeed): no requirement of this vacancy. */
const GENERIC_SKILL_TAGS = new Set([
  'critical thinking', 'entrepreneurship', 'emotional intelligence', 'open-mindedness', 'collaboration',
  'solution orientation', 'process excellence', 'ai proficiency', 'data literacy', 'communication',
]);
const isGenericSkillTag = (requirement: VacancyRequirement) => GENERIC_SKILL_TAGS.has(requirement.text.trim().toLowerCase());

/** Conditions a quoted profile fact contradicts: they block the row, never the skill percent (02.11). */
const BLOCKING_CONDITIONS: readonly string[] = ['workAuthorization', 'workFormat'];
function conditionBlocks(requirements: readonly VacancyRequirement[], assessments: readonly VacancyFitRequirementAssessment[]): VacancyFitConditionBlock[] {
  return requirements.filter((requirement) => !isSkillRequirement(requirement) && BLOCKING_CONDITIONS.includes(requirement.kind)).flatMap((requirement) => {
    const item = assessments.find((entry) => entry.requirementId === requirement.id);
    return item?.status === 'unmatched' && item.evidence[0] ? [{ requirementId: requirement.id, text: requirement.text, quote: item.evidence[0].quote }] : [];
  });
}

/** Validates model claims against exact candidate-owned source text. Missing facts are unknown. */
export function evaluateVacancyFit(input: VacancyFitInput, now = new Date().toISOString()): VacancyFitResult {
  const facts = eligibleFacts(input);
  const factMap = new Map(facts.map((fact) => [fact.id, fact]));
  const gates = Object.fromEntries(VACANCY_FIT_GATE_NAMES.map((name) => {
    const gate = input.gates[name];
    const invalidEvidence = gate.evidence?.some((entry) => !entry.quote.trim() || !quotes(factMap.get(entry.factId), entry.quote));
    return [name, invalidEvidence ? { status: 'unknown', reason: 'gate_evidence_unverified' } : gate];
  })) as unknown as VacancyFitGates;
  const requirements = sourcedRequirements(input);
  const checkedIds = new Set(input.checkedFactIds ?? []);
  const claimed: VacancyFitRequirementAssessment[] = requirements.map((requirement) => {
    const claims = input.assessments?.filter((claim) => claim.requirementId === requirement.id) ?? [];
    const claim = claims.length === 1 ? claims[0] : undefined;
    const cited = Array.isArray(claim?.evidence) ? claim.evidence.filter((entry) => acceptsLocationEvidence(requirement) || !isLocationFact(entry.factId)) : [];
    if (!claim || !['matched', 'partial', 'unmatched'].includes(claim.status) || !cited.length || cited.some((entry) => typeof entry.quote !== 'string' || !entry.quote.trim() || !quotes(factMap.get(entry.factId), entry.quote))) return { requirementId: requirement.id, status: 'unknown', evidence: [] };
    const evidence = cited.map(({ factId, quote }) => ({ factId, quote }));
    return { requirementId: requirement.id, status: claim.status, evidence, ...(claim.status !== 'unmatched' && evidence.some((entry) => checkedIds.has(entry.factId)) ? { checked: true } : {}) };
  });
  const assessments = withEvidenceRules(claimed, factMap);
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
  const required = new Set(requirements.filter((item) => skillIds.has(item.id) && (item.hard || item.stopFactor)).map((item) => item.id));
  const requiredSkills = skills.filter((item) => required.has(item.requirementId));
  const canScore = reason === 'assessed';
  // 01.11: met 1 whether stated or checked by a skill check (`checked` is a label), partial 0.5, else 0.
  // 03.11: weighted mean; a soft trait weighs 0.25, a hard or mandatory requirement 1.5 (owner decision).
  // A soft trait that experience implies counts as met unless a quoted fact contradicts it; the
  // stored assessment is left as it was, so reading an old result needs no model call.
  const byId = new Map(requirements.map((item) => [item.id, item]));
  const role = impliedSoftRole(facts.map((fact) => fact.statement));
  const implied = role ? skills.filter((item) => item.status !== 'unmatched' && item.status !== 'matched' && isSoftRequirementText(byId.get(item.requirementId)?.text ?? '')).map((item) => ({ requirementId: item.requirementId, role })) : [];
  const impliedIds = new Set(implied.map((item) => item.requirementId));
  const credit = (item: VacancyFitRequirementAssessment) => item.status === 'matched' || impliedIds.has(item.requirementId) ? 1 : item.status === 'partial' ? PARTIAL_REQUIREMENT_CREDIT : 0;
  const weight = (item: VacancyFitRequirementAssessment) => {
    const requirement = byId.get(item.requirementId);
    return (requirement && isSoftRequirementText(requirement.text) ? SOFT_WEIGHT : 1) * (requirement && (requirement.hard || requirement.stopFactor) ? HARD_WEIGHT : 1);
  };
  const percent = (items: readonly VacancyFitRequirementAssessment[]) => {
    const total = items.reduce((sum, item) => sum + weight(item), 0);
    return canScore && items.length ? Math.round(items.reduce((sum, item) => sum + credit(item) * weight(item), 0) / total * 100) : null;
  };
  const count = (items: readonly VacancyFitRequirementAssessment[]) => ({
    matched: items.filter((item) => item.status === 'matched' || impliedIds.has(item.requirementId)).length, total: items.length, unknown: items.filter((item) => item.status === 'unknown').length, checked: items.filter((item) => item.checked).length, partial: items.filter((item) => item.status === 'partial').length,
  });
  return {
    candidateId: input.candidateId, vacancyId: input.vacancyId, algorithmVersion: VACANCY_FIT_ALGORITHM_VERSION,
    status: blocked ? 'blocked' : canScore ? 'assessed' : 'unknown', gates,
    calculatedAt: now, dataState: !canScore ? 'unknown' : unknownGate || skills.some((item) => item.status === 'unknown') ? 'partial' : 'confirmed',
    coveragePercent: percent(skills),
    requiredCoverage: { matched: requiredSkills.filter((item) => item.status === 'matched').length, total: requiredSkills.length, percent: percent(requiredSkills) },
    ...(implied.length ? { implied } : {}),
    coverage: count(skills), conditionCoverage: count(conditions), conditionBlocks: conditionBlocks(requirements, assessments),
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
