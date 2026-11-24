import { useState, type FormEvent } from 'react';
import { Icon } from '../kit';
import { LINK_MAX, normalizeLink } from './addLinkModel';
import { saveLink } from './profileLinks';
import { reportFailure } from './reportFailure';

interface LinkFieldProps {
  readonly value: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onChange: (value: string) => void;
  readonly onSubmit: (event: FormEvent) => Promise<void>;
}

function LinkField({ value, busy, error, onChange, onSubmit }: LinkFieldProps) {
  return (
    <form className="field" noValidate onSubmit={(event) => void onSubmit(event)}>
      <label htmlFor="fp-link">Ссылка</label>
      <input
        id="fp-link"
        type="url"
        enterKeyHint="done"
        autoCapitalize="none"
        maxLength={LINK_MAX}
        value={value}
        readOnly={busy}
        aria-invalid={error !== null || undefined}
        aria-describedby={error ? 'fp-link-e' : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <small className="is-err" id="fp-link-e" role="alert">
          <Icon name="warn" />
          {error}
        </small>
      ) : null}
    </form>
  );
}

/** «Добавить ссылку» в «Данных для поиска»: поле открывается на месте, Enter сохраняет. */
export function AddLink() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !value.trim()) return;
    const link = normalizeLink(value);
    if (!link) {
      setError('Это не адрес страницы');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if ((await saveLink(link)) === 'full') {
        setError('В профиле уже 20 ссылок');
        return;
      }
      setValue('');
      setOpen(false);
    } catch (reason) {
      reportFailure('ссылка для поиска не сохранилась', reason);
      setError('Ссылка не сохранилась');
    } finally {
      setBusy(false);
    }
  }

  function change(next: string) {
    setValue(next);
    setError(null);
  }

  return (
    <details
      className="skill-add"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="skill-chip is-add">
        <Icon name="plus" />
        Добавить ссылку
      </summary>
      <LinkField value={value} busy={busy} error={error} onChange={change} onSubmit={submit} />
    </details>
  );
}
