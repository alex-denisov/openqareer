import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { hhVacancyIdFromUrl } from '../../../../shared/hhCandidateSession';
import { listApplications, type ApplicationView } from '../../applications/applicationsApi';
import { fetchTariffQuotas, type TariffQuotaStatus } from '../../tariffs/tariffQuotaApi';
import { useVacancyDetail } from '../../vacancies/vacancyDetailApi';
import {
  useVacancyLetterController,
  type LetterScreenState,
} from '../../vacancies/vacancyLetterController';
import type { ResumeDocument } from '../../resume/resumeTypes';
import { isTauriEnvironment } from '../../../services/desktop/desktopBridge';
import { Button, Icon, Link, StatusLine, useIsMobile } from '../kit';
import { useAsync, type AsyncState } from '../responses/data/useAsync';
import { buildNodePath } from '../routes';
import { vacancyName } from '../shell/vacancyNames';
import { CtxHead } from '../shell/CtxHead';
import { useScreenChrome, useShell } from '../shell/ShellContext';
import { FormStep, useQuestionnaire, type QuestionnaireState } from './FormStep';
import { LetterStep } from './LetterStep';
import { useVisibilityQuestion, type VisibilityState } from './visibilityQuestion';
import type { HhSendStepProps } from './hh/HhSendStep';
import { copyText, hhAnswers, readiness } from './model/formModel';
import {
  stepsFor,
  applyRoute,
  buildHead,
  needsPoolRoute,
  parseStep,
  resolveTarget,
  stepOpening,
  UNKNOWN_VACANCY_TITLE,
  type ApplyHead,
  type ApplyStep,
  type ApplyTarget,
} from './model/applyModel';
import { QuotaBlock } from './QuotaBlock';
import { ResumeDates } from './ResumeDates';
import { ResumeStep } from './ResumeStep';
import { HhResumeStep } from './hh/HhResumeStep';
import { approvedLabel, NeedsLetter, SendStep } from './SendStep';
import { useLetterVariants, type LetterVariantsState } from './useLetterVariants';
import { openExistingFirst, useSentElsewhere } from './existingResponse';
import { useApplyCluster } from './useApplyCluster';
import { Pending, useOpenedName } from './ApplyPending';
import { VacancyColumn, VacancyText } from './VacancyColumn';
import { AtsSendStep } from './ats/AtsSendStep';
import { canSendAts, type AtsApplyControls } from './ats/useAtsApply';
import { useAtsFlow, type AtsFlow } from './ats/useAtsFlow';
import { ManualSendStep } from './ManualSendStep';
import { useManualApply, type ManualApplyFlow, type QueueManual } from './useManualApply';
import { useApprovalHold, useVariantApproval } from './useVariantApproval';

const COLD_CIRCLE = 3;

interface TabsProps {
  readonly step: ApplyStep;
  readonly done: Readonly<Record<ApplyStep, boolean>>;
  readonly hasForm: boolean;
  readonly onStep: (step: ApplyStep) => void;
}

/** Шаги отклика (вкладки макета): пройденный шаг отмечен галочкой. */
function StepTabs({ step, done, hasForm, onStep }: TabsProps) {
  const { path } = useShell();
  return (
    <nav className="tabs sec-tabs r6-steps resp-tabs" aria-label="Отклик">
      <div className="sec-tabs-in">
        {stepsFor(hasForm).map((item) => (
          <a
            key={item.id}
            href={`${path}?step=${item.id}`}
            aria-current={item.id === step ? 'page' : undefined}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              onStep(item.id);
            }}
          >
            {done[item.id] && item.id !== step ? <Icon name="check" /> : null}
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

interface FlowProps {
  readonly target: ApplyTarget;
  /** Отклик из очереди «отправить вручную» (B787). */
  readonly manual: ManualApplyFlow | null;
  readonly queue: QueueManual;
  readonly declined: boolean;
  readonly held: boolean;
  readonly press: () => void;
  readonly cluster: ApplyCluster;
}

type ApplyCluster =
  | (NonNullable<Parameters<typeof buildHead>[0]['cluster']> & {
      readonly descriptionSummary?: string;
    })
  | null;

const textsOf = ({ target, cluster }: Pick<FlowProps, 'target' | 'cluster'>) => [
  cluster?.descriptionSummary,
  target.application?.vacancy?.description,
];

interface SendAsk {
  /** o04: отправка открыта кнопкой «Отправить отклик с анкетой». */
  readonly askNow: boolean;
  readonly onAsked: () => void;
  readonly sendWithForm: () => void;
  readonly visibility: VisibilityState;
}

interface BodyProps {
  readonly onLetterSend: () => void;
  readonly vacancyId: string;
  /** Описания вакансии из прочитанных записей: на случай, если полного текста нет. */
  readonly texts: readonly (string | null | undefined)[];
  readonly head: ApplyHead;
  readonly sourceType: string;
  readonly step: ApplyStep;
  readonly setStep: (step: ApplyStep) => void;
  readonly letter: LetterScreenState;
  readonly variants: LetterVariantsState;
  /** Ответы анкеты одним текстом для вставки на площадке; пусто — анкеты нет. */
  readonly answers: string;
  readonly hhForm: HhSendStepProps['form'];
  readonly onHhForm: HhSendStepProps['onForm'];
  readonly ask: SendAsk;
  readonly resumeOk: boolean;
  /** Шаг «Резюме» уже открывали: его содержимое держим смонтированным. */
  readonly resumeSeen: boolean;
  readonly onResumeOk: () => void;
  readonly manual: ManualApplyFlow | null;
  readonly ats: AtsFlow;
  readonly questionnaire: QuestionnaireState;
}

/** Сайт работодателя в приложении: форма уходит одним нажатием (B787). */
function AtsSendBody({
  body,
  apply,
}: {
  readonly body: BodyProps;
  readonly apply: AtsApplyControls;
}) {
  const { letter, setStep, head, hhForm, ask, ats } = body;
  const approved = letter.approval.saved;
  const { askNow, onAsked } = ask;
  // Анкета открывает «Отправку»: работодатель и все ответы видны до нажатия.
  useEffect(() => {
    if (askNow) onAsked();
  }, [askNow, onAsked]);
  return (
    <>
      <div className="col">
        {approved ? (
          <AtsSendStep
            apply={apply}
            url={head.url}
            employer={head.company}
            applicationId={approved.applicationId}
            approvedLabel={approvedLabel(approved.approvedAt)}
            letterText={letter.draft.text}
            hasResume={Boolean(approved.resume)}
            answered={hhForm?.answered ?? 0}
            onSent={ats.onSent}
            onStep={setStep}
          />
        ) : (
          <NeedsLetter onLetter={() => setStep('letter')} />
        )}
      </div>
      <div className="col" />
    </>
  );
}

function ManualSendBody({
  body,
  manual,
}: {
  readonly body: BodyProps;
  readonly manual: ManualApplyFlow;
}) {
  return (
    <>
      <div className="col">
        <ManualSendStep
          manual={manual}
          letterText={body.letter.draft.text}
          letterStale={body.letter.approval.stale === true}
          letterLoading={body.letter.draft.loading}
          resume={body.letter.approval.saved?.resume ?? null}
          questionnaire={body.questionnaire}
          onStep={body.setStep}
        />
      </div>
      <div className="col" />
    </>
  );
}

function SendBody(props: BodyProps) {
  const { vacancyId, head, sourceType, setStep, letter, answers, hhForm, onHhForm, ask, manual } =
    props;
  // hh.ru в приложении уходит из входа кандидата: там же и вход, и проверка.
  const inApp = isTauriEnvironment() && Boolean(head.url && hhVacancyIdFromUrl(head.url));
  if (manual && !inApp) {
    return <ManualSendBody body={props} manual={manual} />;
  }
  const { apply, queuing } = props.ats;
  if (apply) return <AtsSendBody body={props} apply={apply} />;
  if (queuing) return <LoadingApply />;
  return (
    <>
      <div className="col">
        <SendStep
          vacancyId={vacancyId}
          head={head}
          sourceType={sourceType}
          approved={letter.approval.saved}
          letterText={letter.draft.text}
          answersText={answers}
          form={hhForm}
          onForm={onHhForm}
          askNow={ask.askNow}
          onAsked={ask.onAsked}
          onLetter={() => setStep('letter')}
        />
      </div>
      <div className="col" />
    </>
  );
}

function EditorBody(props: BodyProps) {
  const { vacancyId, head, step, letter, variants, resumeOk, resumeSeen } = props;
  const [document, setDocument] = useState<ResumeDocument | null>(null);
  const [dock, setDock] = useState<HTMLElement | null>(null);
  const mobile = useIsMobile();
  const onHh = Boolean(head.url && hhVacancyIdFromUrl(head.url));
  return (
    <>
      <VacancyColumn head={head} fallbacks={props.texts}>
        {step === 'resume' ? <ResumeDates document={document} /> : null}
      </VacancyColumn>
      <div className="col">
        {/* Резюме собирается один раз и остаётся при переходе между шагами. */}
        {onHh && step === 'resume' ? (
          <HhResumeStep
            vacancyId={vacancyId}
            confirmed={resumeOk}
            onConfirm={props.onResumeOk}
            dock={dock}
          />
        ) : null}
        {!onHh && resumeSeen ? (
          <div hidden={step !== 'resume'}>
            <ResumeStep
              vacancyId={vacancyId}
              approved={letter.approval.saved?.resume ?? null}
              confirmed={resumeOk}
              onConfirm={props.onResumeOk}
              dock={dock}
              onDocument={setDocument}
            />
          </div>
        ) : null}
        <div hidden={step !== 'letter'}>
          <LetterStep
            letter={letter}
            variants={variants}
            head={head}
            onSend={props.onLetterSend}
          />
        </div>
      </div>
      {step === 'resume' && !mobile ? (
        <div className="act-dock is-auto cv-dock" ref={setDock} />
      ) : null}
    </>
  );
}

/** Закончились ли отклики тарифа: письмо не собралось и остаток равен нулю. */
function useExhaustedQuota(letter: LetterScreenState): TariffQuotaStatus | null {
  const load = useCallback(() => fetchTariffQuotas(), []);
  const quotas = useAsync(load, '').state.data;
  if (!quotas || quotas.unlimited || letter.approval.saved || !letter.draft.error) return null;
  const quota = quotas.quotas.find((item) => item.key === 'applications');
  return quota && quota.remaining === 0 ? quota : null;
}

interface FlowHeadProps {
  readonly head: ApplyHead;
  readonly applicationId: string | null;
}

/** Шапка контекста: над какой вакансией идёт работа. */
function FlowHead({ head, applicationId }: FlowHeadProps) {
  const opened = useOpenedName();
  return (
    <CtxHead
      kind="Отклик"
      title={opened ?? vacancyName(head)}
      meta={head.source ? [head.source] : undefined}
      open={
        applicationId
          ? { path: buildNodePath('o01c', { responseId: applicationId }), label: 'Открыть: отклик' }
          : undefined
      }
    />
  );
}

interface FlowState {
  readonly shown: ApplyStep;
  readonly setStep: (step: ApplyStep) => void;
  readonly head: ApplyHead;
  readonly body: BodyProps;
  readonly quota: TariffQuotaStatus | null;
  readonly questionnaire: QuestionnaireState;
  readonly done: Readonly<Record<ApplyStep, boolean>>;
  /** Ещё не известно, что показать на шаге: читается одобрение письма или анкета из адреса. */
  readonly opening: boolean;
  /** Шаг ещё открывается, но текст вакансии уже слева. */
  readonly textFirst: boolean;
  /** Два окна: вакансия и редактор. */
  readonly wide: boolean;
}

/** Письмо отклика: черновик, варианты и одобрение. */
function useApplyLetter(vacancyId: string) {
  // Одобренное письмо открывается своим текстом: черновик не просим, пока одобрение не снято.
  const approvalHold = useApprovalHold(vacancyId);
  const draft = useVacancyLetterController(vacancyId, COLD_CIRCLE, {
    holdDraft: approvalHold.hold,
  });
  const variants = useLetterVariants(vacancyId, draft);
  const letter = useVariantApproval(vacancyId, draft, variants, approvalHold);
  // B678: до чтения одобрения шаг не показывает ни «Сначала одобрите», ни «Собираем письмо».
  // Письмо с опровергнутыми фактами уже прочитано, хотя одобрения у него больше нет.
  const known = Boolean(letter.approval.saved) || letter.approval.stale === true;
  return { letter, variants, approvalPending: approvalHold.hold && !known };
}

/** Анкета для шага «Отправка»: ответы одним текстом и вопросы, прочитанные в окне hh.ru (B641). */
function applyForm(
  questionnaire: QuestionnaireState,
  visibility: VisibilityState,
  setStep: Dispatch<SetStateAction<ApplyStep>>,
): Pick<BodyProps, 'answers' | 'hhForm' | 'onHhForm'> {
  const { form, draft } = questionnaire;
  const answers = form ? copyText(form.questions, draft) : '';
  const ready = form ? readiness(form.questions, draft) : null;
  return {
    answers,
    hhForm: ready
      ? {
          answered: ready.answered,
          complete: ready.missingRequired === 0,
          answersText: answers,
          answers: form ? hhAnswers(form.questions, draft) : [],
          onSubmitted: questionnaire.markSubmitted,
          visibilityAgreed: visibility.agreed,
          askVisibility: () => {
            visibility.ask();
            setStep((now) => (now === 'send' ? 'form' : now));
          },
          open: () => setStep('form'),
        }
      : null,
    // Отклик без анкеты не ушёл: прочитанные вопросы открываются сразу.
    onHhForm: async (hhForm, open) => {
      if ((await questionnaire.takeHhForm(hhForm)) && open) {
        setStep((now) => (now === 'send' ? 'form' : now));
      }
    },
  };
}

/** o04: «Отправить отклик с анкетой» сохраняет ответы и открывает подтверждение отправки. */
function useSendAsk(
  questionnaire: QuestionnaireState,
  setStep: Dispatch<SetStateAction<ApplyStep>>,
  press: () => void,
): SendAsk {
  const [askNow, setAskNow] = useState(false);
  const visibility = useVisibilityQuestion();
  const onAsked = useCallback(() => setAskNow(false), []);
  return {
    askNow,
    onAsked,
    visibility,
    sendWithForm: () => {
      press();
      questionnaire.save();
      setAskNow(true);
      setStep('send');
    },
  };
}

/** Вопросы очереди читаются в фоне: после сбора экран берёт их сразу (B787). */
function useQueuedQuestions(
  manual: ManualApplyFlow | null,
  { reload }: Pick<QuestionnaireState, 'reload'>,
): void {
  const state = manual?.item.state;
  useEffect(() => {
    if (state && state !== 'preparing') reload();
  }, [state, reload]);
}

function doneSteps(
  resume: boolean,
  letter: LetterScreenState,
  { submitted }: QuestionnaireState,
): FlowState['done'] {
  const form = submitted.kind === 'done';
  return { resume, letter: Boolean(letter.approval.saved), form, send: false };
}

/** Письмо одобрено вместе с резюме: вкладка и сам шаг показывают одно состояние. */
function useResumeStep(
  step: ApplyStep,
  setStep: (step: ApplyStep) => void,
  letter: LetterScreenState,
): Pick<BodyProps, 'resumeOk' | 'resumeSeen' | 'onResumeOk'> {
  const [confirmed, setConfirmed] = useState(false);
  const [resumeSeen, setResumeSeen] = useState(step === 'resume');
  if (step === 'resume' && !resumeSeen) setResumeSeen(true);
  const onResumeOk = () => {
    setConfirmed(true);
    setStep('letter');
  };
  const resumeOk = confirmed || Boolean(letter.approval.saved?.resume);
  return { resumeOk, resumeSeen, onResumeOk };
}

/** Шаг «Анкета» из адреса открывается, когда анкета прочитана; до того — письмо. */
const shownStep = (step: ApplyStep, hasForm: boolean): ApplyStep =>
  step === 'form' && !hasForm ? 'letter' : step;

const withPress = (press: () => void) => (action: () => void) => () => {
  press();
  action();
};

const pressedAts = (ats: AtsFlow, press: () => void): AtsFlow =>
  ats.apply ? { ...ats, apply: { ...ats.apply, send: withPress(press)(ats.apply.send) } } : ats;

/**
 * Название вакансии: из связей по вакансии, а если их нет — из ответа об анкете. Пока оно
 * читается — известное со списка: «Вакансия» не мелькает (B798).
 */
function useNamedHead(sources: Parameters<typeof buildHead>[0]): ApplyHead {
  const read = buildHead(sources);
  const opened = useShell().journey?.vacancy;
  if (!opened || read.title !== UNKNOWN_VACANCY_TITLE) return read;
  return { ...read, title: opened.title, company: read.company || opened.company };
}

/** Состояние единого отклика: шаг, письмо, анкета и остаток откликов. */
function useApplyFlow({ target, cluster, manual, press, ...rest }: FlowProps): FlowState {
  const { search } = useShell();
  const [step, setStep] = useState(() => parseStep(search, manual ? 'send' : 'letter'));
  const { letter, variants, approvalPending } = useApplyLetter(target.vacancyId);
  const quota = useExhaustedQuota(letter);
  const questionnaire = useQuestionnaire(target.vacancyId);
  const ask = useSendAsk(questionnaire, setStep, press);
  useQueuedQuestions(manual, questionnaire);
  const known = letter.circles.data ?? questionnaire.known;
  const head = useNamedHead({ application: target.application, known, cluster });
  const sourceType = applyRoute({ application: target.application, cluster }).source ?? 'manual';
  const ats = useAtsFlow({
    ...{ target, destination: cluster?.applyTarget ?? null, head, sourceType },
    manual: manual?.item ?? null,
    ...rest,
    ...{ step, setStep, letter, questionnaire },
  });
  const shown = shownStep(step, Boolean(questionnaire.form ?? ats.apply));
  const resume = useResumeStep(step, setStep, letter);
  return {
    shown,
    setStep,
    head,
    quota,
    questionnaire,
    opening: stepOpening({ step, approvalPending, formLoading: questionnaire.loading }),
    textFirst: step === 'letter' || step === 'resume',
    wide: shown !== 'send' && shown !== 'form' && !quota,
    done: doneSteps(resume.resumeOk, letter, questionnaire),
    body: {
      vacancyId: target.vacancyId,
      texts: textsOf({ target, cluster }),
      head,
      sourceType,
      step: shown,
      setStep,
      letter,
      variants,
      ask,
      ...applyForm(questionnaire, ask.visibility, setStep),
      // Форма сайта снова читается приложением: очередь показывается, только если она не подошла.
      manual: ats.apply ? null : manual,
      ats: pressedAts(ats, press),
      onLetterSend: withPress(press)(() => setStep('send')),
      questionnaire,
      ...resume,
    },
  };
}

/** Шаг «Анкета»; форма сайта работодателя в приложении сначала читается (B787). */
function FormBody({ body }: { readonly body: BodyProps }) {
  const { questionnaire, ask, ats } = body;
  const kind = ats.apply?.state.kind;
  if (kind === 'reading') return <LoadingApply />;
  if (kind === 'read_failed' && ats.apply) {
    return <LoadFailed text="Анкета не загрузилась" onRetry={ats.apply.retry} />;
  }
  if (!questionnaire.form) return null;
  return (
    <FormStep
      state={questionnaire}
      form={questionnaire.form}
      visibility={ask.visibility}
      rejected={ats.apply ? { host: ats.apply.host, answers: ats.apply.rejected } : undefined}
      viaApp={kind ? (canSendAts(kind) ? 'open' : 'locked') : undefined}
      onSend={ask.sendWithForm}
    />
  );
}

/** Одобрение письма ещё читается: текст вакансии слева уже на месте. */
function OpeningEditor({ body }: { readonly body: BodyProps }) {
  return (
    <>
      <VacancyColumn head={body.head} fallbacks={body.texts} />
      <div className="col">
        <LoadingApply />
      </div>
    </>
  );
}

function ApplyFlow(props: FlowProps) {
  const flow = useApplyFlow(props);
  const { shown, head, quota, questionnaire, opening, body } = flow;
  const wide = flow.wide && (!opening || flow.textFirst);
  const ready = !quota && !opening;
  const form = questionnaire.form;
  // Два окна (вакансия и письмо) включает признак макета `data-main-right`.
  useScreenChrome({
    crumb: head.title,
    ...(shown === 'letter' ? {} : { title: shown === 'resume' ? 'Резюме' : 'Отклик' }),
    rootData: {
      // «Резюме» (o03) и «Отправка» в вебе (o04d) без плотных отступов; письмо, анкета и a01 — с ними.
      ...((shown === 'resume' || (shown === 'send' && !isTauriEnvironment())) && !quota ? {} : { mtight: '1' }),
      ...(wide ? { 'main-right': '1' } : {}),
      // Открытое «Что поменять» на 390 — лист снизу (признак макета `data-vsheet`).
      ...(body.variants.wishOpen ? { vsheet: '1' } : {}),
    },
  });
  return (
    <>
      <StepTabs
        step={shown}
        done={flow.done}
        hasForm={Boolean(form ?? body.ats.apply)}
        onStep={flow.setStep}
      />
      <div
        className={wide ? 'page two split-editor' : 'page two'}
        data-b640-node="o02"
        data-b640-section="apply"
        data-apply-step={shown}
      >
        <FlowHead head={head} applicationId={props.target.application?.id ?? null} />
        {quota ? <QuotaBlock head={head} quota={quota} /> : null}
        {opening && !quota && wide ? <OpeningEditor body={body} /> : null}
        {opening && !quota && !wide ? <LoadingApply /> : null}
        {ready && shown === 'send' ? <SendBody {...body} /> : null}
        {ready && shown === 'form' ? <FormBody body={body} /> : null}
        {ready && shown !== 'send' && shown !== 'form' ? <EditorBody {...body} /> : null}
      </div>
    </>
  );
}

function LoadingApply() {
  return (
    <p className="ls-state" role="status">
      Загружаем отклик…
    </p>
  );
}

function LoadFailed({ text, onRetry }: { readonly text: string; readonly onRetry: () => void }) {
  return (
    <StatusLine
      state="err"
      text={text}
      action={
        <Button size="sm" onClick={onRetry}>
          Повторить
        </Button>
      }
    />
  );
}

/** До отправки: отклик, который кандидат отправляет сам, собран заранее (B787). */
function WithManual({ target, cluster }: Omit<FlowProps, 'manual' | 'queue' | 'declined' | 'held' | 'press'>) {
  const { manual, queue, declined, held, press } = useManualApply(
    target,
    applyRoute({ application: target.application, cluster }).source,
  );
  if (manual === 'loading') {
    return (
      <Pending loading fallbacks={textsOf({ target, cluster })}>
        <LoadingApply />
      </Pending>
    );
  }
  return (
    <ApplyFlow
      target={target}
      cluster={cluster}
      manual={manual}
      queue={queue}
      declined={declined}
      held={held}
      press={press}
    />
  );
}

/**
 * Отклик не отправлен: площадка сверяется с вакансией подбора (B678). Пока она не определена,
 * экран ничего не называет и действий не предлагает: после открытия площадка не меняется.
 */
function FromPool({ target }: { readonly target: ApplyTarget }) {
  const { state, retry } = useApplyCluster(target.vacancyId);
  if (state.status === 'ready') return <WithManual target={target} cluster={state.cluster} />;
  return (
    <Pending
      loading={state.status !== 'failed'}
      fallbacks={textsOf({ target, cluster: null })}
    >
      {state.status === 'failed' ? (
        <LoadFailed text="Отклик не загрузился." onRetry={retry} />
      ) : (
        <LoadingApply />
      )}
    </Pending>
  );
}

async function loadApplications(signal: AbortSignal): Promise<readonly ApplicationView[]> {
  return listApplications(signal);
}

interface ApplyTargetProps {
  readonly state: AsyncState<readonly ApplicationView[]>;
  readonly target: ApplyTarget | null;
  readonly onRetry: () => void;
}

/** Единый экран отклика (O2): резюме, письмо и отправка под одну вакансию. */
export function ApplyScreen({ responseId }: { readonly responseId: string }) {
  useSentElsewhere(responseId);
  const load = useCallback(
    async (signal: AbortSignal) =>
      openExistingFirst(responseId, await loadApplications(signal), signal),
    [responseId],
  );
  const { state, reload } = useAsync(load, 'Отклик не загрузился.');
  const target = state.data ? resolveTarget(responseId, state.data) : null;
  const opened = useShell().journey?.vacancy?.vacancyId;
  const vacancyId = target?.vacancyId ?? (state.data ? undefined : opened) ?? '';
  const text = useVacancyDetail(vacancyId, vacancyId !== '');
  return (
    <VacancyText.Provider value={text}>
      <ApplyTargetScreen state={state} target={target} onRetry={reload} />
    </VacancyText.Provider>
  );
}

function ApplyTargetScreen({ state, target, onRetry }: ApplyTargetProps) {
  if (!state.data) {
    return (
      <Pending loading={state.status !== 'error'}>
        {state.status === 'error' ? (
          <LoadFailed text={state.error} onRetry={onRetry} />
        ) : (
          <LoadingApply />
        )}
      </Pending>
    );
  }
  if (!target) {
    return (
      <Pending>
        <StatusLine
          state="err"
          text="У этого отклика нет вакансии из подбора: письмо собрать не из чего"
          action={
            <Link className="btn is-sm" to={buildNodePath('o01')}>
              К откликам
            </Link>
          }
        />
      </Pending>
    );
  }
  return needsPoolRoute(target.application) ? (
    <FromPool key={target.vacancyId} target={target} />
  ) : (
    <WithManual key={target.vacancyId} target={target} cluster={null} />
  );
}
