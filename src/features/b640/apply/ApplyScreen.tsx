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
import { LetterStep } from './LetterStep';
import {
  APPLY_STEPS,
  buildHead,
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

const COLD_CIRCLE = 3;

interface TabsProps {
  readonly step: ApplyStep;
  readonly done: Readonly<Record<ApplyStep, boolean>>;
  readonly onStep: (step: ApplyStep) => void;
}

/** Шаги отклика (вкладки макета): пройденный шаг отмечен галочкой. */
function StepTabs({ step, done, onStep }: TabsProps) {
  const { path } = useShell();
  return (
    <nav className="tabs sec-tabs r6-steps resp-tabs" aria-label="Отклик">
      <div className="sec-tabs-in">
        {APPLY_STEPS.map((item) => (
          <a
            key={item.id}
            href={`${path}?step=${item.id}`}
            aria-current={item.id === step ? 'page' : undefined}
            onClick={(event) => {
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
function VacancyColumn({ vacancyId, head }: { readonly vacancyId: string; readonly head: ApplyHead }) {
  const detail = useVacancyDetail(vacancyId, true);
  const text = detail.status === 'ready' ? detail.detail.description || detail.detail.summary || '' : '';
  return (
    <div className="col vac-col">
      <section className="mod" aria-labelledby="vp-title">
        <div className="lead-head">
          <h3 className="mod-title" id="vp-title">
            {head.title}
          </h3>
          {head.source ? <InfoTip label="Источник" text={`Текст вакансии с ${head.source}.`} /> : null}
        </div>
        {detail.status === 'loading' || detail.status === 'idle' ? (
          <p className="ls-state" role="status">
            Загружаем текст вакансии…
          </p>
        ) : null}
        {detail.status === 'failed' ? <StatusLine state="err" text="Текст вакансии не загрузился" /> : null}
        {text ? (
          <div className="letter full vac-text" aria-label="Текст вакансии">
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
  readonly resumeOk: boolean;
  readonly onResumeOk: () => void;
}

function SendBody({ vacancyId, head, sourceType, setStep, letter }: BodyProps) {
  return (
    <>
      <div className="col">
        <SendStep
          vacancyId={vacancyId}
          head={head}
          sourceType={sourceType}
          approved={letter.approval.saved}
          letterText={letter.draft.text}
          onLetter={() => setStep('letter')}
        />
      </div>
      <div className="col" />
    </>
  );
}

function EditorBody(props: BodyProps) {
  const { vacancyId, head, step, setStep, letter, resumeOk, onResumeOk } = props;
  return (
    <>
      <VacancyColumn vacancyId={vacancyId} head={head} />
      <div className="col">
        {step === 'resume' ? (
          <ResumeStep
            vacancyId={vacancyId}
            approved={letter.approval.saved?.resume ?? null}
            confirmed={resumeOk}
            onConfirm={onResumeOk}
          />
        ) : (
          <LetterStep letter={letter} head={head} onSend={() => setStep('send')} />
        )}
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

function ApplyFlow({ target, cluster }: FlowProps) {
  const { search } = useShell();
  const [step, setStep] = useState<ApplyStep>(() => parseStep(search));
  const [resumeOk, setResumeOk] = useState(false);
  const letter = useVacancyLetterController(target.vacancyId, COLD_CIRCLE);
  const quota = useExhaustedQuota(letter);
  const head = buildHead({ application: target.application, known: letter.circles.data, cluster });
  const saved = Boolean(letter.approval.saved);

  const body: BodyProps = {
    vacancyId: target.vacancyId,
    head,
    sourceType: target.application?.vacancy?.source ?? cluster?.sources[0]?.sourceName ?? 'manual',
    step,
    setStep,
    letter,
    resumeOk,
    onResumeOk: () => {
      setResumeOk(true);
      setStep('letter');
    },
  };
  // Два окна (вакансия и письмо) включает признак макета `data-main-right`.
  const wide = step !== 'send' && !quota;
  useScreenChrome({
    crumb: head.company || head.title,
    rootData: wide ? { mtight: '1', 'main-right': '1' } : { mtight: '1' },
  });
  const application = target.application;
  return (
    <>
      <StepTabs step={step} done={{ resume: resumeOk || saved, letter: saved, send: false }} onStep={setStep} />
      <div
        className={wide ? 'page two split-editor' : 'page two'}
        data-b640-node="o02"
        data-b640-section="apply"
        data-apply-step={step}
      >
        <FlowHead head={head} applicationId={application?.id ?? null} />
        {quota ? <QuotaBlock head={head} quota={quota} /> : null}
        {!quota && step === 'send' ? <SendBody {...body} /> : null}
        {!quota && step !== 'send' ? <EditorBody {...body} /> : null}
      </div>
    </>
  );
}

/** Отклика ещё нет: название, компания и ссылка берутся из подбора. */
function FromPool({ target }: { readonly target: ApplyTarget }) {
  const pool = useMatchedPool();
  const cluster = pool.matched.find((item) => item.cluster.id === target.vacancyId)?.cluster ?? null;
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
  return target.application ? (
    <ApplyFlow key={target.vacancyId} target={target} cluster={null} />
  ) : (
    <FromPool key={target.vacancyId} target={target} />
  );
}
