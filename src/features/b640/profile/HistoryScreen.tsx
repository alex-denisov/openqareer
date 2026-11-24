import { useState } from 'react';
import { apiErrorMessage, CoachApiError } from '../../coach/apiClient';
import { getProfileHistory, revertProfileHistoryEntry } from '../../resume/profileHistoryApi';
import { Button, Icon, InfoTip, StatusLine } from '../kit';
import type { B640Node } from '../routes';
import { BlockError, BlockSkeleton } from '../today/parts';
import { useLoad } from '../today/useLoad';
import { reapplyChange } from './profileExtrasApi';
import {
  historyDays,
  historyHeading,
  sourceChips,
  type HistoryDay,
  type HistoryRow,
} from './historyModel';
import { useHistoryFeed, type FeedState } from './useHistoryFeed';

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

interface RowDiffProps {
  readonly row: HistoryRow;
  readonly day: string;
  readonly busy: boolean;
  readonly onReapply: () => void;
}

function RowDiff({ row, day, busy, onReapply }: RowDiffProps) {
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
          {row.reappliable ? (
            <button
              className="res-act"
              type="button"
              disabled={busy}
              aria-label={`Вернуть: ${row.what}, ${day}`}
              onClick={onReapply}
            >
              Вернуть
            </button>
          ) : null}
        </p>
      ) : null}
    </>
  );
}

/** «Отменить» и «Вернуть» у правки: ожидание на кнопке, отказ — строкой в правке. */
function useRowAction(row: HistoryRow, onChanged: (id: string) => void) {
  const [state, setState] = useState<RevertState>('idle');

  async function run(action: (id: string) => Promise<void>, settled: string, fallback: string) {
    setState('busy');
    try {
      await action(row.id);
      setState('idle');
      onChanged(row.id);
    } catch (reason) {
      // Уже сделано в другой вкладке: показываем как есть на сервере.
      if (reason instanceof CoachApiError && reason.code === settled) {
        setState('idle');
        onChanged(row.id);
        return;
      }
      setState({ error: apiErrorMessage(reason, fallback) });
    }
  }

  const revert = () =>
    void run(
      revertProfileHistoryEntry,
      'profile_change_already_reverted',
      'Не удалось отменить правку.',
    );
  const reapply = () =>
    void run(reapplyChange, 'profile_change_not_reverted', 'Не удалось вернуть правку.');
  return { state, revert, reapply };
}

function Row({ row, day, onReverted }: RowProps) {
  const { state, revert, reapply } = useRowAction(row, onReverted);

  return (
    <li className="hx-row">
      <details className="hx-it" open>
        <summary className="hx-sum">
          <span className="hx-what">{row.what}</span>
          <span className="hx-src">{row.source}</span>
          <Icon name="down" className="hx-chev" />
        </summary>
        <RowDiff row={row} day={day} busy={state === 'busy'} onReapply={reapply} />
        {row.revertable ? (
          <button
            className="row-act is-neutral hx-undo"
            type="button"
            disabled={state === 'busy'}
            aria-busy={state === 'busy' || undefined}
            aria-label={`Отменить: ${row.what}, ${day}`}
            onClick={revert}
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

function History({ first }: { readonly first: FeedState }) {
  const { feed, busy, failed, source, choose, more, markReverted } = useHistoryFeed(first);
  const chips = sourceChips(feed.sources);
  const left = feed.total - feed.entries.length;
  return (
    <>
      <div className="lead-head">
        <h2 className="lead-title" id="hx-title">
          {historyHeading(feed.sources?.all ?? feed.total)}
        </h2>
        <InfoTip label="Как ведётся история" text={HISTORY_TIP} />
      </div>
      {chips.length > 0 && feed.sources?.all ? (
        <div className="chips" role="group" aria-label="Источник правки">
          {chips.map((chip) => (
            <button
              className="chip"
              type="button"
              key={chip.label}
              aria-pressed={chip.source === source}
              onClick={() => choose(chip.source)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      ) : null}
      <Days
        days={historyDays(feed.entries, TIME_ZONE)}
        onReverted={(id) => void markReverted(id)}
      />
      {left > 0 ? (
        <div className="actions">
          <Button variant="quiet" icon="down" busy={busy} onClick={() => more()}>
            {`Показать ещё ${Math.min(20, left)}`}
          </Button>
        </div>
      ) : null}
      {failed ? (
        <BlockError text="Не удалось загрузить ещё правки." onRetry={() => more()} />
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
