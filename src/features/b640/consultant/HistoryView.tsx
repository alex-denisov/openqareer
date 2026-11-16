import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../kit/Icon';
import { Link } from '../shell/Link';
import {
  fetchConversation,
  fetchConversationPage,
  type ConsultantConversationDetail,
  type ConsultantConversationSummary,
} from './consultantApi';
import { Message } from './DialogView';
import { conversationTitle, dayLabel } from './model';

function ErrorRow({ text, onRetry }: { readonly text: string; readonly onRetry: () => void }) {
  return (
    <p className="res-row is-err" role="alert">
      <Icon name="warn" />
      <span className="res-t">{text}</span>
      <button className="res-act" type="button" onClick={onRetry}>
        Повторить
      </button>
    </p>
  );
}

export interface HistoryViewProps {
  /** Адрес прошлого разговора по его номеру. */
  readonly conversationPath: (id: string) => string;
  /** «Начать» в пустом списке: открыть текущий разговор. */
  readonly onStart: () => void;
}

interface HistoryState {
  readonly items: readonly ConsultantConversationSummary[];
  readonly nextCursor: string | null;
  readonly status: 'loading' | 'ready' | 'more' | 'failed';
}

const INITIAL: HistoryState = { items: [], nextCursor: null, status: 'loading' };

/** «Все разговоры» (K5, пусто — K5b): темы одной строкой, последние сверху, по 20. */
export function HistoryView({ conversationPath, onStart }: HistoryViewProps) {
  const [state, setState] = useState<HistoryState>(INITIAL);

  const load = useCallback(async (cursor?: string) => {
    setState((current) => ({ ...current, status: cursor ? 'more' : 'loading' }));
    try {
      const page = await fetchConversationPage(cursor);
      setState((current) => ({
        items: cursor ? [...current.items, ...page.items] : page.items,
        nextCursor: page.nextCursor,
        status: 'ready',
      }));
    } catch {
      setState((current) => ({ ...current, status: 'failed' }));
    }
  }, []);

  useEffect(() => {
    // Первая порция при открытии списка.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const { items, nextCursor, status } = state;
  const empty = status === 'ready' && items.length === 0;
  return (
    <div className="chat" aria-live="polite" aria-busy={status === 'loading'}>
      {items.length > 0 ? (
        <ul className="hist hist2" aria-label="Разговоры, последние сверху">
          {items.map((item) => (
            <li key={item.id}>
              <Link className="hist-t hist-row" to={conversationPath(item.id)}>
                <span className="hist-tt">{conversationTitle(item)}</span>
                <span className="hist-open" aria-hidden="true">
                  <span className="hist-open-l">Открыть</span>
                  <Icon name="arrow" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {status === 'failed' ? (
        <ErrorRow
          text="Разговоры не загрузились"
          onRetry={() => void load(items.length > 0 ? (nextCursor ?? undefined) : undefined)}
        />
      ) : null}
      {nextCursor && status !== 'failed' ? (
        <div className="vl-foot">
          <button
            className="btn"
            type="button"
            disabled={status === 'more'}
            aria-busy={status === 'more' || undefined}
            onClick={() => void load(nextCursor)}
          >
            Показать ещё
          </button>
        </div>
      ) : null}
      {empty ? (
        <div className="vl-empty" role="status">
          <p className="vl-empty-t">Разговоров пока нет</p>
          <div className="actions">
            <button className="btn is-primary" type="button" onClick={onStart}>
              <Icon name="chat" />
              Начать
            </button>
          </div>
        </div>
      ) : null}
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
