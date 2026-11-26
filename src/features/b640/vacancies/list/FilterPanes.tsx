import { useId, useState } from 'react';
import { Icon, Link } from '../../kit';
import { conditionsPath } from '../../career/careerPaths';
import { vacanciesWord } from '../format';
import type { MoneyCurrency } from '../format';
import { splitOptions, type FilterOption, type FilterOptions } from './filterOptions';
import {
  CURRENCY_OPTIONS,
  toggleValue,
  type DateId,
  type FilterKind,
  type ListFilters,
} from './filterModel';

export interface PaneProps {
  readonly filters: ListFilters;
  readonly options: FilterOptions;
  readonly currency: MoneyCurrency;
  readonly onChange: (filters: ListFilters) => void;
  readonly onCurrency: (currency: MoneyCurrency) => void;
}

function Count({ count }: { count?: number }) {
  if (count === undefined) return null;
  return (
    <span className="vt-opt-n num">
      {count}
      <span className="vh"> {vacanciesWord(count)}</span>
    </span>
  );
}

function CheckList({ items, chosen, onToggle }: { items: readonly FilterOption[]; chosen: readonly string[]; onToggle: (id: string) => void }) {
  return (
    <ul className="vt-opts">
      {items.map((option) => (
        <li key={option.id}>
          <label className="vt-opt">
            <input type="checkbox" checked={chosen.includes(option.id)} onChange={() => onToggle(option.id)} />
            <span className="vt-opt-t">{option.label}</span>
            <Count count={option.count} />
          </label>
        </li>
      ))}
    </ul>
  );
}

function Search({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="search">
      <Icon name="search" />
      <span className="vh">Найти: {label}</span>
      <input type="search" placeholder={`Найти: ${label}`} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function MultiPane({ kind, search, ...props }: PaneProps & { kind: 'roles' | 'locations' | 'formats'; search?: string }) {
  const [query, setQuery] = useState('');
  const { filters, options, onChange } = props;
  const chosen = filters[kind];
  const toggle = (id: string) => onChange({ ...filters, [kind]: toggleValue(chosen, id) });
  const { top, rest } = splitOptions(options[kind], query);
  return (
    <>
      {search ? <Search label={search} value={query} onChange={setQuery} /> : null}
      <div className="vt-pop-list">
        {kind === 'formats' ? (
          <ul className="vt-opts">
            <li>
              <label className="vt-opt">
                <input type="checkbox" checked={filters.reloc} onChange={() => onChange({ ...filters, reloc: !filters.reloc })} />
                <span className="vt-opt-t">
                  <Icon name="plane" />
                  Релокация
                </span>
              </label>
            </li>
          </ul>
        ) : null}
        {top.length > 0 ? (
          <>
            <h4 className="vt-pop-h">Частые</h4>
            <CheckList items={top} chosen={chosen} onToggle={toggle} />
          </>
        ) : null}
        {rest.length > 0 ? (
          <>
            <h4 className="vt-pop-h">Остальные</h4>
            <CheckList items={rest} chosen={chosen} onToggle={toggle} />
          </>
        ) : null}
      </div>
    </>
  );
}

function DatePane({ filters, options, onChange }: PaneProps) {
  const name = useId();
  return (
    <div className="vt-pop-list">
      <ul className="vt-opts">
        {options.dates.map((option) => (
          <li key={option.id}>
            <label className="vt-opt">
              <input type="radio" name={name} checked={filters.date === option.id} onChange={() => onChange({ ...filters, date: option.id as DateId })} />
              <span className="vt-opt-t">{option.label}</span>
              <Count count={option.count} />
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Порог денег кандидата живёт в условиях поиска. */
function FloorLink() {
  return (
    <Link className="row-act vt-floor" to={conditionsPath()}>
      Зарплата от — в условиях поиска
    </Link>
  );
}

function MoneyPane({ filters, currency, onChange, onCurrency }: PaneProps) {
  const id = useId();
  const [text, setText] = useState(filters.moneyFrom === null ? '' : String(filters.moneyFrom));
  const [bad, setBad] = useState(false);
  const edit = (value: string) => {
    setText(value);
    const trimmed = value.trim();
    if (trimmed === '') {
      setBad(false);
      onChange({ ...filters, moneyFrom: null });
    } else if (/^\d+$/u.test(trimmed)) {
      setBad(false);
      onChange({ ...filters, moneyFrom: Number(trimmed) });
    } else {
      setBad(true);
    }
  };
  return (
    <>
      <fieldset className="ccy">
        <legend className="vh">Валюта денег</legend>
        <div className="ccy-seg">
          {CURRENCY_OPTIONS.map((option) => (
            <label key={option.code}>
              <input type="radio" name={`${id}-ccy`} value={option.code} checked={currency === option.code} onChange={() => onCurrency(option.code)} />
              <span aria-label={option.aria}>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="vt-pop-list">
        <div className="vt-money-f">
          <label htmlFor={id}>Зарплата от</label>
          <div className="vt-money-in">
            <input id={id} type="text" inputMode="numeric" placeholder="500" value={text} aria-invalid={bad || undefined} aria-describedby={bad ? `${id}-e` : undefined} onChange={(event) => edit(event.target.value)} />
            <span aria-hidden="true">тыс.</span>
          </div>
          {bad ? (
            <p className="va-err vt-money-e" id={`${id}-e`} role="alert">
              <Icon name="warn" />
              Введите число
            </p>
          ) : null}
        </div>
        <FloorLink />
      </div>
    </>
  );
}

/** Содержимое одного фильтра: общее для поповера (1440/1176) и листа (390). */
export function FilterPane({ kind, ...props }: PaneProps & { kind: FilterKind }) {
  if (kind === 'roles') return <MultiPane kind="roles" search="роли" {...props} />;
  if (kind === 'locations') return <MultiPane kind="locations" search="локации" {...props} />;
  if (kind === 'formats') return <MultiPane kind="formats" {...props} />;
  if (kind === 'money') return <MoneyPane {...props} />;
  return <DatePane {...props} />;
}
