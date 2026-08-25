import { WORKSPACE_VERSION } from './workspaceStorageSchema';
import type {
  CandidateWorkspace,
  CareerGoal,
  MarketVacancySample,
  ResumeSource,
  SearchUrgency,
} from './workspaceStorageSchema';
import { isProfileFact } from './profileIngestion';
import { isCandidateRegionList } from './candidateRegions';
import {
  ACTION_PACKAGE_METHOD_VERSION,
  getActionChecklist,
  type ActionPackage,
  type ActionPackageCitation,
} from '../action/actionPackageEngine';
import {
  OPPORTUNITY_METHOD_VERSION,
  type OpportunityAnalysis,
  type OpportunityDecision,
  type OpportunityItem,
  type OpportunityRecord,
} from '../opportunity/opportunityEngine';
import { OUTCOME_METHOD_VERSION, type OutcomeEvent } from '../outcome/outcomeEngine';
import {
  EVIDENCE_METHOD_VERSION,
  ROLE_METHOD_VERSION,
  type CandidateAnalysis,
  type EvidenceItem,
  type RoleHypothesis,
} from '../evidence/evidenceEngine';

export function isCandidateWorkspace(value: unknown): value is CandidateWorkspace {
  if (
    !(
      isWorkspaceRecord(value, WORKSPACE_VERSION) &&
      (value.analysis === undefined || isCandidateAnalysis(value.analysis)) &&
      (value.marketSample === undefined || isMarketSample(value.marketSample)) &&
      (value.opportunity === undefined ||
        isOpportunityRecord(value.opportunity)) &&
      (value.actionPackage === undefined ||
        isActionPackage(value.actionPackage)) &&
      Array.isArray(value.outcomes) &&
      value.outcomes.every(isOutcomeEvent)
    )
  ) {
    return false;
  }

  const actionPackageIsConsistent =
    value.actionPackage === undefined ||
    (value.opportunity !== undefined &&
      value.opportunity.decision !== undefined &&
      value.actionPackage.opportunityId === value.opportunity.id &&
      value.actionPackage.decisionChoice === value.opportunity.decision.choice);
  if (!actionPackageIsConsistent || value.outcomes.length === 0) {
    return actionPackageIsConsistent;
  }
  if (value.opportunity === undefined || value.actionPackage === undefined) {
    return false;
  }

  const opportunityId = value.opportunity.id;
  return value.outcomes.every(
    (event) => event.opportunityId === opportunityId,
  );
}

export function isLegacyWorkspace(
  value: unknown,
): value is Omit<
  CandidateWorkspace,
  'version' | 'analysis' | 'outcomes' | 'regions'
> & { version: 1; market: 'ru' | 'international' } {
  return (
    isWorkspaceRecord(value, 1) &&
    value.analysis === undefined &&
    value.opportunity === undefined &&
    value.actionPackage === undefined &&
    value.outcomes === undefined
  );
}

export function isVersionTwoWorkspace(
  value: unknown,
): value is Omit<
  CandidateWorkspace,
  'version' | 'opportunity' | 'outcomes' | 'regions'
> & { version: 2; market: 'ru' | 'international' } {
  return (
    isWorkspaceRecord(value, 2) &&
    (value.analysis === undefined || isCandidateAnalysis(value.analysis)) &&
    value.opportunity === undefined &&
    value.actionPackage === undefined &&
    value.outcomes === undefined
  );
}

export function isVersionThreeWorkspace(
  value: unknown,
): value is Omit<
  CandidateWorkspace,
  'version' | 'actionPackage' | 'outcomes' | 'regions'
> & { version: 3; market: 'ru' | 'international' } {
  return (
    isWorkspaceRecord(value, 3) &&
    (value.analysis === undefined || isCandidateAnalysis(value.analysis)) &&
    (value.opportunity === undefined ||
      isOpportunityRecord(value.opportunity)) &&
    value.actionPackage === undefined &&
    value.outcomes === undefined
  );
}

export function isVersionFourWorkspace(
  value: unknown,
): value is Omit<CandidateWorkspace, 'version' | 'outcomes' | 'regions'> & {
  version: 4;
  market: 'ru' | 'international';
} {
  if (
    !(
      isWorkspaceRecord(value, 4) &&
      (value.analysis === undefined || isCandidateAnalysis(value.analysis)) &&
      (value.opportunity === undefined ||
        isOpportunityRecord(value.opportunity)) &&
      (value.actionPackage === undefined ||
        isActionPackage(value.actionPackage)) &&
      value.outcomes === undefined
    )
  ) {
    return false;
  }

  return (
    value.actionPackage === undefined ||
    (value.opportunity !== undefined &&
      value.opportunity.decision !== undefined &&
      value.actionPackage.opportunityId === value.opportunity.id &&
      value.actionPackage.decisionChoice === value.opportunity.decision.choice)
  );
}

export function isVersionFiveWorkspace(
  value: unknown,
): value is Omit<CandidateWorkspace, 'version' | 'regions'> & {
  version: 5;
  market: 'ru' | 'international';
} {
  return isMarketEraWorkspace(value, 5);
}

/**
 * The last version that still answered «where are you looking?» with one flag.
 * Version 7 asks for regions instead, so a v6 record migrates rather than
 * failing to load (B158).
 */
export function isVersionSixWorkspace(
  value: unknown,
): value is Omit<CandidateWorkspace, 'version' | 'regions'> & {
  version: 6;
  market: 'ru' | 'international';
} {
  return isMarketEraWorkspace(value, 6);
}

function isMarketEraWorkspace(value: unknown, version: 5 | 6): boolean {
  if (
    !(
      isWorkspaceRecord(value, version) &&
      (value.analysis === undefined || isCandidateAnalysis(value.analysis)) &&
      (value.marketSample === undefined || isMarketSample(value.marketSample)) &&
      (value.opportunity === undefined ||
        isOpportunityRecord(value.opportunity)) &&
      (value.actionPackage === undefined ||
        isActionPackage(value.actionPackage)) &&
      Array.isArray(value.outcomes) &&
      value.outcomes.every(isOutcomeEvent)
    )
  ) {
    return false;
  }

  return (
    value.actionPackage === undefined ||
    (value.opportunity !== undefined &&
      value.opportunity.decision !== undefined &&
      value.actionPackage.opportunityId === value.opportunity.id &&
      value.actionPackage.decisionChoice === value.opportunity.decision.choice)
  );
}

/**
 * Version 7 replaced the binary `market` answer with a list of regions (B158).
 * Every earlier record still carries the flag, so a stored record is judged
 * against the shape its own version actually had.
 */
function carriesMarketAnswer(
  value: Record<string, unknown>,
  version: number,
): boolean {
  if (version >= 7) return isCandidateRegionList(value.regions);
  return value.market === 'ru' || value.market === 'international';
}

function isWorkspaceRecord(
  value: unknown,
  version: number,
): value is Record<string, unknown> &
  Omit<
    CandidateWorkspace,
    'version' | 'analysis' | 'marketSample' | 'opportunity' | 'actionPackage' | 'outcomes'
  > & {
    version: number;
    analysis?: unknown;
    marketSample?: unknown;
    opportunity?: unknown;
    actionPackage?: unknown;
    outcomes?: unknown;
  } {
  if (!isRecord(value)) {
    return false;
  }

  const carriesDocument = recordCarriesDocument(value);

  return (
    value.version === version &&
    (value.careerGoal === undefined || isCareerGoal(value.careerGoal)) &&
    typeof value.resumeText === 'string' &&
    (value.resumeText.trim().length === 0 ||
      value.resumeText.trim().length >= 80) &&
    isResumeSource(value.resumeSource) &&
    isOptionalString(value.resumeFileName) &&
    isOptionalNumber(value.resumePageCount) &&
    typeof value.targetDirection === 'string' &&
    (value.targetDirection.trim().length >= 2 ||
      carriesDocument ||
      (typeof value.currentSituation === 'string' &&
        value.currentSituation.trim().length >= 20)) &&
    carriesMarketAnswer(value, version) &&
    typeof value.currentSituation === 'string' &&
    (carriesDocument || value.currentSituation.trim().length >= 20) &&
    typeof value.constraints === 'string' &&
    isSearchUrgency(value.urgency) &&
    isOptionalString(value.linkedinUrl) &&
    isOptionalString(value.hhUrl) &&
    hasVerifiedProfileFacts(value.profileFacts) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

function isCareerGoal(value: unknown): value is CareerGoal {
  return (
    value === 'find-job' ||
    value === 'choose-role' ||
    value === 'positioning' ||
    value === 'market'
  );
}

function isMarketSample(value: unknown): value is MarketVacancySample {
  return (
    isRecord(value) &&
    value.source === 'hh' &&
    typeof value.query === 'string' &&
    typeof value.found === 'number' &&
    value.found >= 0 &&
    isValidDateString(value.fetchedAt) &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        typeof item.company === 'string' &&
        typeof item.location === 'string' &&
        typeof item.sourceUrl === 'string' &&
        isAllowedHhVacancyUrl(item.sourceUrl) &&
        (item.publishedAt === null || typeof item.publishedAt === 'string') &&
        (item.salary === null ||
          (isRecord(item.salary) &&
            (item.salary.from === null || typeof item.salary.from === 'number') &&
            (item.salary.to === null || typeof item.salary.to === 'number') &&
            typeof item.salary.currency === 'string' &&
            typeof item.salary.gross === 'boolean')),
    )
  );
}

function isCandidateAnalysis(value: unknown): value is CandidateAnalysis {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.evidenceMethodVersion === EVIDENCE_METHOD_VERSION &&
    value.roleMethodVersion === ROLE_METHOD_VERSION &&
    Array.isArray(value.evidenceItems) &&
    value.evidenceItems.every(isEvidenceItem) &&
    Array.isArray(value.questions) &&
    value.questions.every((question) => typeof question === 'string') &&
    Array.isArray(value.roleHypotheses) &&
    value.roleHypotheses.every(isRoleHypothesis) &&
    (value.reviewedAt === undefined || typeof value.reviewedAt === 'string')
  );
}

function isEvidenceItem(value: unknown): value is EvidenceItem {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    (value.kind === 'result' ||
      value.kind === 'responsibility' ||
      value.kind === 'scope' ||
      value.kind === 'expertise') &&
    typeof value.sourceExcerpt === 'string' &&
    typeof value.statement === 'string' &&
    (value.status === 'pending' ||
      value.status === 'confirmed' ||
      value.status === 'rejected') &&
    typeof value.userEdited === 'boolean'
  );
}

function isRoleHypothesis(value: unknown): value is RoleHypothesis {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    (value.fitState === 'plausible' ||
      value.fitState === 'adjacent' ||
      value.fitState === 'needs-evidence') &&
    typeof value.basis === 'string' &&
    Array.isArray(value.evidenceIds) &&
    value.evidenceIds.every((id) => typeof id === 'string') &&
    Array.isArray(value.gaps) &&
    value.gaps.every((gap) => typeof gap === 'string')
  );
}

function isOpportunityRecord(value: unknown): value is OpportunityRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.company === 'string' &&
    typeof value.text === 'string' &&
    typeof value.sourceLabel === 'string' &&
    isOptionalString(value.sourceUrl) &&
    typeof value.capturedAt === 'string' &&
    isRecord(value.parsed) &&
    value.parsed.methodVersion === OPPORTUNITY_METHOD_VERSION &&
    Array.isArray(value.parsed.items) &&
    value.parsed.items.every(isOpportunityItem) &&
    isStringArray(value.parsed.unknowns) &&
    (value.analysis === undefined ||
      isOpportunityAnalysis(value.analysis)) &&
    (value.decision === undefined ||
      isOpportunityDecision(value.decision))
  );
}

function isOpportunityItem(value: unknown): value is OpportunityItem {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    (value.kind === 'task' ||
      value.kind === 'requirement' ||
      value.kind === 'condition') &&
    typeof value.sourceExcerpt === 'string'
  );
}

function isOpportunityAnalysis(value: unknown): value is OpportunityAnalysis {
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.hardConstraintAssessment === 'clear' ||
      value.hardConstraintAssessment === 'conflict' ||
      value.hardConstraintAssessment === 'unknown') &&
    isOpportunityChoice(value.recommendation) &&
    isStringArray(value.reasonCodes) &&
    Array.isArray(value.matches) &&
    value.matches.every(
      (match) =>
        isRecord(match) &&
        typeof match.opportunityItemId === 'string' &&
        isStringArray(match.evidenceIds) &&
        isStringArray(match.sharedSignals),
    ) &&
    isStringArray(value.gapItemIds) &&
    isStringArray(value.unknowns)
  );
}

function isOpportunityDecision(value: unknown): value is OpportunityDecision {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isOpportunityChoice(value.choice) &&
    typeof value.reason === 'string' &&
    typeof value.decidedAt === 'string' &&
    typeof value.overridesRecommendation === 'boolean'
  );
}

function isOpportunityChoice(
  value: unknown,
): value is OpportunityDecision['choice'] {
  return (
    value === 'apply' ||
    value === 'network' ||
    value === 'watch' ||
    value === 'skip'
  );
}

function isActionPackage(value: unknown): value is ActionPackage {
  if (!isRecord(value)) {
    return false;
  }

  if (
    !(
    typeof value.id === 'string' &&
    value.methodVersion === ACTION_PACKAGE_METHOD_VERSION &&
    typeof value.opportunityId === 'string' &&
    (value.decisionChoice === 'apply' || value.decisionChoice === 'network') &&
    typeof value.roleTitle === 'string' &&
    typeof value.company === 'string' &&
    isOptionalString(value.sourceUrl) &&
    typeof value.positioningLine === 'string' &&
    typeof value.motivationNote === 'string' &&
    isStringArray(value.selectedEvidenceIds) &&
    Array.isArray(value.citations) &&
    value.citations.every(isActionPackageCitation) &&
    isStringArray(value.completedChecklistIds) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    (value.reviewedAt === undefined || typeof value.reviewedAt === 'string')
    )
  ) {
    return false;
  }

  const citationIds = new Set(
    value.citations.map((citation) => citation.evidenceId),
  );
  const checklistIds = new Set(
    getActionChecklist(value.decisionChoice).map((item) => item.id),
  );

  return (
    citationIds.size === value.citations.length &&
    value.selectedEvidenceIds.every((id) => citationIds.has(id)) &&
    new Set(value.selectedEvidenceIds).size ===
      value.selectedEvidenceIds.length &&
    value.completedChecklistIds.every((id) => checklistIds.has(id)) &&
    new Set(value.completedChecklistIds).size ===
      value.completedChecklistIds.length &&
    value.positioningLine.length <= 140 &&
    value.motivationNote.length <= 360
  );
}

function isActionPackageCitation(
  value: unknown,
): value is ActionPackageCitation {
  return (
    isRecord(value) &&
    typeof value.evidenceId === 'string' &&
    typeof value.statement === 'string' &&
    typeof value.sourceExcerpt === 'string' &&
    isStringArray(value.opportunityItemIds)
  );
}

function isOutcomeEvent(value: unknown): value is OutcomeEvent {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    value.methodVersion === OUTCOME_METHOD_VERSION &&
    typeof value.opportunityId === 'string' &&
    value.opportunityId.length > 0 &&
    isOutcomeType(value.type) &&
    isValidDateString(value.occurredAt) &&
    isValidDateString(value.recordedAt) &&
    typeof value.note === 'string' &&
    value.note.length <= 500 &&
    isOptionalDateString(value.followUpAt) &&
    isOptionalDateString(value.undoneAt)
  );
}

function isOutcomeType(value: unknown): value is OutcomeEvent['type'] {
  return (
    value === 'applied' ||
    value === 'contacted' ||
    value === 'positive-reply' ||
    value === 'negative-reply' ||
    value === 'interview' ||
    value === 'offer' ||
    value === 'withdrawn'
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string')
  );
}

export function isAllowedProfileUrl(value: string, source: 'linkedin' | 'hh'): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return source === 'linkedin'
      ? hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com')
      : hostname === 'hh.ru' || hostname.endsWith('.hh.ru');
  } catch {
    return false;
  }
}

function isAllowedHhVacancyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' &&
      (hostname === 'hh.ru' || hostname.endsWith('.hh.ru')) &&
      /^\/vacancy\/\d+\/?$/u.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function isResumeSource(value: unknown): value is ResumeSource {
  return (
    value === 'pdf' ||
    value === 'linkedin-pdf' ||
    value === 'hh-pdf' ||
    value === 'text'
  );
}

function isSearchUrgency(value: unknown): value is SearchUrgency {
  return value === 'exploring' || value === 'active' || value === 'urgent';
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOptionalDateString(value: unknown): value is string | undefined {
  return value === undefined || isValidDateString(value);
}

function isValidDateString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !Number.isNaN(new Date(value).getTime())
  );
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || typeof value === 'number';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A stored record has to accept whatever the wizard is allowed to produce.
// Since an imported resume now stands in for the situation description
// (B148 §3a), requiring that description here would mark every
// document-only diagnostic «invalid» and throw the candidate back to the
// first question on the next reload.
function recordCarriesDocument(value: Record<string, unknown>): boolean {
  return (
    (typeof value.resumeText === 'string' && value.resumeText.trim().length >= 80) ||
    isRecord(value.parsedResume)
  );
}

function hasVerifiedProfileFacts(profileFacts: unknown): boolean {
  return (
    profileFacts === undefined ||
    (Array.isArray(profileFacts) &&
      profileFacts.every(
        (fact) =>
          isProfileFact(fact) &&
          (fact.status === 'confirmed' || fact.status === 'corrected'),
      ))
  );
}
