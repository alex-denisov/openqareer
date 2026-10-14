import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  assignApplicationLabel,
  createApplicationLabel,
  listApplicationLabels,
  removeApplicationLabel,
  type ApplicationLabelView,
} from './applicationsApi';

interface ApplicationLabelsEditorProps {
  readonly applicationId: string;
  readonly assigned: readonly ApplicationLabelView[];
  readonly onRefresh: () => void;
}

export function ApplicationLabelsEditor({
  applicationId,
  assigned,
  onRefresh,
}: ApplicationLabelsEditorProps) {
  const [open, setOpen] = useState(false);
  const labels = useApplicationLabels(applicationId, onRefresh, open);
  return (
    <section className="career-responses-label-editor" aria-label="Метки отклика">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Добавить метку
      </button>
      <AssignedLabels labels={assigned} busy={labels.busy} onRemove={labels.remove} />
      {open ? (
        <div className="career-responses-label-editor__body" aria-busy={labels.loading || labels.busy}>
          {labels.loading ? <p role="status">Загружаем метки…</p> : null}
          <AvailableLabels
            labels={labels.available}
            assigned={assigned}
            busy={labels.busy}
            onAssign={labels.assign}
          />
          <NewLabelForm busy={labels.busy} onCreate={labels.create} />
          {labels.error ? <p role="alert">{labels.error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function useApplicationLabels(
  applicationId: string,
  onRefresh: () => void,
  enabled: boolean,
) {
  const [available, setAvailable] = useState<readonly ApplicationLabelView[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reload = useCallback(
    (signal: AbortSignal) => loadAvailableLabels(signal, setAvailable, setLoading, setError),
    [],
  );
  const run = useLabelMutation(onRefresh, setBusy, setError);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [enabled, reload]);

  const assign = useCallback(
    (label: ApplicationLabelView) =>
      void run(() => assignApplicationLabel(applicationId, label.id)),
    [applicationId, run],
  );
  const remove = useCallback(
    (label: ApplicationLabelView) =>
      void run(() => removeApplicationLabel(applicationId, label.id)),
    [applicationId, run],
  );
  const create = useCallback(
    (name: string) =>
      run(async () => {
        const label = await createApplicationLabel(name);
        await assignApplicationLabel(applicationId, label.id);
        setAvailable((current) => mergeLabels(current, label));
      }),
    [applicationId, run],
  );
  return { available, loading, busy, error, assign, remove, create };
}


function useLabelMutation(
  onRefresh: () => void,
  setBusy: (busy: boolean) => void,
  setError: (error: string) => void,
) {
  return useCallback(
    async (action: () => Promise<void>) => {
      setBusy(true);
      setError('');
      try {
        await action();
        onRefresh();
      } catch {
        setError('Не удалось сохранить метку. Повторите.');
      } finally {
        setBusy(false);
      }
    },
    [onRefresh, setBusy, setError],
  );
}

async function loadAvailableLabels(
  signal: AbortSignal,
  setLabels: (labels: readonly ApplicationLabelView[]) => void,
  setLoading: (loading: boolean) => void,
  setError: (error: string) => void,
) {
  setLoading(true);
  setError('');
  try {
    setLabels(await listApplicationLabels(signal));
  } catch {
    if (!signal.aborted) setError('Не удалось загрузить метки.');
  } finally {
    if (!signal.aborted) setLoading(false);
  }
}

function AssignedLabels({
  labels,
  busy,
  onRemove,
}: {
  readonly labels: readonly ApplicationLabelView[];
  readonly busy: boolean;
  readonly onRemove: (label: ApplicationLabelView) => void;
}) {
  if (labels.length === 0) return <p className="career-responses-label-editor__empty">Метки не заданы.</p>;
  return (
    <ul className="career-responses-label-editor__list" aria-label="Назначенные метки">
      {labels.map((label) => (
        <li key={label.id}>
          <span>{label.name}</span>
          <button
            type="button"
            aria-label={`Снять метку ${label.name}`}
            disabled={busy}
            onClick={() => onRemove(label)}
          >
            Снять
          </button>
        </li>
      ))}
    </ul>
  );
}

function AvailableLabels({
  labels,
  assigned,
  busy,
  onAssign,
}: {
  readonly labels: readonly ApplicationLabelView[];
  readonly assigned: readonly ApplicationLabelView[];
  readonly busy: boolean;
  readonly onAssign: (label: ApplicationLabelView) => void;
}) {
  const assignedIds = new Set(assigned.map((label) => label.id));
  const available = labels.filter((label) => !assignedIds.has(label.id));
  if (available.length === 0) return null;
  return (
    <ul className="career-responses-label-editor__list" aria-label="Сохранённые метки">
      {available.map((label) => (
        <li key={label.id}>
          <button type="button" disabled={busy} onClick={() => onAssign(label)}>
            Добавить {label.name}
          </button>
        </li>
      ))}
    </ul>
  );
}

function NewLabelForm({
  busy,
  onCreate,
}: {
  readonly busy: boolean;
  readonly onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    void onCreate(trimmed).then(() => setName(''));
  };
  return (
    <form className="career-responses-label-editor__form" onSubmit={submit}>
      <label>
        Название метки
        <input
          className="career-responses-label-editor__input"
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </label>
      <button type="submit" disabled={!name.trim() || busy}>
        {busy ? 'Сохраняем метку…' : 'Создать метку'}
      </button>
    </form>
  );
}

function mergeLabels(
  labels: readonly ApplicationLabelView[],
  next: ApplicationLabelView,
): ApplicationLabelView[] {
  return labels.some((label) => label.id === next.id) ? [...labels] : [...labels, next];
}
