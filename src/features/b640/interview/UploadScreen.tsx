import { useCallback, useId, useState, type ChangeEvent } from 'react';
import { Button, Icon, Link, StatusLine } from '../kit';
import { useAsync } from '../responses/data/useAsync';
import { buildNodePath } from '../routes';
import { loadDebrief, saveInterviewerName, type DebriefData } from './data/debriefApi';
import { uploadErrorText, uploadInterviewFile } from './data/fileUpload';
import { durationText } from './model/debriefModel';
import { RecordSteps, SourceHead } from './RecordSteps';

type UploadPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending'; readonly percent: number }
  | { readonly kind: 'sent'; readonly durationMs: number }
  | { readonly kind: 'failed'; readonly error: string };

const megabytes = (bytes: number) =>
  `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(bytes / 1_048_576)}\u00a0МБ`;

function useUpload(data: DebriefData) {
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
            <i style={{ inlineSize: `${percent}%` }} />
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
      <div className="actions m-commit">
        <Button
          variant="primary"
          disabled={state === 'saving' || !name.trim()}
          onClick={() => void save()}
        >
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

function UploadBody({ data }: { readonly data: DebriefData }) {
  const upload = useUpload(data);
  if (!data.debrief) {
    return <StatusLine state="wait" text="Интервью по этому отклику ещё не записано." />;
  }
  const sent = upload.phase.kind === 'sent';
  return (
    <>
      <div className="col">
        <section className="lead" aria-labelledby="ic-t">
          <h2 className="lead-title is-long" id="ic-t">
            {upload.file ? 'Запись загружена' : 'Загрузите запись интервью'}
          </h2>
          {upload.file ? (
            <FileRow
              file={upload.file}
              phase={upload.phase}
              onPick={(file) => void upload.send(file)}
            />
          ) : (
            <div className="actions">
              <FilePick label="Выбрать файл" onPick={(file) => void upload.send(file)} />
            </div>
          )}
          {upload.phase.kind === 'failed' ? (
            <StatusLine state="err" text={upload.phase.error} />
          ) : null}
          {sent ? (
            <div className="actions">
              <Link className="btn" to={buildNodePath('i04', { responseId: data.response.id })}>
                <Icon name="right" />К разбору
              </Link>
            </div>
          ) : null}
        </section>
      </div>
      <div className="col">
        <Interviewer data={data} />
      </div>
    </>
  );
}

/** «Загрузка записи» (I4c): файл без деления голосов, имя собеседника. */
export function UploadScreen({ responseId }: { readonly responseId: string }) {
  const load = useCallback((signal: AbortSignal) => loadDebrief(responseId, signal), [responseId]);
  const { state } = useAsync(load, 'Загрузка не открылась.');
  const data = state.data;
  return (
    <>
      <RecordSteps responseId={data?.response.id ?? responseId} current="voices" />
      <div className="page two" data-b640-node="i04c" data-b640-section="interview">
        {data ? <SourceHead data={data} /> : null}
        {data ? <UploadBody data={data} /> : null}
        {state.status === 'error' && !data ? <StatusLine state="err" text={state.error} /> : null}
      </div>
    </>
  );
}
