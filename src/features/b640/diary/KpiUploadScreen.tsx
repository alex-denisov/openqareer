import { useRef, useState, type ChangeEvent } from 'react';
import {
  KPI_FILE_MAX_BYTES,
  KPI_TEXT_MAX,
  type CareerDiaryKpiImportInput,
} from '../../../../shared/careerDiaryKpi';
import { CoachApiError } from '../../coach/apiClient';
import { ActionDock } from '../kit/ActionDock';
import { Button } from '../kit/Button';
import { InfoTip } from '../kit/InfoTip';
import { StatusLine } from '../kit/ResultLine';
import { buildNodePath, type B640Node } from '../routes';
import { Link } from '../shell/Link';
import { useShell } from '../shell/ShellContext';
import { createKpiImport } from './diaryApi';
import './diary.css';

const TABLE_ACCEPT =
  '.csv,.tsv,.xlsx,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';
const ABOUT =
  'Берём только то, что написано: показатель, цель, срок, вес и кто поставил. Файл хранится зашифрованным, удалить его можно на проверке.';

type Failure = 'none' | 'unreadable' | 'failed' | 'large' | 'empty';

interface Picked {
  readonly kind: 'table' | 'photo';
  readonly file: File;
}

function mimeOf(file: File): string {
  if (file.type) return file.type;
  if (file.name.endsWith('.csv')) return 'text/csv';
  if (file.name.endsWith('.tsv')) return 'text/tab-separated-values';
  return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

async function base64Of(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function inputOf(text: string, picked: Picked | null): Promise<CareerDiaryKpiImportInput> {
  if (!picked) return { kind: 'text', text: text.trim() };
  return {
    kind: picked.kind,
    name: picked.file.name,
    mimeType: mimeOf(picked.file),
    data: await base64Of(picked.file),
  };
}

function failureOf(error: unknown): Failure {
  if (!(error instanceof CoachApiError)) return 'failed';
  if (error.code === 'kpi_rows_not_found') return 'none';
  if (error.code === 'kpi_source_unreadable') return 'unreadable';
  return 'failed';
}

function useUpload() {
  const { navigate } = useShell();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  async function submit(text: string, picked: Picked | null) {
    if (!picked && !text.trim()) return setFailure('empty');
    if (picked && picked.file.size > KPI_FILE_MAX_BYTES) return setFailure('large');
    setBusy(true);
    setFailure(null);
    try {
      const created = await createKpiImport(await inputOf(text, picked));
      navigate(`${buildNodePath('d02l')}?import=${encodeURIComponent(created.id)}`);
    } catch (error) {
      setFailure(failureOf(error));
      setBusy(false);
    }
  }
  return { busy, failure, submit, clear: () => setFailure(null) };
}

function FailureLine({ failure }: { readonly failure: Failure | null }) {
  if (failure === 'none') {
    return (
      <StatusLine
        state="err"
        text="Не нашли показатели"
        action={
          <Link className="row-act" to={buildNodePath('d02b')}>
            Ввести вручную
          </Link>
        }
      />
    );
  }
  if (failure === 'failed') {
    return (
      <StatusLine
        state="err"
        text="Не получилось разобрать"
        action={
          <button className="row-act" type="submit">
            Повторить
          </button>
        }
      />
    );
  }
  return null;
}

const FIELD_ERRORS: Partial<Record<Failure, string>> = {
  empty: 'Вставьте текст KPI или выберите файл',
  large: 'Файл больше 4 МБ',
  unreadable: 'Не получилось прочитать файл',
};

interface PickProps {
  readonly picked: Picked | null;
  readonly onPick: (picked: Picked | null) => void;
}

function FilePick({ picked, onPick }: PickProps) {
  const table = useRef<HTMLInputElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const take = (kind: Picked['kind']) => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onPick({ kind, file });
  };
  if (picked) {
    return (
      <p className="kd-file">
        <span>{picked.file.name}</span>
        <button className="row-act" type="button" onClick={() => onPick(null)}>
          Убрать
        </button>
      </p>
    );
  }
  return (
    <div className="actions kd-pick">
      <input
        ref={table}
        className="vh"
        type="file"
        accept={TABLE_ACCEPT}
        tabIndex={-1}
        aria-hidden="true"
        onChange={take('table')}
      />
      <input
        ref={photo}
        className="vh"
        type="file"
        accept={PHOTO_ACCEPT}
        tabIndex={-1}
        aria-hidden="true"
        onChange={take('photo')}
      />
      <Button icon="file" onClick={() => table.current?.click()}>
        Файл таблицы
      </Button>
      <Button icon="camera" onClick={() => photo.current?.click()}>
        Фото слайда
      </Button>
    </div>
  );
}

function TextField({
  text,
  disabled,
  onChange,
}: {
  readonly text: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="gb-f kd-f">
      <label htmlFor="kd-text">Текст</label>
      <textarea
        id="kd-text"
        className="kd-text"
        rows={4}
        maxLength={KPI_TEXT_MAX}
        value={text}
        disabled={disabled}
        placeholder="Например: релиз — не дольше недели к концу января, вес 30 %"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/** Экран d02k «Загрузить KPI»: текст, таблица или фото слайда → черновик на проверку. */
export function KpiUploadScreen({ node }: { readonly node: B640Node }) {
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Picked | null>(null);
  const { busy, failure, submit, clear } = useUpload();
  const fieldError = failure ? FIELD_ERRORS[failure] : undefined;
  return (
    <div className="page gb-page" data-b640-node={node.code} data-b640-section={node.section}>
      <div className="lead-head">
        <h2 className="lead-title" id="kd-title">
          Загрузите KPI — разберём на цели
        </h2>
        <InfoTip label="Что мы берём" text={ABOUT} />
      </div>
      <form
        className="gb-form"
        onSubmit={(event) => (event.preventDefault(), void submit(text, picked))}
      >
        <TextField
          text={text}
          disabled={picked !== null}
          onChange={(value) => (setText(value), clear())}
        />
        <FilePick picked={picked} onPick={(next) => (setPicked(next), clear())} />
        {fieldError ? (
          <p className="va-err" role="alert">
            {fieldError}
          </p>
        ) : null}
        {busy ? (
          <StatusLine state="wait" text="Разбираем KPI" />
        ) : (
          <FailureLine failure={failure} />
        )}
        <ActionDock
          kind="commit"
          primary={
            <Button variant="primary" type="submit" busy={busy}>
              Разобрать
            </Button>
          }
        />
      </form>
    </div>
  );
}
