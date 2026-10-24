import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CaretRight, Check, Plus } from '@phosphor-icons/react';
import { listRelocationCountries } from '../relocationCountryData';
import { MobilePush } from '../RelocationMobilePush';

/** Mockup 15 at 390: a captioned group of list rows with an optional note below. */
export function MobileGroup({
  caption,
  note,
  children,
}: {
  readonly caption?: string;
  readonly note?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="vacancy-push-group">
      {caption ? <h3 className="vacancy-push-cap">{caption}</h3> : null}
      <div className="vacancy-push-list">{children}</div>
      {note ? <p className="vacancy-push-foot">{note}</p> : null}
    </section>
  );
}

export interface MobileNavRowProps {
  readonly id?: string;
  readonly icon?: ReactNode;
  readonly title: string;
  readonly sub?: string;
  readonly value?: string;
  readonly ariaLabel?: string;
  readonly onClick: () => void;
}

/** A row that opens a push screen: icon, title, optional sub-line, value, chevron. */
export function MobileNavRow({
  id,
  icon,
  title,
  sub,
  value,
  ariaLabel,
  onClick,
}: MobileNavRowProps) {
  return (
    <button
      id={id}
      type="button"
      className="vacancy-push-row"
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {icon ? <span className="vacancy-push-ico">{icon}</span> : null}
      <span className="vacancy-push-main">
        <b>{title}</b>
        {sub ? <small>{sub}</small> : null}
      </span>
      {value ? <span className="career-relocation-row-value">{value}</span> : null}
      <CaretRight className="vacancy-push-chev" aria-hidden="true" />
    </button>
  );
}

export function MobileAddRow({
  title,
  onClick,
}: {
  readonly title: string;
  readonly onClick: () => void;
}) {
  return <MobileNavRow icon={<Plus aria-hidden="true" />} title={title} onClick={onClick} />;
}

/** A value picked from a short list: the native picker sits over the row. */
export function MobilePickerRow<T extends string>({
  id,
  icon,
  label,
  value,
  options,
  onChange,
}: {
  readonly id: string;
  readonly icon?: ReactNode;
  readonly label: string;
  readonly value: T;
  readonly options: readonly (readonly [T, string])[];
  readonly onChange: (value: T) => void;
}) {
  const current = options.find(([code]) => code === value)?.[1] ?? 'Не указано';
  return (
    <div className="vacancy-push-row career-relocation-picker-row">
      {icon ? <span className="vacancy-push-ico">{icon}</span> : null}
      <label className="vacancy-push-main" htmlFor={id}>
        <b>{label}</b>
      </label>
      <span className="career-relocation-row-value" aria-hidden="true">
        {current}
      </span>
      <CaretRight className="vacancy-push-chev" aria-hidden="true" />
      <select id={id} value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map(([code, text]) => (
          <option key={code} value={code}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A labelled inline input on the right of the row: dates, numbers, short text. */
export function MobileInputRow({
  id,
  label,
  type = 'text',
  value,
  placeholder,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly type?: 'text' | 'date' | 'number';
  readonly value: string;
  readonly placeholder?: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="vacancy-push-kv career-relocation-input-row">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        data-empty={value ? undefined : 'true'}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function MobileToggleRow({
  label,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className="vacancy-push-kv career-relocation-toggle-row">
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

/** One choice of several, as radio rows inside a group. */
export function MobileRadioRows<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  readonly name: string;
  readonly value: T | null | undefined;
  readonly options: readonly (readonly [T, string])[];
  readonly onChange: (value: T) => void;
}) {
  return (
    <>
      {options.map(([option, label]) => (
        <label key={option} className="vacancy-push-row career-relocation-radio-row">
          <input
            type="radio"
            name={name}
            checked={value === option}
            onChange={() => onChange(option)}
          />
          <span>{label}</span>
        </label>
      ))}
    </>
  );
}

export function MobilePrimary({
  label,
  icon,
  disabled,
  onClick,
}: {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      className="vacancy-push-primary career-relocation-mobile-primary"
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function CountryOptions({
  countries,
  value,
  onPick,
}: {
  readonly countries: ReturnType<typeof listRelocationCountries>;
  readonly value: string;
  readonly onPick: (countryCode: string) => void;
}) {
  return (
    <ul className="career-relocation-option-list" role="listbox" aria-label="Страны">
      {countries.map(({ countryCode, name }) => (
        <li key={countryCode} role="option" aria-selected={countryCode === value}>
          <button type="button" className="vacancy-push-row" onClick={() => onPick(countryCode)}>
            <span className="vacancy-push-main">
              <b>{name}</b>
            </span>
            {countryCode === value ? (
              <Check className="career-relocation-check-mark" aria-hidden="true" />
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Country choice of mockup 15 at 390: its own push screen with search over the rules catalog. */
export function MobileCountrySearch({
  title,
  value,
  onPick,
  onBack,
}: {
  readonly title: string;
  readonly value: string;
  readonly onPick: (countryCode: string) => void;
  readonly onBack: () => void;
}) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => searchRef.current?.focus(), []);
  const needle = query.trim().toLocaleLowerCase('ru');
  const countries = listRelocationCountries().filter(
    ({ name }) => !needle || name.toLocaleLowerCase('ru').includes(needle),
  );
  return (
    <MobilePush title={title} onBack={onBack}>
      <input
        ref={searchRef}
        className="career-relocation-mobile-search"
        type="search"
        aria-label="Поиск: Страна"
        placeholder="Поиск: Страна"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <MobileGroup note={countries.length ? undefined : 'Такой страны нет в каталоге правил.'}>
        <CountryOptions countries={countries} value={value} onPick={onPick} />
      </MobileGroup>
    </MobilePush>
  );
}

/** Several choices as rows with a check mark on the right (mockup 15 `mv=i3`, «Что важно»). */
export function MobileCheckRows<T extends string>({
  values,
  options,
  onToggle,
}: {
  readonly values: readonly T[];
  readonly options: readonly (readonly [T, string])[];
  readonly onToggle: (value: T, checked: boolean) => void;
}) {
  return (
    <>
      {options.map(([option, label]) => (
        <label key={option} className="vacancy-push-row career-relocation-check-row">
          <span>{label}</span>
          <input
            className="career-sr-only"
            type="checkbox"
            checked={values.includes(option)}
            onChange={(event) => onToggle(option, event.target.checked)}
          />
          {values.includes(option) ? <Check aria-hidden="true" size={20} /> : null}
        </label>
      ))}
    </>
  );
}
