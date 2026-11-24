import { useCallback, useId, useState, type ChangeEvent } from 'react';
import { Button, Icon, Link, StatusLine } from '../kit';
import { useScreenChrome } from '../shell/ShellContext';
import { useAsync } from '../responses/data/useAsync';
import { buildNodePath } from '../routes';
import { loadDebrief, saveInterviewerName, splitVoices, type DebriefData } from './data/debriefApi';
import { uploadErrorText, uploadInterviewFile } from './data/fileUpload';
import { durationText } from './model/debriefModel';
import { RecordSteps, SourceHead } from './RecordSteps';
import { MeterFill } from './MeterFill';
import { useVoicesStep, VoicesBlock } from './UploadVoices';

type UploadPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending'; readonly percent: number }
  | { readonly kind: 'sent'; readonly durationMs: number }
  | { readonly kind: 'failed'; readonly error: string };

const megabytes = (bytes: number) =>
  `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(bytes / 1_048_576)}\u00a0МБ`;

function useUpload(data: DebriefData, onSent: () => void) {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<UploadPhase>({ kind: 'idle' });
  async function send(next: File) {
    const interviewId = data.debrief?.interviewId;
    if (!interviewId) return;
    setFile(next);
    setPhase({ kind: 'sending', percent: 0 });
    try {
      const result = await uploadInterviewFile(
        next,
        { applicationId: data.response.id, interviewId },
        (sent, total) => setPhase({ kind: 'sending', percent: Math.round((sent / total) * 100) }),
      );
      setPhase({ kind: 'sent', durationMs: result.durationMs });
      onSent();
    } catch (error) {
      setPhase({ kind: 'failed', error: uploadErrorText(error) });
    }
  }
  return { file, phase, send };
}

function FilePick(props: {
  readonly label: string;
  readonly quiet?: boolean;
  readonly onPick: (file: File) => void;
}) {
  const id = useId();
  function change(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (picked) props.onPick(picked);
  }
  return (
    <label className={props.quiet ? 'row-act' : 'btn is-primary'} htmlFor={id}>
      {props.quiet ? null : <Icon name="upload" />}
      {props.label}
      <input id={id} className="vh" type="file" accept="audio/*,video/mp4" onChange={change} />
    </label>
  );
}

function FileRow(props: {
  readonly file: File;
  readonly phase: UploadPhase;
  readonly onPick: (file: File) => void;
}) {
  const { phase } = props;
  const percent = phase.kind === 'sending' ? phase.percent : 100;
  const size = [
    phase.kind === 'sent' ? durationText(phase.durationMs) : null,
    megabytes(props.file.size),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="ir-file">
      <div className="row-title">{props.file.name}</div>
      <div className="row-sub">
        {size} ·{' '}
        {phase.kind === 'sending' ? null : (
          <FilePick label="Другой файл" quiet onPick={props.onPick} />
        )}
      </div>
      {phase.kind === 'sending' || phase.kind === 'sent' ? (
        <div className="ir-prog">
          <span
            className="meter"
            role="progressbar"
            aria-label="Загрузка"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <MeterFill percent={percent} />
          </span>
          <span className="num">
            {phase.kind === 'sending' ? `Загружаем · ${percent}\u00a0%` : 'Расшифровываем'}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Interviewer({ data }: { readonly data: DebriefData }) {
  const id = useId();
  const [name, setName] = useState(data.debrief?.interviewerName ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  async function save() {
    setState('saving');
    try {
      await saveInterviewerName(data.response.id, name.trim());
      setState('saved');
    } catch {
      setState('failed');
    }
  }
  return (
    <section className="mod" aria-labelledby="ic-v">
      <h3 className="mod-title" id="ic-v">
        Собеседник
      </h3>
      <div className="field">
        <label htmlFor={id}>Имя собеседника</label>
        <input
          id={id}
          type="text"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </div>
      {state === 'failed' ? (
        <StatusLine state="err" text="Имя не сохранилось. Попробуйте ещё раз." />
      ) : null}
      <div className="actions">
        <Button disabled={state === 'saving' || !name.trim()} onClick={() => void save()}>
          <Icon name="check" />
          Сохранить
        </Button>
        {state === 'saved' ? (
          <Link className="btn" to={buildNodePath('i04', { responseId: data.response.id })}>
            К разбору
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function VoicesFailed(props: { readonly data: DebriefData; readonly onView: Replace }) {
  const { data } = props;
  const [busy, setBusy] = useState(false);
  async function retry() {
    setBusy(true);
    try {
      props.onView({ ...data, debrief: await splitVoices(data.response.id) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <StatusLine
      state="err"
      text="Голоса не разделились."
      action={
        <Button size="sm" disabled={busy} onClick={() => void retry()}>
          Повторить
        </Button>
      }
    />
  );
}

type Replace = (next: DebriefData) => void;

/** Заголовок по фазе загрузки: при сбое — снова «Загрузите запись интервью». */
function leadTitle(phase: UploadPhase, picking: boolean, hasFile: boolean): string {
  if (phase.kind === 'sending') return 'Загружаем запись…';
  if (phase.kind === 'failed') return 'Загрузите запись интервью';
  if (picking) return 'Запись загружена — отметьте, кто говорит';
  return hasFile ? 'Запись загружена' : 'Загрузите запись интервью';
}

function UploadLead(props: {
  readonly data: DebriefData;
  readonly upload: ReturnType<typeof useUpload>;
  readonly picking: boolean;
}) {
  const { upload } = props;
  const sent = upload.phase.kind === 'sent' && !props.picking;
  return (
    <section className="lead" aria-labelledby="ic-t">
      <h2 className="lead-title is-long" id="ic-t">
        {leadTitle(
          upload.phase,
          props.picking,
          Boolean(upload.file ?? props.data.debrief?.recording),
        )}
      </h2>
      {upload.file ? (
        <FileRow
          file={upload.file}
          phase={upload.phase}
          onPick={(file) => void upload.send(file)}
        />
      ) : (
        <div className="actions">
          {/* Файл уже на сервере (экран открыли заново): выбор другого — тихой ссылкой, как в макете. */}
          <FilePick
            label={props.data.debrief?.recording ? 'Другой файл' : 'Выбрать файл'}
            quiet={Boolean(props.data.debrief?.recording)}
            onPick={(file) => void upload.send(file)}
          />
        </div>
      )}
      {upload.phase.kind === 'failed' ? <StatusLine state="err" text={upload.phase.error} /> : null}
      {sent ? (
        <div className="actions">
          <Link className="btn" to={buildNodePath('i04', { responseId: props.data.response.id })}>
            <Icon name="right" />К разбору
          </Link>
        </div>
      ) : null}
    </section>
  );
}

function UploadBody(props: {
  readonly data: DebriefData;
  readonly onSent: () => void;
  readonly onView: Replace;
}) {
  const { data } = props;
  const upload = useUpload(data, props.onSent);
  if (!data.debrief) {
    return <StatusLine state="wait" text="Интервью по этому отклику ещё не записано." />;
  }
  const voices = data.debrief.recording?.source === 'upload' ? data.debrief.voices : null;
  const picking = voices?.status === 'ready';
  return (
    <>
      <div className="col">
        <UploadLead data={data} upload={upload} picking={picking} />
        {picking ? <VoicesBlock data={data} /> : null}
        {voices?.status === 'failed' ? <VoicesFailed data={data} onView={props.onView} /> : null}
      </div>
      <div className="col">{picking ? null : <Interviewer data={data} />}</div>
    </>
  );
}

/** «Загрузка записи» (I4c): файл, «Чей голос» после расшифровки, имя собеседника. */
export function UploadScreen({ responseId }: { readonly responseId: string }) {
  const load = useCallback((signal: AbortSignal) => loadDebrief(responseId, signal), [responseId]);
  const { state, reload, replaceData } = useAsync(load, 'Загрузка не открылась.');
  const data = state.data;
  useVoicesStep(data, reload, replaceData);
  // Макет: плотные мобильные отступы (`data-mtight`), как у I1, I2 и I3.
  useScreenChrome({ rootData: { mtight: '1' } });
  // «Запись или файл» — текущий шаг, пока файла нет; после загрузки он с галочкой.
  const [sent, setSent] = useState(false);
  const onSent = useCallback(() => {
    setSent(true);
    reload();
  }, [reload]);
  const step = sent || data?.debrief?.recording ? 'voices' : 'source';
  return (
    <>
      <RecordSteps responseId={data?.response.id ?? responseId} current={step} />
      <div className="page two" data-b640-node="i04c" data-b640-section="interview">
        {data ? <SourceHead data={data} /> : null}
        {data ? <UploadBody data={data} onSent={onSent} onView={replaceData} /> : null}
        {state.status === 'error' && !data ? <StatusLine state="err" text={state.error} /> : null}
      </div>
    </>
  );
}
