import type { FootprintRiskCategory, FootprintRiskItem } from '../../../../shared/footprintRisk';
import { Icon, InfoTip, Link } from '../kit';
import { buildNodePath, type B640Node } from '../routes';
import { FootprintLoad, StartPage, hasSummary } from './FootprintScreen';
import { FindingList } from './SummaryView';
import {
  ACTION_ICON,
  dayMonth,
  findingsWord,
  levelTag,
  openRisks,
  pageAttrs,
  firstToRemove,
  usefulItems,
} from './footprintModel';
import type { FootprintData } from './useFootprint';

interface ViewProps {
  readonly data: FootprintData;
  readonly reload: () => void;
}

function LeadHead({ title, checkedAt }: { readonly title: string; readonly checkedAt: string | null }) {
  const checked = dayMonth(checkedAt);
  return (
    <div className="lead-head">
      <h2 className="lead-title is-long" id="pf-t">{title}</h2>
      {checked ? <InfoTip label="Источник" text={`Проверено ${checked}.`} /> : null}
    </div>
  );
}

function Category({
  category, items, open, reload,
}: {
  readonly category: FootprintRiskCategory;
  readonly items: readonly FootprintRiskItem[];
  readonly open: boolean;
  readonly reload: () => void;
}) {
  return (
    <details className="fp-acc" open={open}>
      <summary className="fp-acc-h">
        <span className="fp-acc-t">
          {category.title}
          <span className="dim"> · {findingsWord(category.count)}</span>
        </span>
        <span className={levelTag(category.level)}>{category.levelLabel}</span>
        <Icon name="down" className="fp-acc-chev" />
      </summary>
      <FindingList items={items} onChanged={reload} />
    </details>
  );
}

/** F3: сводка по категориям; главная кнопка ведёт к первой рисковой находке. */
function Review({ data, reload, first }: ViewProps & { readonly first: FootprintRiskItem | undefined }) {
  const { summary } = data;
  const categories = summary.categories.filter((category) => category.count > 0);
  return (
    <section className="lead" aria-labelledby="pf-t">
      <LeadHead title={summary.headline ?? ''} checkedAt={summary.checkedAt} />
      {first?.action ? (
        <div className="actions">
          <Link className="btn is-primary" to={buildNodePath('f03b', { findingId: first.id })}>
            <Icon name={ACTION_ICON[first.action.kind]} />
            {first.action.label}
          </Link>
        </div>
      ) : null}
      <h3 className="pf-sub" id="fp-acc-t">Что увидит работодатель</h3>
      <div className="fp-accs" role="group" aria-labelledby="fp-acc-t">
        {categories.map((category, index) => (
          <Category key={category.id} category={category} open={index === 0} reload={reload}
            items={summary.items.filter((item) => item.category === category.id)} />
        ))}
      </div>
    </section>
  );
}


/** F4: рискового нет — честная строка, полезное и «Искать со ссылками». */
function NothingRisky({ data, reload }: ViewProps) {
  const useful = usefulItems(data.summary);
  const checked = data.summary.categories.filter((category) => category.id !== 'useful_evidence').length;
  return (
    <section className="lead" aria-labelledby="pf-t">
      <LeadHead title="В проверенных источниках ничего не нашли" checkedAt={data.summary.checkedAt} />
      <div className="actions">
        <Link className="btn is-primary" to={buildNodePath('f01')}>
          <Icon name="search" />
          Искать со ссылками
        </Link>
      </div>
      <p className="pf-done fp-zero" role="status">
        <Icon name="checkc" />
        Рискового не нашли: {checked} {checked === 1 ? 'категория' : checked < 5 ? 'категории' : 'категорий'}
      </p>
      {useful.length > 0 ? (
        <>
          <h3 className="pf-sub">Полезное · {useful.length}</h3>
          <FindingList items={useful} showLevel onChanged={reload} />
        </>
      ) : null}
    </section>
  );
}

/** F3 «Сводка» и вариант F4, когда рискового не осталось. */
export function FindingsScreen({ node }: { readonly node: B640Node }) {
  return (
    <FootprintLoad node={node}>
      {(data, reload) => {
        if (!hasSummary(data)) return <StartPage node={node} data={data} reload={reload} />;
        const risks = openRisks(data.summary);
        const first = firstToRemove(risks);
        return (
          <div className="page pf" {...pageAttrs(node, risks.length > 0 ? undefined : 'f04')}>
            <div className="col">
              {risks.length > 0 ? <Review data={data} reload={reload} first={first} />
                : <NothingRisky data={data} reload={reload} />}
            </div>
          </div>
        );
      }}
    </FootprintLoad>
  );
}
