import React, { useState } from 'react';
import { getCountryTaxData, payrollSources } from '../../../shared/taxData';
import type { CountryCode } from '../../../shared/taxData/types';
import type { PayrollResult } from '../../../shared/taxCalculators';
import { CountryChoice, MoneyInput } from './CountryFitFields';
import { calculateCountryFitScenario } from './countryFitScenario';

function formatPayrollMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}
export function payrollParts(payroll: PayrollResult) {
  const amounts = [
    payroll.incomeTax.amount + payroll.solidaritySurcharge,
    payroll.employeeContributions.total,
    payroll.netAnnualIncome,
  ];
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  let offset = 0;
  return amounts.map((amount, index) => {
    const percent = total > 0 ? (amount / total) * 100 : 0;
    const part = {
      label: ['Налог', 'Взносы работника', 'Чистый доход'][index]!,
      amount,
      percent,
      offset,
      key: ['tax', 'contributions', 'net'][index]!,
    };
    offset += percent;
    return part;
  });
}
function PayrollRing({ parts }: { parts: ReturnType<typeof payrollParts> }) {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <circle className="cf-donut-base" cx="60" cy="60" r="45" />
      {parts.map((part) => (
        <circle
          key={part.key}
          className={`cf-donut-${part.key}`}
          cx="60"
          cy="60"
          r="45"
          pathLength="100"
          strokeDasharray={`${part.percent} ${100 - part.percent}`}
          strokeDashoffset={-part.offset}
          transform="rotate(-90 60 60)"
        >
          <title>{`${part.label}: ${part.percent.toFixed(1)}%`}</title>
        </circle>
      ))}
    </svg>
  );
}
export function CountryFitDonut({ payroll }: { payroll?: PayrollResult }) {
  if (!payroll) return null;
  const parts = payrollParts(payroll);
  const money = (value: number) =>
    new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: payroll.currency,
      maximumFractionDigits: 0,
    }).format(value);
  return (
    <figure className="cf-donut">
      <PayrollRing parts={parts} />
      <figcaption>
        <h2>Целевой доход за год</h2>
        <p>Доли суммы налога, взносов и чистого дохода.</p>
        <dl>
          {parts.map((part) => (
            <div key={part.key}>
              <dt>
                <span className={`cf-key cf-key-${part.key}`} aria-hidden="true" />
                {part.label}
              </dt>
              <dd>
                {money(part.amount)} · {part.percent.toFixed(1)}%
              </dd>
            </div>
          ))}
        </dl>
        {parts.every((part) => part.amount === 0) && <p>Нет суммы для построения диаграммы.</p>}
      </figcaption>
    </figure>
  );
}
function CurrentSources({ payroll }: { payroll?: PayrollResult }) {
  if (!payroll) return null;
  const sources = payrollSources(getCountryTaxData(payroll.countryCode));
  return (
    <details className="cf-faq">
      <summary>Источники и допущения текущего сценария</summary>
      <ul>
        {payroll.assumptions.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <ul>
        {sources.map((source) => (
          <li key={source.url}>
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.title}
            </a>{' '}
            · получено {source.retrievedAt}
          </li>
        ))}
      </ul>
    </details>
  );
}
export function CountryFitCurrent() {
  const [country, setCountry] = useState<CountryCode>('RU');
  const [gross, setGross] = useState('2400000');
  const data = getCountryTaxData(country);
  const result = calculateCountryFitScenario(country, gross, ['', '', '']);
  const payroll = 'payroll' in result ? result.payroll : undefined;
  const money = payroll
    ? formatPayrollMoney(payroll.netMonthlyIncome, data.currency)
    : 'Введите доход';
  return (
    <section className="cf-section cf-current" aria-labelledby="cf-current">
      <h2 id="cf-current">Сравнить с текущей страной</h2>
      <p>
        Это второй независимый сценарий. Страны и суммы не становятся фактами профиля. Валюты не
        конвертируются, покупательская способность не ранжируется.
      </p>
      <div className="cf-calculator">
        <div className="cf-inputs">
          <CountryChoice
            value={country}
            name="current-country"
            label="Текущая страна (сценарий)"
            onChange={setCountry}
          />
          <MoneyInput
            label={`Текущий годовой доход до налогов, ${data.currency}`}
            id="cf-current-income"
            errorId="cf-current-error"
            value={gross}
            onChange={setGross}
            invalid={'error' in result}
          />
          {'error' in result && (
            <p id="cf-current-error" role="alert">
              {result.error}
            </p>
          )}
        </div>
        <div className="cf-result" aria-live="polite">
          <p>Текущий чистый доход в месяц</p>
          <output className="cf-net">{money}</output>
          <p>Сопоставьте с целевым сценарием выше, учитывая разные валюты и собственные расходы.</p>
        </div>
      </div>
      <CurrentSources payroll={payroll} />
    </section>
  );
}
export function CountryFitModes() {
  return (
    <section className="cf-section" aria-labelledby="cf-modes">
      <h2 id="cf-modes">Налоговый статус</h2>
      <p>
        Поддерживается только наёмная зарплата. Резидентство и применимость специальных режимов
        калькулятор не определяет.
      </p>
      <div className="cf-mode-options">
        <span>Наёмный работник · выбран</span>
        <button type="button" disabled>
          ИП / самозанятый · нет расчёта
        </button>
        <button type="button" disabled>
          Digital nomad · нет расчёта
        </button>
      </div>
    </section>
  );
}
function useStickyVisibility(): boolean {
  const [visible, setVisible] = useState(false);
  React.useEffect(() => {
    const result = document.querySelector('.cf-result');
    if (!result || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry.boundingClientRect.bottom <= 0),
    );
    observer.observe(result);
    return () => observer.disconnect();
  }, []);
  return visible;
}
export function CountryFitSticky({
  payroll,
  currency,
  signedIn,
  onContinue,
  storageError = false,
}: {
  payroll?: PayrollResult;
  currency: string;
  signedIn: boolean;
  onContinue: () => void;
  storageError?: boolean;
}) {
  const visible = useStickyVisibility();
  const amount = payroll
    ? new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(payroll.netMonthlyIncome)
    : 'Введите доход';
  return (
    <aside className="cf-sticky ym-hide-content" aria-label="Целевой сценарий" hidden={!visible}>
      <div>
        <small>Целевой net в месяц</small>
        <strong>{amount}</strong>
      </div>
      <button
        type="button"
        className="ps-btn is-primary"
        onClick={onContinue}
        disabled={!signedIn && !payroll}
      >
        {signedIn ? 'В кабинет' : 'Продолжить'}
      </button>
      {storageError && <p role="alert">Разрешите хранилище сайта и повторите переход.</p>}
    </aside>
  );
}
