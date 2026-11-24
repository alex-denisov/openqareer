import { useCallback, useState, type ReactNode } from 'react';
import { listApplications, type ApplicationView } from '../../applications/applicationsApi';
import { fetchTariffQuotas, type TariffQuotaStatus } from '../../tariffs/tariffQuotaApi';
import { useMatchedPool } from '../../vacancies/useMatchedPool';
import { useVacancyDetail } from '../../vacancies/vacancyDetailApi';
import {
  useVacancyLetterController,
  type LetterScreenState,
} from '../../vacancies/vacancyLetterController';
import { Button, Icon, InfoTip, Link, StatusLine } from '../kit';
import { useAsync } from '../responses/data/useAsync';
import { buildNodePath } from '../routes';
import { CtxHead } from '../shell/CtxHead';
import { useScreenChrome, useShell } from '../shell/ShellContext';
import { FormStep, useQuestionnaire, type QuestionnaireState } from './FormStep';
import { LetterStep } from './LetterStep';
import { copyText } from './model/formModel';
import {
  stepsFor,
  applyRoute,
  buildHead,
  needsPoolRoute,
  paragraphs,
  parseStep,
  resolveTarget,
  type ApplyHead,
  type ApplyStep,
  type ApplyTarget,
} from './model/applyModel';
import { QuotaBlock } from './QuotaBlock';
import { ResumeStep } from './ResumeStep';
import { SendStep } from './SendStep';
import { useLetterVariants, type LetterVariantsState } from './useLetterVariants';
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

/** Левая колонка: текст вакансии, под которую идёт отклик. */
function VacancyColumn({
  vacancyId,
  head,
}: {
  readonly vacancyId: string;
  readonly head: ApplyHead;
}) {
  const detail = useVacancyDetail(vacancyId, true);
  const text =
    detail.status === 'ready' ? detail.detail.description || detail.detail.summary || '' : '';
  return (
    <div className="col vac-col">
      <section className="mod" aria-labelledby="vp-title">
        <div className="lead-head">
          <h3 className="mod-title" id="vp-title">
            {head.title}
          </h3>
          {head.source ? (
            <InfoTip label="Источник" text={`Текст вакансии: ${head.source}.`} />
          ) : null}
        </div>
        {detail.status === 'loading' || detail.status === 'idle' ? (
          <p className="ls-state" role="status">
            Загружаем текст вакансии…
          </p>
        ) : null}
        {detail.status === 'failed' ? (
          <StatusLine state="err" text="Текст вакансии не загрузился" />
        ) : null}
        {text ? (
          // B645: длинный текст прокручивается внутри карточки и не растягивает страницу.
          <div
            className="letter full vac-text"
            role="region"
            aria-label="Текст вакансии"
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Фокус нужен для прокрутки текста с клавиатуры.
            tabIndex={0}
          >
            {paragraphs(text).map((line, index) => (
              <div key={`${index}-${line.slice(0, 24)}`}>{line}</div>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

interface FlowProps {
  readonly target: ApplyTarget;
  readonly cluster: Parameters<typeof buildHead>[0]['cluster'];
}

interface BodyProps {
  readonly vacancyId: string;
  readonly head: ApplyHead;
  readonly sourceType: string;
  readonly step: ApplyStep;
  readonly setStep: (step: ApplyStep) => void;
  readonly letter: LetterScreenState;
  readonly variants: LetterVariantsState;
  /** Ответы анкеты одним текстом для вставки на площадке; пусто — анкеты нет. */
  readonly answers: string;
  readonly resumeOk: boolean;
  /** Шаг «Резюме» уже открывали: его содержимое держим смонтированным. */
  readonly resumeSeen: boolean;
  readonly onResumeOk: () => void;
}

function SendBody({ vacancyId, head, sourceType, setStep, letter, answers }: BodyProps) {
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
          onLetter={() => setStep('letter')}
        />
      </div>
      <div className="col" />
    </>
  );
}

function EditorBody(props: BodyProps) {
  const { vacancyId, head, step, setStep, letter, variants, resumeOk, resumeSeen, onResumeOk } =
    props;
  return (
    <>
      <VacancyColumn vacancyId={vacancyId} head={head} />
      <div className="col">
        {/* Резюме собирается один раз и остаётся при переходе между шагами. */}
        {resumeSeen ? (
          <div hidden={step !== 'resume'}>
            <ResumeStep
              vacancyId={vacancyId}
              approved={letter.approval.saved?.resume ?? null}
              confirmed={resumeOk}
              onConfirm={onResumeOk}
            />
          </div>
        ) : null}
        <div hidden={step !== 'letter'}>
          <LetterStep
            letter={letter}
            variants={variants}
            head={head}
            onSend={() => setStep('send')}
          />
        </div>
      </div>
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
  return (
    <CtxHead
      kind="Отклик"
      title={[head.title, head.company].filter(Boolean).join(' · ')}
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
  return { letter, variants };
}

/** Состояние единого отклика: шаг, письмо, анкета и остаток откликов. */
function useApplyFlow({ target, cluster }: FlowProps): FlowState {
  const { search } = useShell();
  const [step, setStep] = useState<ApplyStep>(() => parseStep(search));
  const [resumeOk, setResumeOk] = useState(false);
  const [resumeSeen, setResumeSeen] = useState(step === 'resume');
  if (step === 'resume' && !resumeSeen) setResumeSeen(true);
  const { letter, variants } = useApplyLetter(target.vacancyId);
  const quota = useExhaustedQuota(letter);
  const questionnaire = useQuestionnaire(target.vacancyId);
  const form = questionnaire.form;
  // Шаг «Анкета» из адреса открывается, когда анкета прочитана; до того — письмо.
  const shown: ApplyStep = step === 'form' && !form ? 'letter' : step;
  // Название вакансии: из связей по вакансии, а если их нет — из ответа об анкете.
  const known = letter.circles.data ?? questionnaire.known;
  const head = buildHead({ application: target.application, known, cluster });
  const saved = Boolean(letter.approval.saved);
  // Одобренное письмо уходит со своим резюме: вкладка и сам шаг показывают одно состояние.
  const resumeDone = resumeOk || saved;
  return {
    shown,
    setStep,
    head,
    quota,
    questionnaire,
    wide: shown !== 'send' && shown !== 'form' && !quota,
    done: {
      resume: resumeDone,
      letter: saved,
      form: questionnaire.submitted.kind === 'done',
      send: false,
    },
    body: {
      vacancyId: target.vacancyId,
      head,
      sourceType: applyRoute({ application: target.application, cluster }).source ?? 'manual',
      step: shown,
      setStep,
      letter,
      variants,
      answers: form ? copyText(form.questions, questionnaire.draft) : '',
      resumeOk: resumeDone,
      resumeSeen,
      onResumeOk: () => {
        setResumeOk(true);
        setStep('letter');
      },
    },
  };
}

function ApplyFlow(props: FlowProps) {
  const flow = useApplyFlow(props);
  const { shown, head, quota, questionnaire, wide, body } = flow;
  const form = questionnaire.form;
  // Два окна (вакансия и письмо) включает признак макета `data-main-right`.
  useScreenChrome({
    crumb: head.title,
    rootData: {
      mtight: '1',
      ...(wide ? { 'main-right': '1' } : {}),
      // Открытое «Что поменять» на 390 — лист снизу (признак макета `data-vsheet`).
      ...(body.variants.wishOpen ? { vsheet: '1' } : {}),
    },
  });
  return (
    <>
      <StepTabs step={shown} done={flow.done} hasForm={Boolean(form)} onStep={flow.setStep} />
      <div
        className={wide ? 'page two split-editor' : 'page two'}
        data-b640-node="o02"
        data-b640-section="apply"
        data-apply-step={shown}
      >
        <FlowHead head={head} applicationId={props.target.application?.id ?? null} />
        {quota ? <QuotaBlock head={head} quota={quota} /> : null}
        {!quota && shown === 'send' ? <SendBody {...body} /> : null}
        {!quota && shown === 'form' && form ? <FormStep state={questionnaire} form={form} /> : null}
        {!quota && shown !== 'send' && shown !== 'form' ? <EditorBody {...body} /> : null}
      </div>
    </>
  );
}

/** Отклик не отправлен: название, компания и площадка сверяются с подбором. */
function FromPool({ target }: { readonly target: ApplyTarget }) {
  const pool = useMatchedPool();
  const cluster =
    pool.matched.find((item) => item.cluster.id === target.vacancyId)?.cluster ?? null;
  return <ApplyFlow target={target} cluster={cluster} />;
}

function Pending({ children }: { readonly children: ReactNode }) {
  return (
    <div className="page two" data-b640-node="o02" data-b640-section="apply">
      {children}
    </div>
  );
}

async function loadApplications(signal: AbortSignal): Promise<readonly ApplicationView[]> {
  return listApplications(signal);
}

/** Единый экран отклика (O2): резюме, письмо и отправка под одну вакансию. */
export function ApplyScreen({ responseId }: { readonly responseId: string }) {
  const load = useCallback((signal: AbortSignal) => loadApplications(signal), []);
  const { state, reload } = useAsync(load, 'Отклик не загрузился.');
  if (!state.data) {
    return (
      <Pending>
        {state.status === 'error' ? (
          <StatusLine
            state="err"
            text={state.error}
            action={
              <Button size="sm" onClick={reload}>
                Повторить
              </Button>
            }
          />
        ) : (
          <p className="ls-state" role="status">
            Загружаем отклик…
          </p>
        )}
      </Pending>
    );
  }
  const target = resolveTarget(responseId, state.data);
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
    <ApplyFlow key={target.vacancyId} target={target} cluster={null} />
  );
}
