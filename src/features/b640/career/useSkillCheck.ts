import { useEffect, useReducer, useRef, useState } from 'react';
import {
  loadInitialAssessment,
  RoleSkillAssessmentActions,
} from '../../skills/RoleSkillAssessmentActions';
import {
  getActiveAssessmentCase,
  getAssessmentRun,
  initialRoleSkillAssessmentState,
  roleSkillAssessmentReducer,
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
  readonly nextAfterResult: () => void;
  /** B734: дальше, не записывая итог кейса в профиль. */
  readonly keepOutAfterResult: () => Promise<void>;
  readonly answerAgain: () => void;
}

/** Последний оценённый кейс завершённой проверки — его итог виден при входе. */
function lastEvaluated(run: RoleSkillAssessmentRun | undefined): RunCase | undefined {
  if (!run || run.status !== 'complete') return undefined;
  return [...run.cases].reverse().find((record) => record.evaluation);
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

  const nextAfterResult = () => {
    setResultId(null);
    setReopened(true);
    actions.focusCase();
  };

  const keepOutAfterResult = async () => {
    const record = resultCase;
    if (!record) return;
    if (await actions.keepCaseOut(record.assessmentCase.id)) nextAfterResult();
  };

  const answerAgain = () => {
    const record = resultCase;
    if (!record) return;
    actions.focusCase(record.assessmentCase.id);
    actions.patch({ caseEditing: true, caseAnswer: record.answer ?? '' });
    setResultId(null);
    setReopened(true);
  };

  const flow = { answerCase, nextAfterResult, keepOutAfterResult, answerAgain };
  return { state, run, activeCase, actions, resultCase, ...flow };
}
