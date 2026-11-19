import { InfoTip, PagedList, StatusLine } from '../../kit';
import { ContactRow } from './ContactRow';
import { contactsTitle, importedOn } from './contactsModel';
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

function sourceNote(importedAt: string | null): string {
  const date = importedOn(importedAt);
  return date ? `Знакомые из вашей сети LinkedIn, обновлено ${date}` : 'Знакомые из вашей сети LinkedIn';
}

function Empty() {
  return (
    <section className="lead col-wide" aria-labelledby="ct-empty">
      <h2 className="lead-title" id="ct-empty">Контакты</h2>
      <div className="vl-empty" role="status">
        <p className="vl-empty-t">Связей пока нет</p>
      </div>
    </section>
  );
}

function List({ state }: { readonly state: ContactsState }) {
  return (
    <div className="col col-wide">
      <section className="col ct-list" aria-labelledby="ct-title">
        <div className="list-head">
          <h2 id="ct-title">
            <span className="num">{contactsTitle(state.total)}</span>
          </h2>
          <InfoTip label="Откуда контакты" text={sourceNote(state.importedAt)} />
        </div>
        <PagedList
          items={state.items}
          total={state.total}
          onLoadMore={state.loadMore}
          listClassName="rows exp-rows ct-rows"
          renderItem={(contact) => <ContactRow contact={contact} />}
        />
      </section>
    </div>
  );
}

function Body({ state }: { readonly state: ContactsState }) {
  if (state.load === 'loading') return <StatusLine state="wait" text="Загружаем контакты…" />;
  if (state.load === 'error') return <RetryLine onRetry={state.retry} />;
  if (!state.items.length) return <Empty />;
  return <List state={state} />;
}

/** Узел a02: контакты из сети LinkedIn порциями по 20. */
export function ContactsScreen() {
  const state = useContacts();
  return (
    <div
      className={state.load === 'ready' && !state.items.length ? 'page' : 'page two'}
      data-b640-node="a02"
      data-b640-section="platforms"
    >
      <Body state={state} />
    </div>
  );
}
