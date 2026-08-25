import {
} from '../evidence/evidenceEngine';
import {
} from '../opportunity/opportunityEngine';
import {
} from '../action/actionPackageEngine';
import {
} from '../outcome/outcomeEngine';
import {
} from './profileIngestion';
import {
  WORKSPACE_OWNER_KEY,
  WORKSPACE_STORAGE_KEY,
  WORKSPACE_VERSION,
  type StorageLike,
  type WorkspaceInput,
  type WorkspaceLoadResult,
  type WorkspaceInputErrors,
  type CandidateWorkspace,
} from './workspaceStorageSchema';
import {
  isCandidateWorkspace,
  isLegacyWorkspace,
  isVersionTwoWorkspace,
  isVersionThreeWorkspace,
  isVersionFourWorkspace,
  isVersionFiveWorkspace,
  isVersionSixWorkspace,
  isAllowedProfileUrl,
} from './workspaceStorageGuards';
import {
  normalizeCandidateRegions,
  regionsFromLegacyMarket,
  type CandidateRegion,
} from './candidateRegions';

export { WORKSPACE_STORAGE_KEY, WORKSPACE_OWNER_KEY } from './workspaceStorageSchema';
export type {
  ResumeSource,
  SearchUrgency,
  CareerGoal,
  MarketVacancySample,
  WorkspaceInput,
  CandidateWorkspace,
  StorageLike,
  WorkspaceLoadResult,
  WorkspaceInputErrors,
} from './workspaceStorageSchema';

export function validateWorkspaceInput(
  input: WorkspaceInput,
): WorkspaceInputErrors {
  const errors: WorkspaceInputErrors = {};
  const canStartFromCareerQuestion = input.currentSituation.trim().length >= 20;
  // A resume the candidate actually brought already answers "what is your
  // situation" better than two sentences would, so the wizard's third step is
  // optional exactly when a document exists — and required when it does not,
  // because otherwise there would be nothing at all to reason from (B148).
  const hasDocument =
    input.resumeText.trim().length >= 80 || Boolean(input.parsedResume);

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

  if (!hasDocument && input.currentSituation.trim().length < 20) {
    errors.currentSituation = 'Коротко опишите, где вы находитесь сейчас.';
  }

  if (input.linkedinUrl && !isAllowedProfileUrl(input.linkedinUrl, 'linkedin')) {
    errors.linkedinUrl = 'Укажите ссылку на профиль linkedin.com.';
  }

  if (input.hhUrl && !isAllowedProfileUrl(input.hhUrl, 'hh')) {
    errors.hhUrl = 'Укажите ссылку на резюме hh.ru.';
  }

  if (
    input.profileFacts?.some(
      (fact) => fact.status !== 'confirmed' && fact.status !== 'corrected',
    )
  ) {
    errors.profileFacts =
      'Проверьте каждый найденный факт: подтвердите, исправьте или исключите.';
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
    sameRegions(previous?.regions, input.regions) &&
    previous.constraints === input.constraints.trim();

  return {
    version: WORKSPACE_VERSION,
    careerGoal: input.careerGoal,
    resumeText,
    resumeSource: input.resumeSource,
    resumeFileName: input.resumeFileName?.trim() || undefined,
    resumePageCount: input.resumePageCount,
    targetDirection,
    regions: normalizeCandidateRegions(input.regions),
    currentSituation: input.currentSituation.trim(),
    constraints: input.constraints.trim(),
    urgency: input.urgency,
    linkedinUrl: input.linkedinUrl?.trim() || undefined,
    hhUrl: input.hhUrl?.trim() || undefined,
    profileFacts: input.profileFacts?.filter(
      (fact) => fact.status === 'confirmed' || fact.status === 'corrected',
    ),
    resumeDraft: input.resumeDraft ?? previous?.resumeDraft,
    parsedResume: input.parsedResume ?? previous?.parsedResume,
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
  ownerCandidateId: string | null = null,
): void {
  storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
  if (ownerCandidateId) {
    storage.setItem(WORKSPACE_OWNER_KEY, ownerCandidateId);
  } else {
    storage.removeItem(WORKSPACE_OWNER_KEY);
  }
}

export function loadWorkspace(
  storage: StorageLike,
  ownerCandidateId?: string | null,
): WorkspaceLoadResult {
  try {
    if (ownerCandidateId !== undefined && !ownerOwnsStorage(storage, ownerCandidateId)) {
      return { status: 'empty' };
    }
    const raw = storage.getItem(WORKSPACE_STORAGE_KEY);
    if (raw === null) {
      return { status: 'empty' };
    }
    return parseStoredWorkspace(raw);
  } catch {
    return { status: 'invalid' };
  }
}

function ownerOwnsStorage(
  storage: StorageLike,
  ownerCandidateId: string | null,
): boolean {
  const storedOwner = storage.getItem(WORKSPACE_OWNER_KEY);
  return !(
    ownerCandidateId === null ||
    storedOwner === null ||
    storedOwner !== ownerCandidateId
  );
}

function parseStoredWorkspace(raw: string): WorkspaceLoadResult {
  const parsed: unknown = JSON.parse(raw);
  if (isCurrentWorkspace(parsed)) {
    return { status: 'ready', workspace: normalizeLoadedWorkspace(parsed) };
  }
  return migrateLegacyWorkspace(parsed);
}

function isCurrentWorkspace(value: unknown): value is CandidateWorkspace {
  return isCandidateWorkspace(value);
}

function migrateLegacyWorkspace(parsed: unknown): WorkspaceLoadResult {
  if (isLegacyWorkspace(parsed)) {
    return ready({ ...parsed, outcomes: [] });
  }
  if (
    isVersionTwoWorkspace(parsed) ||
    isVersionThreeWorkspace(parsed) ||
    isVersionFourWorkspace(parsed)
  ) {
    return ready({ ...parsed, outcomes: [] });
  }
  if (isVersionFiveWorkspace(parsed) || isVersionSixWorkspace(parsed)) {
    // v5 and v6 already carry outcomes; only the answer about where the
    // candidate looks for work changes shape.
    return ready(parsed);
  }
  return { status: 'invalid' };
}

/**
 * Every record written before version 7 answered «where are you looking?» with
 * one `market` flag. It becomes a region list, and the flag stops travelling —
 * leaving it in place would keep two answers to the same question (B158).
 */
function ready(
  legacy: Omit<CandidateWorkspace, 'version' | 'regions'> & {
    market: 'ru' | 'international';
  },
): WorkspaceLoadResult {
  const { market, ...rest } = legacy;
  return {
    status: 'ready',
    workspace: {
      ...rest,
      version: WORKSPACE_VERSION,
      regions: regionsFromLegacyMarket(market),
    },
  };
}

/**
 * The candidate picks regions in whatever order they click them, while a stored
 * workspace holds them in catalogue order, so both sides are normalised before
 * comparison — otherwise re-picking the same regions would throw away analysis
 * that is still current.
 */
function sameRegions(
  previous: readonly CandidateRegion[] | undefined,
  next: readonly CandidateRegion[],
): boolean {
  if (!previous) return false;
  const before = normalizeCandidateRegions(previous);
  const after = normalizeCandidateRegions(next);
  return (
    before.length === after.length &&
    before.every((region, index) => region === after[index])
  );
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
  storage.removeItem(WORKSPACE_OWNER_KEY);
}

