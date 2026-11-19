import { Icon, PagedList, StatusLine } from '../../kit';
import { useShell } from '../../shell/ShellContext';
import { ContactRow } from './ContactRow';
import { ContactsControls } from './ContactsControls';
import { formatCount } from './contactsModel';
import { useContacts, type ContactsState } from './useContacts';

function RetryLine({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <StatusLine
      state="err"
      text="Контакты не загрузились"
      action={
        <button className="btn is-sm" type="button" onClick={onRetry}>
          Повторить
        </button>
      }
    />
  );
}

function Empty() {
  const { navigate } = useShell();
  return (
    <section className="lead col-wide" aria-labelledby="ct-empty">
      <h2 className="lead-title" id="ct-empty">
        Контакты
      </h2>
      <div className="vl-empty" role="status">
        <p className="vl-empty-t">Связей пока нет</p>
        <div className="actions">
          <button
            className="btn is-primary"
            type="button"
            onClick={() => navigate('/app/profile/linkedin')}
          >
            <Icon name="refresh" />
            Обновить из LinkedIn
          </button>
        </div>
      </div>
    </section>
  );
}

function NothingFound({ onReset }: { readonly onReset: () => void }) {
  return (
    <div className="vl-empty" role="status">
      <p className="vl-empty-t">Никого не нашли</p>
      <button className="btn" type="button" onClick={onReset}>
        Сбросить всё
      </button>
    </div>
  );
}

function Rows({ state }: { readonly state: ContactsState }) {
  const { criteria } = state;
  if (state.load === 'loading') return <StatusLine state="wait" text="Загружаем контакты…" />;
  if (state.load === 'error') return <RetryLine onRetry={state.retry} />;
  if (!state.items.length) return <NothingFound onReset={state.resetAll} />;
  return (
    <PagedList
      key={JSON.stringify(criteria)}
      items={state.items}
      total={state.total}
      onLoadMore={state.loadMore}
      listClassName="rows exp-rows ct-rows"
      renderItem={(contact) => <ContactRow contact={contact} />}
    />
  );
}

function List({ state }: { readonly state: ContactsState }) {
  return (
    <div className="col col-wide">
      <section className="col ct-list" aria-labelledby="ct-title">
        <div className="list-head">
          <h2 id="ct-title">
            <span className="num">{formatCount(state.total)}</span> человек, которые нанимают
          </h2>
        </div>
        <ContactsControls state={state} />
        <Rows state={state} />
      </section>
    </div>
  );
}

function Body({ state }: { readonly state: ContactsState }) {
  if (!state.everLoaded) {
    if (state.load === 'error') return <RetryLine onRetry={state.retry} />;
    return <StatusLine state="wait" text="Загружаем контакты…" />;
  }
  if (!state.filtered && state.load === 'ready' && !state.items.length) return <Empty />;
  return <List state={state} />;
}

/** Узел a02: контакты из сети LinkedIn порциями по 20, поиск, фильтры и статус «писали / ответили». */
export function ContactsScreen() {
  const state = useContacts();
  const bare = state.load === 'ready' && !state.filtered && !state.items.length;
  return (
    <div className={bare ? 'page' : 'page two'} data-b640-node="a02" data-b640-section="platforms">
      <Body state={state} />
    </div>
  );
}
