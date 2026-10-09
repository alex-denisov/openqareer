import { useEffect, useRef, useState } from 'react';
import { CircleNotch, MagnifyingGlass, SlidersHorizontal, Target } from '@phosphor-icons/react';
import type {
  CandidateCompanyFilter,
  CandidateCompanyOpportunity,
  CandidateCompanyPage,
  CandidateCompanySort,
} from '../../../shared/candidateCompany';
import { companyContactSummary, companyVacancySummary } from './companiesAndPeopleUtils';

const FILTERS: readonly { value: CandidateCompanyFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'want', label: 'Хочу' },
  { value: 'contacts', label: 'Есть контакты' },
  { value: 'recruiter', label: 'Рекрутер известен' },
];

interface CompanyToolbarProps {
  readonly search: string;
  readonly sort: CandidateCompanySort;
  readonly filter: CandidateCompanyFilter;
  readonly filterCounts: CandidateCompanyPage['filterCounts'];
  readonly onSearch: (value: string) => void;
  readonly onSort: (value: CandidateCompanySort) => void;
  readonly onFilter: (value: CandidateCompanyFilter) => void;
  readonly onOpenFilters: () => void;
}

function CompanySearchField({
  search,
  onSearch,
}: Pick<CompanyToolbarProps, 'search' | 'onSearch'>) {
  return (
    <label className="companies-people-search">
      <MagnifyingGlass aria-hidden="true" />
      <input
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder="Поиск среди компаний"
        aria-label="Поиск среди компаний"
      />
    </label>
  );
}

function CompanySortSelect({
  sort,
  contactsKnown,
  onSort,
}: {
  readonly sort: CandidateCompanySort;
  readonly contactsKnown: boolean;
  readonly onSort: (value: CandidateCompanySort) => void;
}) {
  return (
    <label className="companies-people-select-wrap">
      <span className="visually-hidden">Сортировка компаний</span>
      <select
        className="companies-people-select"
        aria-label="Сортировка компаний"
        value={sort}
        onChange={(event) => onSort(event.target.value as CandidateCompanySort)}
      >
        <option value="default">«Хочу», затем вакансии</option>
        <option value="contacts" disabled={!contactsKnown}>
          По контактам в сети
        </option>
        <option value="alphabetical">По алфавиту</option>
      </select>
    </label>
  );
}

function CompanyFilterChips({
  filter,
  counts,
  onFilter,
}: {
  readonly filter: CandidateCompanyFilter;
  readonly counts: CandidateCompanyPage['filterCounts'];
  readonly onFilter: (value: CandidateCompanyFilter) => void;
}) {
  return (
    <div className="companies-people-filter-chips" role="group" aria-label="Фильтры компаний">
      {FILTERS.map((item) => (
        <CompanyFilterChip
          key={item.value}
          item={item}
          filter={filter}
          counts={counts}
          onFilter={onFilter}
        />
      ))}
    </div>
  );
}

function CompanyFilterChip({
  item,
  filter,
  counts,
  onFilter,
}: {
  readonly item: (typeof FILTERS)[number];
  readonly filter: CandidateCompanyFilter;
  readonly counts: CandidateCompanyPage['filterCounts'];
  readonly onFilter: (value: CandidateCompanyFilter) => void;
}) {
  const disabled = item.value === 'contacts' && counts.contacts === null;
  const count =
    counts[
      item.value === 'all'
        ? 'all'
        : item.value === 'want'
          ? 'want'
          : item.value === 'recruiter'
            ? 'recruiter'
            : 'contacts'
    ];
  return (
    <button
      type="button"
      className="companies-people-filter-chip"
      aria-pressed={filter === item.value}
      disabled={disabled}
      title={disabled ? 'Список импортированных контактов неизвестен.' : undefined}
      onClick={() => onFilter(item.value)}
    >
      {item.value === 'contacts' && disabled
        ? `${item.label} · неизвестно`
        : `${item.label}${count === null ? '' : ` ${count}`}`}
    </button>
  );
}

export function CompanyToolbar(props: CompanyToolbarProps) {
  return (
    <>
      <div className="companies-people-toolbar">
        <CompanySearchField search={props.search} onSearch={props.onSearch} />
        <CompanySortSelect
          sort={props.sort}
          contactsKnown={props.filterCounts.contacts !== null}
          onSort={props.onSort}
        />
        <button
          type="button"
          className="companies-people-filter-button"
          onClick={props.onOpenFilters}
        >
          <SlidersHorizontal aria-hidden="true" /> Фильтры
        </button>
      </div>
      <CompanyFilterChips
        filter={props.filter}
        counts={props.filterCounts}
        onFilter={props.onFilter}
      />
    </>
  );
}

export function CompanyList({
  companies,
  selectedKey,
  busyKey,
  onSelect,
  onToggleWant,
}: {
  readonly companies: readonly CandidateCompanyOpportunity[];
  readonly selectedKey: string | null;
  readonly busyKey: string | null;
  readonly onSelect: (key: string) => void;
  readonly onToggleWant: (company: CandidateCompanyOpportunity) => void;
}) {
  if (companies.length === 0) {
    return <p className="companies-people-empty">Нет компаний по этим условиям.</p>;
  }
  return (
    <div className="companies-people-list" role="list" aria-label="Компании текущей подборки">
      {companies.map((company) => (
        <CompanyListRow
          key={company.key}
          company={company}
          selected={selectedKey === company.key}
          busy={busyKey === company.key}
          onSelect={onSelect}
          onToggleWant={onToggleWant}
        />
      ))}
    </div>
  );
}

function CompanyListRow({
  company,
  selected,
  busy,
  onSelect,
  onToggleWant,
}: {
  readonly company: CandidateCompanyOpportunity;
  readonly selected: boolean;
  readonly busy: boolean;
  readonly onSelect: (key: string) => void;
  readonly onToggleWant: (company: CandidateCompanyOpportunity) => void;
}) {
  return (
    <article
      className={`companies-people-company-row${selected ? ' is-selected' : ''}`}
      role="listitem"
    >
      <button
        type="button"
        className="companies-people-company-select"
        aria-label={`Открыть компанию ${company.name}`}
        aria-pressed={selected}
        onClick={() => onSelect(company.key)}
      >
        <strong>{company.name}</strong>
        <span>
          {company.location ?? 'Место вакансий неизвестно'} · {companyVacancySummary(company)}
        </span>
        <span>{companyContactSummary(company)}</span>
      </button>
      <div className="companies-people-company-metrics">
        <button
          type="button"
          className="companies-people-want-toggle"
          aria-pressed={company.want}
          disabled={busy}
          onClick={() => onToggleWant(company)}
        >
          <Target aria-hidden="true" /> {company.want ? 'Хочу' : 'Добавить'}
        </button>
        {company.hasRecruiter ? <span>Рекрутер найден</span> : null}
      </div>
    </article>
  );
}

interface CompanyFilterSheetProps {
  readonly open: boolean;
  readonly filter: CandidateCompanyFilter;
  readonly sort: CandidateCompanySort;
  readonly counts: CandidateCompanyPage['filterCounts'];
  readonly onClose: () => void;
  readonly onApply: (filter: CandidateCompanyFilter, sort: CandidateCompanySort) => void;
}

function CompanyFilterSheetHeader({
  close,
  onReset,
}: {
  readonly close: () => void;
  readonly onReset: () => void;
}) {
  return (
    <div className="companies-people-detail-heading">
      <h2 id="companies-filter-title">Фильтры</h2>
      <div className="companies-people-actions">
        <button type="button" className="companies-people-filter-chip" onClick={onReset}>
          Сбросить
        </button>
        <button type="button" className="companies-people-filter-chip" onClick={close}>
          Закрыть
        </button>
      </div>
    </div>
  );
}

function CompanyFilterApply({
  filter,
  sort,
  counts,
  onApply,
  close,
}: {
  readonly filter: CandidateCompanyFilter;
  readonly sort: CandidateCompanySort;
  readonly counts: CandidateCompanyPage['filterCounts'];
  readonly onApply: (filter: CandidateCompanyFilter, sort: CandidateCompanySort) => void;
  readonly close: () => void;
}) {
  const countKey =
    filter === 'all'
      ? 'all'
      : filter === 'want'
        ? 'want'
        : filter === 'recruiter'
          ? 'recruiter'
          : 'contacts';
  return (
    <button
      type="button"
      className="companies-people-action is-primary"
      onClick={() => {
        onApply(filter, sort);
        close();
      }}
    >
      Показать {counts[countKey] ?? 'неизвестно'}
    </button>
  );
}

function CompanyFilterSheetForm({
  filter,
  sort,
  counts,
  onApply,
  close,
}: Omit<CompanyFilterSheetProps, 'open' | 'onClose'> & { close: () => void }) {
  const [draftFilter, setDraftFilter] = useState(filter);
  const [draftSort, setDraftSort] = useState(sort);
  return (
    <form method="dialog">
      <CompanyFilterSheetHeader
        close={close}
        onReset={() => {
          setDraftFilter('all');
          setDraftSort('default');
        }}
      />
      <FilterOptions
        name="company-filter"
        legend="Показывать"
        value={draftFilter}
        disabledContacts={counts.contacts === null}
        onChange={setDraftFilter}
      />
      <SortOptions
        value={draftSort}
        disabledContacts={counts.contacts === null}
        onChange={setDraftSort}
      />
      <CompanyFilterApply
        filter={draftFilter}
        sort={draftSort}
        counts={counts}
        onApply={onApply}
        close={close}
      />
    </form>
  );
}

export function CompanyFilterSheet(props: CompanyFilterSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (props.open && dialog && !dialog.open) {
      dialog.showModal();
    } else if (!props.open && dialog?.open) {
      dialog.close();
    }
  }, [props.open]);
  return (
    <dialog
      ref={dialogRef}
      className="companies-people-filter-sheet"
      aria-labelledby="companies-filter-title"
      onClose={props.onClose}
    >
      <CompanyFilterSheetForm {...props} close={() => dialogRef.current?.close()} />
    </dialog>
  );
}

function FilterOptions({
  name,
  legend,
  value,
  disabledContacts,
  onChange,
}: {
  readonly name: string;
  readonly legend: string;
  readonly value: CandidateCompanyFilter;
  readonly disabledContacts: boolean;
  readonly onChange: (value: CandidateCompanyFilter) => void;
}) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      {FILTERS.map((item) => (
        <label className="companies-people-filter-option" key={item.value}>
          <input
            type="radio"
            name={name}
            value={item.value}
            checked={value === item.value}
            disabled={item.value === 'contacts' && disabledContacts}
            onChange={() => onChange(item.value)}
          />
          {item.value === 'contacts' && disabledContacts
            ? `${item.label} · неизвестно`
            : item.label}
        </label>
      ))}
    </fieldset>
  );
}

function SortOptions({
  value,
  disabledContacts,
  onChange,
}: {
  readonly value: CandidateCompanySort;
  readonly disabledContacts: boolean;
  readonly onChange: (value: CandidateCompanySort) => void;
}) {
  return (
    <fieldset>
      <legend>Сортировка</legend>
      {[
        ['default', '«Хочу», затем вакансии'],
        ['contacts', 'По контактам в сети'],
        ['alphabetical', 'По алфавиту'],
      ].map(([option, label]) => (
        <label className="companies-people-filter-option" key={option}>
          <input
            type="radio"
            name="company-sort"
            value={option}
            checked={value === option}
            disabled={option === 'contacts' && disabledContacts}
            onChange={() => onChange(option as CandidateCompanySort)}
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}

export function CompanyLoadingState() {
  return (
    <div className="companies-people-empty" role="status" aria-busy="true">
      <CircleNotch className="career-spin" aria-hidden="true" /> Загружаем компании текущей
      подборки…
    </div>
  );
}
