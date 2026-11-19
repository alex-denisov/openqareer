import { useState, type FormEvent } from 'react';
import { createApplicationInterview } from '../../applications/applicationsApi';
import { Button, Icon, StatusLine } from '../kit';

type When =
  { readonly ok: true; readonly iso: string } | { readonly ok: false; readonly error: string };

/** `datetime-local` в ISO; прошедшая дата — ошибка поля. */
export function parseWhen(value: string, now: Date): When {
  const time = Date.parse(value);
  if (!value || Number.isNaN(time)) return { ok: false, error: 'Выберите дату и время' };
  if (time < now.getTime()) return { ok: false, error: 'Эта дата уже прошла' };
  return { ok: true, iso: new Date(time).toISOString() };
}

function WhenField(props: {
  readonly value: string;
  readonly error: string | null;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="pf-f iw-f">
      <label htmlFor="iw-when">Дата и время</label>
      <input
        id="iw-when"
        type="datetime-local"
        className="pf-pick"
        value={props.value}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={props.error ? 'iw-err' : undefined}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
      {props.error ? (
        <small className="is-err" id="iw-err">
          <Icon name="warn" />
          {props.error}
        </small>
      ) : null}
    </div>
  );
}

/** «Когда интервью?» (I1d): интервью ещё не записано — дата заводит его и открывает подготовку. */
export function WhenForm(props: { readonly responseId: string; readonly onCreated: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'failed'>('idle');
  async function submit(event: FormEvent) {
    event.preventDefault();
    const when = parseWhen(value, new Date());
    setError(when.ok ? null : when.error);
    if (!when.ok) return;
    setState('saving');
    try {
      await createApplicationInterview(props.responseId, { round: 1, scheduledAt: when.iso });
      props.onCreated();
    } catch {
      setState('failed');
    }
  }
  return (
    <form className="lead col-wide iw-lead" aria-labelledby="iw-t" noValidate onSubmit={submit}>
      <h2 className="lead-title" id="iw-t">
        Когда интервью?
      </h2>
      <WhenField value={value} error={error} onChange={setValue} />
      {state === 'failed' ? (
        <StatusLine state="err" text="Интервью не записалось. Попробуйте ещё раз." />
      ) : null}
      <div className="actions">
        <Button type="submit" variant="primary" disabled={state === 'saving'}>
          <Icon name="compass" />
          Готовиться
        </Button>
      </div>
    </form>
  );
}
