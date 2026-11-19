import { useState } from 'react';
import type { CareerDiaryEntry } from '../../../../shared/careerDiaryEntries';
import { Icon } from '../kit/Icon';
import { StatusLine } from '../kit/ResultLine';
import { Link } from '../shell/Link';
import { buildNodePath } from '../routes';
import { EntryEditor, type GoalOption } from './EntryEditor';
import { kindView, shortDate } from './model';
import { RetryButton } from './parts';

export type { GoalOption } from './EntryEditor';

export interface EntryItemProps {
  readonly entry: CareerDiaryEntry;
  readonly goals: readonly GoalOption[];
  readonly open?: boolean;
  /** В карточке цели ссылка на цель у записи не нужна. */
  readonly showGoal?: boolean;
  readonly onSaved: (entry: CareerDiaryEntry) => void;
  readonly onDelete: (entry: CareerDiaryEntry) => Promise<void>;
}

function useRemove(entry: CareerDiaryEntry, onDelete: EntryItemProps['onDelete']) {
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState(false);
  async function remove() {
    setDeleting(true);
    setFailed(false);
    try {
      await onDelete(entry);
    } catch {
      setFailed(true);
      setDeleting(false);
    }
  }
  return { deleting, failed, remove };
}

interface EntryActionsProps {
  readonly goal: GoalOption | null;
  readonly deleting: boolean;
  readonly onEdit: () => void;
  readonly onRemove: () => void;
}

/** Цель записи и действия «Изменить», «Удалить» (`div.dn-more`). */
function EntryActions({ goal, deleting, onEdit, onRemove }: EntryActionsProps) {
  return (
    <div className="dn-more">
      {goal ? (
        <Link className="dn-goal-link" to={buildNodePath('d02a', { goalId: goal.id })}>
          <Icon name="target" />
          {goal.title}
        </Link>
      ) : (
        <span />
      )}
      <span className="dn-acts">
        <button className="row-act" type="button" onClick={onEdit}>
          Изменить
        </button>
        <button className="row-act is-danger" type="button" disabled={deleting} onClick={onRemove}>
          Удалить
        </button>
      </span>
    </div>
  );
}

/** Запись ленты (`li.dn-entry`): раскрывается в цель и действия. */
export function EntryItem({
  entry,
  goals,
  open = false,
  showGoal = true,
  onSaved,
  onDelete,
}: EntryItemProps) {
  const [editing, setEditing] = useState(false);
  const { deleting, failed, remove } = useRemove(entry, onDelete);
  const view = kindView(entry.kind);
  const goal = showGoal ? (goals.find((item) => item.id === entry.goalId) ?? null) : null;
  const saved = (next: CareerDiaryEntry) => {
    setEditing(false);
    onSaved(next);
  };
  return (
    <li className="dn-entry">
      <details className="dn-e" open={open || editing || undefined}>
        <summary>
          <span className="dn-date num">{shortDate(entry.date)}</span>
          <span className="dn-text">{entry.text}</span>
          <span className={view.tagClass}>{view.tag}</span>
        </summary>
        {editing ? (
          <EntryEditor
            entry={entry}
            goals={goals}
            onCancel={() => setEditing(false)}
            onSaved={saved}
          />
        ) : (
          <EntryActions
            goal={goal}
            deleting={deleting}
            onEdit={() => setEditing(true)}
            onRemove={() => void remove()}
          />
        )}
        {failed ? (
          <StatusLine
            state="err"
            text="Запись не удалилась"
            action={<RetryButton onClick={() => void remove()} />}
          />
        ) : null}
      </details>
    </li>
  );
}
