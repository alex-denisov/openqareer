import { useCallback, useState } from 'react';
import {
  transitionInterviewSession,
  type InterviewSessionView,
} from '../../interview/interviewSimulatorApi';
import { Button, Link, StatusLine } from '../kit';
import { useAsync } from '../responses/data/useAsync';
import { buildNodePath } from '../routes';
import { useScreenChrome } from '../shell/ShellContext';
import { loadMock, recoverMock, type MockLoad } from './data/mockApi';
import { MockQuestion } from './MockQuestion';
import { InterviewHead, PrepSteps } from './PrepSteps';

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

function Unavailable({ kind }: { readonly kind: 'none' | 'paywall' }) {
  const paywall = kind === 'paywall';
  return (
    <StatusLine
      state="wait"
      text={
        paywall
          ? 'Пробное интервью — на платном тарифе.'
          : 'Интервью пока не назначено ни по одному отклику.'
      }
      action={
        <Link className="row-act" to={buildNodePath(paywall ? 't01' : 'o01')}>
          {paywall ? 'Тарифы' : 'К откликам'}
        </Link>
      }
    />
  );
}

function Body(props: {
  readonly load: MockLoad;
  readonly onSession: (next: InterviewSessionView) => void;
  readonly onLost: (text: string) => void;
  readonly draft: string | undefined;
  readonly reload: () => void;
}) {
  const { load } = props;
  if (load.kind === 'none' || load.kind === 'paywall') return <Unavailable kind={load.kind} />;
  if (load.kind === 'other') return <OtherSession session={load.session} onDone={props.reload} />;
  const question = load.session.currentQuestion;
  if (!question) {
    return (
      <StatusLine
        state="ok"
        text="Пробное интервью закончено."
        action={
          <Link className="row-act" to={buildNodePath('i01', { responseId: load.response.id })}>
            К подготовке
          </Link>
        }
      />
    );
  }
  return (
    <div className="col">
      <MockQuestion
        key={question.id}
        response={load.response}
        session={load.session}
        question={question}
        onSession={props.onSession}
        onLost={props.onLost}
        draft={props.draft}
      />
    </div>
  );
}

/**
 * Загрузка и смена тренировки. Тренировку заменили в другой вкладке (ответ — 404): экран
 * подхватывает текущую или начинает новую, набранный ответ остаётся в поле.
 */
function useMockSession(responseId: string) {
  const load = useCallback((signal: AbortSignal) => loadMock(responseId, signal), [responseId]);
  const { state, reload, replaceData } = useAsync(load, 'Пробное интервью не открылось.');
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const data = state.data;
  const onSession = (session: InterviewSessionView) => {
    // Ответ записан — набранный до замены текст следующему вопросу не нужен.
    setDraft(undefined);
    replaceData(data && data.kind === 'ready' ? { ...data, session } : (data as MockLoad));
  };
  const onLost = (text: string) => {
    if (!data || data.kind !== 'ready') return;
    setDraft(text);
    recoverMock(data.response).then(replaceData, reload);
  };
  return { state, reload, draft, onSession, onLost };
}

/** «Пробное интервью» (I2): вопросы по должности отклика, ответ и разбор на месте. */
export function MockScreen({ responseId }: { readonly responseId: string }) {
  const { state, reload, draft, onSession, onLost } = useMockSession(responseId);
  useScreenChrome({ rootData: { mtight: '1' } });
  const data = state.data;
  const response = data && data.kind !== 'none' ? data.response : null;
  return (
    <>
      <PrepSteps responseId={response?.id ?? responseId} current="prep" />
      <div className="page two" data-b640-node="i02" data-b640-section="interview">
        {response ? <InterviewHead response={response} /> : null}
        {data ? (
          <Body load={data} onSession={onSession} onLost={onLost} draft={draft} reload={reload} />
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
            <span>Готовим вопросы…</span>
          </p>
        ) : null}
      </div>
    </>
  );
}
