import { useMemo, useState } from 'react';
import { RelocationScenarioPanel } from './RelocationScenarioPanel';
import type { RelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import type { SourcedThreshold } from '../../../shared/countryFit/types';
import { getCountryTaxData, supportedCountryCodes } from '../../../shared/taxData';
import { calculateRelocationEconomy, countryFitForQuestionnaire, listRelocationCountries } from './relocationCountryData';
import { relocationDay } from './relocationDates';

export interface RelocationEconomyProps {
  readonly profile: RelocationQuestionnaire;
  readonly selectedCountryCodes: readonly string[];
  readonly selectedCountryCode: string;
  readonly grossAnnualIncome: number | undefined;
  readonly onCountryCodeChange: (countryCode: string) => void;
  readonly onGrossAnnualIncomeChange: (amount: number | undefined) => void;
  readonly onShowComparison: () => void;
}

export function RelocationEconomy({
  profile,
  selectedCountryCodes,
  selectedCountryCode,
  grossAnnualIncome,
  onCountryCodeChange,
  onGrossAnnualIncomeChange,
  onShowComparison,
}: RelocationEconomyProps) {
  const countries = useMemo(() => listRelocationCountries(), []);
  const [incomeMode, setIncomeMode] = useState('local_employment');
  const countryCode = selectedCountryCode || selectedCountryCodes[0] || '';
  const country = countries.find((item) => item.countryCode === countryCode);
  const supported = supportedCountryCodes.some((code) => code === countryCode);
  const data = supported && countryCode ? getCountryTaxData(countryCode) : null;
  const result = supported && grossAnnualIncome !== undefined
    ? calculateRelocationEconomy(countryCode, grossAnnualIncome)
    : undefined;
  const belowThresholds = useMemo(
    () => data ? belowAnnualSalaryThresholds(countryCode, profile, grossAnnualIncome, data.currency) : [],
    [countryCode, data, grossAnnualIncome, profile],
  );
  return (
    <section className="career-relocation-economy" aria-labelledby="career-relocation-economy-title">
      <EconomyHeading />
      <EconomyInputs countries={countries} countryCode={countryCode} data={data} income={grossAnnualIncome} onCountryChange={(code) => { onCountryCodeChange(code); onGrossAnnualIncomeChange(undefined); }} onIncomeChange={onGrossAnnualIncomeChange} />
      <TaxDataFreshness data={data} />
      {incomeMode === 'local_employment' && <EconomyOutput countryCode={countryCode} countryName={country?.name} supported={supported} income={grossAnnualIncome} result={result} />}
      {supported && <RelocationScenarioPanel countryCode={countryCode} income={grossAnnualIncome} profile={profile} onCountryChange={onCountryCodeChange} onIncomeChange={onGrossAnnualIncomeChange} onIncomeModeChange={setIncomeMode} />}
      <SalaryThresholdWarnings warnings={belowThresholds} />
      <EconomyActions onShowComparison={onShowComparison} />
    </section>
  );
}

function EconomyHeading() {
  return (
    <header className="career-relocation-section-heading">
      <div>
        <h2 id="career-relocation-economy-title">Экономика переезда</h2>
        <p>Показываем налоговый расчёт отдельно от расходов, которых нет в источниках.</p>
      </div>
    </header>
  );
}

function EconomyInputs({
  countries,
  countryCode,
  data,
  income,
  onCountryChange,
  onIncomeChange,
}: {
  readonly countries: ReturnType<typeof listRelocationCountries>;
  readonly countryCode: string;
  readonly data: ReturnType<typeof getCountryTaxData> | null;
  readonly income: number | undefined;
  readonly onCountryChange: (code: string) => void;
  readonly onIncomeChange: (amount: number | undefined) => void;
}) {
  return (
    <div className="career-relocation-economy-controls">
      <label>
        <span>Страна</span>
        <select value={countryCode} onChange={(event) => onCountryChange(event.target.value)}>
          <option value="">Выберите страну</option>
          {countries.map(({ countryCode: code, name }) => <option value={code} key={code}>{name}</option>)}
        </select>
      </label>
      <label>
        <span>Годовая зарплата до налогов</span>
        <input type="number" min="0" step="any" inputMode="decimal" value={income ?? ''}
          onChange={(event) => onIncomeChange(event.target.value === '' ? undefined : Number(event.target.value))}
          aria-describedby="career-relocation-income-hint" />
      </label>
      <p id="career-relocation-income-hint">
        {data ? `Валюта: ${data.currency}. Шкала налогов: ${data.taxYear}.` : 'Сначала выберите страну с доступной шкалой налогов.'}
      </p>
    </div>
  );
}

function TaxDataFreshness({ data }: { readonly data: ReturnType<typeof getCountryTaxData> | null }) {
  if (!data) return null;
  const retrievedAt = Date.parse(data.incomeTax.source.retrievedAt);
  const ageDays = Math.floor((Date.now() - retrievedAt) / 86_400_000);
  if (!Number.isFinite(retrievedAt) || ageDays <= 90) return null;
  const dateLabel = new Intl.DateTimeFormat('ru-RU').format(new Date(retrievedAt));
  return (
    <aside className="career-relocation-threshold-warning" role="status" aria-label="Данные устарели">
      <h3>Данные устарели</h3>
      <p>Налоговые шкалы обновлены {dateLabel}, прошло больше 90 дней. Расчёт показан с пометкой; цифры могли измениться.</p>
    </aside>
  );
}

function EconomyOutput({
  countryCode,
  countryName,
  supported,
  income,
  result,
}: {
  readonly countryCode: string;
  readonly countryName: string | undefined;
  readonly supported: boolean;
  readonly income: number | undefined;
  readonly result: ReturnType<typeof calculateRelocationEconomy> | undefined;
}) {
  if (!countryCode) return <EconomyNotice title="Выберите страну для расчёта" detail="Расчёт использует годовую зарплату и доступную налоговую шкалу." />;
  if (!supported) return <EconomyNotice title="Налоговая шкала не подключена" detail={`Для ${countryName ?? 'этой страны'} расчёт не выполняется, пока нет проверенных налоговых данных.`} />;
  if (result?.status === 'invalid_input') return <p className="career-relocation-error" role="alert">{result.reason}</p>;
  if (income === undefined || !Number.isFinite(income) || income <= 0) return <EconomyNotice title="Укажите годовую зарплату" detail="Пока сумма не указана, налоговый результат не рассчитывается." />;
  if (result?.status === 'available') return <PayrollResult countryName={countryName ?? countryCode} result={result} />;
  return null;
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
    paths.flatMap(({ label, thresholds }) => thresholds.flatMap((threshold) =>
      threshold.requirement === 'minimum_annual_salary' &&
      threshold.period === 'annual' &&
      threshold.currency === currency &&
      annualIncome < threshold.amount
        ? [{ pathLabel: label, threshold }]
        : [],
    )),
  );
}

function SalaryThresholdWarnings({ warnings }: { readonly warnings: readonly SalaryThresholdWarning[] }) {
  if (!warnings.length) return null;
  return (
    <section className="career-relocation-threshold-warning" role="status" aria-labelledby="career-relocation-threshold-title">
      <h3 id="career-relocation-threshold-title">Зарплата ниже порога</h3>
      <p>Сумма ниже опубликованных требований отдельных маршрутов. Это не оценка остальных условий визы.</p>
      <ul>
        {warnings.map(({ pathLabel, threshold }) => (
          <li key={`${pathLabel}-${threshold.amount}`}>
            <strong>{pathLabel}:</strong> {formatCurrency(threshold.amount, threshold.currency ?? 'EUR')} в год.
            {' '}Шкала {threshold.source.dataYear}, получено {relocationDay(threshold.source.retrievedAt)}.
          </li>
        ))}
      </ul>
    </section>
  );
}

function EconomyNotice({ title, detail }: { readonly title: string; readonly detail: string }) {
  return <div className="career-relocation-empty" role="status"><strong>{title}</strong><span>{detail}</span></div>;
}

function EconomyActions({ onShowComparison }: { readonly onShowComparison: () => void }) {
  return (
    <>

      <div className="career-relocation-list-footer">
        <button className="career-btn career-btn-secondary" type="button" onClick={onShowComparison}>К сравнению</button>
      </div>
    </>
  );
}

function PayrollResult({
  countryName,
  result,
}: {
  readonly countryName: string;
  readonly result: Extract<ReturnType<typeof calculateRelocationEconomy>, { readonly status: 'available' }>;
}) {
  const { payroll } = result;
  return (
    <div className="career-relocation-economy-result" aria-live="polite">
      <h3>{countryName}</h3>
      <p>Предварительная зарплатная оценка со стандартными условиями. Настройки и полный бюджет учитываются в итоге сценария ниже.</p>
      <p>
        Чистый доход: <strong>{formatCurrency(payroll.netMonthlyIncome, payroll.currency)}</strong> в месяц.
      </p>
      <div className="career-relocation-economy-breakdown">
        <span>Налог на доход</span>
        <strong>{formatCurrency(payroll.incomeTax.amount, payroll.currency)} в год</strong>
        {payroll.employeeContributions.items.map((item) => (
          <span key={item.name}>{item.name}: {formatCurrency(item.amount, payroll.currency)} в год</span>
        ))}
      </div>
      <p>Расходы на жильё, страховку и другие обязательства задайте в полном сценарии ниже. Его итог учитывает заполненность бюджета.</p>
      <ul className="career-relocation-source-list" aria-label="Источники расчёта">
        {[payroll.incomeTax.source, ...payroll.employeeContributions.items.map(({ source }) => source)]
          .filter((source, index, all) => all.findIndex((item) => item.url === source.url) === index)
          .map((source) => (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
              <span> · шкала {source.dataYear}, получено {relocationDay(source.retrievedAt)}</span>
            </li>
          ))}
      </ul>
      <ul className="career-relocation-assumptions">
        {payroll.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
      </ul>
    </div>
  );
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
