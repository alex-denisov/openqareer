import {
  EVIDENCE_METHOD_VERSION,
  ROLE_METHOD_VERSION,
  type CandidateAnalysis,
  type EvidenceItem,
  type RoleHypothesis,
} from '../evidence/evidenceEngine';
import {
  OPPORTUNITY_METHOD_VERSION,
  type OpportunityAnalysis,
  type OpportunityDecision,
  type OpportunityItem,
  type OpportunityRecord,
} from '../opportunity/opportunityEngine';
import {
  ACTION_PACKAGE_METHOD_VERSION,
  getActionChecklist,
  type ActionPackage,
  type ActionPackageCitation,
} from '../action/actionPackageEngine';
import {
  OUTCOME_METHOD_VERSION,
  type OutcomeEvent,
} from '../outcome/outcomeEngine';

export const WORKSPACE_STORAGE_KEY = 'candidate-workspace';
export const WORKSPACE_VERSION = 5;

export type WorkspaceMarket = 'ru' | 'international';
export type ResumeSource = 'pdf' | 'linkedin-pdf' | 'hh-pdf' | 'text';
export type SearchUrgency = 'exploring' | 'active' | 'urgent';

export interface WorkspaceInput {
  resumeText: string;
  resumeSource: ResumeSource;
  resumeFileName?: string;
  resumePageCount?: number;
  targetDirection: string;
  market: WorkspaceMarket;
  currentSituation: string;
  constraints: string;
  urgency: SearchUrgency;
  linkedinUrl?: string;
  hhUrl?: string;
}

export interface MarketVacancySampleItem {
  id: string;
  title: string;
  company: string;
  location: string;
  sourceUrl: string;
  publishedAt: string | null;
  salary: {
    from: number | null;
    to: number | null;
    currency: string;
    gross: boolean;
  } | null;
}

export interface MarketVacancySample {
  source: 'hh';
  query: string;
  found: number;
  fetchedAt: string;
  items: MarketVacancySampleItem[];
}

export interface CandidateWorkspace extends WorkspaceInput {
  version: typeof WORKSPACE_VERSION;
  createdAt: string;
  updatedAt: string;
  analysis?: CandidateAnalysis;
  marketSample?: MarketVacancySample;
  opportunity?: OpportunityRecord;
  actionPackage?: ActionPackage;
  outcomes: OutcomeEvent[];
}

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export type WorkspaceLoadResult =
  | { status: 'empty' }
  | { status: 'invalid' }
  | { status: 'ready'; workspace: CandidateWorkspace };

export type WorkspaceInputErrors = Partial<
  Record<keyof WorkspaceInput, string>
>;

export function validateWorkspaceInput(
  input: WorkspaceInput,
): WorkspaceInputErrors {
  const errors: WorkspaceInputErrors = {};
  const canStartFromCareerQuestion = input.currentSituation.trim().length >= 20;

  if (
    input.resumeText.trim().length > 0 &&
    input.resumeText.trim().length < 80
  ) {
    errors.resumeText =
      'Добавьте хотя бы 80 знаков, чтобы сохранить рабочий контекст.';
  } else if (!input.resumeText.trim() && !canStartFromCareerQuestion) {
    errors.resumeText =
      'Добавьте резюме или начните с вопроса о вашей ситуации.';
  }

  if (input.targetDirection.trim().length < 2 && !canStartFromCareerQuestion) {
    errors.targetDirection = 'Укажите роль или направление.';
  }

  if (input.currentSituation.trim().length < 20) {
    errors.currentSituation = 'Коротко опишите, где вы находитесь сейчас.';
  }

  if (input.linkedinUrl && !isAllowedProfileUrl(input.linkedinUrl, 'linkedin')) {
    errors.linkedinUrl = 'Укажите ссылку на профиль linkedin.com.';
  }

  if (input.hhUrl && !isAllowedProfileUrl(input.hhUrl, 'hh')) {
    errors.hhUrl = 'Укажите ссылку на резюме hh.ru.';
  }

  return errors;
}

export function createWorkspace(
  input: WorkspaceInput,
  now: string = new Date().toISOString(),
  previous?: CandidateWorkspace,
): CandidateWorkspace {
  const resumeText = input.resumeText.trim();
  const targetDirection = input.targetDirection.trim();
  const canKeepAnalysis =
    previous?.resumeText === resumeText &&
    previous.targetDirection === targetDirection;
  const canKeepOpportunity =
    canKeepAnalysis &&
    previous?.market === input.market &&
    previous.constraints === input.constraints.trim();

  return {
    version: WORKSPACE_VERSION,
    resumeText,
    resumeSource: input.resumeSource,
    resumeFileName: input.resumeFileName?.trim() || undefined,
    resumePageCount: input.resumePageCount,
    targetDirection,
    market: input.market,
    currentSituation: input.currentSituation.trim(),
    constraints: input.constraints.trim(),
    urgency: input.urgency,
    linkedinUrl: input.linkedinUrl?.trim() || undefined,
    hhUrl: input.hhUrl?.trim() || undefined,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    analysis: canKeepAnalysis ? previous.analysis : undefined,
    marketSample: canKeepOpportunity ? previous?.marketSample : undefined,
    opportunity: canKeepOpportunity ? previous?.opportunity : undefined,
    actionPackage: canKeepOpportunity ? previous?.actionPackage : undefined,
    outcomes: canKeepOpportunity ? (previous?.outcomes ?? []) : [],
  };
}

export function saveWorkspace(
  storage: StorageLike,
  workspace: CandidateWorkspace,
): void {
  storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
}

export function loadWorkspace(storage: StorageLike): WorkspaceLoadResult {
  try {
    const raw = storage.getItem(WORKSPACE_STORAGE_KEY);
    if (raw === null) {
      return { status: 'empty' };
    }

    const parsed: unknown = JSON.parse(raw);
    if (isCandidateWorkspace(parsed)) {
      return { status: 'ready', workspace: normalizeLoadedWorkspace(parsed) };
    }

    if (isLegacyWorkspace(parsed)) {
      return {
        status: 'ready',
        workspace: {
          ...parsed,
          version: WORKSPACE_VERSION,
          outcomes: [],
        },
      };
    }

    if (isVersionTwoWorkspace(parsed)) {
      return {
        status: 'ready',
        workspace: {
          ...parsed,
          version: WORKSPACE_VERSION,
          outcomes: [],
        },
      };
    }

    if (isVersionThreeWorkspace(parsed)) {
      return {
        status: 'ready',
        workspace: {
          ...parsed,
          version: WORKSPACE_VERSION,
          outcomes: [],
        },
      };
    }

    if (isVersionFourWorkspace(parsed)) {
      return {
        status: 'ready',
        workspace: {
          ...parsed,
          version: WORKSPACE_VERSION,
          outcomes: [],
        },
      };
    }

    return { status: 'invalid' };
  } catch {
    return { status: 'invalid' };
  }
}

function normalizeLoadedWorkspace(
  workspace: CandidateWorkspace,
): CandidateWorkspace {
  if (workspace.resumeText.trim()) return workspace;

  return {
    ...workspace,
    analysis: undefined,
  };
}

export function clearWorkspace(storage: StorageLike): void {
  storage.removeItem(WORKSPACE_STORAGE_KEY);
}

function isCandidateWorkspace(value: unknown): value is CandidateWorkspace {
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

function isLegacyWorkspace(
  value: unknown,
): value is Omit<CandidateWorkspace, 'version' | 'analysis' | 'outcomes'> & {
  version: 1;
} {
  return (
    isWorkspaceRecord(value, 1) &&
    value.analysis === undefined &&
    value.opportunity === undefined &&
    value.actionPackage === undefined &&
    value.outcomes === undefined
  );
}

function isVersionTwoWorkspace(
  value: unknown,
): value is Omit<
  CandidateWorkspace,
  'version' | 'opportunity' | 'outcomes'
> & {
  version: 2;
} {
  return (
    isWorkspaceRecord(value, 2) &&
    (value.analysis === undefined || isCandidateAnalysis(value.analysis)) &&
    value.opportunity === undefined &&
    value.actionPackage === undefined &&
    value.outcomes === undefined
  );
}

function isVersionThreeWorkspace(
  value: unknown,
): value is Omit<
  CandidateWorkspace,
  'version' | 'actionPackage' | 'outcomes'
> & {
  version: 3;
} {
  return (
    isWorkspaceRecord(value, 3) &&
    (value.analysis === undefined || isCandidateAnalysis(value.analysis)) &&
    (value.opportunity === undefined ||
      isOpportunityRecord(value.opportunity)) &&
    value.actionPackage === undefined &&
    value.outcomes === undefined
  );
}

function isVersionFourWorkspace(
  value: unknown,
): value is Omit<CandidateWorkspace, 'version' | 'outcomes'> & {
  version: 4;
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

  return (
    value.version === version &&
    typeof value.resumeText === 'string' &&
    (value.resumeText.trim().length === 0 ||
      value.resumeText.trim().length >= 80) &&
    isResumeSource(value.resumeSource) &&
    isOptionalString(value.resumeFileName) &&
    isOptionalNumber(value.resumePageCount) &&
    typeof value.targetDirection === 'string' &&
    (value.targetDirection.trim().length >= 2 ||
      (typeof value.currentSituation === 'string' &&
        value.currentSituation.trim().length >= 20)) &&
    (value.market === 'ru' || value.market === 'international') &&
    typeof value.currentSituation === 'string' &&
    value.currentSituation.trim().length >= 20 &&
    typeof value.constraints === 'string' &&
    isSearchUrgency(value.urgency) &&
    isOptionalString(value.linkedinUrl) &&
    isOptionalString(value.hhUrl) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
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

function isAllowedProfileUrl(value: string, source: 'linkedin' | 'hh'): boolean {
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
