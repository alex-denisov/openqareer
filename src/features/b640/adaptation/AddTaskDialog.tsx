import { useState } from 'react';
import type { CareerDiaryNewAdaptationTask } from '../../diary/careerDiaryPlanning';
import { Button } from '../kit/Button';
import { Dialog } from '../kit/Dialog';
import { StatusLine } from '../kit/ResultLine';
import { stageForDate } from './adaptationModel';
import { Field } from './StartPlan';

interface Props {
  readonly open: boolean;
  readonly startDate: string;
  readonly onClose: () => void;
  readonly onAdd: (task: CareerDiaryNewAdaptationTask) => Promise<void>;
}

/** «Добавить задачу» в план: этап задачи берётся из её срока. */
export function AddTaskDialog({ open, startDate, onClose, onAdd }: Props) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [errors, setErrors] = useState<{ title?: string; dueDate?: string }>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function add() {
    const found = {
      ...(title.trim() ? {} : { title: 'Напишите задачу' }),
      ...(dueDate ? {} : { dueDate: 'Укажите срок' }),
    };
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setFailed(false);
    try {
      await onAdd({ title: title.trim(), dueDate, stage: stageForDate(startDate, dueDate), category: 'delivery' });
      setTitle('');
      setDueDate('');
      onClose();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  const footer = (
    <>
      <Button variant="primary" icon="plus" busy={busy} onClick={() => void add()}>
        Добавить
      </Button>
      <Button onClick={onClose}>Отмена</Button>
    </>
  );
  return (
    <Dialog open={open} onClose={onClose} title="Новая задача" footer={footer}>
      <Field id="at-title" label="Задача" value={title} placeholder="Например: встреча с командой эксплуатации" error={errors.title} onChange={setTitle} />
      <Field id="at-due" label="Срок" type="date" value={dueDate} error={errors.dueDate} onChange={setDueDate} />
      {failed ? <StatusLine state="err" text="Задача не добавилась, попробуйте ещё раз" /> : null}
    </Dialog>
  );
}
