import type { CareerDiaryEntry } from '../../../../shared/careerDiaryEntries';
import { Button } from '../kit/Button';
import { StatusLine } from '../kit/ResultLine';
import { useToast } from '../kit/Toast';
import { deleteEntry } from './diaryApi';
import { EntryItem, type GoalOption } from './EntryItem';
import { RetryButton } from './parts';
import { useEntries } from './useEntries';

/** «Записи по цели»: записи ленты, привязанные к цели; правка и удаление на месте. */
export function GoalEntries({ goal }: { readonly goal: GoalOption }) {
  const goalId = goal.id;
  const feed = useEntries(null, goalId);
  const toast = useToast();
  const remove = async (entry: CareerDiaryEntry) => {
    await deleteEntry(entry.id);
    feed.remove(entry.id);
    toast.show({ text: 'Запись удалена' });
  };
  const { state } = feed;
  if (state.state === 'loading') return <StatusLine state="wait" text="Загружаем записи" />;
  if (state.state === 'error') {
    return (
      <StatusLine
        state="err"
        text="Записи не загрузились"
        action={<RetryButton onClick={feed.retry} />}
      />
    );
  }
  if (state.feed.items.length === 0) return null;
  return (
    <section className="gt-sec" aria-labelledby="ga-e">
      <h3 className="gt-sec-h" id="ga-e">
        {`Записи по цели · ${state.feed.items.length}${state.feed.nextCursor ? '+' : ''}`}
      </h3>
      <ul className="dn-list">
        {state.feed.items.map((entry) => (
          <EntryItem
            key={entry.id}
            entry={entry}
            goals={[goal]}
            showGoal={false}
            onSaved={feed.put}
            onDelete={remove}
          />
        ))}
      </ul>
      {state.feed.nextCursor ? (
        <div className="vl-foot ct-foot">
          <Button icon="down" busy={state.loadingMore} onClick={feed.loadMore}>
            <span>Показать ещё</span>
          </Button>
        </div>
      ) : null}
    </section>
  );
}
