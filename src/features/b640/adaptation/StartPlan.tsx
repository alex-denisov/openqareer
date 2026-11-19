import { useState, type FormEvent } from 'react';
import { createCareerDiaryAdaptationPlan } from '../../diary/careerDiaryPlanning';
import { ActionDock } from '../kit/ActionDock';
import { Button } from '../kit/Button';
import { StatusLine } from '../kit/ResultLine';
import { createWorkplace, savePlan } from './adaptationApi';

export function Field(props: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly type?: 'text' | 'date';
  readonly placeholder?: string;
  readonly error?: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="gb-f">
      <label htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        type={props.type ?? 'text'}
        value={props.value}
        maxLength={200}
        placeholder={props.placeholder}
        aria-invalid={props.error ? true : undefined}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
      {props.error ? <p className="va-err" role="alert">{props.error}</p> : null}
    </div>
  );
}

const EMPTY = { company: '', title: '', startDate: '' };
type Draft = typeof EMPTY;

function errorsOf(draft: Draft): Partial<Record<keyof Draft, string>> {
  return {
    ...(draft.company.trim() ? {} : { company: 'Укажите компанию' }),
    ...(draft.title.trim() ? {} : { title: 'Укажите должность' }),
    ...(draft.startDate ? {} : { startDate: 'Укажите день выхода' }),
  };
}

/** Нет места работы: компания, должность и день выхода — и план 30-60-90 готов. */
export function StartWorkplace({ onDone }: { readonly onDone: () => void }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const set = (key: keyof Draft) => (value: string) => setDraft({ ...draft, [key]: value });
  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = errorsOf(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setFailed(false);
    try {
      const workplace = await createWorkplace({ ...draft, company: draft.company.trim(), title: draft.title.trim() });
      await savePlan(workplace.id, createCareerDiaryAdaptationPlan(workplace, new Date().toISOString()));
      onDone();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }
  return (
    <form className="gb-form" onSubmit={(event) => void submit(event)} aria-labelledby="ap-start">
      <h2 className="lead-title" id="ap-start">План первых 90 дней на новом месте</h2>
      <Field id="ap-company" label="Компания" value={draft.company} error={errors.company} onChange={set('company')} />
      <Field id="ap-title" label="Должность" value={draft.title} error={errors.title} onChange={set('title')} />
      <Field id="ap-start-date" label="День выхода" type="date" value={draft.startDate} error={errors.startDate} onChange={set('startDate')} />
      {failed ? <StatusLine state="err" text="План не создался, попробуйте ещё раз" /> : null}
      <ActionDock kind="commit" primary={<Button variant="primary" type="submit" busy={busy}>Начать план</Button>} />
    </form>
  );
}

/** Место работы есть, плана нет. */
export function StartTemplate({ onStart }: { readonly onStart: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function start() {
    setBusy(true);
    setFailed(false);
    try {
      await onStart();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="lead" aria-labelledby="ap-empty">
      <h2 className="lead-title" id="ap-empty">План первых 90 дней на новом месте</h2>
      {failed ? <StatusLine state="err" text="План не создался, попробуйте ещё раз" /> : null}
      <ActionDock
        kind="commit"
        primary={<Button variant="primary" icon="plus" busy={busy} onClick={() => void start()}>Начать план</Button>}
      />
    </section>
  );
}
