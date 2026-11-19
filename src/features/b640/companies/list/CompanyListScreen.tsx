import type { CandidateCompanyFilter, CandidateCompanySort } from '../../../../../shared/candidateCompany';
import { Button, Icon, Link, StatusLine } from '../../kit';
import { buildNodePath } from '../../routes';
import { companiesTitle, formatCount } from '../format';
import { RetryLine } from '../RetryLine';
import { useCompanyWant } from '../useCompanyWant';
import { CompanyRow } from './CompanyRow';
import { filterChips, SORT_OPTIONS } from './listModel';
import { FiltersButton, PlaceChips } from './PlaceFilters';
import { useCompanyList, type CompanyList } from './useCompanyList';

const PAGE = 20;

function Tools({ list }: { readonly list: CompanyList }) {
  const all = list.counts?.all ?? list.total;
  return (
    <div className="co-tools">
      <div className="field co-q">
        <label className="vh" htmlFor="co-q">{`Поиск среди ${formatCount(all)} компаний`}</label>
        <input
          id="co-q"
          type="text"
          inputMode="search"
          placeholder={`Поиск среди ${formatCount(all)}`}
          value={list.query.search}
          onChange={(event) => list.setSearch(event.target.value)}
        />
      </div>
      <div className="field co-sort ls-f">
        <label className="vh" htmlFor="co-sort">Сортировка</label>
        <select
          id="co-sort"
          value={list.query.sort}
          onChange={(event) => list.setSort(event.target.value as CandidateCompanySort)}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <FiltersButton place={list.query} cities={list.cities} onChange={list.setPlace} />
    </div>
  );
}

function Chips({ list }: { readonly list: CompanyList }) {
  const chips = filterChips(list.counts);
  if (!chips.length) return null;
  const pick = (id: CandidateCompanyFilter) => list.setFilter(list.query.filter === id ? 'all' : id);
  return (
    <div className="chips" role="group" aria-label="Быстрые фильтры">
      {chips.map((chip) => (
        <button
          key={chip.id}
          className="chip"
          type="button"
          aria-pressed={list.query.filter === chip.id}
          onClick={() => pick(chip.id)}
        >
          {chip.label} · <span className="num">{formatCount(chip.count)}</span>
        </button>
      ))}
      {list.counts && list.counts.relocation > 0 ? (
        <button
          className="chip"
          type="button"
          aria-pressed={list.query.relocation}
          onClick={() => list.setPlace({ relocation: !list.query.relocation, city: list.query.city })}
        >
          <Icon name="plane" />
          Релокация · <span className="num">{formatCount(list.counts.relocation)}</span>
        </button>
      ) : null}
    </div>
  );
}

function Foot({ list }: { readonly list: CompanyList }) {
  const left = list.total - list.items.length;
  if (left <= 0) return null;
  return (
    <>
      <div className="vl-foot">
        <Button icon="down" busy={list.moreBusy} onClick={() => void list.loadMore()}>
          <span>
            {`Показать ещё ${Math.min(PAGE, left)} · осталось `}
            <span className="num">{formatCount(left)}</span>
          </span>
        </Button>
      </div>
      {list.moreFailed ? <StatusLine state="err" text="Не удалось загрузить. Нажмите ещё раз." /> : null}
    </>
  );
}

function CompanyTable({ list }: { readonly list: CompanyList }) {
  const want = useCompanyWant(list.markWant);
  return (
    <>
      <table className="co-table">
        <caption className="vh">Компании подборки</caption>
        <thead>
          <tr>
            <th scope="col">Компания</th>
            <th scope="col">Вакансий по вашим ролям</th>
            <th scope="col">Знакомые</th>
            <th scope="col">
              <span className="vh">Хочу в компанию</span>
            </th>
          </tr>
        </thead>
        <tbody aria-busy={list.load === 'loading' || undefined}>
          {list.items.map((company) => (
            <CompanyRow
              key={company.key}
              company={company}
              busy={want.busyKey === company.key}
              onWant={(target) => void want.toggle(target)}
            />
          ))}
        </tbody>
      </table>
      {want.failed ? <RetryLine text={`Не удалось сохранить отметку: ${want.failed.name}`} onRetry={want.retry} /> : null}
      <Foot list={list} />
    </>
  );
}

/** v10g: с релокацией никого — ведём к удалённой работе. */
function RelocationEmpty({ city }: { readonly city: string | null }) {
  return (
    <div className="vl-empty" role="status">
      <p className="vl-empty-t">
        {city ? 'В этом городе компаний с релокацией не нашли' : 'Компаний с релокацией в подборке не нашли'}
      </p>
      <Link className="btn is-primary" to={buildNodePath('s07', {})}>
        <Icon name="desktop" />
        Посмотреть удалённую работу
      </Link>
    </div>
  );
}

function Body({ list }: { readonly list: CompanyList }) {
  if (list.load === 'loading' && !list.items.length) {
    return <StatusLine state="wait" text="Загружаем компании…" />;
  }
  if (list.load === 'error') return <RetryLine text="Не удалось загрузить компании" onRetry={list.retry} />;
  if (!list.items.length && list.query.relocation) return <RelocationEmpty city={list.query.city} />;
  if (!list.items.length) {
    const narrowed = list.query.search || list.query.filter !== 'all' || list.query.city;
    return (
      <div className="vl-empty" role="status">
        <p className="vl-empty-t">{narrowed ? 'Таких компаний в подборке нет' : 'В подборке пока нет компаний'}</p>
      </div>
    );
  }
  return <CompanyTable list={list} />;
}

/** Узел v10: компании подборки, отметка «Хочу», переход в карточку компании. */
export function CompanyListScreen() {
  const list = useCompanyList();
  const all = list.counts?.all;
  return (
    <div className="page" data-b640-node="v10" data-b640-section="vacancies">
      <section className="col col-wide co-list" aria-labelledby="co-title">
        <h2 className="co-h" id="co-title">
          {list.query.relocation ? (
            'Компании с релокацией'
          ) : all === undefined ? (
            'Компании в подборке'
          ) : (
            <>
              <span className="num">{formatCount(all)}</span>&nbsp;{companiesTitle(all)}
            </>
          )}
        </h2>
        <Tools list={list} />
        <Chips list={list} />
        <PlaceChips place={list.query} onChange={list.setPlace} />
        <Body list={list} />
      </section>
    </div>
  );
}

