import { useCallback, useEffect } from 'react';
import { Button, Icon, Link, StatusLine } from '../kit';
import { useAsync } from '../responses/data/useAsync';
import { buildNodePath } from '../routes';
import { useShell } from '../shell/ShellContext';
import { loadDebrief, type DebriefData } from './data/debriefApi';
import { clock, durationText } from './model/debriefModel';
import { RecordSteps, SourceHead } from './RecordSteps';
import { useAppRecording, type AppRecording } from './useAppRecording';

function LiveLine({ recording }: { readonly recording: AppRecording }) {
  if (recording.phase === 'stopped') {
    return (
      <div className="ir-live is-err" role="alert">
        <Icon name="warn" />
        <span className="ir-live-t">
          Запись остановилась · сохранено {durationText(recording.elapsedMs)}
        </span>
        <Button variant="primary" onClick={() => void recording.resume()}>
          <Icon name="mic" />
          Продолжить запись
        </Button>
        <Button onClick={() => void recording.stop()}>
          <Icon name="check" />
          Сохранить
        </Button>
      </div>
    );
  }
  if (recording.phase !== 'recording' && recording.phase !== 'finishing') return null;
  return (
    <div className="ir-live" role="status">
      <span className="ir-dot" aria-hidden="true" />
      <span className="ir-live-t">
        Идёт запись · <span className="num">{clock(recording.elapsedMs)}</span>
      </span>
      <Button
        variant="quiet"
        disabled={recording.phase === 'finishing'}
        onClick={() => void recording.stop()}
      >
        <Icon name="close" />
        Остановить
      </Button>
    </div>
  );
}

function RecordLead({ recording }: { readonly recording: AppRecording }) {
  const idle = recording.phase === 'ready' || recording.phase === 'starting';
  return (
    <section className="lead" aria-labelledby="ia-t">
      <h2 className="lead-title is-long" id="ia-t">
        Запись интервью для разбора
      </h2>
      {recording.error ? <StatusLine state="err" text={recording.error} /> : null}
      {idle ? (
        <div className="actions">
          <Button
            variant="primary"
            disabled={recording.phase === 'starting'}
            onClick={() => void recording.start()}
          >
            <Icon name="mic" />
            Начать запись
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function RecordBody({ data }: { readonly data: DebriefData }) {
  const responseId = data.response.id;
  const recording = useAppRecording(responseId, data.debrief?.interviewId ?? null);
  const { navigate } = useShell();
  useEffect(() => {
    if (recording.phase === 'done') navigate(buildNodePath('i04', { responseId }));
  }, [recording.phase, navigate, responseId]);
  if (recording.phase === 'unsupported') {
    return (
      <StatusLine
        state="wait"
        text="Запись звонка есть в приложении для macOS 15 и новее. Здесь можно загрузить файл записи."
        action={
          <Link className="row-act" to={buildNodePath('i04c', { responseId })}>
            Загрузить файл
          </Link>
        }
      />
    );
  }
  return (
    <>
      <div className="col">
        <RecordLead recording={recording} />
      </div>
      <div className="col">
        <section className="mod" aria-labelledby="ia-live">
          <div className="eyebrow">Во время звонка</div>
          <h3 className="mod-title" id="ia-live">
            Окно звонка остаётся у вас на экране
          </h3>
          <LiveLine recording={recording} />
        </section>
        <section className="mod" aria-labelledby="ia-after">
          <h3 className="mod-title" id="ia-after">
            После звонка
          </h3>
          <div className="actions">
            <Link className="btn is-quiet" to={buildNodePath('i04', { responseId })}>
              <Icon name="right" />
              Что будет в разборе
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}

/** «Запись интервью в приложении» (I4b): только в .app, в вебе — путь к загрузке файла. */
export function RecordScreen({ responseId }: { readonly responseId: string }) {
  const load = useCallback((signal: AbortSignal) => loadDebrief(responseId, signal), [responseId]);
  const { state } = useAsync(load, 'Запись не открылась.');
  const data = state.data;
  return (
    <>
      <RecordSteps responseId={data?.response.id ?? responseId} current="source" />
      <div className="page two" data-b640-node="i04b" data-b640-section="interview">
        {data ? <SourceHead data={data} /> : null}
        {data ? <RecordBody data={data} /> : null}
        {state.status === 'error' && !data ? <StatusLine state="err" text={state.error} /> : null}
      </div>
    </>
  );
}
