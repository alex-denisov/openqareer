import { useEffect, useState } from 'react';
import { Icon } from '../kit/Icon';
import { Link } from '../shell/Link';
import {
  fetchConversation,
  type ConsultantConversationDetail,
  type ConsultantConversationSummary,
} from './consultantApi';
import { conversationTitle, dayLabel } from './model';
import { ErrorRow, Message } from './parts';
import { useHistory } from './useHistory';

export interface HistoryViewProps {
  /** Адрес прошлого разговора по его номеру. */
  readonly conversationPath: (id: string) => string;
  /** «Начать» в пустом списке: открыть текущий разговор. */
  readonly onStart: () => void;
}

interface RowsProps {
  readonly items: readonly ConsultantConversationSummary[];
  readonly pathOf: (id: string) => string;
}

function Rows({ items, pathOf }: RowsProps) {
  return (
    <ul className="hist hist2" aria-label="Разговоры, последние сверху">
      {items.map((item) => (
        <li key={item.id}>
          <Link className="hist-t hist-row" to={pathOf(item.id)}>
            <span className="hist-tt">{conversationTitle(item)}</span>
            <span className="hist-open" aria-hidden="true">
              <span className="hist-open-l">Открыть</span>
              <Icon name="arrow" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Empty({ onStart }: { readonly onStart: () => void }) {
  return (
    <div className="vl-empty" role="status">
      <p className="vl-empty-t">Разговоров пока нет</p>
      <div className="actions">
        <button className="btn is-primary" type="button" onClick={onStart}>
          <Icon name="chat" />
          Начать
        </button>
      </div>
    </div>
  );
}

/** «Все разговоры» (K5, пусто — K5b): темы одной строкой, последние сверху, по 20. */
export function HistoryView({ conversationPath, onStart }: HistoryViewProps) {
  const { items, nextCursor, status, loadMore, retry } = useHistory();
  const loadingMore = status === 'more';
  return (
    <div className="chat" aria-live="polite" aria-busy={status === 'loading'}>
      {items.length > 0 ? <Rows items={items} pathOf={conversationPath} /> : null}
      {status === 'failed' ? <ErrorRow text="Разговоры не загрузились" onRetry={retry} /> : null}
      {nextCursor && status !== 'failed' ? (
        <div className="vl-foot">
          <button
            className="btn"
            type="button"
            disabled={loadingMore}
            aria-busy={loadingMore || undefined}
            onClick={loadMore}
          >
            Показать ещё
          </button>
        </div>
      ) : null}
      {status === 'ready' && items.length === 0 ? <Empty onStart={onStart} /> : null}
    </div>
  );
}

type ConversationState =
  | { readonly status: 'loading' | 'failed' }
  | { readonly status: 'ready'; readonly detail: ConsultantConversationDetail };

/** Прошлый разговор из списка: лента с датой. */
export function ConversationView({ id }: { readonly id: string }) {
  const [state, setState] = useState<ConversationState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    fetchConversation(id)
      .then((detail) => active && setState({ status: 'ready', detail }))
      .catch(() => active && setState({ status: 'failed' }));
    return () => {
      active = false;
    };
  }, [id, attempt]);

  function retry() {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }

  const detail = state.status === 'ready' ? state.detail : null;
  const day = detail ? dayLabel(detail.lastMessageAt) : null;
  return (
    <div className="chat" aria-live="polite" aria-busy={state.status === 'loading'}>
      {state.status === 'failed' ? <ErrorRow text="Разговор не загрузился" onRetry={retry} /> : null}
      {day ? <span className="day">{day}</span> : null}
      {detail?.messages.map((message) => <Message key={message.id} message={message} />)}
    </div>
  );
}
