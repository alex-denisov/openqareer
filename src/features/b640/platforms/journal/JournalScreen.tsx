import type { LinkedinJournalPage } from '../../../../../shared/b640LinkedinJournal';
import { Icon, Link, PagedList, StatusLine } from '../../kit';
import { buildNodePath } from '../../routes';
import type { SectionProps } from '../../sections';
import { PlatformRetry } from '../PlatformRetry';
import { givenName, givenNameDative, journalRow, journalTotals, leadReply, monthTitle } from './journalModel';
import { useJournal } from './useJournal';

/** «Павел ответил» → «Написать Павлу»: черновик сообщения под строкой контакта в a02. */
function Lead({ contact }: { readonly contact: { readonly id: string; readonly name: string } }) {
  return (
    <section className="lead" aria-labelledby="jn-title">
      <h2 className="lead-title" id="jn-title">{`${givenName(contact.name)} ответил`}</h2>
      <div className="actions">
        <Link className="btn is-primary" to={`${buildNodePath('a02')}#write-${contact.id}`}>
          <Icon name="send" />
          {`Написать ${givenNameDative(contact.name)}`}
        </Link>
      </div>
    </section>
  );
}

function Rows({ page, loadMore }: { readonly page: LinkedinJournalPage; readonly loadMore: () => Promise<void> }) {
  return (
    <PagedList
      items={page.events}
      total={page.total}
      onLoadMore={loadMore}
      listClassName="rows exp-rows"
      renderItem={(event) => {
        const row = journalRow(event);
        return (
          <li className="row" key={row.id}>
            <div>
              <div className="row-title">{row.title}</div>
              {row.sub ? <div className="row-sub num">{row.sub}</div> : null}
            </div>
            <span className={row.tag.ok ? 'tag ok' : 'tag'}>{row.tag.text}</span>
          </li>
        );
      }}
    />
  );
}

function Totals({ page }: { readonly page: LinkedinJournalPage }) {
  return (
    <section className="mod" aria-labelledby="jn-sum">
      <h3 className="mod-title" id="jn-sum">
        {monthTitle(page.month)}
      </h3>
      <dl className="kv">
        {journalTotals(page.month).flatMap((item) => [
          <dt key={`${item.id}-t`}>{item.label}</dt>,
          <dd className="num" key={`${item.id}-v`}>
            {item.value}
          </dd>,
        ])}
      </dl>
    </section>
  );
}

/** Узел a05c: журнал LinkedIn — свои публикации, снятия из очереди и отметки «ответил». */
export function JournalScreen({ node }: SectionProps) {
  const journal = useJournal();
  const { data } = journal;
  const page = data.state === 'ready' ? data.page : null;
  const lead = page ? leadReply(page.events) : null;
  return (
    <div className="page two" data-b640-node={node.code} data-b640-section={node.section}>
      <div className="col">
        {lead ? <Lead contact={lead} /> : null}
        <section className="col" aria-labelledby="jl-title">
          <div className="list-head">
            <h2 className="gt-h" id="jl-title">Журнал LinkedIn</h2>
          </div>
          {data.state === 'loading' ? <StatusLine state="wait" text="Загружаем журнал…" /> : null}
          {data.state === 'error' ? <PlatformRetry text="Не удалось загрузить журнал" onRetry={journal.retry} /> : null}
          {page && !page.events.length ? (
            <div className="vl-empty" role="status">
              <p className="vl-empty-t">Событий LinkedIn пока нет</p>
            </div>
          ) : null}
          {page && page.events.length ? <Rows page={page} loadMore={journal.loadMore} /> : null}
        </section>
      </div>
      <div className="col">{page && page.total ? <Totals page={page} /> : null}</div>
    </div>
  );
}
