import { useEffect, useState, type FormEvent } from 'react';
import { Star } from '@phosphor-icons/react';
import {
  createApplicationLabel,
  listApplicationLabels,
  type ApplicationLabelView,
} from './applicationsApi';

interface BulkLabelPickerProps {
  readonly disabled: boolean;
  readonly onPick: (label: ApplicationLabelView) => void;
}

/** «Добавить метку» for many responses: pick a saved label or create one, then preview. */
export function BulkLabelPicker({ disabled, onPick }: BulkLabelPickerProps) {
  const [open, setOpen] = useState(false);
  const pick = (label: ApplicationLabelView) => {
    setOpen(false);
    onPick(label);
  };
  return (
    <span className="career-responses-bulk-label">
      <button
        type="button"
        className="career-btn career-btn-secondary career-btn-sm"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <Star aria-hidden="true" />
        Добавить метку
      </button>
      {open ? <LabelChoices onPick={pick} /> : null}
    </span>
  );
}

function useSavedLabels() {
  const [labels, setLabels] = useState<readonly ApplicationLabelView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    listApplicationLabels(controller.signal)
      .then(setLabels)
      .catch(() => {
        if (!controller.signal.aborted) setError('Не удалось загрузить метки.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  return { labels, loading, error, setError };
}

function LabelChoices({ onPick }: { readonly onPick: (label: ApplicationLabelView) => void }) {
  const saved = useSavedLabels();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      onPick(await createApplicationLabel(trimmed));
    } catch {
      saved.setError('Не удалось создать метку. Повторите.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="career-responses-bulk-label__menu" aria-label="Метки" role="group">
      {saved.loading ? <p role="status">Загружаем метки…</p> : null}
      {saved.labels.map((label) => (
        <button key={label.id} type="button" onClick={() => onPick(label)}>
          {label.name}
        </button>
      ))}
      <form onSubmit={(event) => void create(event)}>
        <label>
          Новая метка
          <input
            value={name}
            maxLength={36}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </label>
        <button type="submit" disabled={!name.trim() || busy}>
          Создать и добавить
        </button>
      </form>
      {saved.error ? <p role="alert">{saved.error}</p> : null}
    </div>
  );
}
