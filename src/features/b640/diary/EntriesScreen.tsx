import { useState } from 'react';
import {
  diaryWeekStart,
  type CareerDiaryEntry,
  type CareerDiaryEntryKind,
} from '../../../../shared/careerDiaryEntries';
import { Button } from '../kit/Button';
import { Icon } from '../kit/Icon';
import { StatusLine } from '../kit/ResultLine';
import { useToast } from '../kit/Toast';
import { buildNodePath, type B640Node } from '../routes';
import { Link } from '../shell/Link';
import { createEntry, deleteEntry } from './diaryApi';
import { KINDS, groupByWeek, nearestDue, today, weekNumber, weekdayDate } from './model';
import { RetryButton } from './parts';
import { QuickEntry } from './QuickEntry';
import { useDiaryContext } from './useDiaryContext';
import { useEntries, type EntriesApi, type Feed } from './useEntries';
import { WeekSection } from './WeekSection';
import type { GoalOption } from './EntryEditor';
import './diary.css';

function oldestDate(entries: readonly CareerDiaryEntry[]): string | null {
  return entries.reduce<string | null>(
    (oldest, entry) => (oldest === null || entry.date < oldest ? entry.date : oldest),
    null,
  );
}

/** Удаление с тостом «Отменить»: отмена записывает запись заново. */
function useRemoveEntry(feed: EntriesApi) {
  const toast = useToast();
  return async (entry: CareerDiaryEntry) => {
    await deleteEntry(entry.id);
    feed.remove(entry.id);
    const restore = () => {
      const { date, kind, text, goalId } = entry;
      void createEntry({ date, kind, text, goalId }).then(feed.put, () =>
        toast.show({ text: 'Запись не вернулась' }),
      );
    };
    toast.show({ text: 'Запись удалена', undo: { label: 'Отменить', onUndo: restore } });
  };
}

interface KindChipsProps {
  readonly kind: CareerDiaryEntryKind | null;
  readonly onPick: (kind: CareerDiaryEntryKind | null) => void;
}

function KindChips({ kind, onPick }: KindChipsProps) {
  const options = [{ kind: null, chip: 'Все' }, ...KINDS];
  return (
    <div className="chips dn-kinds" role="group" aria-label="Фильтр по типу записи">
      {options.map((option) => (
        <button
          key={option.chip}
          className="chip"
          type="button"
          aria-pressed={kind === option.kind}
          onClick={() => onPick(option.kind)}
        >
          {option.chip}
        </button>
      ))}
    </div>
  );
}

interface NextGoal {
  readonly id: string;
  readonly title: string;
  readonly dueDate: string;
}

const nextText = (goal: NextGoal) => `${weekdayDate(goal.dueDate)} · срок цели «${goal.title}»`;

function NextMobile({ goal }: { readonly goal: NextGoal | null }) {
  if (!goal) return null;
  return (
    <Link className="dn-next-m only-mob" to={buildNodePath('d02a', { goalId: goal.id })}>
      <span className="dn-next-l">Ближайшее</span>
      <span className="dn-next-t">{nextText(goal)}</span>
      <Icon name="right" />
    </Link>
  );
}

function NextSide({ goal }: { readonly goal: NextGoal | null }) {
  if (!goal) return null;
  return (
    <section className="dn-side only-desk" aria-labelledby="dn-next">
      <h3 className="dn-side-h" id="dn-next">
        Ближайшее
      </h3>
      <p className="dn-side-t">{nextText(goal)}</p>
      <Link className="btn is-sm" to={buildNodePath('d02')}>
        Подготовить цели
      </Link>
    </section>
  );
}

interface FeedViewProps {
  readonly feed: Feed;
  readonly api: EntriesApi;
  readonly loadingMore: boolean;
  readonly moreFailed: boolean;
  readonly filtered: boolean;
  readonly goals: readonly GoalOption[];
  readonly origin: string | null;
  readonly onDelete: (entry: CareerDiaryEntry) => Promise<void>;
}

/** Недели ленты, пустое состояние и «Показать ещё». */
function FeedView({
  feed,
  api,
  loadingMore,
  moreFailed,
  filtered,
  goals,
  origin,
  onDelete,
}: FeedViewProps) {
  const day = today();
  const currentWeek = diaryWeekStart(day) ?? day;
  const start = origin ?? oldestDate(feed.items);
  return (
    <>
      {groupByWeek(feed.items, feed.summaries, currentWeek).map((group) => (
        <WeekSection
          key={group.weekStart}
          group={group}
          number={weekNumber(group.weekStart, start)}
          current={group.weekStart === currentWeek}
          goals={goals}
          onSaved={api.put}
          onDelete={onDelete}
        />
      ))}
      {feed.items.length === 0 ? (
        <p className="vl-empty">
          {filtered ? 'Записей такого типа пока нет.' : 'Здесь появятся ваши записи.'}
        </p>
      ) : null}
      {feed.nextCursor ? (
        <div className="vl-foot ct-foot">
          <Button icon="down" busy={loadingMore} onClick={api.loadMore}>
            <span>Показать ещё</span>
          </Button>
        </div>
      ) : null}
      {moreFailed ? (
        <StatusLine
          state="err"
          text="Не удалось загрузить"
          action={<RetryButton onClick={api.loadMore} />}
        />
      ) : null}
    </>
  );
}

/** Экран d00 «Записи»: быстрая запись, фильтр по типу, лента по неделям. */
export function EntriesScreen({ node }: { readonly node: B640Node }) {
  const [kind, setKind] = useState<CareerDiaryEntryKind | null>(null);
  const feed = useEntries(kind);
  const context = useDiaryContext();
  const remove = useRemoveEntry(feed);
  const next = nearestDue(context.goals, today());
  const { state } = feed;
  return (
    <div className="page two dn-page" data-b640-node={node.code} data-b640-section={node.section}>
      <div className="col">
        <QuickEntry kind={kind ?? 'note'} onCreated={feed.put} />
        <NextMobile goal={next} />
        <KindChips kind={kind} onPick={setKind} />
        {state.state === 'loading' ? <StatusLine state="wait" text="Загружаем записи" /> : null}
        {state.state === 'error' ? (
          <StatusLine
            state="err"
            text="Записи не загрузились"
            action={<RetryButton onClick={feed.retry} />}
          />
        ) : null}
        {state.state === 'ready' ? (
          <FeedView
            feed={state.feed}
            api={feed}
            loadingMore={state.loadingMore}
            moreFailed={state.moreFailed}
            filtered={kind !== null}
            goals={context.goals}
            origin={context.origin}
            onDelete={remove}
          />
        ) : null}
      </div>
      <div className="col">
        <NextSide goal={next} />
      </div>
    </div>
  );
}
