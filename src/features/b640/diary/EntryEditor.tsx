import { useId, useState } from 'react';
import {
  DIARY_ENTRY_TEXT_MAX,
  type CareerDiaryEntry,
  type CareerDiaryEntryKind,
} from '../../../../shared/careerDiaryEntries';
import { StatusLine } from '../kit/ResultLine';
import { updateEntry } from './diaryApi';
import { DateInput } from '../kit/DateInput';
import { KINDS } from './model';
import { RetryButton } from './parts';

export interface GoalOption {
  readonly id: string;
  readonly title: string;
}

interface Draft {
  readonly text: string;
  readonly date: string;
  readonly kind: CareerDiaryEntryKind;
  readonly goalId: string;
}

function useEditor(entry: CareerDiaryEntry, onSaved: (entry: CareerDiaryEntry) => void) {
  const [draft, setDraft] = useState<Draft>({
    text: entry.text,
    date: entry.date,
    kind: entry.kind,
    goalId: entry.goalId ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const blank = draft.text.trim() === '';
  const change = (patch: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...patch }));

  async function save() {
    if (blank) return;
    setBusy(true);
    setFailed(false);
    try {
      const { text, date, kind, goalId } = draft;
      onSaved(
        await updateEntry(entry.id, { text: text.trim(), date, kind, goalId: goalId || null }),
      );
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return { draft, change, busy, failed, blank, save };
}

interface FieldsProps {
  readonly id: string;
  readonly draft: Draft;
  readonly goals: readonly GoalOption[];
  readonly change: (patch: Partial<Draft>) => void;
}

/** День, тип и цель записи в один ряд (на 390 — столбиком). */
function EditorRow({ id, draft, goals, change }: FieldsProps) {
  return (
    <div className="dn-edit-row">
      <div className="field">
        <label htmlFor={`${id}-d`}>День</label>
        <DateInput
          id={`${id}-d`}
          value={draft.date}
          required
          onChange={(date) => change({ date })}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-k`}>Тип</label>
        <select
          id={`${id}-k`}
          value={draft.kind}
          onChange={(event) => change({ kind: event.target.value as CareerDiaryEntryKind })}
        >
          {KINDS.map((option) => (
            <option key={option.kind} value={option.kind}>
              {option.chip}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${id}-g`}>Цель</label>
        <select
          id={`${id}-g`}
          value={draft.goalId}
          onChange={(event) => change({ goalId: event.target.value })}
        >
          <option value="">Без цели</option>
          {goals.map((option) => (
            <option key={option.id} value={option.id}>
              {option.title}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export interface EntryEditorProps {
  readonly entry: CareerDiaryEntry;
  readonly goals: readonly GoalOption[];
  readonly onCancel: () => void;
  readonly onSaved: (entry: CareerDiaryEntry) => void;
}

/** Правка записи на месте: текст, день, вид и цель. */
export function EntryEditor({ entry, goals, onCancel, onSaved }: EntryEditorProps) {
  const id = useId();
  const { draft, change, busy, failed, blank, save } = useEditor(entry, onSaved);
  return (
    <form
      className="dn-edit"
      aria-label="Изменить запись"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="field">
        <label htmlFor={`${id}-t`}>Запись</label>
        <textarea
          id={`${id}-t`}
          value={draft.text}
          maxLength={DIARY_ENTRY_TEXT_MAX}
          onChange={(event) => change({ text: event.target.value })}
        />
      </div>
      <EditorRow id={id} draft={draft} goals={goals} change={change} />
      {failed ? (
        <StatusLine state="err" text="Запись не сохранилась" action={<RetryButton submit />} />
      ) : null}
      <div className="actions">
        <button className="btn is-primary is-sm" type="submit" disabled={busy || blank}>
          Сохранить
        </button>
        <button className="btn is-sm" type="button" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}
