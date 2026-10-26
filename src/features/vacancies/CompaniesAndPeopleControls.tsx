import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CaretLeft,
  CaretRight,
  CircleNotch,
  Funnel,
  MagnifyingGlass,
  SlidersHorizontal,
  Clock,
  Target,
  UsersThree,
  X,
} from '@phosphor-icons/react';
import { BulkCompanyWantButton } from './BulkCompanyWantButton';
import type {
  CandidateCompanyFilter,
  CandidateCompanyOpportunity,
  CandidateCompanyPage,
  CandidateCompanySort,
} from '../../../shared/candidateCompany';
import { pluralWordRu } from '../../../shared/pluralRu';
import { companyLocationLabel, isContactImportStale } from './companiesAndPeopleUtils';
import { CompanyAvatar } from './CompanyDetailPanel';

const FILTERS: readonly { value: CandidateCompanyFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'want', label: 'Хочу' },
  { value: 'contacts', label: 'Есть контакты в сети' },
  { value: 'recruiter', label: 'Рекрутер известен' },
];

interface CompanyToolbarProps {
  readonly search: string;
  readonly total: number;
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
  total,
  onSearch,
}: Pick<CompanyToolbarProps, 'search' | 'total' | 'onSearch'>) {
  const placeholder = `Поиск среди ${total}`;
  return (
    <span className="companies-people-search">
      <label className="companies-people-field-label" htmlFor="companies-people-q">
        Поиск
      </label>
      <MagnifyingGlass aria-hidden="true" />
      <input
        id="companies-people-q"
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </span>
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
    <span className="companies-people-select-wrap">
      <label className="companies-people-field-label" htmlFor="companies-people-sort">
        Сортировка
      </label>
      <select
        id="companies-people-sort"
        className="companies-people-select"
        value={sort}
        onChange={(event) => onSort(event.target.value as CandidateCompanySort)}
      >
        <option value="default">«Хочу», затем по вакансиям</option>
        <option value="contacts" disabled={!contactsKnown}>
          По контактам в сети
        </option>
        <option value="alphabetical">По алфавиту</option>
      </select>
    </span>
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
      {FILTERS.filter((item) => item.value !== 'all').map((item) => (
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
      onClick={() => onFilter(filter === item.value ? 'all' : item.value)}
    >
      <span className="companies-people-filter-label">{item.label}</span>{' '}
      <span className="companies-people-filter-count">{disabled ? '· неизвестно' : count}</span>
    </button>
  );
}

export function CompanyToolbar(props: CompanyToolbarProps) {
  return (
    <div className="companies-people-toolbar">
      <CompanySearchField search={props.search} total={props.total} onSearch={props.onSearch} />
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
      <CompanyFilterChips
        filter={props.filter}
        counts={props.filterCounts}
        onFilter={props.onFilter}
      />
    </div>
  );
}

export function CompanyList({
  companies,
  selectedKey,
  filter,
  allCount,
  search,
  onSelect,
  onOpenCareer,
  onWantsChanged,
  footer,
}: {
  readonly companies: readonly CandidateCompanyOpportunity[];
  readonly selectedKey: string | null;
  readonly filter: CandidateCompanyFilter;
  readonly allCount: number;
  readonly search: string;
  readonly onSelect: (key: string) => void;
  readonly onOpenCareer?: () => void;
  readonly onWantsChanged?: () => void;
  /** Mockup 13: the count and order note close the scrolling list. */
  readonly footer?: ReactNode;
}) {
  if (companies.length === 0) {
    return (
      <CompanyListEmptyState
        filter={filter}
        allCount={allCount}
        search={search}
        onOpenCareer={onOpenCareer}
        onWantsChanged={onWantsChanged}
      />
    );
  }
  return (
    <div className="companies-people-list" role="list" aria-label="Компании текущей подборки">
      {companies.map((company) => (
        <CompanyListRow
          key={company.key}
          company={company}
          selected={selectedKey === company.key}
          onSelect={onSelect}
        />
      ))}
      {footer}
    </div>
  );
}

function CompanyListEmptyState({
  filter,
  allCount,
  search,
  onOpenCareer,
  onWantsChanged,
}: {
  readonly filter: CandidateCompanyFilter;
  readonly allCount: number;
  readonly search: string;
  readonly onOpenCareer?: () => void;
  readonly onWantsChanged?: () => void;
}) {
  if (filter === 'want' && allCount > 0 && !search) {
    return (
      <div className="companies-people-empty companies-people-empty-state" role="status">
        <p>В «Хочу» пока нет компаний.</p>
        <BulkCompanyWantButton
          count={allCount}
          className="companies-people-action"
          onDone={() => onWantsChanged?.()}
        />
      </div>
    );
  }
  if (filter === 'all' && allCount === 0 && !search) {
    return (
      <div className="companies-people-empty companies-people-empty-state" role="status">
        <p>Компаний пока нет: подборка вакансий пуста. Задайте роль и условия в «Карьере».</p>
        {onOpenCareer ? (
          <button type="button" className="companies-people-action" onClick={onOpenCareer}>
            Открыть «Карьеру»
          </button>
        ) : null}
      </div>
    );
  }
  return <p className="companies-people-empty">Нет компаний по этим условиям.</p>;
}

function companyContactsCount(company: CandidateCompanyOpportunity): number | null {
  return company.contactsCount === null || isContactImportStale(company.contactsImportedAt)
    ? null
    : company.contactsCount;
}

function CompanyRowMetrics({ company }: { readonly company: CandidateCompanyOpportunity }) {
  const contacts = companyContactsCount(company);
  return (
    <span className="companies-people-company-metrics">
      <span
        className={`companies-people-contacts${contacts === null ? '' : ' is-known'}`}
        data-zero={contacts === 0 ? '' : undefined}
        title={contacts === null ? 'Контакты в сети неизвестны' : 'Контакты в вашей сети'}
      >
        <UsersThree aria-hidden="true" />
        {contacts === null ? (
          <>
            <span className="career-sr-only">контакты неизвестны</span>
            <span className="companies-people-mobile-only" aria-hidden="true">
              неизвестно
            </span>
          </>
        ) : (
          <>
            {/* Mockup 13 on 390: one line «2 в сети» after the icon; 1440 keeps the number only. */}
            <span className="companies-people-contacts-count">{contacts}</span> в сети
          </>
        )}
      </span>
      {company.want ? (
        <span className="companies-people-want-chip is-compact">
          <Target aria-hidden="true" /> Хочу
        </span>
      ) : null}
    </span>
  );
}

function CompanyListRow({
  company,
  selected,
  onSelect,
}: {
  readonly company: CandidateCompanyOpportunity;
  readonly selected: boolean;
  readonly onSelect: (key: string) => void;
}) {
  return (
    <div className="companies-people-company-row-wrap" role="listitem">
      <button
        type="button"
        className={`companies-people-company-row${selected ? ' is-selected' : ''}`}
        aria-label={`Открыть компанию ${company.name}`}
        aria-pressed={selected}
        onClick={() => onSelect(company.key)}
      >
        <CompanyAvatar name={company.name} />
        <span className="companies-people-company-text">
          <strong>{company.name}</strong>
          <span>
            {companyLocationLabel(company.location)} ·{' '}
            <span className="companies-people-num">{company.vacancyCount}</span>{' '}
            {pluralWordRu(company.vacancyCount, ['вакансия', 'вакансии', 'вакансий'])}
          </span>
        </span>
        <CompanyRowMetrics company={company} />
        <CaretRight className="companies-people-row-chev" aria-hidden="true" />
      </button>
    </div>
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

const SORT_OPTIONS: readonly { value: CandidateCompanySort; label: string; short: string }[] = [
  { value: 'default', label: '«Хочу», затем по вакансиям', short: '«Хочу», затем вакансии' },
  { value: 'contacts', label: 'По контактам в сети', short: 'По контактам в сети' },
  { value: 'alphabetical', label: 'По алфавиту', short: 'По алфавиту' },
];

type SheetView = 'overview' | 'filter' | 'sort';

function filterCount(
  counts: CandidateCompanyPage['filterCounts'],
  filter: CandidateCompanyFilter,
): number | null {
  return counts[filter];
}

function CompanyFilterSheetHeader({
  view,
  onBack,
  onReset,
  onClose,
}: {
  readonly view: SheetView;
  readonly onBack: () => void;
  readonly onReset: () => void;
  readonly onClose: () => void;
}) {
  const title = view === 'filter' ? 'Показывать' : view === 'sort' ? 'Сортировка' : 'Фильтры';
  return (
    <div className="companies-people-sheet-head">
      {view === 'sort' ? (
        <button
          type="button"
          className="companies-people-sheet-back"
          aria-label="Назад к фильтрам"
          onClick={onBack}
        >
          <CaretLeft aria-hidden="true" />
        </button>
      ) : null}
      <h2>{title}</h2>
      {view === 'overview' ? (
        <button type="button" className="companies-people-sheet-reset" onClick={onReset}>
          Сбросить
        </button>
      ) : null}
      {view === 'filter' ? (
        <button type="button" className="companies-people-sheet-reset" onClick={onClose}>
          Закрыть
        </button>
      ) : null}
    </div>
  );
}

function SheetRow({
  icon,
  label,
  value,
  onClick,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string;
  readonly onClick: () => void;
}) {
  return (
    <button type="button" className="companies-people-sheet-row" onClick={onClick}>
      <span className="companies-people-sheet-ico" aria-hidden="true">
        {icon}
      </span>
      <span className="companies-people-sheet-main">{label}</span>
      <span className="companies-people-sheet-val">{value}</span>
      <CaretRight className="companies-people-sheet-chev" aria-hidden="true" />
    </button>
  );
}

function SheetBody({
  view,
  filter,
  sort,
  counts,
  onView,
  onFilter,
  onSort,
}: {
  readonly view: SheetView;
  readonly filter: CandidateCompanyFilter;
  readonly sort: CandidateCompanySort;
  readonly counts: CandidateCompanyPage['filterCounts'];
  readonly onView: (view: SheetView) => void;
  readonly onFilter: (value: CandidateCompanyFilter) => void;
  readonly onSort: (value: CandidateCompanySort) => void;
}) {
  if (view === 'filter')
    return <FilterOptions value={filter} counts={counts} onChange={onFilter} />;
  if (view === 'sort') {
    return (
      <SortOptions value={sort} disabledContacts={counts.contacts === null} onChange={onSort} />
    );
  }
  return (
    <div className="companies-people-sheet-list">
      <SheetRow
        icon={<Funnel />}
        label="Показывать"
        value={FILTERS.find((item) => item.value === filter)?.label ?? 'Все'}
        onClick={() => onView('filter')}
      />
      <SheetRow
        icon={<Clock />}
        label="Сортировка"
        value={SORT_OPTIONS.find((item) => item.value === sort)?.short ?? ''}
        onClick={() => onView('sort')}
      />
    </div>
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
  const [view, setView] = useState<SheetView>('overview');
  return (
    <form method="dialog">
      <span className="companies-people-sheet-grab" aria-hidden="true" />
      <CompanyFilterSheetHeader
        view={view}
        onBack={() => setView('overview')}
        onReset={() => {
          setDraftFilter('all');
          setDraftSort('default');
        }}
        onClose={close}
      />
      <SheetBody
        view={view}
        filter={draftFilter}
        sort={draftSort}
        counts={counts}
        onView={setView}
        onFilter={(value) => {
          // Макет 13: выбор в листе «Показывать» применяется сразу и закрывает лист.
          onApply(value, draftSort);
          close();
        }}
        onSort={setDraftSort}
      />
      {view === 'filter' ? null : (
        <button
          type="button"
          className="companies-people-sheet-cta"
          onClick={() => {
            onApply(draftFilter, draftSort);
            close();
          }}
        >
          Показать {filterCount(counts, draftFilter) ?? 'неизвестно'}
        </button>
      )}
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
      aria-label="Фильтры"
      onClose={props.onClose}
    >
      {props.open ? (
        <CompanyFilterSheetForm {...props} close={() => dialogRef.current?.close()} />
      ) : null}
    </dialog>
  );
}

function FilterOptions({
  value,
  counts,
  onChange,
}: {
  readonly value: CandidateCompanyFilter;
  readonly counts: CandidateCompanyPage['filterCounts'];
  readonly onChange: (value: CandidateCompanyFilter) => void;
}) {
  return (
    <fieldset className="companies-people-sheet-list">
      <legend className="career-sr-only">Показывать</legend>
      {FILTERS.map((item) => {
        const unknown = item.value === 'contacts' && counts.contacts === null;
        return (
          <label className="companies-people-filter-option" key={item.value}>
            <input
              type="radio"
              name="company-filter"
              value={item.value}
              checked={value === item.value}
              disabled={unknown}
              onChange={() => onChange(item.value)}
            />
            <span className="companies-people-sheet-main">
              {unknown ? `${item.label} · неизвестно` : item.label}
            </span>
            {unknown ? null : (
              <span className="companies-people-sheet-val">{counts[item.value]}</span>
            )}
          </label>
        );
      })}
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
    <fieldset className="companies-people-sheet-list">
      <legend className="career-sr-only">Сортировка</legend>
      {SORT_OPTIONS.map((option) => (
        <label className="companies-people-filter-option" key={option.value}>
          <input
            type="radio"
            name="company-sort"
            value={option.value}
            checked={value === option.value}
            disabled={option.value === 'contacts' && disabledContacts}
            onChange={() => onChange(option.value)}
          />
          <span className="companies-people-sheet-main">{option.label}</span>
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

/** B439: the selection narrowed from «Компании и люди» says so and can be widened again. */
export function CompanySelectionFilterChip({
  companyName,
  onClear,
}: {
  readonly companyName?: string;
  readonly onClear: () => void;
}) {
  if (!companyName) return null;
  return (
    <button
      type="button"
      className="vacancies-company-filter-chip"
      aria-label={`Убрать фильтр компании ${companyName}`}
      onClick={onClear}
    >
      Компания: {companyName} <X aria-hidden="true" />
    </button>
  );
}
