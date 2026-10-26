import { useMemo, useState } from 'react';
import type { RelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import type { SourcedThreshold } from '../../../shared/countryFit/types';
import type { RelocationScenarioInput } from '../../../shared/relocationScenario';
import { getCountryTaxData, supportedCountryCodes } from '../../../shared/taxData';
import {
  calculateRelocationEconomy,
  countryFitForQuestionnaire,
  listRelocationCountries,
  relocationAssumptionSummary,
  scenarioPayrollNow,
} from './relocationCountryData';
import { relocationDay } from './relocationDates';
import type { PayrollResult } from '../../../shared/taxCalculators';
import { relocationEconomyBreakdown } from './relocationEconomyBreakdown';
import { useEconomyCountryPrompt } from './economyCountryPrompt';
import { RelocationScenarioEditor } from './RelocationScenarioEditor';
import {
  EconomyActions,
  EconomyBreakdownView,
  EconomyCountryField,
  EconomyHeading,
  EconomySalaryField,
  EconomySources,
  EconomySummaryNote,
  formatMoney,
} from './RelocationEconomyCalc';
import './relocation-economy.css';
import { useRelocationScenario, type RelocationScenarioState } from './useRelocationScenario';

export interface RelocationEconomyProps {
  readonly profile: RelocationQuestionnaire;
  readonly selectedCountryCodes: readonly string[];
  readonly selectedCountryCode: string;
  readonly grossAnnualIncome: number | undefined;
  readonly onCountryCodeChange: (countryCode: string) => void;
  readonly onGrossAnnualIncomeChange: (amount: number | undefined) => void;
  readonly onShowComparison: () => void;
}

type TaxData = ReturnType<typeof getCountryTaxData>;

/**
 * Mockup 15 `view=net`: one calculation with a salary slider, the breakdown and «Откуда цифры».
 * «Уточнить расходы» opens the scenario editor; its «Рассчитать» brings the person back here.
 */
export function RelocationEconomy(props: RelocationEconomyProps) {
  const countryCode = props.selectedCountryCode || props.selectedCountryCodes[0] || '';
  const supported = supportedCountryCodes.some((code) => code === countryCode);
  const scenario = useRelocationScenario({
    countryCode,
    income: props.grossAnnualIncome,
    profile: props.profile,
  });
  const [editing, setEditing] = useState(false);
  const countryPrompt = useEconomyCountryPrompt(countryCode, 'career-relocation-economy-country');
  if (editing && supported) {
    return (
      <div className="career-relocation-card career-relocation-economy-editor">
        <RelocationScenarioEditor
          scenario={scenario}
          countryCode={countryCode as RelocationScenarioInput['countryCode']}
          onBack={() => setEditing(false)}
          onCalculated={() => setEditing(false)}
          onOpened={(input) => {
            props.onCountryCodeChange(input.countryCode);
            props.onGrossAnnualIncomeChange(input.grossAnnualIncome);
          }}
        />
      </div>
    );
  }
  return (
    <EconomyCalculation
      {...props}
      countryCode={countryCode}
      supported={supported}
      scenario={scenario}
      countryPrompt={countryPrompt.message}
      onEdit={() => (supported ? setEditing(true) : countryPrompt.ask())}
    />
  );
}

type EconomyCalculationProps = RelocationEconomyProps & {
  readonly countryCode: string;
  readonly supported: boolean;
  readonly scenario: RelocationScenarioState;
  readonly countryPrompt: string | null;
  readonly onEdit: () => void;
};

/** The scenario counts only for this country and salary; its payroll is recomputed by today's rules. */
function useEconomyCalculation({
  countryCode,
  supported,
  scenario,
  grossAnnualIncome,
}: EconomyCalculationProps) {
  const countries = useMemo(() => listRelocationCountries(), []);
  const data = supported && countryCode ? getCountryTaxData(countryCode) : null;
  const expenses = scenarioExpenses(scenario, countryCode, grossAnnualIncome);
  const calculated = expenses ? scenario.calculated : undefined;
  const scenarioPayroll = calculated ? scenarioPayrollNow(calculated.input) : undefined;
  return { countries, data, income: grossAnnualIncome, expenses, calculated, scenarioPayroll };
}

function EconomyCalculation(props: EconomyCalculationProps) {
  const { countryCode, supported } = props;
  const { countries, data, income, expenses, calculated, scenarioPayroll } =
    useEconomyCalculation(props);
  return (
    <div className="career-relocation-economy-layout">
      <section
        className="career-relocation-card career-relocation-economy"
        aria-labelledby="career-relocation-economy-title"
      >
        <EconomyHeading />
        <EconomyInputs
          {...props}
          countries={countries}
          city={calculated?.input.city ?? ''}
          currency={data?.currency}
        />
        {props.countryPrompt ? (
          <p className="career-relocation-economy-prompt" role="alert">
            {props.countryPrompt}
          </p>
        ) : null}
        <TaxDataFreshness data={data} />
        <EconomyResult
          countryCode={countryCode}
          countryName={countries.find((item) => item.countryCode === countryCode)?.name}
          supported={supported}
          income={income}
          expenses={expenses}
          scenarioPayroll={scenarioPayroll}
          householdSize={calculated?.input.householdSize ?? 1}
        />
        <SalaryThresholdWarnings
          countryCode={countryCode}
          profile={props.profile}
          income={income}
          currency={data?.currency}
        />
        <EconomyActions onEdit={props.onEdit} onShowComparison={props.onShowComparison} />
      </section>
      <EconomySources
        data={data}
        assumption={relocationAssumptionSummary(countryCode, income, scenarioPayroll)}
        expenses={expenses}
        onEdit={props.onEdit}
      />
    </div>
  );
}

function EconomyInputs(
  props: RelocationEconomyProps & {
    readonly countries: ReturnType<typeof listRelocationCountries>;
    readonly countryCode: string;
    readonly city: string;
    readonly currency: string | undefined;
  },
) {
  return (
    <>
      <EconomyCountryField
        countries={props.countries}
        countryCode={props.countryCode}
        city={props.city}
        onChange={(code) => {
          props.onCountryCodeChange(code);
          props.onGrossAnnualIncomeChange(undefined);
        }}
      />
      {props.currency ? (
        <EconomySalaryField
          income={props.grossAnnualIncome}
          currency={props.currency}
          onChange={props.onGrossAnnualIncomeChange}
        />
      ) : null}
    </>
  );
}

/** The candidate's costs count only after «Рассчитать» for this very country and salary. */
function scenarioExpenses(
  scenario: RelocationScenarioState,
  countryCode: string,
  income: number | undefined,
): RelocationScenarioInput['expenses'] | undefined {
  const result = scenario.calculated?.result;
  if (!result || !countryCode || result.currency !== getCountryTaxData(countryCode).currency)
    return undefined;
  if (result.payroll && result.payroll.grossAnnualIncome !== income) return undefined;
  return scenario.calculated?.input.expenses;
}

function EconomyResult({
  countryCode,
  countryName,
  supported,
  income,
  expenses,
  householdSize,
  scenarioPayroll,
}: {
  readonly countryCode: string;
  readonly countryName: string | undefined;
  readonly supported: boolean;
  readonly income: number | undefined;
  readonly expenses: RelocationScenarioInput['expenses'] | undefined;
  readonly householdSize: number;
  /** After «Рассчитать»: the payroll with the family's options (e.g. Germany's childless surcharge). */
  readonly scenarioPayroll?: PayrollResult;
}) {
  const notice = economyNotice(countryCode, countryName, supported, income);
  if (notice || income === undefined) return notice;
  const result = calculateRelocationEconomy(countryCode, income);
  if (result.status === 'invalid_input')
    return (
      <p className="career-relocation-error" role="alert">
        {result.reason}
      </p>
    );
  if (result.status !== 'available') return null;
  const payroll = scenarioPayroll ?? result.payroll;
  const breakdown = relocationEconomyBreakdown(payroll, expenses);
  return (
    <>
      <EconomyBreakdownView breakdown={breakdown} />
      <EconomySummaryNote
        breakdown={breakdown}
        currency={payroll.currency}
        householdSize={householdSize}
      />
    </>
  );
}

/** Why there is no calculation yet: no country, no verified scale or no salary. */
function economyNotice(
  countryCode: string,
  countryName: string | undefined,
  supported: boolean,
  income: number | undefined,
) {
  if (!countryCode)
    return (
      <EconomyNotice
        title="Выберите страну для расчёта"
        detail="Расчёт использует годовую зарплату и налоговую шкалу страны."
      />
    );
  if (!supported)
    return (
      <EconomyNotice
        title="Нет проверенной шкалы"
        detail={`Для ${countryName ?? 'этой страны'} расчёт не выполняется, пока нет проверенных налоговых данных.`}
      />
    );
  if (income === undefined || !Number.isFinite(income))
    return (
      <EconomyNotice
        title="Укажите зарплату"
        detail="Пока сумма не указана, расчёт не выполняется."
      />
    );
  return null;
}

function TaxDataFreshness({ data }: { readonly data: TaxData | null }) {
  if (!data) return null;
  const retrievedAt = Date.parse(data.incomeTax.source.retrievedAt);
  const ageDays = Math.floor((Date.now() - retrievedAt) / 86_400_000);
  if (!Number.isFinite(retrievedAt) || ageDays <= 90) return null;
  const dateLabel = new Intl.DateTimeFormat('ru-RU').format(new Date(retrievedAt));
  return (
    <aside
      className="career-relocation-threshold-warning"
      role="status"
      aria-label="Данные устарели"
    >
      <h3>Данные устарели</h3>
      <p>
        Налоговые шкалы обновлены {dateLabel}, прошло больше 90 дней. Расчёт показан с пометкой;
        цифры могли измениться.
      </p>
    </aside>
  );
}

interface SalaryThresholdWarning {
  readonly pathLabel: string;
  readonly threshold: SourcedThreshold;
}

function belowAnnualSalaryThresholds(
  countryCode: string,
  profile: RelocationQuestionnaire,
  annualIncome: number | undefined,
  currency: string,
): readonly SalaryThresholdWarning[] {
  if (annualIncome === undefined || !Number.isFinite(annualIncome) || annualIncome <= 0) return [];
  return countryFitForQuestionnaire(countryCode, profile).scenarios.flatMap(({ paths }) =>
    paths.flatMap(({ label, thresholds }) =>
      thresholds.flatMap((threshold) =>
        threshold.requirement === 'minimum_annual_salary' &&
        threshold.period === 'annual' &&
        threshold.currency === currency &&
        annualIncome < threshold.amount
          ? [{ pathLabel: label, threshold }]
          : [],
      ),
    ),
  );
}

function SalaryThresholdWarnings({
  countryCode,
  profile,
  income,
  currency,
}: {
  readonly countryCode: string;
  readonly profile: RelocationQuestionnaire;
  readonly income: number | undefined;
  readonly currency: string | undefined;
}) {
  const warnings = useMemo(
    () => (currency ? belowAnnualSalaryThresholds(countryCode, profile, income, currency) : []),
    [countryCode, currency, income, profile],
  );
  if (!warnings.length) return null;
  return (
    <section
      className="career-relocation-threshold-warning"
      role="status"
      aria-labelledby="career-relocation-threshold-title"
    >
      <h3 id="career-relocation-threshold-title">Зарплата ниже порога</h3>
      <p>
        Сумма ниже опубликованных требований отдельных маршрутов. Это не оценка остальных условий
        визы.
      </p>
      <ul>
        {warnings.map(({ pathLabel, threshold }) => (
          <li key={`${pathLabel}-${threshold.amount}`}>
            <strong>{pathLabel}:</strong>{' '}
            {formatMoney(threshold.amount, threshold.currency ?? 'EUR')} в год. Шкала{' '}
            {threshold.source.dataYear}, получено {relocationDay(threshold.source.retrievedAt)}.
          </li>
        ))}
      </ul>
    </section>
  );
}

function EconomyNotice({ title, detail }: { readonly title: string; readonly detail: string }) {
  return (
    <div className="career-relocation-empty" role="status">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}
