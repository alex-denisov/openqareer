import type { RoleSkillAssessmentRun } from '../../../server/domain/roleSkillAssessment';
import type {
  RoleSkillAssessmentCurrent,
  RoleSkillAssessmentMutationResult,
} from './roleSkillAssessmentApi';

export type SuggestionDecision = { accepted: boolean; statement: string };

export interface RoleSkillAssessmentUiState {
  current: RoleSkillAssessmentCurrent | null;
  loading: boolean;
  busy: boolean;
  error?: string;
  consent: boolean;
  howItWorksOpen: boolean;
  dialogueAnswer: string;
  suggestionDrafts: Record<string, SuggestionDecision>;
  caseAnswer: string;
  caseDraftDirty: boolean;
  caseEditing: boolean;
  discussionOpen: boolean;
  discussionQuestion: string;
  appealOpen: boolean;
  appealReason: string;
  focusedCaseId?: string;
  focusedSkillId?: string;
  skillOverviewOpen: boolean;
}

export type RoleSkillAssessmentUiAction =
  | { type: 'patch'; values: Partial<RoleSkillAssessmentUiState> }
  | { type: 'current'; current: RoleSkillAssessmentCurrent | RoleSkillAssessmentMutationResult }
  | { type: 'focus-case'; caseId?: string }
  | { type: 'focus-skill'; skillId?: string };

export const initialRoleSkillAssessmentState: RoleSkillAssessmentUiState = {
  current: null,
  loading: true,
  busy: false,
  consent: false,
  howItWorksOpen: true,
  dialogueAnswer: '',
  suggestionDrafts: {},
  caseAnswer: '',
  caseDraftDirty: false,
  caseEditing: false,
  discussionOpen: false,
  discussionQuestion: '',
  appealOpen: false,
  appealReason: '',
  skillOverviewOpen: false,
};

export function getAssessmentRun(
  current: RoleSkillAssessmentUiState['current'],
): RoleSkillAssessmentRun | undefined {
  return current && 'run' in current ? current.run : undefined;
}

export function getActiveAssessmentCase(
  current: RoleSkillAssessmentUiState['current'],
  focusedCaseId?: string,
): RoleSkillAssessmentRun['cases'][number] | undefined {
  const run = getAssessmentRun(current);
  if (!run) return undefined;
  return (
    (focusedCaseId
      ? run.cases.find((record) => record.assessmentCase.id === focusedCaseId)
      : undefined) ?? run.cases[run.currentCaseIndex]
  );
}

export function roleSkillAssessmentReducer(
  state: RoleSkillAssessmentUiState,
  action: RoleSkillAssessmentUiAction,
): RoleSkillAssessmentUiState {
  if (action.type === 'patch') return { ...state, ...action.values };
  if (action.type === 'focus-case') return focusCase(state, action.caseId);
  if (action.type === 'focus-skill')
    return { ...state, focusedSkillId: action.skillId, skillOverviewOpen: false };
  return reconcileCurrent(state, action.current);
}

function focusCase(state: RoleSkillAssessmentUiState, caseId?: string): RoleSkillAssessmentUiState {
  const next = {
    ...state,
    focusedCaseId: caseId,
    focusedSkillId: undefined,
    skillOverviewOpen: false,
  };
  const record = getActiveAssessmentCase(next.current, caseId);
  return record ? resetCaseInputs(next, record) : next;
}

function reconcileCurrent(
  state: RoleSkillAssessmentUiState,
  current: RoleSkillAssessmentCurrent | RoleSkillAssessmentMutationResult,
): RoleSkillAssessmentUiState {
  const previousRun = getAssessmentRun(state.current);
  const nextRun = getAssessmentRun(current);
  const isNewRun = Boolean(nextRun && previousRun?.id !== nextRun.id);
  let next: RoleSkillAssessmentUiState = {
    ...state,
    current,
    focusedCaseId: isNewRun || nextRun?.status === 'complete' ? undefined : state.focusedCaseId,
  };
  next = updateDialogueInputs(next, previousRun, nextRun, isNewRun);
  next = updateSuggestionInputs(next, previousRun, nextRun, isNewRun);
  next = updateCaseInputs(next, state.current, isNewRun);
  return next;
}

function updateDialogueInputs(
  state: RoleSkillAssessmentUiState,
  previous: RoleSkillAssessmentRun | undefined,
  next: RoleSkillAssessmentRun | undefined,
  isNewRun: boolean,
): RoleSkillAssessmentUiState {
  const questionChanged = previous?.currentDialogueIndex !== next?.currentDialogueIndex;
  return next?.status === 'dialogue' && (isNewRun || questionChanged)
    ? { ...state, dialogueAnswer: '' }
    : state;
}

function updateSuggestionInputs(
  state: RoleSkillAssessmentUiState,
  previous: RoleSkillAssessmentRun | undefined,
  next: RoleSkillAssessmentRun | undefined,
  isNewRun: boolean,
): RoleSkillAssessmentUiState {
  const enteringSuggestions = next?.status === 'suggestions' && previous?.status !== 'suggestions';
  if (next?.status !== 'suggestions' || (!isNewRun && !enteringSuggestions)) return state;
  const suggestionDrafts = Object.fromEntries(
    next.suggestions.map((suggestion) => [
      suggestion.id,
      { accepted: true, statement: suggestion.statement },
    ]),
  );
  return { ...state, suggestionDrafts };
}

function updateCaseInputs(
  state: RoleSkillAssessmentUiState,
  previousCurrent: RoleSkillAssessmentUiState['current'],
  isNewRun: boolean,
): RoleSkillAssessmentUiState {
  const previousRecord = getActiveAssessmentCase(previousCurrent, state.focusedCaseId);
  const nextRecord = getActiveAssessmentCase(state.current, state.focusedCaseId);
  if (
    !nextRecord ||
    (!isNewRun && previousRecord?.assessmentCase.id === nextRecord.assessmentCase.id)
  ) {
    return state;
  }
  return resetCaseInputs(state, nextRecord);
}

function resetCaseInputs(
  state: RoleSkillAssessmentUiState,
  record: RoleSkillAssessmentRun['cases'][number],
): RoleSkillAssessmentUiState {
  return {
    ...state,
    caseAnswer: record.answer ?? '',
    caseDraftDirty: false,
    caseEditing: record.status === 'pending',
    discussionOpen: false,
    discussionQuestion: '',
    appealOpen: false,
    appealReason: '',
  };
}

/** Надпись над экраном проверки: «по вакансии» только при входе из вакансии (B5). */
export function assessmentKicker(origin: {
  readonly fromCareer: boolean;
  readonly fromVacancy: boolean;
}): string {
  if (origin.fromCareer) return 'Карьера · проверка роли';
  return origin.fromVacancy ? 'Профиль · проверка по вакансии' : 'Профиль · проверка по роли';
}
