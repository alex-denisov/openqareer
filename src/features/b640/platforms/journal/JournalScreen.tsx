import { InfoTip, PagedList, StatusLine } from '../../kit';
import type { SectionProps } from '../../sections';
import { PlatformRetry } from '../PlatformRetry';
import type { AutomationJournalPage } from '../../../automation/automationApi';
import { journalRow, journalTotals } from './journalModel';
import { useJournal } from './useJournal';

function Rows({ page, loadMore }: { readonly page: AutomationJournalPage; readonly loadMore: () => Promise<void> }) {
  return (
    <PagedList
      items={page.entries}
      total={page.counts.total}
      onLoadMore={loadMore}
      listClassName="rows exp-rows"
      renderItem={(entry) => {
        const row = journalRow(entry);
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

function Totals({ page }: { readonly page: AutomationJournalPage }) {
  return (
    <section className="mod" aria-labelledby="jn-sum">
      <h3 className="mod-title" id="jn-sum">
        {`За ${page.periodDays} дней`}
        <InfoTip label="Откуда данные" text="Журнал действий OpenQareer на hh.ru и в LinkedIn за последние 30 дней." />
      </h3>
      <dl className="kv">
        {journalTotals(page.counts).flatMap((item) => [
          <dt key={`${item.id}-t`}>{item.label}</dt>,
          <dd className="num" key={`${item.id}-v`}>
            {item.value}
          </dd>,
        ])}
      </dl>
    </section>
  );
}

/** Узел a05c: журнал действий за 30 дней. */
export function JournalScreen({ node }: SectionProps) {
  const journal = useJournal();
  const { data } = journal;
  const page = data.state === 'ready' ? data.page : null;
  return (
    <div className="page two" data-b640-node={node.code} data-b640-section={node.section}>
      <div className="col">
        <section className="col" aria-labelledby="jl-title">
          <div className="list-head">
            <h2 id="jl-title">Журнал</h2>
          </div>
          {data.state === 'loading' ? <StatusLine state="wait" text="Загружаем журнал…" /> : null}
          {data.state === 'error' ? <PlatformRetry text="Не удалось загрузить журнал" onRetry={journal.retry} /> : null}
          {page && !page.entries.length ? (
            <div className="vl-empty" role="status">
              <p className="vl-empty-t">За 30 дней действий не было</p>
            </div>
          ) : null}
          {page && page.entries.length ? <Rows page={page} loadMore={journal.loadMore} /> : null}
        </section>
      </div>
      <div className="col">{page && page.entries.length ? <Totals page={page} /> : null}</div>
    </div>
  );
}
