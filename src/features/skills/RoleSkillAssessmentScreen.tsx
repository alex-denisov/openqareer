import {
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
  type FormEvent,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';
import { ArrowLeft, CheckCircle } from '@phosphor-icons/react';
import type { AuthUser } from '../coach/coachApi';
import { CaseState, ModelErrorState } from './RoleSkillAssessmentCaseViews';
import { DialogueState, SuggestionsState } from './RoleSkillAssessmentConversationViews';
import { ResultState } from './RoleSkillAssessmentResultView';
import { RoleSkillAssessmentProfileChange } from './RoleSkillAssessmentProfileChange';
import {
  ErrorState,
  getProgressStep,
  InlineError,
  InsufficientRequirementsState,
  LoadingState,
  NoRoleState,
  ProgressTrack,
  RoleChangedState,
  SkillOverview,
  SourceErrorState,
  StartState,
  TooFewVacanciesState,
} from './RoleSkillAssessmentStartViews';
import { RoleSkillAssessmentActions, loadInitialAssessment } from './RoleSkillAssessmentActions';
import {
  getActiveAssessmentCase,
  getAssessmentRun,
  initialRoleSkillAssessmentState,
  roleSkillAssessmentReducer,
  type RoleSkillAssessmentUiState,
} from './roleSkillAssessmentState';
import './role-skill-assessment.css';

interface RoleSkillAssessmentScreenProps {
  session: AuthUser;
  onClose: () => void;
  onOpenOpportunities: () => void;
}

export function RoleSkillAssessmentScreen({
  session,
  onClose,
  onOpenOpportunities,
}: RoleSkillAssessmentScreenProps) {
  const [state, dispatch] = useReducer(roleSkillAssessmentReducer, initialRoleSkillAssessmentState);
  const requestRef = useRef<{ key: string; id: string }>();
  const busyRef = useRef(false);
  const draftTimer = useRef<number>();
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const actions = new RoleSkillAssessmentActions(state, dispatch, requestRef, busyRef);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const run = getAssessmentRun(state.current);
  const activeCase = getActiveAssessmentCase(state.current, state.focusedCaseId);

  useAssessmentLifecycle(
    session.candidateId,
    state,
    dispatch,
    actionsRef,
    draftTimer,
    run,
    activeCase,
  );

  return (
    <section className="career-role-assessment" data-testid="role-skill-assessment">
      <AssessmentHeader state={state} run={run} onClose={onClose} />
      {run ? <ProgressTrack step={getProgressStep(run.status, run.currentDialogueIndex)} /> : null}
      <AssessmentStateContent
        state={state}
        run={run}
        activeCase={activeCase}
        actions={actions}
        answerRef={answerRef}
        onOpenOpportunities={onOpenOpportunities}
      />
    </section>
  );
}

function useAssessmentLifecycle(
  candidateId: string | null,
  state: RoleSkillAssessmentUiState,
  dispatch: Dispatch<Parameters<typeof roleSkillAssessmentReducer>[1]>,
  actionsRef: MutableRefObject<RoleSkillAssessmentActions>,
  draftTimer: MutableRefObject<number | undefined>,
  run: ReturnType<typeof getAssessmentRun>,
  activeCase: ReturnType<typeof getActiveAssessmentCase>,
): void {
  useEffect(() => {
    void loadInitialAssessment(dispatch);
  }, [candidateId, dispatch]);
  useEffect(
    () => scheduleDraftSave(state, run, activeCase, actionsRef, draftTimer),
    [
      state.caseAnswer,
      state.caseDraftDirty,
      run?.id,
      run?.revision,
      run?.status,
      activeCase?.assessmentCase.id,
      state,
      run,
      activeCase,
      actionsRef,
      draftTimer,
    ],
  );
}

function scheduleDraftSave(
  state: RoleSkillAssessmentUiState,
  run: ReturnType<typeof getAssessmentRun>,
  activeCase: ReturnType<typeof getActiveAssessmentCase>,
  actionsRef: MutableRefObject<RoleSkillAssessmentActions>,
  draftTimer: MutableRefObject<number | undefined>,
): () => void {
  window.clearTimeout(draftTimer.current);
  if (!state.caseDraftDirty || run?.status !== 'cases' || activeCase?.status !== 'pending')
    return () => undefined;
  draftTimer.current = window.setTimeout(() => {
    void actionsRef.current.saveCaseDraft();
  }, 700);
  return () => window.clearTimeout(draftTimer.current);
}

function AssessmentHeader({
  state,
  run,
  onClose,
}: {
  state: RoleSkillAssessmentUiState;
  run: ReturnType<typeof getAssessmentRun>;
  onClose: () => void;
}) {
  const roleTitle =
    run?.roleTitle ?? getCurrentRoleTitle(state.current) ?? 'Связь опыта и требований роли';
  return (
    <header className="career-role-assessment-header">
      <button
        type="button"
        className="career-role-assessment-back"
        onClick={onClose}
        aria-label="Назад к профилю"
      >
        <ArrowLeft size={20} aria-hidden="true" />
      </button>
      <div>
        <p className="career-role-assessment-kicker">Профиль · проверка по вакансии</p>
        <h1>Проверка навыков</h1>
        <p className="career-role-assessment-subtitle">
          {roleTitle}
          {run ? ' · около 20 минут: короткий диалог и три практических кейса.' : ''}
        </p>
      </div>
      {run ? (
        <span className="career-role-assessment-save">
          <CheckCircle size={16} aria-hidden="true" /> Прогресс сохраняется
        </span>
      ) : null}
    </header>
  );
}

function AssessmentStateContent({
  state,
  run,
  activeCase,
  actions,
  answerRef,
  onOpenOpportunities,
}: AssessmentContentProps) {
  if (state.loading) return <LoadingState />;
  if (!state.current)
    return <ErrorState message={state.error} onRetry={() => void actions.loadCurrent()} />;
  if (state.error) {
    const onRetry = run?.status === 'model_error' ? actions.retryModel : actions.loadCurrent;
    return <InlineError message={state.error} onRetry={() => void onRetry()} />;
  }
  return (
    <LoadedAssessmentContent
      {...{ state, run, activeCase, actions, answerRef, onOpenOpportunities }}
    />
  );
}

interface AssessmentContentProps {
  state: RoleSkillAssessmentUiState;
  run: ReturnType<typeof getAssessmentRun>;
  activeCase: ReturnType<typeof getActiveAssessmentCase>;
  actions: RoleSkillAssessmentActions;
  answerRef: RefObject<HTMLTextAreaElement>;
  onOpenOpportunities: () => void;
}

function LoadedAssessmentContent(props: AssessmentContentProps) {
  const { state, actions, run, onOpenOpportunities } = props;
  const emptyState = renderEmptyContext(state, onOpenOpportunities, actions);
  if (emptyState) return emptyState;
  if (state.current?.state === 'ready') {
    return (
      <div className="career-role-assessment-start">
        <StartState
          current={state.current}
          consent={state.consent}
          busy={state.busy}
          howItWorksOpen={state.howItWorksOpen}
          onToggleHowItWorks={() => actions.patch({ howItWorksOpen: !state.howItWorksOpen })}
          onConsent={(consent) => actions.patch({ consent })}
          onStart={() => void actions.start()}
        />
        <SkillOverview current={state.current} />
      </div>
    );
  }
  if (!run)
    return (
      <ErrorState
        message="Состояние проверки не найдено."
        onRetry={() => void actions.loadCurrent()}
      />
    );
  return <AssessmentRunContent {...props} run={run} />;
}

function renderEmptyContext(
  state: RoleSkillAssessmentUiState,
  onOpenOpportunities: () => void,
  actions: RoleSkillAssessmentActions,
) {
  const current = state.current;
  if (
    !current ||
    current.state === 'ready' ||
    current.state === 'run' ||
    current.state === 'result'
  )
    return null;
  if (current.state === 'role_not_selected')
    return <NoRoleState onOpenOpportunities={onOpenOpportunities} />;
  if (current.state === 'source_unavailable')
    return <SourceErrorState onRetry={() => void actions.loadCurrent()} />;
  if (current.state === 'too_few_vacancies')
    return <TooFewVacanciesState current={current} onOpenOpportunities={onOpenOpportunities} />;
  if (current.state === 'insufficient_requirements')
    return (
      <InsufficientRequirementsState current={current} onOpenOpportunities={onOpenOpportunities} />
    );
  return (
    <RoleChangedState roleTitle={current.run.roleTitle} onOpenOpportunities={onOpenOpportunities} />
  );
}

function AssessmentRunContent({
  state,
  run,
  activeCase,
  actions,
  answerRef,
  onOpenOpportunities,
}: AssessmentContentProps & { run: NonNullable<AssessmentContentProps['run']> }) {
  if (run.status === 'model_error')
    return (
      <ModelErrorState run={run} busy={state.busy} onRetry={() => void actions.retryModel()} />
    );
  if (run.status === 'dialogue')
    return (
      <DialogueState
        run={run}
        question={run.dialogueQuestions[run.currentDialogueIndex] ?? 'Ответы сохранены.'}
        answer={state.dialogueAnswer}
        busy={state.busy}
        onChange={(dialogueAnswer) => actions.patch({ dialogueAnswer })}
        onSubmit={() => void actions.submitDialogue(state.dialogueAnswer)}
        onVoiceSubmit={(answer) => actions.submitDialogue(answer)}
        inputRef={answerRef}
      />
    );
  if (run.status === 'suggestions')
    return <SuggestionsContent state={state} run={run} actions={actions} />;
  if (run.status === 'cases' && activeCase)
    return <CurrentCaseContent {...{ state, run, activeCase, actions, answerRef }} />;
  return (
    <CompletedAssessmentContent
      {...{ state, run, activeCase, actions, answerRef, onOpenOpportunities }}
    />
  );
}

function CurrentCaseContent({
  state,
  run,
  activeCase,
  actions,
  answerRef,
}: Omit<AssessmentContentProps, 'onOpenOpportunities'> & {
  run: NonNullable<AssessmentContentProps['run']>;
  activeCase: NonNullable<AssessmentContentProps['activeCase']>;
}) {
  return (
    <>
      <RoleSkillAssessmentProfileChange
        change={run.profileChange}
        busy={state.busy}
        onRollback={() => actions.rollbackSuggestions()}
      />
      <CaseAssessmentContent
        state={state}
        run={run}
        activeCase={activeCase}
        actions={actions}
        answerRef={answerRef}
      />
    </>
  );
}

function SuggestionsContent({
  state,
  run,
  actions,
}: {
  state: RoleSkillAssessmentUiState;
  run: NonNullable<AssessmentContentProps['run']>;
  actions: RoleSkillAssessmentActions;
}) {
  return (
    <SuggestionsState
      run={run}
      drafts={state.suggestionDrafts}
      busy={state.busy}
      onDrafts={(next) => updateSuggestions(state, actions, next)}
      onSetAll={(accepted) => actions.chooseAllSuggestions(accepted)}
      onAcceptAll={() => void actions.saveSuggestions(true)}
      onSave={() => void actions.saveSuggestions()}
    />
  );
}

function updateSuggestions(
  state: RoleSkillAssessmentUiState,
  actions: RoleSkillAssessmentActions,
  next: SetStateAction<RoleSkillAssessmentUiState['suggestionDrafts']>,
): void {
  actions.patch({
    suggestionDrafts: typeof next === 'function' ? next(state.suggestionDrafts) : next,
  });
}

function CaseAssessmentContent({
  state,
  run,
  activeCase,
  actions,
  answerRef,
}: Omit<AssessmentContentProps, 'onOpenOpportunities'> & {
  run: NonNullable<AssessmentContentProps['run']>;
  activeCase: NonNullable<AssessmentContentProps['activeCase']>;
}) {
  return (
    <CaseState
      run={run}
      activeCase={activeCase}
      answer={state.caseAnswer}
      dirty={state.caseDraftDirty}
      editing={state.caseEditing}
      discussionOpen={state.discussionOpen}
      discussionQuestion={state.discussionQuestion}
      appealOpen={state.appealOpen}
      appealReason={state.appealReason}
      busy={state.busy}
      onAnswerChange={(answer) => actions.changeCaseAnswer(answer)}
      onSubmitCase={() => void actions.submitCase()}
      onVoiceSubmit={(answer) => actions.submitCase(answer)}
      onSkip={() => void actions.skipCase()}
      onEdit={() => actions.patch({ caseEditing: true })}
      onCancelEdit={() =>
        actions.patch({ caseAnswer: activeCase.answer ?? '', caseEditing: false })
      }
      onContinue={() => actions.focusCase()}
      onCloseReview={() => actions.focusCase()}
      onDiscussionOpen={() => actions.patch({ discussionOpen: !state.discussionOpen })}
      onDiscussionChange={(discussionQuestion) => actions.patch({ discussionQuestion })}
      onDiscuss={submitDiscussion(state, actions)}
      onAppealOpen={() => actions.patch({ appealOpen: !state.appealOpen })}
      onAppealChange={(appealReason) => actions.patch({ appealReason })}
      onAppeal={submitAppeal(state, actions)}
      inputRef={answerRef}
    />
  );
}

function submitDiscussion(state: RoleSkillAssessmentUiState, actions: RoleSkillAssessmentActions) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void actions.discussCase(state.discussionQuestion);
  };
}

function submitAppeal(state: RoleSkillAssessmentUiState, actions: RoleSkillAssessmentActions) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void actions.appealCase(state.appealReason);
  };
}

function CompletedAssessmentContent({
  state,
  run,
  activeCase,
  actions,
  answerRef,
  onOpenOpportunities,
}: AssessmentContentProps & { run: NonNullable<AssessmentContentProps['run']> }) {
  return (
    <>
      <RoleSkillAssessmentProfileChange
        change={run.profileChange}
        busy={state.busy}
        onRollback={() => actions.rollbackSuggestions()}
      />
      <ResultState
        run={run}
        stale={Boolean(state.current?.state === 'result' && state.current.stale)}
        consent={state.consent}
        busy={state.busy}
        reviewingCase={Boolean(state.focusedCaseId)}
        onConsent={(consent) => actions.patch({ consent })}
        onRefresh={() => void actions.start()}
        onOpenOpportunities={onOpenOpportunities}
        onReviewCase={(caseId) => actions.focusCase(caseId)}
      />
      {state.focusedCaseId && activeCase ? (
        <CaseAssessmentContent
          state={state}
          run={run}
          activeCase={activeCase}
          actions={actions}
          answerRef={answerRef}
        />
      ) : null}
    </>
  );
}

function getCurrentRoleTitle(current: RoleSkillAssessmentUiState['current']): string | undefined {
  return current && 'roleTitle' in current ? current.roleTitle : undefined;
}
