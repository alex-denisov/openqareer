import React from 'react';
import {
  MIN_REPORT_SAMPLE,
  marketReportPath,
  marketReportTitle,
  monthPhrase,
  monthRange,
  type MarketReport,
} from '../../../shared/marketReport';

/** GEO 09.11: monthly market report on the guide template; every number carries sample and date. */

const PERIOD: Readonly<Record<string, string>> = {
  hour: 'в час',
  month: 'в месяц',
  year: 'в год',
};

function num(value: number): string {
  return value.toLocaleString('ru-RU').replace(/\u00a0/gu, ' ');
}

function date(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

function percent(part: number, whole: number): string {
  const value = (part / whole) * 100;
  // Small shares keep one decimal: «0 %» next to 439 vacancies reads as an error.
  const text = value < 10 ? value.toFixed(1).replace('.', ',') : String(Math.round(value));
  return `${text} %`;
}

function SourceLine({ report, sample }: { report: MarketReport; sample: number }) {
  const range = monthRange(report.month);
  return (
    <p className="oq-guide-source-meta">
      Источник: каталог вакансий openqareer, вакансии, впервые опубликованные с {date(range.start)}{' '}
      по {date(range.end)}; выборка {num(sample)}; расчёт {date(report.generatedAt)}.
    </p>
  );
}

function Salaries({ report }: { report: MarketReport }) {
  return (
    <section className="oq-guide-section" id="salaries" aria-labelledby="h-salaries">
      <h2 id="h-salaries">Медианы зарплатных вилок</h2>
      {report.salaryGroups.length === 0 ? (
        <p>
          Ни в одной валюте и периоде оплаты не набралось {MIN_REPORT_SAMPLE} вилок с явным периодом
          — медиану не публикуем.
        </p>
      ) : (
        <table className="sp-table">
          <thead>
            <tr>
              <th scope="col">Валюта и период</th>
              <th scope="col">Медиана «от»</th>
              <th scope="col">Медиана «до»</th>
              <th scope="col">Вилок</th>
            </tr>
          </thead>
          <tbody>
            {report.salaryGroups.map((group) => (
              <tr key={`${group.currency}-${group.period}`}>
                <td>
                  {group.currency}, {PERIOD[group.period]}
                </td>
                <td data-l="Медиана «от»">{num(group.medianLow)}</td>
                <td data-l="Медиана «до»">{num(group.medianHigh)}</td>
                <td data-l="Вилок">{num(group.sample)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <SourceLine report={report} sample={report.withPeriodisedRange} />
    </section>
  );
}

function Roles({ report }: { report: MarketReport }) {
  if (report.topRoles.length === 0) return null;
  return (
    <section className="oq-guide-section" id="roles" aria-labelledby="h-roles">
      <h2 id="h-roles">Роли с наибольшим числом вакансий</h2>
      <table className="sp-table">
        <thead>
          <tr>
            <th scope="col">Роль</th>
            <th scope="col">Вакансий</th>
            <th scope="col">Доля месяца</th>
          </tr>
        </thead>
        <tbody>
          {report.topRoles.map((role) => (
            <tr key={role.slug}>
              <td>{role.label}</td>
              <td data-l="Вакансий">{num(role.count)}</td>
              <td data-l="Доля месяца">{percent(role.count, report.vacancies)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <SourceLine report={report} sample={report.vacancies} />
    </section>
  );
}

function Method({ report }: { report: MarketReport }) {
  return (
    <section className="oq-guide-section" id="method" aria-labelledby="h-method">
      <h2 id="h-method">Как считали</h2>
      <ul>
        <li>
          Вакансия — карточка каталога после сведения повторов: одна позиция с нескольких площадок
          считается один раз. За ними стоит {num(report.sourceRecords)} записей источников.
        </li>
        <li>Месяц вакансии — дата её первой публикации в источнике.</li>
        <li>
          В медиану входят только вилки «от — до», у которых источник явно указал период оплаты
          (час, месяц, год). Валюты и периоды считаются отдельно и не пересчитываются друг в друга.
        </li>
        <li>
          Цифра из выборки меньше {MIN_REPORT_SAMPLE} не публикуется
          {report.hiddenSalaryGroups > 0
            ? `; так скрыто групп валюты и периода: ${report.hiddenSalaryGroups}`
            : ''}
          .
        </li>
        <li>
          Каталог собирает ATS-доски компаний и открытые ленты; это не весь рынок и не выборка,
          взвешенная по странам.
        </li>
      </ul>
    </section>
  );
}

export function MarketReportPage({ report }: { readonly report: MarketReport }) {
  return (
    <main id="main" tabIndex={-1} className="ps-wrap ps-page oq-guide">
      <header className="oq-guide-hero">
        <p className="oq-guide-eyebrow">Отчёт о рынке</p>
        <h1>{marketReportTitle(report.month)}</h1>
        <p className="oq-guide-lead">
          {monthPhrase(report.month).replace(/^в/u, 'В')} в каталоге openqareer появилось{' '}
          {num(report.vacancies)} вакансий
          {report.remote !== undefined
            ? `, удалённых среди них — ${percent(report.remote, report.vacancies)}`
            : ''}
          . Вилку с явным периодом оплаты указали {num(report.withPeriodisedRange)}.
        </p>
        <SourceLine report={report} sample={report.vacancies} />
      </header>
      <article className="oq-guide-article">
        <Salaries report={report} />
        <Roles report={report} />
        <Method report={report} />
      </article>
    </main>
  );
}

export function MarketReportsHub({ reports }: { readonly reports: readonly MarketReport[] }) {
  return (
    <main id="main" tabIndex={-1} className="ps-wrap ps-page oq-guide">
      <header className="oq-guide-hero">
        <p className="oq-guide-eyebrow">Отчёты о рынке</p>
        <h1>Рынок вакансий по месяцам</h1>
        <p className="oq-guide-lead">
          Каждый месяц: число вакансий каталога, медианы зарплатных вилок с периодом оплаты, доля
          удалённых и роли с наибольшим спросом.
        </p>
      </header>
      <ul className="oq-guide-related-list">
        {reports.map((report) => (
          <li key={report.month}>
            <a href={marketReportPath(report.month)}>
              <b>{marketReportTitle(report.month)}</b>
              <small>
                Вакансий: {num(report.vacancies)}; расчёт {date(report.generatedAt)}
              </small>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
