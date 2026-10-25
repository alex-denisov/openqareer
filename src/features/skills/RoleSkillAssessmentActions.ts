import { apiErrorMessage, CoachApiError } from '../coach/apiClient';
import type { RoleSkillAssessmentMutationResult } from './roleSkillAssessmentApi';
import {
  answerRoleAssessmentCase,
  answerRoleAssessmentDialogue,
  appealRoleAssessmentCase,
  decideRoleAssessmentSuggestions,
  discussRoleAssessmentCase,
  getCurrentRoleSkillAssessment,
  rollbackRoleAssessmentSuggestions,
  retryRoleSkillAssessment,
  saveRoleAssessmentDraft,
  skipRoleAssessmentCase,
  startRoleSkillAssessment,
  type RoleSkillAssessmentFocusRequest,
} from './roleSkillAssessmentApi';
import {
  getActiveAssessmentCase,
  getAssessmentRun,
  type RoleSkillAssessmentUiAction,
  type RoleSkillAssessmentUiState,
} from './roleSkillAssessmentState';

type Dispatch = (action: RoleSkillAssessmentUiAction) => void;
type RequestRef = { current?: { key: string; id: string } };

export class RoleSkillAssessmentActions {
  constructor(
    private readonly state: RoleSkillAssessmentUiState,
    private readonly dispatch: Dispatch,
    private readonly requestRef: RequestRef,
    private readonly busyRef: { current: boolean },
    private readonly roleTitle?: string,
    private readonly focus?: RoleSkillAssessmentFocusRequest,
  ) {}

  get run() {
    return getAssessmentRun(this.state.current);
  }

  get activeCase() {
    return getActiveAssessmentCase(this.state.current, this.state.focusedCaseId);
  }

  patch(values: Partial<RoleSkillAssessmentUiState>): void {
    this.dispatch({ type: 'patch', values });
  }

  focusCase(caseId?: string): void {
    this.dispatch({ type: 'focus-case', caseId });
  }

  focusSkill(skillId?: string): void {
    this.dispatch({ type: 'focus-skill', skillId });
  }

  loadCurrent = async (): Promise<void> => {
    this.patch({ loading: true, error: undefined });
    try {
      this.dispatch({
        type: 'current',
        current: await getCurrentRoleSkillAssessment(this.roleTitle),
      });
    } catch (reason) {
      this.patch({ error: apiErrorMessage(reason, 'Не удалось загрузить проверку навыков.') });
    } finally {
      this.patch({ loading: false });
    }
  };

  start = async (): Promise<void> => {
    if (!this.state.consent || this.busyRef.current) return;
    this.setBusy(true);
    this.patch({ error: undefined });
    try {
      this.dispatch({
        type: 'current',
        current: await startRoleSkillAssessment(this.roleTitle, this.focus),
      });
      this.patch({ consent: false });
    } catch (reason) {
      this.patch({ error: apiErrorMessage(reason, 'Не удалось начать проверку.') });
    } finally {
      this.setBusy(false);
    }
  };

  submitDialogue = async (answer: string): Promise<boolean> => {
    const run = this.run;
    if (!run || !answer.trim()) return false;
    const payload = { expectedRevision: run.revision, answer: answer.trim() };
    const requestId = this.requestId('dialogue', payload);
    return this.performMutation(() =>
      answerRoleAssessmentDialogue({ runId: run.id, ...payload, requestId }),
    );
  };

  changeCaseAnswer = (caseAnswer: string): void => {
    const record = this.activeCase;
    this.patch({
      caseAnswer,
      caseDraftDirty: record?.status === 'pending' && caseAnswer !== (record.answer ?? ''),
    });
  };

  saveCaseDraft = async (): Promise<boolean> => {
    const run = this.run;
    const record = this.activeCase;
    if (!run || !record || run.status !== 'cases' || record.status !== 'pending') return false;
    const payload = {
      expectedRevision: run.revision,
      caseId: record.assessmentCase.id,
      draft: this.state.caseAnswer,
    };
    const requestId = this.requestId('draft', payload);
    return this.performMutation(() =>
      saveRoleAssessmentDraft({ runId: run.id, ...payload, requestId }),
    );
  };

  submitCase = async (answer = this.state.caseAnswer): Promise<boolean> => {
    const run = this.run;
    const record = this.activeCase;
    if (!run || !record || !answer.trim()) return false;
    const payload = {
      expectedRevision: run.revision,
      caseId: record.assessmentCase.id,
      answer: answer.trim(),
    };
    const requestId = this.requestId('answer', payload);
    this.dispatch({ type: 'focus-case', caseId: record.assessmentCase.id });
    this.patch({ caseAnswer: answer, caseDraftDirty: false });
    const submitted = await this.performMutation(() =>
      answerRoleAssessmentCase({ runId: run.id, ...payload, requestId }),
    );
    if (submitted) this.patch({ caseEditing: false });
    return submitted;
  };

  skipCase = async (): Promise<boolean> => {
    const run = this.run;
    const record = this.activeCase;
    if (!run || !record || run.status !== 'cases' || this.state.caseDraftDirty) return false;
    const payload = { expectedRevision: run.revision, caseId: record.assessmentCase.id };
    const requestId = this.requestId('skip', payload);
    return this.performMutation(() =>
      skipRoleAssessmentCase({ runId: run.id, ...payload, requestId }),
    );
  };

  chooseAllSuggestions = (accepted: boolean): void => {
    const run = this.run;
    if (!run) return;
    const suggestionDrafts = Object.fromEntries(
      run.suggestions.map((suggestion) => [
        suggestion.id,
        {
          accepted,
          statement: this.state.suggestionDrafts[suggestion.id]?.statement ?? suggestion.statement,
        },
      ]),
    );
    this.patch({ suggestionDrafts });
  };

  saveSuggestions = async (acceptAll = false): Promise<boolean> => {
    const run = this.run;
    if (!run) return false;
    const payload = {
      expectedRevision: run.revision,
      suggestions: run.suggestions.map((suggestion) => ({
        id: suggestion.id,
        accepted: acceptAll || this.state.suggestionDrafts[suggestion.id]?.accepted || false,
        statement: this.state.suggestionDrafts[suggestion.id]?.statement ?? suggestion.statement,
      })),
    };
    const requestId = this.requestId('suggestions', payload);
    return this.performMutation(() =>
      decideRoleAssessmentSuggestions({ runId: run.id, ...payload, requestId }),
    );
  };

  /** B564: after a failed suggestion step the candidate goes on to the cases with nothing added. */
  skipSuggestions = async (): Promise<boolean> => {
    const run = this.run;
    if (run?.modelError?.action !== 'suggestions' || run.suggestions.length > 0) return false;
    const payload = { expectedRevision: run.revision, suggestions: [] };
    const requestId = this.requestId('suggestions', payload);
    return this.performMutation(() =>
      decideRoleAssessmentSuggestions({ runId: run.id, ...payload, requestId }),
    );
  };

  rollbackSuggestions = async (): Promise<boolean> => {
    const run = this.run;
    if (!run?.profileChange?.memoryIds.length || run.profileChange.revertedAt) return false;
    const payload = { expectedRevision: run.revision };
    const requestId = this.requestId('suggestions_rollback', payload);
    return this.performMutation(() =>
      rollbackRoleAssessmentSuggestions({ runId: run.id, ...payload, requestId }),
    );
  };

  discussCase = async (question: string): Promise<boolean> => {
    const run = this.run;
    const record = this.activeCase;
    if (!run || !record || !question.trim()) return false;
    const payload = {
      expectedRevision: run.revision,
      caseId: record.assessmentCase.id,
      question: question.trim(),
    };
    const requestId = this.requestId('discussion', payload);
    const sent = await this.performMutation(() =>
      discussRoleAssessmentCase({ runId: run.id, ...payload, requestId }),
    );
    if (sent) this.patch({ discussionOpen: false, discussionQuestion: '' });
    return sent;
  };

  appealCase = async (reason: string): Promise<boolean> => {
    const run = this.run;
    const record = this.activeCase;
    if (!run || !record || !reason.trim()) return false;
    const payload = {
      expectedRevision: run.revision,
      caseId: record.assessmentCase.id,
      reason: reason.trim(),
    };
    const requestId = this.requestId('appeal', payload);
    const sent = await this.performMutation(() =>
      appealRoleAssessmentCase({ runId: run.id, ...payload, requestId }),
    );
    if (sent) this.patch({ appealOpen: false, appealReason: '' });
    return sent;
  };

  retryModel = async (): Promise<boolean> => {
    const run = this.run;
    if (!run?.modelError) return false;
    const payload = { expectedRevision: run.revision };
    const requestId = this.requestId('retry', payload);
    return this.performMutation(() =>
      retryRoleSkillAssessment({ runId: run.id, ...payload, requestId }),
    );
  };

  private requestId(action: string, payload: unknown): string {
    const key = `${action}:${JSON.stringify(payload)}`;
    if (this.requestRef.current?.key !== key) {
      this.requestRef.current = { key, id: crypto.randomUUID() };
    }
    return this.requestRef.current.id;
  }

  private async performMutation(
    mutate: () => Promise<RoleSkillAssessmentMutationResult>,
  ): Promise<boolean> {
    if (this.busyRef.current) return false;
    this.setBusy(true);
    this.patch({ error: undefined });
    try {
      const result = await mutate();
      this.requestRef.current = undefined;
      this.patch({ caseDraftDirty: false });
      this.dispatch({ type: 'current', current: result });
      return true;
    } catch (reason) {
      this.patch({
        error: apiErrorMessage(reason, 'Не удалось сохранить ответ. Попробуйте ещё раз.'),
      });
      if (reason instanceof CoachApiError && reason.code === 'assessment_revision_conflict') {
        void this.loadCurrent();
      }
      return false;
    } finally {
      this.setBusy(false);
    }
  }

  private setBusy(busy: boolean): void {
    this.busyRef.current = busy;
    this.patch({ busy });
  }
}

export async function loadInitialAssessment(dispatch: Dispatch, roleTitle?: string): Promise<void> {
  dispatch({ type: 'patch', values: { loading: true, error: undefined } });
  try {
    dispatch({ type: 'current', current: await getCurrentRoleSkillAssessment(roleTitle) });
  } catch (reason) {
    dispatch({
      type: 'patch',
      values: { error: apiErrorMessage(reason, 'Не удалось загрузить проверку навыков.') },
    });
  } finally {
    dispatch({ type: 'patch', values: { loading: false } });
  }
}
