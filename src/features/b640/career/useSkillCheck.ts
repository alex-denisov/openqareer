import { useEffect, useLayoutEffect, useReducer, useRef, useState, type Dispatch } from 'react';
import {
  loadInitialAssessment,
  RoleSkillAssessmentActions,
} from '../../skills/RoleSkillAssessmentActions';
import {
  getActiveAssessmentCase,
  getAssessmentRun,
  initialRoleSkillAssessmentState,
  roleSkillAssessmentReducer,
  type RoleSkillAssessmentUiAction,
  type RoleSkillAssessmentUiState,
} from '../../skills/roleSkillAssessmentState';
import type { RoleSkillAssessmentRun } from '../../../../server/domain/roleSkillAssessment';

type RunCase = RoleSkillAssessmentRun['cases'][number];

export interface SkillCheck {
  readonly state: RoleSkillAssessmentUiState;
  readonly run: RoleSkillAssessmentRun | undefined;
  readonly activeCase: RunCase | undefined;
  readonly actions: RoleSkillAssessmentActions;
  /** Кейс, итог которого открыт (C4b); `null` — открыт вопрос. */
  readonly resultCase: RunCase | undefined;
  readonly answerCase: () => Promise<void>;
  /** «Верно» / «Пропустить» записываются, затем следующий кейс; без вопроса — сразу дальше. */
  readonly nextAfterResult: (accepted: boolean) => Promise<void>;
  readonly answerAgain: () => void;
}

/** Последний оценённый кейс завершённой проверки — его итог виден при входе. */
function lastEvaluated(run: RoleSkillAssessmentRun | undefined): RunCase | undefined {
  if (!run || run.status !== 'complete') return undefined;
  return [...run.cases].reverse().find((record) => record.evaluation);
}

/** Оценённый кейс, по которому кандидат ещё не решил: его итог открывается первым (B734). */
function awaitingDecision(run: RoleSkillAssessmentRun | undefined): string | undefined {
  if (!run || !['cases', 'complete'].includes(run.status)) return undefined;
  return run.cases.find((record) => record.decision === 'pending')?.assessmentCase.id;
}

/** Фактов из разговора нет — шаг «Что добавить в профиль» показывать не с чем (B734). */
export function hasNoSuggestions(run: RoleSkillAssessmentRun | undefined): boolean {
  return run?.status === 'suggestions' && run.suggestions.length === 0;
}

/** Вход в проверку: итог без решения открывается первым, пустой шаг фактов пропускается (B734). */
function useOnEntry(
  run: RoleSkillAssessmentRun | undefined,
  actions: RoleSkillAssessmentActions,
  dispatch: Dispatch<RoleSkillAssessmentUiAction>,
  openResult: (caseId: string) => void,
): void {
  const runId = run?.id;
  const awaitingId = awaitingDecision(run);
  useLayoutEffect(() => {
    if (!runId || !awaitingId) return;
    openResult(awaitingId);
    dispatch({ type: 'focus-case', caseId: awaitingId });
    // Только при входе в проверку: дальше итог открывает сам ответ на кейс.
  }, [runId]);

  const skipEmpty = hasNoSuggestions(run);
  useEffect(() => {
    if (skipEmpty) void actions.saveSuggestions();
    // Один раз на шаг: после сбоя повторяет кандидат.
  }, [runId, skipEmpty]);
}

/** Состояние C04: проверка роли через действия прежнего экрана навыков, без своей логики сервера. */
export function useSkillCheck(roleTitle: string | undefined): SkillCheck {
  const [state, dispatch] = useReducer(roleSkillAssessmentReducer, initialRoleSkillAssessmentState);
  const requestRef = useRef<{ key: string; id: string }>();
  const busyRef = useRef(false);
  const [resultId, setResultId] = useState<string | null>(null);
  const [reopened, setReopened] = useState(false);
  const actions = new RoleSkillAssessmentActions(state, dispatch, requestRef, busyRef, roleTitle);
  const run = getAssessmentRun(state.current);
  const activeCase = getActiveAssessmentCase(state.current, state.focusedCaseId);

  useEffect(() => {
    void loadInitialAssessment(dispatch, roleTitle);
  }, [roleTitle]);

  useOnEntry(run, actions, dispatch, setResultId);

  const shown = resultId
    ? run?.cases.find((record) => record.assessmentCase.id === resultId)
    : reopened
      ? undefined
      : lastEvaluated(run);
  const resultCase = shown?.evaluation && !state.caseEditing ? shown : undefined;

  const answerCase = async () => {
    const record = activeCase;
    if (!record) return;
    const sent = await actions.submitCase();
    if (sent) setResultId(record.assessmentCase.id);
  };

  const nextAfterResult = async (accepted: boolean) => {
    const record = resultCase;
    const open = record?.decision === 'pending' || (record?.decision === 'declined' && accepted);
    if (record && open && !(await actions.decideCase(record.assessmentCase.id, accepted))) return;
    setResultId(null);
    setReopened(true);
    actions.focusCase();
  };

  const answerAgain = () => {
    const record = resultCase;
    if (!record) return;
    actions.focusCase(record.assessmentCase.id);
    actions.patch({ caseEditing: true, caseAnswer: record.answer ?? '' });
    setResultId(null);
    setReopened(true);
  };

  return { state, run, activeCase, actions, resultCase, answerCase, nextAfterResult, answerAgain };
}
