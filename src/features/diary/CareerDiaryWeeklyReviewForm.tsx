import { useEffect, useRef, type FormEvent } from 'react';
import { CaretLeft, Check } from '@phosphor-icons/react';
import type { CareerDiaryWeeklyReviewInput } from '../../../shared/careerDiary';

export type CareerDiaryWeeklyReviewDraft = Omit<CareerDiaryWeeklyReviewInput, 'weekStart'>;

export interface CareerDiaryWeeklyReviewFormProps {
  readonly weekTitle: string;
  readonly draft: CareerDiaryWeeklyReviewDraft;
  readonly saving: boolean;
  readonly error: string | null;
  readonly onDraftChange: (draft: CareerDiaryWeeklyReviewDraft) => void;
  readonly onClose: () => void;
  readonly onSave: () => void;
}

export function CareerDiaryWeeklyReviewForm(props: CareerDiaryWeeklyReviewFormProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus();
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus();
      else window.requestAnimationFrame(() => document.getElementById('career-diary-review-current-title')?.focus());
    };
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    props.onSave();
  }

  return (
    <section className="career-diary-review-form" aria-labelledby="career-diary-review-form-title">
      <header className="career-diary-review-form__header">
        <button className="career-btn is-ghost is-icon career-diary-back" type="button" aria-label="Назад к разборам" onClick={props.onClose}>
          <CaretLeft size={20} aria-hidden="true" />
        </button>
        <div>
          <p className="career-diary-eyebrow">Только ваши заметки</p>
          <h3 id="career-diary-review-form-title" ref={headingRef} tabIndex={-1}>{props.weekTitle}</h3>
        </div>
      </header>
      <p className="career-diary-note">Заготовка консультанта не сохранена. Отметьте только то, что действительно произошло.</p>
      <form onSubmit={submit} noValidate>
        <div className="career-diary-review-fields">
          <ReviewField id="career-diary-review-moved" label="Что сдвинулось" value={props.draft.movedForward} onChange={(value) => props.onDraftChange({ ...props.draft, movedForward: value })} />
          <ReviewField id="career-diary-review-blockers" label="Что мешало" value={props.draft.blockers} onChange={(value) => props.onDraftChange({ ...props.draft, blockers: value })} />
          <ReviewField id="career-diary-review-learning" label="Чему научился" value={props.draft.learning} onChange={(value) => props.onDraftChange({ ...props.draft, learning: value })} />
          <ReviewField id="career-diary-review-risks" label="Риски и блокеры" value={props.draft.risks} onChange={(value) => props.onDraftChange({ ...props.draft, risks: value })} />
          <ReviewField id="career-diary-review-next-week" label="Вывод на следующую неделю" value={props.draft.nextWeek} onChange={(value) => props.onDraftChange({ ...props.draft, nextWeek: value })} />
        </div>
        {props.error ? <p className="career-diary-error" role="alert">{props.error}</p> : null}
        <button className="career-btn is-primary" type="submit" disabled={props.saving} aria-busy={props.saving}>
          <Check size={18} aria-hidden="true" />{props.saving ? 'Сохраняем…' : 'Сохранить разбор'}
        </button>
      </form>
    </section>
  );
}

function ReviewField(props: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="career-field" htmlFor={props.id}>
      <span className="career-field-label">{props.label}</span>
      <textarea id={props.id} className="career-input" rows={4} maxLength={4000} value={props.value} onChange={(event) => props.onChange(event.currentTarget.value)} />
    </label>
  );
}
