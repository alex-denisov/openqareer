import { useState, type ReactNode } from 'react';
import { Buildings, Info, PencilSimple, Scales, ShieldCheck } from '@phosphor-icons/react';
import type { PayrollResult } from '../../../shared/taxCalculators';
import type { RelocationScenarioInput } from '../../../shared/relocationScenario';
import type { getCountryTaxData } from '../../../shared/taxData';
import type { EconomyBreakdown, EconomyItemKey } from './relocationEconomyBreakdown';
import { relocationDay } from './relocationDates';

type TaxData = ReturnType<typeof getCountryTaxData>;

/** Slider bounds per currency: a UI range only, the value itself is the candidate's. */
const SALARY_RANGE: Readonly<Record<string, readonly [number, number, number]>> = {
  EUR: [20_000, 300_000, 5_000],
  RSD: [1_000_000, 30_000_000, 100_000],
  AED: [60_000, 1_500_000, 10_000],
  GEL: [20_000, 600_000, 5_000],
  RUB: [600_000, 30_000_000, 50_000],
};

export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

const percent = (share: number) => `${Math.round(share * 100)} %`;

/** «Страна и город»: the countries of the catalog; the scenario's city joins the chosen one. */
export function EconomyCountryField({
  countries,
  countryCode,
  city,
  onChange,
}: {
  readonly countries: readonly { readonly countryCode: string; readonly name: string }[];
  readonly countryCode: string;
  readonly city: string;
  readonly onChange: (code: string) => void;
}) {
  return (
    <div className="career-relocation-field">
      <label htmlFor="career-relocation-economy-country">Страна и город</label>
      <select
        id="career-relocation-economy-country"
        value={countryCode}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Выберите страну</option>
        {countries.map(({ countryCode: code, name }) => (
          <option value={code} key={code}>
            {code === countryCode && city ? `${name}, ${city}` : name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** .rl-slide: the gross salary on a range with its formatted value. */
export function EconomySalaryField({
  income,
  currency,
  onChange,
}: {
  readonly income: number | undefined;
  readonly currency: string;
  readonly onChange: (amount: number | undefined) => void;
}) {
  const [min, max, step] = SALARY_RANGE[currency] ?? SALARY_RANGE.EUR;
  return (
    <div className="career-relocation-field">
      <label htmlFor="career-relocation-economy-income">Годовая зарплата до налогов</label>
      <div className="career-relocation-economy-slide">
        <input
          id="career-relocation-economy-income"
          type="range"
          min={min}
          max={max}
          step={step}
          value={income ?? min}
          aria-valuetext={income === undefined ? 'не указана' : formatMoney(income, currency)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="career-relocation-economy-value">
          {income === undefined ? 'не указана' : formatMoney(income, currency)}
        </span>
      </div>
    </div>
  );
}

/** .rl-stack + .rl-legend: only the parts we know; the rest of the bar stays neutral. */
export function EconomyBreakdownView({
  breakdown,
  onEdit,
}: {
  readonly breakdown: EconomyBreakdown;
  /** Rent and insurance have no source: the person enters them in the scenario editor (owner 24.10). */
  readonly onEdit: () => void;
}) {
  const known = breakdown.items.filter((item) => item.share !== null && item.share > 0);
  const label = known
    .map((item) => `${item.label.toLocaleLowerCase('ru')} ${percent(item.share ?? 0)}`)
    .join(', ');
  const shown = breakdown.items.filter((item) => item.key !== 'other' || item.share !== null);
  return (
    <>
      <svg
        className="career-relocation-economy-stack"
        viewBox="0 0 100 14"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Раскладка: ${label}`}
      >
        <rect className="is-track" x={0} y={0} width={100} height={14} />
        {segments(known).map(({ key, x, width }) => (
          <rect key={key} className={`is-${key}`} x={x} y={0} width={width} height={14} />
        ))}
      </svg>
      <ul className="career-relocation-economy-legend">
        {shown.map((item) => (
          <li key={item.key}>
            <span
              className={`career-relocation-economy-swatch is-${item.key}`}
              aria-hidden="true"
            />
            <span>{item.label}</span>
            {item.share === null ? (
              <MissingShare onEdit={onEdit} />
            ) : (
              <span>{percent(item.share)}</span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/** Макет 15: «нет данных в источниках, указать» — «указать» открывает редактор сценария. */
export function MissingShare({ onEdit }: { readonly onEdit: () => void }) {
  return (
    <span className="is-missing">
      нет данных в источниках,{' '}
      <button type="button" className="career-relocation-economy-specify" onClick={onEdit}>
        указать
      </button>
    </span>
  );
}

/** Left-to-right positions of the known parts, with a 0.4-unit gap like the mockup's 2 px. */
function segments(
  items: readonly { readonly key: EconomyItemKey; readonly share: number | null }[],
) {
  let x = 0;
  return items.map(({ key, share }) => {
    const width = Math.max(0, (share ?? 0) * 100 - 0.4);
    const segment = { key, x, width };
    x += (share ?? 0) * 100;
    return segment;
  });
}

export function EconomySummaryNote({
  breakdown,
  currency,
  householdSize,
}: {
  readonly breakdown: EconomyBreakdown;
  readonly currency: string;
  readonly householdSize: number;
}) {
  return (
    <p className="career-relocation-note">
      <Info aria-hidden="true" size={17} />
      <span>
        {breakdown.freeMonthly === null
          ? `Чистыми ${formatMoney(breakdown.netMonthly, currency)} в месяц после налогов и взносов. Аренды и страховки по городам в проверенных источниках нет: укажите свои суммы, и мы посчитаем свободный остаток.`
          : `Свободный остаток ${formatMoney(breakdown.freeMonthly, currency)} в месяц на ${householdSize} чел. по вашим расходам, до учёта переезда и порога визы.`}
      </span>
    </p>
  );
}

const SOURCE_ICONS: Readonly<Record<Exclude<EconomyItemKey, 'other' | 'free'>, ReactNode>> = {
  tax: <Scales aria-hidden="true" size={18} />,
  rent: <Buildings aria-hidden="true" size={18} />,
  insurance: <ShieldCheck aria-hidden="true" size={18} />,
};

/** «Откуда цифры»: the tax scale with its dates; rent and insurance are the candidate's or missing. */
export function EconomySources({
  data,
  assumption,
  expenses,
  onEdit,
}: {
  readonly data: TaxData | null;
  /** Tax class, church tax, health insurance and children the tax line assumes. */
  readonly assumption: string | null;
  readonly expenses: RelocationScenarioInput['expenses'] | undefined;
  readonly onEdit: () => void;
}) {
  const own = (key: 'rent' | 'insurance') => {
    const cost = expenses?.[key];
    return cost ? `Ваши данные, ${relocationDay(cost.observedAt)}` : null;
  };
  return (
    <aside
      className="career-relocation-card career-relocation-economy-sources"
      aria-labelledby="career-relocation-sources-title"
    >
      <div className="career-relocation-reason-head">
        <h3 id="career-relocation-sources-title">Откуда цифры</h3>
      </div>
      <ul>
        <TaxSourceRow data={data} assumption={assumption} />
        {(['rent', 'insurance'] as const).map((key) => (
          <SourceRow
            key={key}
            icon={SOURCE_ICONS[key]}
            title={key === 'rent' ? 'Аренда' : 'Страховка'}
            ok={Boolean(own(key))}
            detail={own(key) ?? 'Нет данных в источниках'}
            action={own(key) ? undefined : { label: 'указать', onClick: onEdit }}
          />
        ))}
      </ul>
      <p className="career-relocation-economy-aside-note">
        Если в вашем сценарии зарплата ниже порога визы, мы покажем это отдельной строкой, а не
        скроем.
      </p>
    </aside>
  );
}

function TaxSourceRow({
  data,
  assumption,
}: {
  readonly data: TaxData | null;
  readonly assumption: string | null;
}) {
  return (
    <SourceRow
      icon={SOURCE_ICONS.tax}
      title="Налоги"
      ok={Boolean(data)}
      detail={
        data
          ? `Шкала страны, ${data.taxYear}, обновлено ${relocationDay(data.incomeTax.source.retrievedAt)}`
          : 'Нет проверенной шкалы для этой страны'
      }
      note={data ? (assumption ?? undefined) : undefined}
    />
  );
}

function SourceRow({
  icon,
  title,
  detail,
  ok,
  action,
  note,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly detail: string;
  readonly note?: string;
  readonly ok: boolean;
  readonly action?: { readonly label: string; readonly onClick: () => void };
}) {
  return (
    <li className={ok ? 'is-ok' : undefined}>
      <span className="career-relocation-economy-source-icon">{icon}</span>
      <span>
        <b>{title}</b>
        <small>{detail}</small>
        {note ? <small>{note}</small> : null}
      </span>
      {action ? (
        <button
          className="career-relocation-btn is-sm is-ghost"
          type="button"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ) : null}
    </li>
  );
}

export function EconomyHeading() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="career-relocation-section-title">
        <h3 id="career-relocation-economy-title">Экономика переезда</h3>
        <button
          className="career-relocation-btn is-sm is-icon is-ghost"
          type="button"
          aria-label="Пояснение"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Info aria-hidden="true" size={17} />
        </button>
      </div>
      {open ? (
        <p className="career-relocation-muted">
          Налоги по проверенной шкале страны без индивидуальных льгот и вычетов. Аренда, страховка и
          прочие расходы — только ваши суммы. Расчёт не заменяет консультацию налогового
          специалиста.
        </p>
      ) : null}
    </>
  );
}

export function EconomyActions({
  onEdit,
  onShowComparison,
}: {
  readonly onEdit: () => void;
  readonly onShowComparison: () => void;
}) {
  return (
    <div className="career-relocation-footer-actions">
      <button className="career-relocation-btn is-primary" type="button" onClick={onEdit}>
        <PencilSimple aria-hidden="true" size={17} />
        Уточнить расходы
      </button>
      <button className="career-relocation-btn" type="button" onClick={onShowComparison}>
        К сравнению
      </button>
    </div>
  );
}

export type { PayrollResult };
