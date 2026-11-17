import { useState } from 'react';
import { apiErrorMessage, CoachApiError } from '../../coach/apiClient';
import {
  getProfileHistory,
  revertProfileHistoryEntry,
  type ProfileHistoryItem,
} from '../../resume/profileHistoryApi';
import { Button, Icon, InfoTip, StatusLine } from '../kit';
import type { B640Node } from '../routes';
import { BlockError, BlockSkeleton } from '../today/parts';
import { useLoad } from '../today/useLoad';
import { historyDays, historyHeading, type HistoryDay, type HistoryRow } from './historyModel';

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const HISTORY_TIP =
  'Каждая правка профиля записывается с датой и источником. «Отменить» возвращает прежнее значение и тоже попадает в историю.';

function loadFirstPage(signal: AbortSignal) {
  return getProfileHistory(0, signal);
}

type RevertState = 'idle' | 'busy' | { readonly error: string };

interface RowProps {
  readonly row: HistoryRow;
  readonly day: string;
  readonly onReverted: (id: string) => void;
}

function RowDiff({ row }: { readonly row: HistoryRow }) {
  return (
    <>
      <p className="hx-diff">
        <s className="hx-was">{row.was}</s>
        <Icon name="right" label="стало" />
        <span className="hx-now">{row.now}</span>
      </p>
      {row.reverted ? (
        <p className="res-row hx-res" role="status">
          <Icon name="check" />
          <span className="res-t">Отменено</span>
        </p>
      ) : null}
    </>
  );
}

function Row({ row, day, onReverted }: RowProps) {
  const [state, setState] = useState<RevertState>('idle');

  async function revert() {
    setState('busy');
    try {
      await revertProfileHistoryEntry(row.id);
      setState('idle');
      onReverted(row.id);
    } catch (reason) {
      // Правку уже отменили (в другой вкладке): показываем её отменённой.
      if (reason instanceof CoachApiError && reason.code === 'profile_change_already_reverted') {
        setState('idle');
        onReverted(row.id);
        return;
      }
      setState({ error: apiErrorMessage(reason, 'Не удалось отменить правку.') });
    }
  }

  return (
    <li className="hx-row">
      <details className="hx-it" open>
        <summary className="hx-sum">
          <span className="hx-what">{row.what}</span>
          <span className="hx-src">{row.source}</span>
          <Icon name="down" className="hx-chev" />
        </summary>
        <RowDiff row={row} />
        {row.revertable ? (
          <button
            className="row-act is-neutral hx-undo"
            type="button"
            disabled={state === 'busy'}
            aria-busy={state === 'busy' || undefined}
            aria-label={`Отменить: ${row.what}, ${day}`}
            onClick={() => void revert()}
          >
            Отменить
          </button>
        ) : null}
        {typeof state === 'object' ? <StatusLine state="err" text={state.error} /> : null}
      </details>
    </li>
  );
}

function Days({
  days,
  onReverted,
}: {
  readonly days: readonly HistoryDay[];
  readonly onReverted: (id: string) => void;
}) {
  return (
    <>
      {days.map((day) => (
        <section className="hx-day" aria-labelledby={`hx-${day.key}`} key={day.key}>
          <h3 className="hx-d" id={`hx-${day.key}`}>
            {day.label}
          </h3>
          <ul className="hx-rows">
            {day.rows.map((row) => (
              <Row row={row} day={day.label} onReverted={onReverted} key={row.id} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

interface FeedState {
  readonly entries: readonly ProfileHistoryItem[];
  readonly total: number;
  readonly page: number;
}

/** Догрузка следующих страниц и отметка отменённых правок поверх первой страницы. */
function useHistoryFeed(first: FeedState) {
  const [feed, setFeed] = useState<FeedState>(first);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function more() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const next = await getProfileHistory(feed.page + 1);
      const known = new Set(feed.entries.map((entry) => entry.id));
      setFeed({
        entries: [...feed.entries, ...next.entries.filter((entry) => !known.has(entry.id))],
        total: next.total,
        page: next.page,
      });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  /**
   * После отмены в истории появляется новая запись: перечитываем начало списка.
   * Если чтение не удалось, отмечаем правку отменённой на месте.
   */
  async function markReverted(id: string) {
    try {
      const fresh = await getProfileHistory(0);
      setFeed({ entries: fresh.entries, total: fresh.total, page: fresh.page });
    } catch {
      setFeed((current) => ({
        ...current,
        entries: current.entries.map((entry) =>
          entry.id === id ? { ...entry, revertedAt: entry.createdAt } : entry,
        ),
      }));
    }
  }

  return { feed, busy, failed, more, markReverted };
}

function History({ first }: { readonly first: FeedState }) {
  const { feed, busy, failed, more, markReverted } = useHistoryFeed(first);
  const left = feed.total - feed.entries.length;
  return (
    <>
      <div className="lead-head">
        <h2 className="lead-title" id="hx-title">
          {historyHeading(feed.total)}
        </h2>
        <InfoTip label="Как ведётся история" text={HISTORY_TIP} />
      </div>
      <Days
        days={historyDays(feed.entries, TIME_ZONE)}
        onReverted={(id) => void markReverted(id)}
      />
      {left > 0 ? (
        <div className="actions">
          <Button variant="quiet" icon="down" busy={busy} onClick={() => void more()}>
            {`Показать ещё ${Math.min(20, left)}`}
          </Button>
        </div>
      ) : null}
      {failed ? (
        <BlockError text="Не удалось загрузить ещё правки." onRetry={() => void more()} />
      ) : null}
    </>
  );
}

/** p10 «История изменений»: правки профиля по дням, «Отменить» у каждой, по 20 на порцию. */
export function HistoryScreen({ node }: { readonly node: B640Node }) {
  const first = useLoad(loadFirstPage);
  return (
    <div className="page" data-b640-node={node.code} data-b640-section={node.section}>
      <div className="col col-wide">
        <section className="lead hx" aria-labelledby="hx-title">
          {first.state === 'loading' ? (
            <>
              <h2 className="lead-title" id="hx-title">
                История изменений
              </h2>
              <BlockSkeleton label="Загружаем историю" rows={4} />
            </>
          ) : null}
          {first.state === 'error' ? (
            <>
              <h2 className="lead-title" id="hx-title">
                История изменений
              </h2>
              <BlockError text="Не удалось загрузить историю." onRetry={first.retry} />
            </>
          ) : null}
          {first.state === 'ready' ? <History first={first.data} /> : null}
        </section>
      </div>
    </div>
  );
}
