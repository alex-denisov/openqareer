import React from 'react';
import {
  SALARY_BASIS_TEXT,
  vacancies,
  type SalaryCityView,
  type SalaryCountryView,
  type SalaryFaq,
  type SalaryProfessionView,
} from '../../../shared/salaryPublicPages';

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
function Faq({ title, faqs }: { readonly title: string; readonly faqs: readonly SalaryFaq[] }) {
  return (
    <section className="sp-s" aria-labelledby="sp-faq">
      <span className="sp-label">Вопросы</span>
      <h2 id="sp-faq">{title}</h2>
      <div className="sp-faq">
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

function CityTable({ view }: { readonly view: SalaryProfessionView }) {
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
          <CityRows view={view} />
        </tbody>
      </table>
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

function CityRows({ view }: { readonly view: SalaryProfessionView }) {
  return (
    <>
      {view.cities.map((city) => (
        <tr key={city.placeSlug}>
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
            Удалённые вакансии в другой валюте: медиана {view.remote.median}, выборка —{' '}
            {vacancies(view.remote.sampleSize)} с вилкой
          </span>
          <a className="sp-link" href="/vacancies/remote">
            Удалённые вакансии <Arrow />
          </a>
        </div>
      ) : null}
      <div className="sp-card-f sp-small">
        {view.scaleMax ? `Шкала полос — от 0 до ${view.scaleMax} в месяц. ` : ''}
        Город без 30 вакансий с вилкой не показываем.
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
        <p className="sp-answer">
          <b>Коротко:</b> {view.answer}
        </p>
        <div className="sp-kpi">
          <div>
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
            <b>{view.lead.vacancyCount.toLocaleString('ru-RU')}</b>
            <small>из {vacancies(view.totalVacancies)} за 90 дней</small>
          </div>
        </div>
        <div className="sp-stamp">
          <span>
            Выборка: {vacancies(view.sampleSize)} с вилкой в {view.placesShown} местах из{' '}
            {view.totalVacancies.toLocaleString('ru-RU')} за 90 дней
          </span>
          <span>Источник: открытый каталог openqareer</span>
          <span>Дата: {view.date}</span>
        </div>
      </section>
    </>
  );
}

function ProfessionNext({ view }: { readonly view: SalaryProfessionView }) {
  return (
    <>
      <section className="sp-strip">
        <div>
          <h3>Узнайте, сколько стоите именно вы</h3>
          <p>Загрузите резюме: покажем вакансии от нужной вам суммы и процент совпадения.</p>
        </div>
        <a className="sp-btn sp-primary" href={`/signup?from=salaries&role=${view.role}`}>
          Найти вакансии от {view.lead.median}
        </a>
      </section>
    </>
  );
}

function ProfessionLinks({ view }: { readonly view: SalaryProfessionView }) {
  return (
    <>
      <section className="sp-s" aria-labelledby="sp-next">
        <h2 id="sp-next" className="sp-h3">
          Что дальше
        </h2>
        <div className="sp-links">
          {view.cities
            .filter((city) => city.bar)
            .slice(0, 2)
            .map((city) => (
              <a key={city.placeSlug} className="sp-link" href={`/vacancies/${city.placeSlug}`}>
                Вакансии: {city.city} <Arrow />
              </a>
            ))}
          <a className="sp-link" href="/tools/country-fit">
            В какую страну переехать <Arrow />
          </a>
        </div>
      </section>
    </>
  );
}

function ProfessionMethod() {
  return (
    <>
      <section className="sp-s" aria-labelledby="sp-how">
        <span className="sp-label">Как мы считаем</span>
        <h2 id="sp-how">Откуда эти цифры</h2>
        <div className="sp-how">
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
              Пересчитываем каждый день. Если в городе меньше 30 вакансий с вилкой, город не
              показываем.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

function CountryHero({ view }: { readonly view: SalaryCountryView }) {
  return (
    <>
      <section className="sp-hero">
        <span className="sp-eyebrow">Зарплаты по странам · ставки {view.taxYear} года</span>
        <h1>Зарплата {view.inName}: сколько остаётся на руки</h1>
        <p className="sp-answer">
          <b>Коротко:</b> {view.answer}
        </p>
        <div className="sp-stamp">
          <span>{view.assumptions}</span>
          <span>Ставки {view.taxYear} года</span>
        </div>
      </section>
    </>
  );
}

function CountryActions({ view }: { readonly view: SalaryCountryView }) {
  return (
    <aside className="sp-act">
      <b>Что дальше</b>
      <a
        className="sp-btn sp-primary"
        href={`/signup?from=salaries&country=${view.code}&next=match`}
      >
        Какие вакансии {view.inName} подходят вам
      </a>
      <a className="sp-link" href={`/tools/country-fit?country=${view.code}`}>
        Подходит ли вам переезд <Arrow />
      </a>
      <a className="sp-link" href="/salaries">
        Зарплаты по профессиям <Arrow />
      </a>
    </aside>
  );
}

function CountryNet({ view }: { readonly view: SalaryCountryView }) {
  return (
    <>
      <section className="sp-s sp-gh">
        <div>
          <h2 className="sp-h3">До налогов → на руки, в месяц</h2>
          <div className="sp-card">
            <table className="sp-table">
              <thead>
                <tr>
                  <th>До налогов</th>
                  <th className="n">Налоги и взносы</th>
                  <th className="n">На руки</th>
                  <th className="n">Остаётся</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => (
                  <tr key={row.gross} className={row.note ? 'sp-me' : undefined}>
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
              </tbody>
            </table>
            <div className="sp-card-f sp-small">
              Расчёт openqareer по ставкам {view.taxYear} года. Не заменяет консультацию налогового
              консультанта.
            </div>
          </div>
        </div>
        <CountryActions view={view} />
      </section>
    </>
  );
}

function CountryThresholds({ view }: { readonly view: SalaryCountryView }) {
  return (
    <>
      {view.thresholds.length ? (
        <section className="sp-s" aria-labelledby="sp-thr">
          <span className="sp-label">Переезд</span>
          <h2 id="sp-thr">Какая зарплата нужна, чтобы переехать {view.inName} по работе</h2>
          <div className="sp-thr">
            {view.thresholds.map((item) => (
              <div key={item.label + item.amount}>
                <span>{item.label}</span>
                <b>{item.amount}</b>
                <p>{item.explanation}</p>
                <a className="sp-link" href={item.source.url} rel="noopener">
                  {new URL(item.source.url).hostname.replace(/^www\./u, '')}
                </a>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function CountryOthers({ view }: { readonly view: SalaryCountryView }) {
  return (
    <>
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
        </div>
      </section>
    </>
  );
}

export function SalaryProfessionPage({ view }: { readonly view: SalaryProfessionView }) {
  return (
    <main className="sp" id="main">
      <Crumbs current={view.label} />
      <ProfessionHero view={view} />
      <section className="sp-s" aria-labelledby="sp-cities">
        <span className="sp-label">По городам</span>
        <h2 id="sp-cities">Где платят больше</h2>
        <p className="sp-lead">
          Полоса — вилка, в которую попадает половина вакансий города. Отметка — медиана. Считаем по
          серединам вилок «от — до» в вакансиях с обеими границами, {SALARY_BASIS_TEXT[view.basis]}.
        </p>
        <CityTable view={view} />
      </section>
      <ProfessionNext view={view} />
      <ProfessionLinks view={view} />
      <ProfessionMethod />
      <Faq title={`О зарплате ${view.labelGenitive}`} faqs={view.faqs} />
    </main>
  );
}

export function SalaryCountryPage({ view }: { readonly view: SalaryCountryView }) {
  return (
    <main className="sp" id="main">
      <Crumbs current={view.name} />
      <CountryHero view={view} />
      <CountryNet view={view} />
      <CountryThresholds view={view} />
      <Faq title={`Частые вопросы о зарплате ${view.inName}`} faqs={view.faqs} />
      <CountryOthers view={view} />
    </main>
  );
}
