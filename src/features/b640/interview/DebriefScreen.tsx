import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApplicationView } from '../../../../server/domain/applicationDerivedFields';
import type { InterviewDebriefView } from '../../../../server/domain/interviewDebriefView';
import { isTauriEnvironment } from '../../../services/desktop/desktopBridge';
import { InfoTip, Link, StatusLine } from '../kit';
import { useAsync } from '../responses/data/useAsync';
import { buildNodePath } from '../routes';
import { CtxHead } from '../shell/CtxHead';
import { AnalysisRetry, Agreements, NextPrep } from './DebriefAside';
import { DebriefNotes } from './DebriefNotes';
import { DebriefQuestions, ShareLine } from './DebriefQuestions';
import { DebriefSteps } from './DebriefSteps';
import { analyzeDebrief, loadDebrief, type DebriefData } from './data/debriefApi';
import { durationText, measuresTip } from './model/debriefModel';
import { formatInterviewWhen } from './model/prepModel';
import { PrepSteps } from './PrepSteps';

const POLL_MS = 10_000;

function DebriefHead({ data }: { readonly data: DebriefData }) {
  const { response, debrief } = data;
  const when = formatInterviewWhen(debrief?.scheduledAt ?? null);
  const meta = [
    when ? `интервью ${when}` : null,
    debrief?.metrics ? `запись ${durationText(debrief.metrics.durationMs)}` : null,
  ].filter((item): item is string => item !== null);
  return (
    <CtxHead
      kind="Интервью"
      title={[response.vacancy?.company, response.vacancy?.title].filter(Boolean).join(' · ')}
      meta={meta.length > 0 ? meta : undefined}
      open={{
        path: buildNodePath('o01c', { responseId: response.id }),
        label: 'Открыть: интервью',
      }}
    />
  );
}

/** Модель зовётся один раз, когда расшифровка готова, а разбора ещё нет. */
function useAnalysis(data: DebriefData | null, replace: (next: DebriefData) => void) {
  const [busy, setBusy] = useState(false);
  const asked = useRef(false);
  const run = useCallback(async () => {
    if (!data) return;
    setBusy(true);
    try {
      replace({ ...data, debrief: await analyzeDebrief(data.response.id) });
    } catch {
      if (data.debrief)
        replace({ ...data, debrief: { ...data.debrief, analysis: { status: 'failed' } } });
    } finally {
      setBusy(false);
    }
  }, [data, replace]);
  const needed =
    data?.debrief?.recording?.status === 'ready' && data.debrief.analysis.status === 'none';
  useEffect(() => {
    if (!needed || asked.current) return;
    asked.current = true;
    void run();
  }, [needed, run]);
  return { busy, run };
}

function NoRecording({ response }: { readonly response: ApplicationView }) {
  const inApp = isTauriEnvironment();
  return (
    <StatusLine
      state="wait"
      text="Записи этого интервью ещё нет."
      action={
        <Link
          className="row-act"
          to={buildNodePath(inApp ? 'i04b' : 'i04c', { responseId: response.id })}
        >
          {inApp ? 'Записать интервью' : 'Загрузить запись'}
        </Link>
      }
    />
  );
}

function RecordingState({
  debrief,
  response,
}: {
  readonly debrief: InterviewDebriefView;
  readonly response: ApplicationView;
}) {
  const status = debrief.recording?.status;
  if (!debrief.recording) return <NoRecording response={response} />;
  if (status === 'failed') {
    return (
      <StatusLine
        state="err"
        text="Запись не расшифровалась."
        action={
          <Link className="row-act" to={buildNodePath('i04c', { responseId: response.id })}>
            Загрузить файл
          </Link>
        }
      />
    );
  }
  if (status !== 'ready') {
    return (
      <p className="ls-state" role="status">
        <span>{status === 'recording' ? 'Идёт запись…' : 'Расшифровываем запись…'}</span>
      </p>
    );
  }
  return null;
}

function DebriefLead(props: {
  readonly data: DebriefData;
  readonly debrief: InterviewDebriefView;
  readonly analysis: ReturnType<typeof useAnalysis>;
}) {
  const { response } = props.data;
  const { debrief } = props;
  const ready = debrief.recording?.status === 'ready' && debrief.metrics;
  const voiced = debrief.recording?.source === 'app';
  return (
    <section className="lead" aria-labelledby="db-title">
      <div className="lead-head">
        <h2 className="lead-title is-long" id="db-title">
          Что спросили и как прошло
        </h2>
        {ready && debrief.recording && debrief.metrics ? (
          <InfoTip
            label="Откуда меры"
            text={measuresTip(debrief.recording.startedAt, debrief.metrics, voiced)}
          />
        ) : null}
      </div>
      <DebriefSteps responseId={response.id} current="debrief" inApp={isTauriEnvironment()} />
      <RecordingState debrief={debrief} response={response} />
      {ready && debrief.metrics ? <ShareLine metrics={debrief.metrics} /> : null}
      {debrief.analysis.status === 'failed' ? (
        <AnalysisRetry busy={props.analysis.busy} onRetry={() => void props.analysis.run()} />
      ) : null}
      {props.analysis.busy ? (
        <p className="ls-state" role="status">
          <span>Разбираем вопросы…</span>
        </p>
      ) : null}
      {ready && debrief.metrics ? (
        <DebriefQuestions
          responseId={response.id}
          questions={debrief.analysis.status === 'ready' ? debrief.analysis.findings.questions : []}
          lines={debrief.transcript}
          metrics={debrief.metrics}
          interviewerName={debrief.interviewerName}
        />
      ) : null}
      <DebriefNotes responseId={response.id} initial={debrief.notes ?? ''} />
    </section>
  );
}

function DebriefBody({
  data,
  replace,
}: {
  readonly data: DebriefData;
  readonly replace: (next: DebriefData) => void;
}) {
  const analysis = useAnalysis(data, replace);
  const { debrief, response } = data;
  if (!debrief) {
    return (
      <StatusLine
        state="wait"
        text="Интервью по этому отклику ещё не записано."
        action={
          <Link className="row-act" to={buildNodePath('i01', { responseId: response.id })}>
            Когда интервью?
          </Link>
        }
      />
    );
  }
  const findings = debrief.analysis.status === 'ready' ? debrief.analysis.findings : null;
  return (
    <>
      <div className="col">
        <DebriefLead data={data} debrief={debrief} analysis={analysis} />
      </div>
      <div className="col">
        <Agreements responseId={response.id} items={findings?.agreements ?? []} />
        <NextPrep responseId={response.id} items={findings?.nextPrep ?? []} />
      </div>
    </>
  );
}

/** Пока запись пишется или расшифровывается, экран сам перечитывает её раз в 10 с. */
function usePolling(data: DebriefData | null, reload: () => void) {
  const status = data?.debrief?.recording?.status;
  useEffect(() => {
    if (status !== 'recording' && status !== 'transcribing') return undefined;
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [status, reload]);
}

/** «Разбор после интервью» (I4). */
export function DebriefScreen({ responseId }: { readonly responseId: string }) {
  const load = useCallback((signal: AbortSignal) => loadDebrief(responseId, signal), [responseId]);
  const { state, reload, replaceData } = useAsync(load, 'Разбор не загрузился.');
  const data = state.data;
  usePolling(data, reload);
  return (
    <>
      <PrepSteps responseId={data?.response.id ?? responseId} current="debrief" />
      <div className="page two" data-b640-node="i04" data-b640-section="interview">
        {data ? <DebriefHead data={data} /> : null}
        {data ? <DebriefBody data={data} replace={replaceData} /> : null}
        {state.status === 'ready' && data === null ? (
          <StatusLine state="wait" text="Такого отклика нет." />
        ) : null}
        {!data && state.status === 'error' ? <StatusLine state="err" text={state.error} /> : null}
        {!data && state.status === 'loading' ? (
          <p className="ls-state" role="status">
            <span>Загружаем разбор…</span>
          </p>
        ) : null}
      </div>
    </>
  );
}
