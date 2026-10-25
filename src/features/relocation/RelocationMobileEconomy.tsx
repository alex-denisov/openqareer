import { useState } from 'react';
import {
  Buildings,
  CheckCircle,
  Info,
  PencilSimple,
  Scales,
  ShieldCheck,
} from '@phosphor-icons/react';
import { getCountryTaxData, supportedCountryCodes } from '../../../shared/taxData';
import type { RelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import type { RelocationScenarioInput } from '../../../shared/relocationScenario';
import {
  calculateRelocationEconomy,
  listRelocationCountries,
  relocationAssumptionSummary,
  scenarioPayrollNow,
} from './relocationCountryData';
import { relocationEconomyBreakdown, type EconomyBreakdown } from './relocationEconomyBreakdown';
import { relocationDay } from './relocationDates';
import { formatMoney } from './RelocationEconomyCalc';
import { MobilePush } from './RelocationMobilePush';
import { RelocationScenarioEditor } from './RelocationScenarioEditor';
import { MobileGroup, MobilePickerRow } from './mobile/MobileRows';
import { useRelocationScenario, type RelocationScenarioState } from './useRelocationScenario';
import './relocation-economy.css';

export interface RelocationMobileEconomyProps {
  readonly selectedCountryCodes: readonly string[];
  readonly selectedCountryCode: string;
  readonly grossAnnualIncome: number | undefined;
  readonly onCountryCodeChange: (countryCode: string) => void;
  readonly onGrossAnnualIncomeChange: (amount: number | undefined) => void;
  readonly profile?: RelocationQuestionnaire | null;
}

const SALARY_RANGE: Readonly<Record<string, readonly [number, number, number]>> = {
  EUR: [20_000, 300_000, 5_000],
  RSD: [1_000_000, 30_000_000, 100_000],
  AED: [60_000, 1_500_000, 10_000],
  GEL: [20_000, 600_000, 5_000],
  RUB: [600_000, 30_000_000, 50_000],
};

/**
 * Mockup 15 `vt=net` at 390: country and salary rows, the breakdown bar and list, a note,
 * «Откуда цифры» and one CTA «Уточнить расходы» that pushes the scenario editor.
 */
export function RelocationMobileEconomy(props: RelocationMobileEconomyProps) {
  const countryCode = props.selectedCountryCode || props.selectedCountryCodes[0] || '';
  const supported = supportedCountryCodes.some((code) => code === countryCode);
  const scenario = useRelocationScenario({
    countryCode,
    income: props.grossAnnualIncome,
    profile: props.profile ?? null,
  });
  const [editing, setEditing] = useState(false);
  if (editing && supported) {
    return (
      <MobilePush title="Свой сценарий" onBack={() => setEditing(false)}>
        <RelocationScenarioEditor
          mobile
          scenario={scenario}
          countryCode={countryCode as RelocationScenarioInput['countryCode']}
          onBack={() => setEditing(false)}
          onCalculated={() => setEditing(false)}
          onOpened={(input) => {
            props.onCountryCodeChange(input.countryCode);
            props.onGrossAnnualIncomeChange(input.grossAnnualIncome);
          }}
        />
      </MobilePush>
    );
  }
  return (
    <MobileCalculation
      {...props}
      countryCode={countryCode}
      supported={supported}
      scenario={scenario}
      onEdit={() => setEditing(true)}
    />
  );
}

function MobileCalculation(
  props: RelocationMobileEconomyProps & {
    readonly countryCode: string;
    readonly supported: boolean;
    readonly scenario: RelocationScenarioState;
    readonly onEdit: () => void;
  },
) {
  const { countryCode, supported, scenario } = props;
  const data = supported ? getCountryTaxData(countryCode) : null;
  const calculated = calculatedFor(scenario, countryCode, props.grossAnnualIncome);
  return (
    <div className="career-relocation-mobile-section career-relocation-mobile-economy">
      <MobileGroup>
        <CountryRow {...props} city={calculated?.input.city ?? ''} />
        {data ? (
          <SalaryRows
            income={props.grossAnnualIncome}
            currency={data.currency}
            onChange={props.onGrossAnnualIncomeChange}
          />
        ) : null}
      </MobileGroup>
      <MobileResult
        countryCode={countryCode}
        supported={supported}
        income={props.grossAnnualIncome}
        calculated={calculated}
      />
      <MobileSources
        data={data}
        assumption={relocationAssumptionSummary(
          countryCode,
          props.grossAnnualIncome,
          calculated ? scenarioPayrollNow(calculated.input) : undefined,
        )}
        expenses={calculated?.input.expenses}
        onEdit={props.onEdit}
      />
      {supported ? (
        <button className="career-relocation-mobile-cta" type="button" onClick={props.onEdit}>
          <PencilSimple aria-hidden="true" size={18} />
          Уточнить расходы
        </button>
      ) : null}
    </div>
  );
}

/** The saved scenario counts only for this very country and salary. */
function calculatedFor(
  scenario: RelocationScenarioState,
  countryCode: string,
  income: number | undefined,
) {
  const saved = scenario.calculated;
  if (!saved || saved.input.countryCode !== countryCode) return undefined;
  if (saved.input.grossAnnualIncome !== income) return undefined;
  return saved;
}

function CountryRow(
  props: RelocationMobileEconomyProps & {
    readonly countryCode: string;
    readonly supported: boolean;
    readonly city: string;
  },
) {
  const options = [
    ['', 'Выберите'] as const,
    ...listRelocationCountries().map(
      ({ countryCode: code, name }) =>
        [code, code === props.countryCode && props.city ? `${name}, ${props.city}` : name] as const,
    ),
  ];
  return (
    <MobilePickerRow
      id="relocation-mobile-economy-country"
      icon={props.supported ? <CheckCircle aria-hidden="true" /> : <Info aria-hidden="true" />}
      label="Страна и город"
      value={props.countryCode}
      options={options}
      onChange={(code) => {
        props.onCountryCodeChange(code);
        props.onGrossAnnualIncomeChange(undefined);
      }}
    />
  );
}

/** «Зарплата в год до налогов» with its value, the slider under it. */
function SalaryRows({
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
    <>
      <div className="vacancy-push-kv career-relocation-salary-row">
        <span>Зарплата в год до налогов</span>
        <b>{income === undefined ? 'не указана' : formatMoney(income, currency)}</b>
      </div>
      <div className="vacancy-push-kv career-relocation-slider-row">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={income ?? min}
          aria-label="Годовая зарплата до налогов"
          aria-valuetext={income === undefined ? 'не указана' : formatMoney(income, currency)}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
    </>
  );
}

function MobileResult({
  countryCode,
  supported,
  income,
  calculated,
}: {
  readonly countryCode: string;
  readonly supported: boolean;
  readonly income: number | undefined;
  readonly calculated: RelocationScenarioState['calculated'];
}) {
  if (!countryCode)
    return (
      <Notice
        title="Выберите страну"
        detail="Расчёт использует годовую зарплату и налоговую шкалу страны."
      />
    );
  if (!supported)
    return (
      <Notice
        title="Нет проверенной шкалы"
        detail="Для этой страны расчёт не выполняется, пока нет проверенных налоговых данных."
      />
    );
  if (income === undefined)
    return (
      <Notice title="Укажите зарплату" detail="Пока сумма не указана, расчёт не выполняется." />
    );
  const result = calculateRelocationEconomy(countryCode, income);
  if (result.status !== 'available')
    return (
      <p className="career-relocation-error" role="alert">
        {result.reason}
      </p>
    );
  const payroll = (calculated && scenarioPayrollNow(calculated.input)) ?? result.payroll;
  const breakdown = relocationEconomyBreakdown(payroll, calculated?.input.expenses);
  return (
    <MobileBreakdown
      breakdown={breakdown}
      currency={payroll.currency}
      householdSize={calculated?.input.householdSize ?? 1}
    />
  );
}

/** .rl-stack, «Раскладка» rows and the .pm-note with the monthly amount. */
function MobileBreakdown({
  breakdown,
  currency,
  householdSize,
}: {
  readonly breakdown: EconomyBreakdown;
  readonly currency: string;
  readonly householdSize: number;
}) {
  const shown = breakdown.items.filter((item) => item.key !== 'other' || item.share !== null);
  return (
    <>
      <MobileStack breakdown={breakdown} />
      <MobileGroup caption="Раскладка">
        {shown.map((item) => (
          <div key={item.key} className="vacancy-push-kv">
            <span>
              <i className={`career-relocation-economy-swatch is-${item.key}`} aria-hidden="true" />
              {item.label}
            </span>
            <b className={item.share === null ? 'is-missing' : undefined}>
              {item.share === null ? 'нет данных' : `${Math.round(item.share * 100)} %`}
            </b>
          </div>
        ))}
      </MobileGroup>
      <p className="career-relocation-mobile-note">
        <CheckCircle aria-hidden="true" size={16} />
        <span>
          {breakdown.freeMonthly === null
            ? `Чистыми ${formatMoney(breakdown.netMonthly, currency)} в месяц после налогов. Аренды и страховки по городам в проверенных источниках нет: укажите свои суммы.`
            : `Свободный остаток ${formatMoney(breakdown.freeMonthly, currency)} в месяц на ${householdSize} чел. по вашим расходам, до учёта переезда и порога визы.`}
        </span>
      </p>
    </>
  );
}

/** «Откуда цифры»: the tax scale; rent and insurance are the person's or open the editor. */
/** Shares as SVG rect widths: attributes, not inline styles. */
function MobileStack({ breakdown }: { readonly breakdown: EconomyBreakdown }) {
  let x = 0;
  return (
    <svg
      className="career-relocation-economy-stack"
      viewBox="0 0 100 14"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <rect className="is-track" x={0} y={0} width={100} height={14} />
      {breakdown.items
        .filter((item) => item.share !== null && item.share > 0)
        .map((item) => {
          const width = (item.share ?? 0) * 100;
          const rect = (
            <rect
              key={item.key}
              className={`is-${item.key}`}
              x={x}
              y={0}
              width={Math.max(0, width - 0.6)}
              height={14}
            />
          );
          x += width;
          return rect;
        })}
    </svg>
  );
}

function MobileSources({
  data,
  assumption,
  expenses,
  onEdit,
}: {
  readonly data: ReturnType<typeof getCountryTaxData> | null;
  readonly assumption: string | null;
  readonly expenses: RelocationScenarioInput['expenses'] | undefined;
  readonly onEdit: () => void;
}) {
  if (!data) return null;
  const own = (key: 'rent' | 'insurance') => {
    const cost = expenses?.[key];
    return cost ? `ваши данные, ${relocationDay(cost.observedAt)}` : null;
  };
  return (
    <MobileGroup
      caption="Откуда цифры"
      note="Без индивидуальных льгот и вычетов. Не заменяет консультацию налогового специалиста. Если зарплата ниже порога визы, покажем это отдельной строкой."
    >
      <div className="vacancy-push-row">
        <span className="vacancy-push-ico">
          <Scales aria-hidden="true" />
        </span>
        <span className="vacancy-push-main">
          <b>Налоги</b>
          <small>
            шкала страны, {data.taxYear}, обновлено{' '}
            {relocationDay(data.incomeTax.source.retrievedAt)}
          </small>
          {assumption ? <small>{assumption}</small> : null}
        </span>
      </div>
      {(['rent', 'insurance'] as const).map((key) => (
        <button key={key} type="button" className="vacancy-push-row" onClick={onEdit}>
          <span className="vacancy-push-ico">
            {key === 'rent' ? <Buildings aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
          </span>
          <span className="vacancy-push-main">
            <b>{key === 'rent' ? 'Аренда' : 'Страховка'}</b>
            <small>{own(key) ?? 'нет данных в источниках, указать'}</small>
          </span>
        </button>
      ))}
    </MobileGroup>
  );
}

function Notice({ title, detail }: { readonly title: string; readonly detail: string }) {
  return (
    <p className="career-relocation-push-why" role="status">
      <Info aria-hidden="true" size={20} />
      <span>
        <b>{title}.</b> {detail}
      </span>
    </p>
  );
}
