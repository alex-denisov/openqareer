import { useId, useState } from 'react';
import type { CareerDiaryGoalSummary } from '../../../../shared/careerDiary';
import { DIARY_NOTE_MAX } from '../../../../shared/careerDiaryCards';
import { Button } from '../kit/Button';
import { Dialog } from '../kit/Dialog';
import { StatusLine } from '../kit/ResultLine';
import { DateInput } from '../kit/DateInput';
import { recordMeasurement } from './diaryApi';
import { today } from './model';

export interface MeasureDialogProps {
  readonly goal: CareerDiaryGoalSummary | null;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

/** Числовое значение с запятой или точкой; «да»/«нет» для цели «сделано или нет». */
export function parseMeasure(
  goal: CareerDiaryGoalSummary,
  raw: string,
): number | boolean | string | null {
  const text = raw.trim();
  if (!text) return null;
  if (typeof goal.targetValue === 'boolean') return /^(да|сделано|yes)$/iu.test(text);
  if (typeof goal.targetValue === 'number') {
    const value = Number(text.replace(',', '.'));
    return Number.isFinite(value) ? value : null;
  }
  return text;
}

function useMeasure(goal: CareerDiaryGoalSummary | null, onSaved: () => void) {
  const [value, setValue] = useState('');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!goal) return;
    const parsed = parseMeasure(goal, value);
    if (parsed === null) {
      setError('Введите число');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await recordMeasurement(goal.id, {
        value: parsed,
        measuredAt: date,
        note: note.trim() || null,
      });
      setValue('');
      setNote('');
      onSaved();
    } catch {
      setError('Замер не сохранился. Повторите.');
    } finally {
      setBusy(false);
    }
  }
  return { value, setValue, date, setDate, note, setNote, busy, error, save };
}

interface FooterProps {
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onSave: () => void;
}

function Footer({ busy, onClose, onSave }: FooterProps) {
  return (
    <>
      <Button onClick={onClose}>Отмена</Button>
      <Button variant="primary" icon="check" busy={busy} onClick={onSave}>
        Сохранить замер
      </Button>
    </>
  );
}

/** «Внести замер»: значение, день и комментарий. */
export function MeasureDialog({ goal, onClose, onSaved }: MeasureDialogProps) {
  const id = useId();
  const form = useMeasure(goal, onSaved);
  const footer = <Footer busy={form.busy} onClose={onClose} onSave={() => void form.save()} />;
  return (
    <Dialog open={goal !== null} onClose={onClose} title="Внести замер" footer={footer}>
      <div className="field">
        <label htmlFor={`${id}-v`}>
          {goal?.unit ? `${goal.title}, ${goal.unit}` : (goal?.title ?? '')}
        </label>
        <input
          id={`${id}-v`}
          type="text"
          inputMode={typeof goal?.targetValue === 'number' ? 'decimal' : 'text'}
          placeholder={typeof goal?.targetValue === 'boolean' ? 'да или нет' : undefined}
          value={form.value}
          onChange={(event) => form.setValue(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-d`}>День замера</label>
        <DateInput id={`${id}-d`} value={form.date} max={today()} onChange={form.setDate} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-n`}>Комментарий</label>
        <input
          id={`${id}-n`}
          type="text"
          maxLength={DIARY_NOTE_MAX}
          placeholder="Например: 12 откликов, 3 интервью"
          value={form.note}
          onChange={(event) => form.setNote(event.target.value)}
        />
      </div>
      {form.error ? <StatusLine state="err" text={form.error} /> : null}
    </Dialog>
  );
}
