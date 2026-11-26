import type { CareerDiaryEntry } from '../../../../shared/careerDiaryEntries';
import { Icon } from '../kit/Icon';
import type { WeekForm } from './weekModel';

export interface WeekAchievedProps {
  readonly entries: readonly CareerDiaryEntry[];
  readonly form: WeekForm;
  readonly onChange: (patch: Partial<WeekForm>) => void;
  readonly dateOf: (date: string) => string;
}

function RemoveButton({ onClick }: { readonly onClick: () => void }) {
  return (
    <button className="icon-btn" type="button" aria-label="Убрать из итога" onClick={onClick}>
      <Icon name="close" />
    </button>
  );
}

interface NoteRowProps {
  readonly index: number;
  readonly form: WeekForm;
  readonly onChange: (patch: Partial<WeekForm>) => void;
}

/** Своя строка в «Что получилось». */
function NoteRow({ index, form, onChange }: NoteRowProps) {
  return (
    <li className="check">
      <label className="vh" htmlFor={`wk-note-${index}`}>
        Что ещё получилось
      </label>
      <input
        id={`wk-note-${index}`}
        type="text"
        value={form.notes[index]}
        placeholder="Например: договорились о тестовой среде"
        onChange={(event) =>
          onChange({
            notes: form.notes.map((item, at) => (at === index ? event.target.value : item)),
          })
        }
      />
      <RemoveButton
        onClick={() => onChange({ notes: form.notes.filter((_, at) => at !== index) })}
      />
    </li>
  );
}

/**
 * «Что получилось»: записи недели (проблемы — только если кандидат сам отметил их),
 * крестик убирает запись из итога, «Добавить» — своя строка.
 */
export function WeekAchieved({ entries, form, onChange, dateOf }: WeekAchievedProps) {
  const shown = entries.filter(
    (entry) =>
      !form.hiddenIds.includes(entry.id) &&
      (entry.kind !== 'problem' || form.achievedIds.includes(entry.id)),
  );
  const toggle = (id: string, checked: boolean) => {
    const rest = form.achievedIds.filter((known) => known !== id);
    onChange({ achievedIds: checked ? [...rest, id] : rest });
  };
  return (
    <li className="dn-fs">
      <h3>Что получилось</h3>
      <ul className="checks">
        {shown.map((entry) => (
          <li className="check" key={entry.id}>
            <input
              type="checkbox"
              id={`wk-${entry.id}`}
              checked={form.achievedIds.includes(entry.id)}
              onChange={(event) => toggle(entry.id, event.target.checked)}
            />
            <label htmlFor={`wk-${entry.id}`}>
              {entry.text}
              <span className="when">{dateOf(entry.date)}</span>
            </label>
            <RemoveButton onClick={() => onChange({ hiddenIds: [...form.hiddenIds, entry.id] })} />
          </li>
        ))}
        {form.notes.map((_, index) => (
          <NoteRow key={`note-${index}`} index={index} form={form} onChange={onChange} />
        ))}
      </ul>
      <div className="actions">
        <button
          className="btn is-quiet"
          type="button"
          onClick={() => onChange({ notes: [...form.notes, ''] })}
        >
          <Icon name="plus" />
          Добавить
        </button>
      </div>
    </li>
  );
}
