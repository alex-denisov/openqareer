import React, { useState } from 'react';
import { getCountryTaxData } from '../../../shared/taxData';
import type { CountryCode } from '../../../shared/taxData/types';
import { CountryChoice, MoneyInput } from './CountryFitFields';
import {
  CountryFitCurrent,
  CountryFitDonut,
  CountryFitModes,
  CountryFitSticky,
} from './CountryFitComparison';
import { PublicFooter, PublicHeader } from './PublicSiteChrome';
import { calculateCountryFitScenario, saveCountryFitScenario } from './countryFitScenario';

export const COUNTRY_FIT_TITLE = 'Калькулятор налогов и чистой зарплаты 2026 | openqareer';
export const COUNTRY_FIT_DESCRIPTION =
  'Зарплата после налогов в шести странах: расчёт за 2026 год, свои расходы и источники. Без регистрации.';
export const COUNTRY_FIT_FAQ = [
  [
    'Нужна ли регистрация для расчёта?',
    'Нет. Расчёт выполняется в браузере. Для перехода к карьерной стратегии можно сохранить выбранные страну и годовой доход в текущей вкладке.',
  ],
  [
    'Какие налоговые режимы поддерживаются?',
    'Калькулятор оценивает зарплату наёмного работника за 2026 год. Режимы ИП, самозанятости и digital nomad не рассчитываются. Условия применимости и источники показаны под результатом.',
  ],
  [
    'Откуда взяты расходы на жизнь?',
    'Аренду, частную страховку и прочие расходы вводите вы. Это личный сценарий, а не рыночная оценка. Данные и индекс Numbeo не подключены: у сервиса нет лицензированного набора.',
  ],
  [
    'Можно ли считать результат налоговой консультацией?',
    'Нет. Это ориентир по опубликованным ставкам с указанными допущениями. Резидентство, вычеты, семейное положение и условия договора могут изменить расчёт. Обсудите свой случай с налоговым специалистом.',
  ],
] as const;

interface CountryFitPageProps {
  readonly onNavigate: (path: string) => void;
  readonly signedIn?: boolean;
  readonly isAdmin?: boolean;
}
function payrollSources(country: CountryCode) {
  const data = getCountryTaxData(country);
  return [
    ...new Map(
      [data.incomeTax.source, ...data.employeeContributions.map((item) => item.source)].map(
        (source) => [source.url, source],
      ),
    ).values(),
  ];
}
function useCountryFitModel(onNavigate: (path: string) => void, signedIn: boolean) {
  const [country, setCountry] = useState<CountryCode>('DE');
  const [gross, setGross] = useState('60000');
  const [costs, setCosts] = useState(['', '', '']);
  const [storageError, setStorageError] = useState(false);
  const data = getCountryTaxData(country);
  const result = calculateCountryFitScenario(country, gross, costs);
  const payroll = 'payroll' in result ? result.payroll : undefined;
  const money = (amount: number) =>
    new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: data.currency,
      maximumFractionDigits: 0,
    }).format(amount);
  const sources = payrollSources(country);
  const error = 'error' in result ? result.error : result.costsError;
  function continueToOnboarding() {
    if (signedIn) {
      onNavigate('/app');
      return;
    }
    if (!payroll) return;
    const saved = saveCountryFitScenario({
      countryCode: country,
      grossAnnualIncome: payroll.grossAnnualIncome,
      currency: data.currency,
    });
    setStorageError(!saved);
    if (saved) onNavigate(signedIn ? '/app' : '/signup');
  }

  return {
    signedIn,
    country,
    setCountry,
    gross,
    setGross,
    costs,
    setCosts,
    storageError,
    data,
    result,
    payroll,
    money,
    sources,
    error,
    continueToOnboarding,
  };
}
type CountryFitModel = ReturnType<typeof useCountryFitModel>;
function CountryInputs({ model }: { model: CountryFitModel }) {
  const { country, setCountry, setCosts, data, gross, setGross, result } = model;
  return (
    <div className="cf-inputs">
      <CountryChoice
        value={country}
        name="target-country"
        label="Целевая страна работы"
        onChange={(code) => {
          setCountry(code);
          setCosts(['', '', '']);
        }}
      />
      <MoneyInput
        id="cf-income"
        label={`Годовая зарплата до налогов, ${data.currency}`}
        value={gross}
        onChange={setGross}
        invalid={'error' in result}
      />
      <p className="cf-note">
        Наёмная зарплата. Смена страны очищает расходы. Валюты не конвертируются.
      </p>
    </div>
  );
}

function PayrollResult({ model }: { model: CountryFitModel }) {
  const { payroll, money } = model;
  return (
    <div className="cf-result" aria-live="polite" aria-atomic="true">
      <p>Чистый доход в месяц</p>
      <output className="cf-net">
        {payroll ? money(payroll.netMonthlyIncome) : 'Введите доход'}
      </output>
      {payroll && (
        <dl>
          <div>
            <dt>Налог за год</dt>
            <dd>{money(payroll.incomeTax.amount)}</dd>
          </div>
          <div>
            <dt>Взносы работника за год</dt>
            <dd>{money(payroll.employeeContributions.total)}</dd>
          </div>
          <div>
            <dt>Налог и взносы от дохода</dt>
            <dd>
              {(payroll.grossAnnualIncome > 0
                ? ((payroll.incomeTax.amount + payroll.employeeContributions.total) /
                    payroll.grossAnnualIncome) *
                  100
                : 0
              ).toFixed(1)}
              %
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function ScenarioCosts({ model }: { model: CountryFitModel }) {
  const { data, costs, setCosts, result, money } = model;
  return (
    <section className="cf-section" aria-labelledby="cf-costs">
      <h2 id="cf-costs">Ваши расходы в месяц</h2>
      <p>
        Это ваш бюджет. Рыночных цен аренды и индекса Numbeo здесь нет. Введите все три суммы; если
        расхода нет, укажите 0.
      </p>
      <div className="cf-costs">
        {['Аренда', 'Частная страховка', 'Остальные расходы'].map((label, index) => (
          <MoneyInput
            key={label}
            id={`cf-cost-${index}`}
            label={`${label}, ${data.currency}`}
            value={costs[index]!}
            invalid={Boolean('costsError' in result && result.costsError)}
            onChange={(value) =>
              setCosts((current) => current.map((item, at) => (at === index ? value : item)))
            }
          />
        ))}
      </div>
      <p className="cf-remainder" aria-live="polite">
        Остаток в месяц:{' '}
        <strong>
          {'remainder' in result && result.remainder !== undefined
            ? money(result.remainder)
            : 'укажите расходы'}
        </strong>
      </p>
    </section>
  );
}

function ScenarioNext({ model }: { model: CountryFitModel }) {
  const { continueToOnboarding, payroll, storageError, signedIn } = model;
  return (
    <section className="cf-section cf-next" aria-labelledby="cf-next">
      <div>
        <h2 id="cf-next">
          {signedIn ? 'Продолжить карьерный план' : 'Сохранить сценарий для карьерного плана'}
        </h2>
        <p>
          {signedIn
            ? 'Откройте кабинет, чтобы продолжить карьерный план. Этот расчёт не меняет данные существующего профиля.'
            : 'Страна, валюта и годовой доход перейдут в контекст первого онбординга в этой вкладке. Расходы останутся только в калькуляторе.'}
        </p>
      </div>
      <button
        type="button"
        className="ps-btn is-primary"
        onClick={continueToOnboarding}
        disabled={!payroll}
      >
        {signedIn ? 'Открыть кабинет' : 'Продолжить с этим сценарием'}
      </button>
      {storageError && (
        <p role="alert">
          Браузер запретил сохранение. Разрешите хранилище сайта и повторите переход.
        </p>
      )}
    </section>
  );
}

function ScenarioSources({ model }: { model: CountryFitModel }) {
  const { data, payroll, sources } = model;
  return (
    <section className="cf-section" aria-labelledby="cf-method">
      <h2 id="cf-method">Источники и ограничения расчёта</h2>
      <p>
        Налоговый год: {data.taxYear}. Источники получены: {data.incomeTax.source.retrievedAt}. Это
        дата набора данных, а не проверка изменений на сегодняшний день.
      </p>
      <ul>
        {payroll?.assumptions.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
      <p>
        Оценка не заменяет индивидуальную налоговую консультацию. Статус резидентства и специальные
        режимы здесь не определяются.
      </p>
      <ul>
        {sources.map((source) => (
          <li key={source.url}>
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.title}
            </a>{' '}
            ({source.dataYear}; получено {source.retrievedAt})
          </li>
        ))}
      </ul>
    </section>
  );
}

function ScenarioFaq() {
  return (
    <section
      className="cf-section"
      aria-labelledby="cf-faq"
      itemScope
      itemType="https://schema.org/FAQPage"
    >
      <h2 id="cf-faq">Вопросы о расчёте</h2>
      {COUNTRY_FIT_FAQ.map(([question, answer]) => (
        <details
          className="cf-faq"
          key={question}
          itemScope
          itemProp="mainEntity"
          itemType="https://schema.org/Question"
        >
          <summary itemProp="name">{question}</summary>
          <div itemScope itemProp="acceptedAnswer" itemType="https://schema.org/Answer">
            <p itemProp="text">{answer}</p>
          </div>
        </details>
      ))}
    </section>
  );
}

function ScenarioHeading() {
  return (
    <header className="cf-heading">
      <p className="ps-label">Country Fit · 2026</p>
      <h1>Зарплата после налогов</h1>
      <p>Чистый доход в шести странах. Без регистрации.</p>
    </header>
  );
}
function CountryFitCrumbs() {
  return (
    <nav className="ps-crumbs" aria-label="Навигационная цепочка">
      <a href="/">openqareer</a> / <span aria-current="page">Country Fit</span>
    </nav>
  );
}
function CountryFitHeader(props: CountryFitPageProps) {
  return (
    <PublicHeader
      onNavigate={props.onNavigate}
      onLanding={false}
      signedIn={Boolean(props.signedIn)}
      isAdmin={props.isAdmin}
    />
  );
}
export function CountryFitPage({
  onNavigate,
  signedIn = false,
  isAdmin = false,
}: CountryFitPageProps) {
  const model = useCountryFitModel(onNavigate, signedIn);
  React.useEffect(() => {
    document.title = COUNTRY_FIT_TITLE;
  }, []);
  return (
    <div className="ps cf-public">
      <a className="ps-skip" href="#main">
        К содержимому
      </a>
      <CountryFitHeader onNavigate={onNavigate} signedIn={signedIn} isAdmin={isAdmin} />
      <main id="main" className="ps-wrap ps-page cf-page ym-hide-content">
        <CountryFitCrumbs />
        <ScenarioHeading />
        <section className="cf-calculator" aria-label="Калькулятор зарплаты">
          <CountryInputs model={model} />
          <PayrollResult model={model} />
        </section>
        {model.error && (
          <p id="cf-error" role="alert">
            {model.error}
          </p>
        )}
        <CountryFitDonut payroll={model.payroll} />
        <CountryFitCurrent />
        <CountryFitModes />
        <ScenarioCosts model={model} />
        <ScenarioNext model={model} />
        <ScenarioSources model={model} />
        <ScenarioFaq />
        <a className="ps-btn is-ghost" href="/vacancies">
          Посмотреть открытый каталог вакансий
        </a>
      </main>
      <PublicFooter onNavigate={onNavigate} onLanding={false} signedIn={signedIn} />
      <CountryFitSticky
        payroll={model.payroll}
        currency={model.data.currency}
        signedIn={signedIn}
        onContinue={model.continueToOnboarding}
        storageError={model.storageError}
      />
    </div>
  );
}
