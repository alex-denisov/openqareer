import { useCallback, useState } from 'react';
import type { ApplicationView } from '../../../../server/domain/applicationDerivedFields';
import { apiErrorMessage, CoachApiError } from '../../coach/apiClient';
import {
  transitionInterviewSession,
  type InterviewAnswerMode,
  type InterviewSessionView,
} from '../../interview/interviewSimulatorApi';
import { Button, Icon, Link, StatusLine } from '../kit';
import { useAsync } from '../responses/data/useAsync';
import { buildNodePath } from '../routes';
import { useScreenChrome, useShell } from '../shell/ShellContext';
import { useVoiceInput } from '../voice/useVoiceInput';
import { loadPractice, startPractice, type PracticeLoad } from './data/practiceApi';
import { practiceChoice } from './model/practiceModel';
import { formatInterviewWhen } from './model/prepModel';
import { PracticeAnswer, type PracticeRecovery } from './PracticeAnswer';
import { answerModeOf } from './PracticeAnswerInput';
import { PracticeReview } from './PracticeReview';
import { PracticeTask } from './PracticeTask';
import { InterviewHead, PrepSteps } from './PrepSteps';

type Step = 'task' | 'answer' | 'review';
type Ready = Extract<PracticeLoad, { kind: 'ready' }>;

const STEPS: readonly (readonly [Step, string])[] = [
  ['task', 'Задача'],
  ['answer', 'Ответ'],
  ['review', 'Разбор'],
];

function stepPath(responseId: string, step: Step): string {
  const base = buildNodePath('i03', { responseId });
  return step === 'answer' ? base : `${base}?step=${step}`;
}

/** Шаги тренировки: «Задача → Ответ → Разбор». */
function PracticeSteps(props: { readonly responseId: string; readonly current: Step }) {
  const at = STEPS.findIndex(([step]) => step === props.current);
  return (
    <ol className="ctx-steps iv-steps" aria-label="Шаги тренировки">
      {STEPS.map(([step, label], index) => (
        <li key={step} className={index < at ? 'is-done' : index === at ? 'is-now' : ''}>
          <Link
            to={stepPath(props.responseId, step)}
            aria-current={index === at ? 'step' : undefined}
          >
            {index < at ? <Icon name="check" /> : <span className="num">{index + 1}</span>}
            {label}
          </Link>
        </li>
      ))}
    </ol>
  );
}

function companyOf(response: ApplicationView): string | null {
  return response.vacancy && !response.vacancy.companyHidden
    ? (response.vacancy.company ?? null)
    : null;
}

function taskSubtitle(response: ApplicationView): string {
  const who = [companyOf(response), response.vacancy?.title].filter(Boolean).join(', ');
  const when = formatInterviewWhen(response.nearestInterview?.scheduledAt ?? null);
  return [who, when ? `интервью ${when}` : null].filter(Boolean).join(' · ');
}

/** Шаг по сессии и по ссылке шагов: без сессии — задача, начатая — ответ, отвеченная — разбор. */
function stepOf(load: Ready, asked: string | null): Step {
  const choice = practiceChoice(load.session, load.response.id);
  if (asked === 'task' || choice === 'start') return 'task';
  return choice === 'review' ? 'review' : 'answer';
}

function OtherSession(props: {
  readonly session: InterviewSessionView;
  readonly onDone: () => void;
}) {
  const [failed, setFailed] = useState(false);
  async function finish() {
    try {
      await transitionInterviewSession(props.session.id, props.session.version, 'finish');
      props.onDone();
    } catch {
      setFailed(true);
    }
  }
  return (
    <StatusLine
      state={failed ? 'err' : 'wait'}
      text={
        failed
          ? 'Не получилось закончить прошлое интервью. Попробуйте ещё раз.'
          : `Не закончено пробное интервью «${props.session.vacancyTitle ?? props.session.roleTitle}».`
      }
      action={
        <Button size="sm" onClick={() => void finish()}>
          Закончить его и начать это
        </Button>
      }
    />
  );
}

function useStart(load: Ready, onSession: (session: InterviewSessionView) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'paywall' | string | null>(null);
  async function start(mode: InterviewAnswerMode) {
    setBusy(true);
    setError(null);
    try {
      onSession(await startPractice(load.response, mode));
    } catch (reason) {
      const paywall = reason instanceof CoachApiError && reason.code === 'paywall_required';
      setError(
        paywall
          ? 'paywall'
          : apiErrorMessage(reason, 'Тренировка не началась. Попробуйте ещё раз.'),
      );
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, start };
}

function StartError({ error }: { readonly error: string }) {
  if (error !== 'paywall') return <StatusLine state="err" text={error} />;
  return (
    <StatusLine
      state="wait"
      text="Пробные интервью на этом тарифе закончились."
      action={
        <Link className="row-act" to={buildNodePath('t01')}>
          Тарифы
        </Link>
      }
    />
  );
}

const ignoreText = (): void => undefined;

function TaskStep(props: {
  readonly load: Ready;
  readonly onSession: (session: InterviewSessionView) => void;
}) {
  const { load } = props;
  // В .app голос становится доступен не сразу: выбор «Голосом / Текстом» следует за ним.
  const voice = useVoiceInput(ignoreText).supported;
  const [chosen, setMode] = useState<InterviewAnswerMode | null>(null);
  const mode = answerModeOf(chosen, voice);
  const started = useStart(load, props.onSession);
  const running = practiceChoice(load.session, load.response.id) === 'resume';
  return (
    <div className="col">
      <PracticeTask
        task={load.task}
        subtitle={taskSubtitle(load.response)}
        mode={mode}
        voice={voice}
        quota={load.quota}
        busy={started.busy}
        action={
          running ? (
            <div className="actions">
              <Link className="btn is-primary" to={stepPath(load.response.id, 'answer')}>
                <Icon name="right" />
                Вернуться к ответу
              </Link>
            </div>
          ) : null
        }
        onMode={setMode}
        onStart={() => void started.start(mode)}
      />
      {started.error ? <StartError error={started.error} /> : null}
    </div>
  );
}

function Body(props: {
  readonly load: PracticeLoad;
  readonly asked: string | null;
  readonly onSession: (session: InterviewSessionView) => void;
  readonly recovery: PracticeRecovery;
  readonly reload: () => void;
}) {
  const { load } = props;
  if (load.kind === 'none') {
    return (
      <StatusLine
        state="wait"
        text="Интервью пока не назначено ни по одному отклику."
        action={
          <Link className="row-act" to={buildNodePath('o01')}>
            К откликам
          </Link>
        }
      />
    );
  }
  if (load.kind === 'other') return <OtherSession session={load.session} onDone={props.reload} />;
  const step = stepOf(load, props.asked);
  if (step === 'task' || !load.session) return <TaskStep load={load} onSession={props.onSession} />;
  if (step === 'review') {
    return (
      <PracticeReview
        session={load.session}
        company={companyOf(load.response)}
        responseId={load.response.id}
      />
    );
  }
  return (
    <>
      <div className="col">
        <PracticeAnswer
          task={load.task}
          company={companyOf(load.response)}
          session={load.session}
          recovery={props.recovery}
        />
      </div>
      <div className="col" />
    </>
  );
}

/** B780: тренировку заменили в другой вкладке — перечитать текущую, набранный ответ сохранить. */
function useRecovery(
  reload: () => void,
  onSession: (session: InterviewSessionView) => void,
): PracticeRecovery {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  return {
    draft,
    onLost: (text) => {
      setDraft(text);
      reload();
    },
    onFinished: (session) => {
      setDraft(undefined);
      onSession(session);
    },
  };
}

/** «Тренировка System Design» (I3): задача по вакансии отклика, ответ со схемой, разбор. */
export function PracticeScreen({ responseId }: { readonly responseId: string }) {
  const { search, navigate } = useShell();
  const asked = new URLSearchParams(search).get('step');
  const load = useCallback((signal: AbortSignal) => loadPractice(responseId, signal), [responseId]);
  const { state, reload, replaceData } = useAsync(load, 'Тренировка не открылась.');
  useScreenChrome({ rootData: { mtight: '1' } });
  const data = state.data;
  const response = data && data.kind !== 'none' ? data.response : null;
  const current: Step = data && data.kind === 'ready' ? stepOf(data, asked) : 'task';
  const onSession = (session: InterviewSessionView) => {
    if (!data || data.kind !== 'ready') return;
    replaceData({ ...data, session });
    if (asked) navigate(stepPath(data.response.id, 'answer'));
  };
  const recovery = useRecovery(reload, onSession);
  return (
    <>
      <PrepSteps responseId={response?.id ?? responseId} current="prep" />
      <PracticeSteps responseId={response?.id ?? responseId} current={current} />
      <div className="page two" data-b640-node="i03" data-b640-section="interview">
        {response ? <InterviewHead response={response} /> : null}
        {data ? (
          <Body
            load={data}
            asked={asked}
            onSession={onSession}
            recovery={recovery}
            reload={reload}
          />
        ) : null}
        {!data && state.status === 'error' ? (
          <StatusLine
            state="err"
            text={state.error}
            action={
              <Button size="sm" onClick={reload}>
                Повторить
              </Button>
            }
          />
        ) : null}
        {!data && state.status === 'loading' ? (
          <p className="ls-state" role="status">
            <span>Готовим задачу…</span>
          </p>
        ) : null}
      </div>
    </>
  );
}
