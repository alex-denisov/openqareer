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
import type { SkillCheckFocus } from '../vacancies/VacancyQuizProposal';
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
  RunSkillOverview,
  SkillOverview,
  SourceErrorState,
  StartState,
  TooFewVacanciesState,
} from './RoleSkillAssessmentStartViews';
import { RoleSkillAssessmentActions, loadInitialAssessment } from './RoleSkillAssessmentActions';
import {
  FocusInsufficientState,
  FocusStartCard,
  runMatchesFocus,
  SkillCheckFocusNote,
} from './RoleSkillAssessmentFocusViews';
import {
  getActiveAssessmentCase,
  getAssessmentRun,
  initialRoleSkillAssessmentState,
  roleSkillAssessmentReducer,
  type RoleSkillAssessmentUiState,
} from './roleSkillAssessmentState';
import './role-skill-assessment.css';
import './role-skill-assessment-flow.css';

interface RoleSkillAssessmentScreenProps {
  session: AuthUser;
  /** Skills a vacancy's consultant offer asked to confirm (B552). */
  focus?: SkillCheckFocus;
  /** Роль, нажатая на «Карьере»; без неё — роль «Стратегии» (B445). */
  roleTitle?: string;
  onClose: () => void;
  onOpenOpportunities: () => void;
}

export function RoleSkillAssessmentScreen(props: RoleSkillAssessmentScreenProps) {
  const { session, focus, roleTitle, onClose, onOpenOpportunities } = props;
  const [state, dispatch] = useReducer(roleSkillAssessmentReducer, initialRoleSkillAssessmentState);
  const requestRef = useRef<{ key: string; id: string }>();
  const busyRef = useRef(false);
  const draftTimer = useRef<number>();
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const actions = new RoleSkillAssessmentActions(
    state,
    dispatch,
    requestRef,
    busyRef,
    roleTitle,
    focus,
  );
  const actionsRef = useLatestRef(actions);
  const run = getAssessmentRun(state.current);
  const activeCase = getActiveAssessmentCase(state.current, state.focusedCaseId);
  const screenKey = getAssessmentScreenKey(state, run);

  useAssessmentLifecycle(
    session.candidateId,
    roleTitle,
    state,
    dispatch,
    actionsRef,
    draftTimer,
    run,
    activeCase,
  );
  useScrollTopOn(screenKey);

  return (
    <section className="career-role-assessment" data-testid="role-skill-assessment">
      <AssessmentHeader {...{ state, run, actions, onClose }} fromCareer={Boolean(roleTitle)} />
      {focus ? <SkillCheckFocusNote focus={focus} run={run} /> : null}
      <AssessmentProgress state={state} run={run} />
      <AssessmentBody
        state={state}
        run={run}
        activeCase={activeCase}
        actions={actions}
        answerRef={answerRef}
        onClose={onClose}
        onOpenOpportunities={onOpenOpportunities}
        focus={focus}
      />
    </section>
  );
}

function AssessmentProgress({
  state,
  run,
}: Pick<AssessmentContentProps, 'state' | 'run'>) {
  if (run) return <ProgressTrack step={getProgressStep(run)} caseCount={run.cases.length} />;
  return state.current?.state === 'ready' ? <ProgressTrack step={1} /> : null;
}

/** Each new step of the check starts at the top of the page. */
function useScrollTopOn(screenKey: string) {
  useEffect(() => {
    document.querySelector<HTMLElement>('.career-main')?.scrollTo(0, 0);
  }, [screenKey]);
}

function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function getAssessmentScreenKey(
  state: RoleSkillAssessmentUiState,
  run: ReturnType<typeof getAssessmentRun>,
): string {
  const caseIndex = run?.status === 'cases' ? run.currentCaseIndex : '';
  return [
    run?.id ?? 'new',
    run?.status ?? state.current?.state ?? 'loading',
    caseIndex,
    state.focusedCaseId ?? '',
    state.focusedSkillId ?? '',
    state.skillOverviewOpen ? 'skills' : '',
  ].join('|');
}

function useAssessmentLifecycle(
  candidateId: string | null,
  roleTitle: string | undefined,
  state: RoleSkillAssessmentUiState,
  dispatch: Dispatch<Parameters<typeof roleSkillAssessmentReducer>[1]>,
  actionsRef: MutableRefObject<RoleSkillAssessmentActions>,
  draftTimer: MutableRefObject<number | undefined>,
  run: ReturnType<typeof getAssessmentRun>,
  activeCase: ReturnType<typeof getActiveAssessmentCase>,
): void {
  useEffect(() => {
    void loadInitialAssessment(dispatch, roleTitle);
  }, [candidateId, roleTitle, dispatch]);
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
  actions,
  onClose,
  fromCareer,
}: {
  state: RoleSkillAssessmentUiState;
  run: ReturnType<typeof getAssessmentRun>;
  actions: RoleSkillAssessmentActions;
  onClose: () => void;
  /** Проверка открыта с «Карьеры»: «Назад» ведёт туда, а не в профиль (B445). */
  fromCareer: boolean;
}) {
  const details = getAssessmentHeaderDetails(state, run, fromCareer);
  const back = () => handleAssessmentHeaderBack(actions, onClose, details.backTarget);
  return (
    <header className="career-role-assessment-header">
      <button
        type="button"
        className="career-role-assessment-back"
        onClick={back}
        aria-label={details.backLabel}
      >
        <ArrowLeft size={20} aria-hidden="true" />
      </button>
      <div>
        <p className="career-role-assessment-kicker">
          {fromCareer ? 'Карьера · проверка роли' : 'Профиль · проверка по вакансии'}
        </p>
        <h1>{details.title}</h1>
        <p className="career-role-assessment-subtitle">{details.subtitle}</p>
      </div>
      {run ? (
        <span className="career-role-assessment-save">
          <CheckCircle size={16} aria-hidden="true" /> Прогресс сохраняется
        </span>
      ) : null}
    </header>
  );
}

interface AssessmentHeaderDetails {
  title: string;
  subtitle: string;
  backLabel: string;
  backTarget: 'skill' | 'case' | 'overview' | 'close';
}

function getAssessmentHeaderDetails(
  state: RoleSkillAssessmentUiState,
  run: ReturnType<typeof getAssessmentRun>,
  fromCareer = false,
): AssessmentHeaderDetails {
  const roleTitle =
    run?.roleTitle ?? getCurrentRoleTitle(state.current) ?? 'Связь опыта и требований роли';
  const selectedSkill = run?.skills.find((skill) => skill.id === state.focusedSkillId);
  const selectedCase =
    run?.status === 'complete'
      ? run.cases.find((record) => record.assessmentCase.id === state.focusedCaseId)
      : undefined;
  const detailTitle = selectedSkill?.name ?? selectedCase?.assessmentCase.skillName;
  const title = detailTitle ?? (state.skillOverviewOpen ? 'Что проверяем' : 'Проверка навыков');
  const backTarget = selectedSkill
    ? 'skill'
    : selectedCase
      ? 'case'
      : state.skillOverviewOpen
        ? 'overview'
        : 'close';
  return {
    title,
    subtitle: buildAssessmentHeaderSubtitle(run, roleTitle, detailTitle, state.skillOverviewOpen),
    backLabel: detailTitle
      ? 'Назад к итогу'
      : state.skillOverviewOpen
        ? 'Назад к диалогу'
        : fromCareer
          ? 'Назад к карьере'
          : 'Назад к профилю',
    backTarget,
  };
}

function buildAssessmentHeaderSubtitle(
  run: ReturnType<typeof getAssessmentRun>,
  roleTitle: string,
  detailTitle: string | undefined,
  overviewOpen: boolean,
): string {
  if (detailTitle) return 'Оценка по критериям кейса';
  const context = overviewOpen ? `${roleTitle} · данные из выборки вакансий` : roleTitle;
  return run && !overviewOpen
    ? `${context} · около 20 минут: короткий диалог и ${caseCountText(run.cases.length)}.`
    : context;
}

function caseCountText(count: number): string {
  if (count === 1) return 'один практический кейс';
  if (count === 2) return 'два практических кейса';
  return 'три практических кейса';
}

function handleAssessmentHeaderBack(
  actions: RoleSkillAssessmentActions,
  onClose: () => void,
  target: AssessmentHeaderDetails['backTarget'],
): void {
  if (target === 'skill') actions.focusSkill();
  else if (target === 'case') actions.focusCase();
  else if (target === 'overview') actions.patch({ skillOverviewOpen: false });
  else onClose();
}

function AssessmentBody(props: AssessmentContentProps) {
  const content = <AssessmentStateContent {...props} />;
  if (props.run && !props.state.skillOverviewOpen) {
    return (
      <div className="career-role-assessment-flow-grid">
        <div>{content}</div>
        <aside className="career-role-assessment-flow-side">
          <RunSkillOverview run={props.run} />
        </aside>
      </div>
    );
  }
  return content;
}

function AssessmentStateContent({
  state,
  run,
  activeCase,
  actions,
  answerRef,
  onClose,
  onOpenOpportunities,
  focus,
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
      {...{ state, run, activeCase, actions, answerRef, onClose, onOpenOpportunities, focus }}
    />
  );
}

interface AssessmentContentProps {
  state: RoleSkillAssessmentUiState;
  run: ReturnType<typeof getAssessmentRun>;
  activeCase: ReturnType<typeof getActiveAssessmentCase>;
  actions: RoleSkillAssessmentActions;
  answerRef: RefObject<HTMLTextAreaElement>;
  onClose: () => void;
  onOpenOpportunities: () => void;
  focus?: SkillCheckFocus;
}

/** B552: the offer's skills take over a screen that holds another check. */
function renderFocusStart(props: AssessmentContentProps) {
  const { state, actions, run, focus, onClose } = props;
  if (!focus) return null;
  if (state.current?.state === 'focus_insufficient')
    return <FocusInsufficientState current={state.current} onClose={onClose} />;
  const otherCheck =
    state.current?.state === 'run' ||
    state.current?.state === 'result' ||
    state.current?.state === 'role_changed';
  // G5 R1b: a thin role sample stops the role check, not the check of the vacancy's skills.
  const thinRole =
    state.current?.state === 'too_few_vacancies' ||
    state.current?.state === 'insufficient_requirements';
  if (!thinRole && (!otherCheck || runMatchesFocus(run, focus))) return null;
  return (
    <FocusStartCard
      focus={focus}
      consent={state.consent}
      busy={state.busy}
      onConsent={(consent) => actions.patch({ consent })}
      onStart={() => void actions.start()}
      onLater={onClose}
    />
  );
}

function LoadedAssessmentContent(props: AssessmentContentProps) {
  const { state, actions, run, onOpenOpportunities, onClose } = props;
  const focusStart = renderFocusStart(props);
  if (focusStart) return focusStart;
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
          onLater={onClose}
        />
        <SkillOverview current={state.current} />
      </div>
    );
  }
  if (run && state.skillOverviewOpen) {
    return <RunSkillOverview run={run} page />;
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
  if (current.state === 'focus_insufficient')
    return (
      <ErrorState
        message="Проверка по навыкам вакансии недоступна."
        onRetry={() => void actions.loadCurrent()}
      />
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
  onClose,
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
        onShowSkills={() => actions.patch({ skillOverviewOpen: true })}
        inputRef={answerRef}
      />
    );
  if (run.status === 'suggestions')
    return <SuggestionsContent state={state} run={run} actions={actions} />;
  if (run.status === 'cases' && activeCase)
    return <CurrentCaseContent {...{ state, run, activeCase, actions, answerRef }} />;
  return (
    <CompletedAssessmentContent
      {...{ state, run, activeCase, actions, answerRef, onClose, onOpenOpportunities }}
    />
  );
}

type CaseContentProps = Pick<
  AssessmentContentProps,
  'state' | 'run' | 'activeCase' | 'actions' | 'answerRef'
> & {
  run: NonNullable<AssessmentContentProps['run']>;
  activeCase: NonNullable<AssessmentContentProps['activeCase']>;
};

function CurrentCaseContent({ state, run, activeCase, actions, answerRef }: CaseContentProps) {
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

function CaseAssessmentContent({ state, run, activeCase, actions, answerRef }: CaseContentProps) {
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
  onClose,
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
        focusedSkillId={state.focusedSkillId}
        onConsent={(consent) => actions.patch({ consent })}
        onRefresh={() => void actions.start()}
        onOpenOpportunities={onOpenOpportunities}
        onOpenRoles={onClose}
        onSelectSkill={(skillId) => actions.focusSkill(skillId)}
        onReviewCase={(caseId, mode) => openResultCase(actions, caseId, mode)}
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

function openResultCase(
  actions: RoleSkillAssessmentActions,
  caseId: string,
  mode: 'view' | 'edit' | 'appeal' = 'view',
): void {
  actions.focusCase(caseId);
  actions.patch({ caseEditing: mode === 'edit', appealOpen: mode === 'appeal' });
}

function getCurrentRoleTitle(current: RoleSkillAssessmentUiState['current']): string | undefined {
  return current && 'roleTitle' in current ? current.roleTitle : undefined;
}
