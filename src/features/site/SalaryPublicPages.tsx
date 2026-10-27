import React from 'react';
import {
  SALARY_BASIS_TEXT,
  groupDigits,
  vacancies,
  type NetRow,
  type SalaryCityView,
  type SalaryCountryView,
  type SalaryFaq,
  type SalaryProfessionView,
} from '../../../shared/salaryPublicPages';
import { MIN_CITY_SALARY_SAMPLE } from '../../../shared/salaryMarketSnapshot';

/** B351 round 5 (27.10): mockups 06a and 06b; every figure arrives in the view model. */
function Arrow() {
  return (
    <svg className="sp-ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
function Crumbs({ current }: { readonly current: string }) {
  return (
    <nav className="sp-crumbs" aria-label="Хлебные крошки">
      <a href="/">Главная</a>
      <span aria-hidden="true">/</span>
      <a href="/salaries">Зарплаты</a>
      <span aria-hidden="true">/</span>
      <span>{current}</span>
    </nav>
  );
}
function Faq({
  title,
  faqs,
  aside,
  columns,
}: {
  readonly title: string;
  readonly faqs: readonly SalaryFaq[];
  readonly aside?: React.ReactNode;
  readonly columns?: boolean;
}) {
  return (
    <section className="sp-s" aria-labelledby="sp-faq">
      <div className="sp-sh">
        <div>
          <span className="sp-label">Вопросы</span>
          <h2 id="sp-faq">{title}</h2>
        </div>
        {aside ? <p>{aside}</p> : null}
      </div>
      <div className={columns ? 'sp-faq sp-faq-2' : 'sp-faq'}>
        {faqs.map((faq, index) => (
          <details key={faq.question} open={index === 0}>
            <summary>{faq.question}</summary>
            <p>{faq.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

const CITY_FOLD = 3;
const CITY_FOLD_MOBILE = 2;

function CityTable({ view }: { readonly view: SalaryProfessionView }) {
  const rest = view.cities.slice(CITY_FOLD_MOBILE);
  return (
    <div className="sp-card">
      <table className="sp-table">
        <thead>
          <tr>
            <th>Город</th>
            <th className="n">Медиана</th>
            <th className="n">Половина вакансий</th>
            <th className="sp-bar-h">Распределение</th>
            <th className="n">Выборка</th>
          </tr>
        </thead>
        <tbody>
          <CityRows
            cities={view.cities.slice(0, CITY_FOLD)}
            rowClass={(index) => (index >= CITY_FOLD_MOBILE ? 'sp-wide-only' : undefined)}
          />
        </tbody>
      </table>
      {rest.length ? (
        <details className="sp-fold">
          <summary>Все города</summary>
          <table className="sp-table">
            <tbody>
              <CityRows
                cities={rest}
                rowClass={(index) =>
                  index + CITY_FOLD_MOBILE < CITY_FOLD ? 'sp-narrow-only' : undefined
                }
              />
            </tbody>
          </table>
        </details>
      ) : null}
      <CityTableFooter view={view} />
    </div>
  );
}

function SalaryBar({ bar }: { readonly bar: NonNullable<SalaryCityView['bar']> }) {
  return (
    <svg className="sp-bar" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
      <rect className="sp-bar-track" x="0" y="3" width="100" height="4" rx="2" />
      <rect
        className="sp-bar-range"
        x={bar.left}
        y="3"
        width={100 - bar.left - bar.right}
        height="4"
        rx="2"
      />
      <rect className="sp-bar-mark" x={bar.mark - 0.6} y="0" width="1.2" height="10" />
    </svg>
  );
}

function CityRows({
  cities,
  rowClass,
}: {
  readonly cities: readonly SalaryCityView[];
  readonly rowClass?: (index: number) => string | undefined;
}) {
  return (
    <>
      {cities.map((city, index) => (
        <tr key={city.placeSlug} className={rowClass?.(index)}>
          <td>
            {city.city}
            <span className="sp-sub">{vacancies(city.vacancyCount)}</span>
          </td>
          <td className="n" data-l="Медиана">
            {city.median}
          </td>
          <td className="n" data-l="Половина вакансий">
            {city.range}
          </td>
          <td className="sp-bar-c">
            {city.bar ? (
              <SalaryBar bar={city.bar} />
            ) : (
              <span className="sp-small">другая валюта</span>
            )}
          </td>
          <td className="n" data-l="Выборка">
            {city.sampleSize}
          </td>
        </tr>
      ))}
    </>
  );
}

function CityTableFooter({ view }: { readonly view: SalaryProfessionView }) {
  return (
    <>
      <div className="sp-card-f">
        <span>Сколько можете получать вы? Загрузите резюме — покажем вашу вилку по вакансиям.</span>
        <a className="sp-btn" href={`/signup?from=salaries&role=${view.role}`}>
          Узнать свою вилку
        </a>
      </div>
      {view.remote ? (
        <div className="sp-card-f">
          <span>
            Удалённые вакансии: медиана {view.remote.median}, по{' '}
            {groupDigits(view.remote.sampleSize)} вакансиям с вилкой
          </span>
          <a className="sp-link" href={`/vacancies/remote/${view.role}`}>
            Удалённые вакансии <Arrow />
          </a>
        </div>
      ) : null}
      <div className="sp-card-f sp-small">
        {view.scaleMax ? `Шкала полос — от 0 до ${view.scaleMax} в месяц. ` : ''}
        Город без {MIN_CITY_SALARY_SAMPLE} вакансий с вилкой не показываем.
      </div>
    </>
  );
}

function ProfessionHero({ view }: { readonly view: SalaryProfessionView }) {
  const basis = SALARY_BASIS_TEXT[view.basis];
  return (
    <>
      <section className="sp-hero">
        <span className="sp-eyebrow">Зарплаты · обновлено {view.date}</span>
        <h1>Зарплата {view.labelGenitive} в 2026 году по городам</h1>
        <p className="sp-answer sp-callout">
          <b>Коротко:</b> {view.answer}
        </p>
        <div className="sp-kpi sp-kpi-joined">
          <div className="sp-kpi-lead">
            <span>Медиана, {view.lead.city}</span>
            <b>{view.lead.median}</b>
            <small>{view.leadNet ? `на руки ${view.leadNet}` : `в месяц, ${basis}`}</small>
          </div>
          <div>
            <span>Половина вакансий</span>
            <b>{view.lead.range}</b>
            <small>половина вакансий платит столько</small>
          </div>
          <div>
            <span>Вакансий, {view.lead.city}</span>
            <b>{groupDigits(view.lead.vacancyCount)}</b>
            <small>из {vacancies(view.totalVacancies)} за 90 дней</small>
          </div>
        </div>
        <div className="sp-stamp">
          <span>
            Выборка: {vacancies(view.sampleSize)} с вилкой в {view.placesShown} местах из{' '}
            {groupDigits(view.totalVacancies)} за 90 дней
          </span>
          <span>Источник: открытый каталог openqareer</span>
          <span>Дата: {view.date}</span>
        </div>
      </section>
    </>
  );
}

function ProfessionCompare({ view }: { readonly view: SalaryProfessionView }) {
  const group = view.leadGroup;
  return (
    <section className="sp-card sp-cmp" aria-labelledby="sp-cmp-h">
      <div>
        <h2 id="sp-cmp-h" className="sp-h3">
          Сравните свою зарплату: {view.lead.city}
        </h2>
        <p className="sp-small">
          {vacancies(group.sampleSize)} {view.labelGenitive} с вилкой,{' '}
          {SALARY_BASIS_TEXT[view.basis]}, открытый каталог на {view.date}. Считается в браузере,
          ничего не сохраняем.
        </p>
      </div>
      <div
        className="sp-cmp-row"
        data-salary-compare=""
        data-p25={group.p25}
        data-p50={group.p50}
        data-p75={group.p75}
        data-currency={group.currency}
      >
        <label htmlFor="sp-my-pay">Ваша зарплата {SALARY_BASIS_TEXT[view.basis]} в месяц</label>
        <input
          className="sp-input"
          id="sp-my-pay"
          inputMode="numeric"
          autoComplete="off"
          placeholder={`например, ${view.lead.median}`}
        />
        <p className="sp-cmp-out" id="sp-my-out" aria-live="polite">
          Введите сумму — покажем, где она в вилках вакансий: {view.lead.city}.
        </p>
      </div>
    </section>
  );
}

function ProfessionNext({ view }: { readonly view: SalaryProfessionView }) {
  return (
    <>
      <section className="sp-band">
        <div>
          <h3>Узнайте, сколько стоите именно вы</h3>
          <p>
            Загрузите резюме: покажем вакансии {view.labelGenitive} от нужной вам суммы и что
            поднимет вас в вилке.
          </p>
        </div>
        <a className="sp-btn sp-primary" href={`/signup?from=salaries&role=${view.role}`}>
          Найти вакансии от {view.lead.median}
        </a>
      </section>
    </>
  );
}

function ProfessionLinks({ view }: { readonly view: SalaryProfessionView }) {
  const lead = view.lead;
  return (
    <section className="sp-s" aria-labelledby="sp-next">
      <h2 id="sp-next" className="sp-h3">
        Что дальше
      </h2>
      <div className="sp-links">
        <a className="sp-link" href={`/vacancies/${lead.placeSlug}/${view.role}`}>
          {vacancies(lead.vacancyCount)} {view.labelGenitive}: {lead.city} <Arrow />
        </a>
        <a className="sp-link" href={`/tools/interview-questions/${view.role}`}>
          Вопросы на собеседовании {view.labelGenitive} <Arrow />
        </a>
        <a className="sp-link" href="/tools/resume">
          Резюме {view.labelGenitive} в конструкторе <Arrow />
        </a>
        <a className="sp-link" href="/#tariffs">
          Какую сумму назвать на собеседовании — подготовка к торгу в Pro <Arrow />
        </a>
      </div>
    </section>
  );
}

function ProfessionMethod() {
  return (
    <>
      <section className="sp-s" aria-labelledby="sp-how">
        <span className="sp-label">Как мы считаем</span>
        <h2 id="sp-how">Откуда эти цифры</h2>
        <div className="sp-how sp-how-plain">
          <div>
            <b>Только вакансии с вилкой</b>
            <p>
              Берём вакансии с обеими границами «от — до» и помесячной оплатой, считаем середину.
            </p>
          </div>
          <div>
            <b>Без перекоса от редких высоких зарплат</b>
            <p>Медиана и процентили устойчивы к единичным выбросам, в отличие от среднего.</p>
          </div>
          <div>
            <b>Дата и выборка у каждой цифры</b>
            <p>
              Пересчитываем каждый день. Если в городе меньше {MIN_CITY_SALARY_SAMPLE} вакансий с
              вилкой, город не показываем.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

function CountryHero({ view }: { readonly view: SalaryCountryView }) {
  return (
    <section className="sp-hero">
      <span className="sp-eyebrow">Зарплаты по странам · ставки {view.taxYear} года</span>
      <h1>Зарплата {view.inName}: сколько остаётся на руки</h1>
      <p className="sp-answer sp-callout">
        <b>Коротко:</b> {view.answer}
      </p>
      <div className="sp-stamp">
        <span>{view.assumptions}</span>
        <span>Ставки {view.taxYear} года</span>
      </div>
    </section>
  );
}

function CountryActions({ view }: { readonly view: SalaryCountryView }) {
  const lead = view.cities[0];
  return (
    <aside className="sp-act">
      <b>Что дальше</b>
      <a
        className="sp-btn sp-primary"
        href={`/signup?from=salaries&country=${view.code}&next=match`}
      >
        {lead
          ? `Какие из ${groupDigits(lead.count)}\u00a0вакансий ${lead.genitive} подходят вам`
          : `Какие вакансии ${view.inName} подходят вам`}
      </a>
      <a className="sp-link" href={lead ? `/vacancies/${lead.slug}` : '/vacancies'}>
        Вакансии {view.inName} <Arrow />
      </a>
      <a className="sp-link" href={`/tools/relocation?country=${view.code}`}>
        Оценить переезд {view.toName} <Arrow />
      </a>
    </aside>
  );
}

const NET_FOLD = 5;
/** Mockup 06b at 390: two rows open, the rest under «Все суммы». */
const NET_FOLD_MOBILE = 2;

function NetRows({
  rows,
  rowClass,
}: {
  readonly rows: readonly NetRow[];
  readonly rowClass?: (index: number) => string | undefined;
}) {
  return (
    <>
      {rows.map((row, index) => (
        <tr
          key={row.gross}
          className={
            [row.note ? 'sp-me' : '', rowClass?.(index) ?? ''].join(' ').trim() || undefined
          }
        >
          <td>
            {row.gross} {row.note ? <span className="sp-chip">{row.note}</span> : null}
          </td>
          <td className="n" data-l="Налоги и взносы">
            {row.deductions}
          </td>
          <td className="n" data-l="На руки">
            <b>{row.net}</b>
          </td>
          <td className="n" data-l="Остаётся">
            {row.share}
          </td>
        </tr>
      ))}
    </>
  );
}

function NetHead() {
  return (
    <thead>
      <tr>
        <th>До налогов</th>
        <th className="n">Налоги и взносы</th>
        <th className="n">На руки</th>
        <th className="n">Остаётся</th>
      </tr>
    </thead>
  );
}

function CountryNet({ view }: { readonly view: SalaryCountryView }) {
  const rest = view.rows.slice(NET_FOLD_MOBILE);
  return (
    <section className="sp-s sp-gh">
      <div>
        <h2 className="sp-h3">До налогов → на руки, в месяц</h2>
        <div className="sp-card">
          <table className="sp-table">
            <NetHead />
            <tbody>
              <NetRows
                rows={view.rows.slice(0, NET_FOLD)}
                rowClass={(index) => (index >= NET_FOLD_MOBILE ? 'sp-wide-only' : undefined)}
              />
            </tbody>
          </table>
          {rest.length ? (
            <details className="sp-fold">
              <summary>Все суммы</summary>
              <table className="sp-table">
                <tbody>
                  <NetRows
                    rows={rest}
                    rowClass={(index) =>
                      index + NET_FOLD_MOBILE < NET_FOLD ? 'sp-narrow-only' : undefined
                    }
                  />
                </tbody>
              </table>
            </details>
          ) : null}
          <div className="sp-card-f sp-small">
            Расчёт openqareer по ставкам {view.taxYear} года. Не заменяет консультацию налогового
            консультанта.
          </div>
        </div>
      </div>
      <CountryActions view={view} />
    </section>
  );
}

function CountryCities({ view }: { readonly view: SalaryCountryView }) {
  if (!view.cities.length) return null;
  return (
    <section className="sp-s sp-narrow" aria-labelledby="sp-where">
      <h2 className="sp-h3" id="sp-where">
        Где искать: города с вакансиями
      </h2>
      <ul className="sp-cities">
        {view.cities.map((city) => (
          <li key={city.slug}>
            <a href={`/vacancies/${city.slug}`}>{city.label}</a>
            <span>{vacancies(city.count)}</span>
          </li>
        ))}
      </ul>
      <p className="sp-small">Города, где меньше 30 вакансий, не показываем.</p>
      <p className="sp-note">
        В вакансиях из каталога зарплата {view.inName} указана редко, поэтому медиану по стране не
        считаем. Ориентируйтесь на таблицу «на руки» и на пороги переезда ниже.
      </p>
      {view.catalogDate ? (
        <p className="sp-small">Открытый каталог openqareer, {view.catalogDate}.</p>
      ) : null}
    </section>
  );
}

function CountryThresholds({ view }: { readonly view: SalaryCountryView }) {
  if (!view.thresholds.length) return null;
  return (
    <section className="sp-s" aria-labelledby="sp-thr">
      <div className="sp-sh">
        <div>
          <span className="sp-label">Переезд</span>
          <h2 id="sp-thr">Какая зарплата нужна, чтобы переехать {view.toName} по работе</h2>
        </div>
        <p>
          Пороги из правил {view.taxYear} года. Подходит ли вам какой-то из путей, зависит от
          диплома, опыта и языка — это покажет оценка переезда.
        </p>
      </div>
      <div className="sp-thr">
        {view.thresholds.map((item) => (
          <div key={item.label + item.amount}>
            <span>{item.label}</span>
            <b>{item.sum}</b>
            <p>
              {item.per}. {item.explanation}
            </p>
            <a className="sp-link" href={item.source.url} rel="noopener">
              {new URL(item.source.url).hostname.replace(/^www\./u, '')}
            </a>
          </div>
        ))}
      </div>
      <div className="sp-band">
        <div>
          <h3>Подходит ли вам один из этих путей?</h3>
          <p>
            6 вопросов: гражданство, язык, семья, профессия. Покажем варианты переезда и сколько
            будет на руки.
          </p>
        </div>
        <a className="sp-btn sp-primary" href={`/tools/relocation?country=${view.code}`}>
          Оценить переезд
        </a>
      </div>
    </section>
  );
}

function CountryOthers({ view }: { readonly view: SalaryCountryView }) {
  return (
    <section className="sp-s" aria-labelledby="sp-other">
      <span className="sp-label">Другие страны</span>
      <h2 id="sp-other">Сколько остаётся на руки в других странах</h2>
      <div className="sp-card">
        <table className="sp-table">
          <thead>
            <tr>
              <th>Страна</th>
              <th className="n">До налогов в месяц</th>
              <th className="n">На руки</th>
              <th className="n">Остаётся</th>
            </tr>
          </thead>
          <tbody>
            {view.others.map((row) => (
              <tr key={row.slug}>
                <td>
                  <a className="sp-link" href={`/salaries/${row.slug}`}>
                    {row.name}
                  </a>
                </td>
                <td className="n" data-l="До налогов">
                  {row.gross}
                </td>
                <td className="n" data-l="На руки">
                  {row.net}
                </td>
                <td className="n" data-l="Остаётся">
                  {row.share}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="sp-card-f sp-small">
          Наёмный работник, ставки {view.taxYear} года, допущения по каждой стране — в калькуляторе.
        </div>
      </div>
    </section>
  );
}

export function SalaryProfessionPage({ view }: { readonly view: SalaryProfessionView }) {
  return (
    <main className="sp" id="main">
      <Crumbs current={view.label} />
      <ProfessionHero view={view} />
      <section className="sp-s" aria-labelledby="sp-cities">
        <div className="sp-sh">
          <div>
            <span className="sp-label">По городам</span>
            <h2 id="sp-cities">Где {view.labelDative} платят больше</h2>
          </div>
          <p className="sp-hide-m">
            Полоса — вилка, в которую попадает половина вакансий города. Отметка — медиана. Считаем
            по серединам вилок «от — до» в вакансиях с обеими границами,{' '}
            {SALARY_BASIS_TEXT[view.basis]}.
          </p>
        </div>
        <CityTable view={view} />
      </section>
      <ProfessionCompare view={view} />
      <ProfessionNext view={view} />
      <ProfessionLinks view={view} />
      <ProfessionMethod />
      <Faq
        title={`О зарплате ${view.labelGenitive}`}
        faqs={view.faqs}
        columns
        aside={
          <a className="sp-link" href={`/tools/interview-questions/${view.role}`}>
            Вопросы на собеседовании {view.labelGenitive} <Arrow />
          </a>
        }
      />
    </main>
  );
}

export function SalaryCountryPage({ view }: { readonly view: SalaryCountryView }) {
  return (
    <main className="sp" id="main">
      <Crumbs current={view.name} />
      <CountryHero view={view} />
      <CountryNet view={view} />
      <CountryCities view={view} />
      <CountryThresholds view={view} />
      <Faq title={`Частые вопросы о зарплате ${view.inName}`} faqs={view.faqs} />
      <CountryOthers view={view} />
    </main>
  );
}
