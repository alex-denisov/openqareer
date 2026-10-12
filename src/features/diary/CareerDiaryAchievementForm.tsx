import { useEffect, useRef, useState } from 'react';
import { CaretLeft, Check } from '@phosphor-icons/react';
import type { CareerDiaryAchievementInput } from '../../../shared/careerDiary';

interface CareerDiaryAchievementFormProps {
  readonly onClose: () => void;
  readonly onSave: (input: CareerDiaryAchievementInput) => Promise<void>;
}

const emptyDraft: CareerDiaryAchievementInput = { situation: '', action: '', result: '' };

export function CareerDiaryAchievementForm({ onClose, onSave }: CareerDiaryAchievementFormProps) {
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus();
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus();
      else window.requestAnimationFrame(() => document.getElementById('career-diary-achievements-title')?.focus());
    };
  }, []);

  return (
    <section className="career-diary-achievement-form" aria-labelledby="career-diary-achievement-form-title">
      <header className="career-diary-achievement-form__header">
        <button className="career-btn is-ghost is-icon career-diary-back" type="button" aria-label="Назад к достижениям" onClick={onClose}>
          <CaretLeft size={20} aria-hidden="true" />
        </button>
        <h2 id="career-diary-achievement-form-title" ref={headingRef} tabIndex={-1}>Добавить достижение</h2>
      </header>
      <p className="career-diary-note">Опишите факт своими словами. В профиль он попадёт после предложения консультанта и вашего принятия.</p>
      <form onSubmit={(event) => { event.preventDefault(); void saveAchievementDraft(draft, onSave, setSaving, setError); }} noValidate>
        <AchievementField id="career-diary-achievement-situation" label="Ситуация" value={draft.situation} onChange={(value) => setDraft({ ...draft, situation: value })} />
        <AchievementField id="career-diary-achievement-action" label="Действие" value={draft.action} onChange={(value) => setDraft({ ...draft, action: value })} />
        <AchievementField id="career-diary-achievement-result" label="Результат" value={draft.result} onChange={(value) => setDraft({ ...draft, result: value })} />
        {error ? <p className="career-diary-error" role="alert">{error}</p> : null}
        <button className="career-btn is-primary" type="submit" disabled={saving} aria-busy={saving}>
          <Check size={18} aria-hidden="true" />{saving ? 'Сохраняем…' : 'Сохранить достижение'}
        </button>
      </form>
    </section>
  );
}

async function saveAchievementDraft(
  draft: CareerDiaryAchievementInput,
  onSave: CareerDiaryAchievementFormProps['onSave'],
  setSaving: (value: boolean) => void,
  setError: (value: string | null) => void,
): Promise<void> {
  if (!draft.situation.trim() || !draft.action.trim() || !draft.result.trim()) {
    setError('Заполните ситуацию, действие и результат.');
    return;
  }
  setSaving(true);
  setError(null);
  try {
    await onSave({
      situation: draft.situation.trim(),
      action: draft.action.trim(),
      result: draft.result.trim(),
    });
  } catch (reason) {
    setError(reason instanceof Error ? reason.message : 'Не удалось сохранить достижение. Повторите попытку.');
  } finally {
    setSaving(false);
  }
}

function AchievementField(props: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="career-field" htmlFor={props.id}>
      <span className="career-field-label">{props.label}</span>
      <textarea id={props.id} className="career-input" rows={4} maxLength={3000} value={props.value} onChange={(event) => props.onChange(event.currentTarget.value)} />
    </label>
  );
}
