import {
  calculateParetoFrontier,
  visibleFact,
  type CountryComparisonCountry,
  type ComparisonEvidence,
  type CountryComparisonFact,
} from '../../../shared/countryFit/countryComparison';
import type { ReactNode } from 'react';
import { Clock, Info } from '@phosphor-icons/react';
import { COUNTRY_FIT_DISCLAIMER } from '../../../shared/countryFit';
import './CountryComparisonPanel.css';
import { relocationDay } from './relocationDates';

type FactKey = keyof CountryComparisonCountry['facts'];
type PanelState = 'ready' | 'loading' | 'empty' | 'error';

/** Rows and their order as in mockup 15 `cmp`. */
const CRITERIA: readonly { readonly key: FactKey; readonly label: string }[] = [
  { key: 'access', label: 'Тип доступа' },
  { key: 'processingTime', label: 'Срок оформления' },
  { key: 'relocationVacancies', label: 'Вакансий с релокацией' },
  { key: 'salaryThreshold', label: 'Порог зарплаты для доступа' },
  { key: 'incomeTax', label: 'Налог на доход' },
  { key: 'monthlyRemainder', label: 'Свободный остаток в месяц' },
  { key: 'workingLanguage', label: 'Язык работы' },
  { key: 'familyAndResidence', label: 'Семья и ПМЖ' },
];

/**
 * The comparison shows all eight rows of mockup 15 `cmp`. A cell without a
 * sourced value says why in plain words (owner rule: no «нет данных» stub).
 */
function shownCriteria(countries: readonly CountryComparisonCountry[]) {
  if (countries.length > 1) return CRITERIA;
  // One country's own facts (its card) keep only the rows that have a source.
  return CRITERIA.filter(({ key }) =>
    countries.some(
      (country) =>
        visibleFact(country.facts[key] as CountryComparisonFact<unknown>, key).status !== 'no_data',
    ),
  );
}

const MISSING_BY_METRIC: Readonly<Partial<Record<FactKey, string>>> = {
  processingTime: 'в правилах не указан',
  relocationVacancies: 'подборка ещё не прочитана',
  salaryThreshold: 'в правилах не указан',
  incomeTax: 'нет налоговой шкалы',
  monthlyRemainder: 'см. «Экономика»',
  workingLanguage: 'в правилах не указан',
  familyAndResidence: 'в анкете не указано',
};

export interface ComparisonMeaning {
  readonly countryCode: string;
  readonly name: string;
  readonly text: string;
}

export interface CountryComparisonPanelProps {
  readonly countries?: readonly CountryComparisonCountry[];
  readonly state?: PanelState;
  readonly errorMessage?: string;
  readonly onRetry?: () => void;
  readonly title?: string;
  readonly showParetoSummary?: boolean;
  readonly meanings?: readonly ComparisonMeaning[];
  readonly titleAction?: ReactNode;
}

export function CountryComparisonPanel({
  countries = [],
  state = 'ready',
  errorMessage = 'Не удалось загрузить сравнение стран.',
  onRetry,
  title = 'Сравнение стран',
  showParetoSummary = true,
  meanings = [],
  titleAction,
}: CountryComparisonPanelProps) {
  if (state === 'loading')
    return <PanelStateMessage busy>Загружаем проверенные данные по странам…</PanelStateMessage>;
  if (state === 'error') return <ErrorState message={errorMessage} onRetry={onRetry} />;
  if (state === 'empty' || countries.length === 0)
    return <PanelStateMessage>Выберите страны для сравнения.</PanelStateMessage>;
  if (countries.length > 3)
    return <PanelStateMessage>Для читаемого сравнения выберите до трёх стран.</PanelStateMessage>;
  return (
    <ReadyComparison
      countries={countries}
      title={title}
      showParetoSummary={showParetoSummary}
      meanings={meanings}
      titleAction={titleAction}
    />
  );
}

function PanelStateMessage({
  busy,
  children,
}: {
  readonly busy?: boolean;
  readonly children: string;
}) {
  return (
    <div className="career-country-comparison-state" aria-busy={busy}>
      {children}
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry?: () => void;
}) {
  return (
    <div className="career-country-comparison-state" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="career-country-comparison-retry" onClick={onRetry}>
          Повторить загрузку
        </button>
      )}
    </div>
  );
}

function ReadyComparison({
  countries,
  title,
  showParetoSummary,
  meanings,
  titleAction,
}: {
  readonly countries: readonly CountryComparisonCountry[];
  readonly title: string;
  readonly showParetoSummary: boolean;
  readonly meanings: readonly ComparisonMeaning[];
  readonly titleAction?: ReactNode;
}) {
  const pareto = calculateParetoFrontier(countries);
  return (
    <section
      className="career-country-comparison"
      aria-labelledby="career-country-comparison-title"
    >
      <div className="career-country-comparison-head">
        <h3 id="career-country-comparison-title" className="career-country-comparison-title">
          {title}
        </h3>
        {titleAction}
      </div>
      <DesktopMatrix countries={countries} />
      <div className="career-country-comparison-desktop-sources">
        <SourcesLine countries={countries} />
      </div>
      <MobileStack countries={countries} />
      {showParetoSummary ? <ParetoSummary countries={countries} result={pareto} /> : null}
      <ComparisonMeanings meanings={meanings} />
    </section>
  );
}

function DesktopMatrix({ countries }: { readonly countries: readonly CountryComparisonCountry[] }) {
  return (
    <div className="career-country-comparison-desktop">
      <table className="career-country-comparison-table">
        <caption className="career-sr-only">
          Сопоставимые показатели по выбранным странам. Каждое значение сопровождается источником
          или причиной отсутствия данных.
        </caption>
        <thead>
          <tr>
            <th scope="col">Параметр</th>
            {countries.map((country) => (
              <th scope="col" key={country.countryCode}>
                {country.countryName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shownCriteria(countries).map((criterion) => (
            <tr key={criterion.key}>
              <th scope="row">{criterion.label}</th>
              {countries.map((country) => (
                <td key={country.countryCode}>
                  <FactContent fact={country.facts[criterion.key]} metric={criterion.key} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Mockup 15 `vt=cmp` at 390: grouped rows «country — value», sources in one footnote. */
function MobileStack({ countries }: { readonly countries: readonly CountryComparisonCountry[] }) {
  const sources = comparisonSources(countries);
  return (
    <div className="career-country-comparison-mobile">
      {shownCriteria(countries)
        .filter(({ key }) => key !== 'monthlyRemainder')
        .map((criterion) => (
          <section className="career-country-comparison-mobile-criterion" key={criterion.key}>
            <h3>{criterion.label}</h3>
            <dl>
              {countries.map((country) => {
                const visible = visibleFact(
                  country.facts[criterion.key] as CountryComparisonFact<unknown>,
                  criterion.key,
                );
                return (
                  <div className="career-country-comparison-mobile-entry" key={country.countryCode}>
                    <dt>{country.countryName}</dt>
                    <dd title={visible.status === 'available' ? undefined : visible.reason}>
                      {visible.status === 'available'
                        ? formatFact(criterion.key, visible.value)
                        : missingCellLabel(criterion.key, visible.reason)}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        ))}
      <p className="career-country-comparison-mobile-foot">
        Баллов и общего места нет: вес параметров вы определяете сами.
        {sources
          ? ` Источники: ${sources}.`
          : ' Проверенных источников по этим показателям пока нет.'}
      </p>
    </div>
  );
}

/**
 * One line under the matrix, as in mockup 15 `cmp` («Источники: официальные
 * порталы стран, каталог вакансий, 07.10»); the dated documents open under it.
 */
function SourcesLine({ countries }: { readonly countries: readonly CountryComparisonCountry[] }) {
  const sources = uniqueSources(countries);
  if (!sources.length)
    return (
      <p className="career-country-comparison-sources-line">
        <Clock aria-hidden="true" size={14} />
        <span>Проверенных источников по этим показателям пока нет.</span>
      </p>
    );
  return (
    <details className="career-country-comparison-sources-line">
      <summary>
        <Clock aria-hidden="true" size={14} />
        <span>{sourcesSummary(sources)}</span>
      </summary>
      <ul>
        {sources.map((source) => (
          <li key={source.title}>
            {source.url ? (
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.title}
              </a>
            ) : (
              source.title
            )}
            {source.dataYear ? `, год шкалы ${source.dataYear}` : ''},{' '}
            {relocationDay(source.capturedAt)}
          </li>
        ))}
      </ul>
    </details>
  );
}

const SOURCE_KIND_LABELS: Readonly<Record<string, string>> = {
  official: 'официальные порталы стран',
  vacancy_catalog: 'подборка вакансий',
  candidate_profile: 'ваша анкета',
  calculation: 'расчёт по шкале',
};

export function sourcesSummary(sources: readonly ComparisonEvidence[]): string {
  const kinds = [...new Set(sources.map(({ kind }) => SOURCE_KIND_LABELS[kind] ?? 'документы'))];
  const latest =
    sources
      .map(({ capturedAt }) => capturedAt)
      .sort()
      .at(-1) ?? '';
  return `Источники: ${kinds.join(', ')}, ${relocationDay(latest)}`;
}

function uniqueSources(countries: readonly CountryComparisonCountry[]) {
  const seen = new Map<string, ComparisonEvidence>();
  for (const country of countries) {
    for (const criterion of CRITERIA) {
      const visible = visibleFact(
        country.facts[criterion.key] as CountryComparisonFact<unknown>,
        criterion.key,
      );
      if (visible.status !== 'available') continue;
      for (const source of visible.sources)
        if (!seen.has(source.title)) seen.set(source.title, source);
    }
  }
  return [...seen.values()];
}

function comparisonSources(countries: readonly CountryComparisonCountry[]): string {
  const seen = new Map<string, string>();
  for (const country of countries) {
    for (const criterion of CRITERIA) {
      const visible = visibleFact(
        country.facts[criterion.key] as CountryComparisonFact<unknown>,
        criterion.key,
      );
      if (visible.status !== 'available') continue;
      for (const source of visible.sources) {
        if (!seen.has(source.title))
          seen.set(source.title, `${source.title}, ${relocationDay(source.capturedAt)}`);
      }
    }
  }
  return [...seen.values()].join('; ');
}

/** Mockup 15 `cmp` 1440: a short value per cell; the reason stays a hint, sources go under the table. */
function FactContent({
  fact,
  metric,
}: {
  readonly fact: CountryComparisonFact<unknown>;
  readonly metric: FactKey;
}) {
  const visible = visibleFact(fact, metric);
  if (visible.status !== 'available') {
    return (
      <span className="career-country-comparison-no-data" title={visible.reason}>
        {visible.status === 'unknown'
          ? 'статус неизвестен'
          : missingCellLabel(metric, visible.reason)}
      </span>
    );
  }
  return (
    <span className="career-country-comparison-value">{formatFact(metric, visible.value)}</span>
  );
}

function formatFact(metric: FactKey, fact: unknown): string {
  const value = fact as Record<string, unknown>;
  if (metric === 'access') return String(value.label);
  if (metric === 'processingTime')
    return `${value.amount} ${value.unit === 'days' ? 'дн.' : 'нед.'}`;
  if (metric === 'relocationVacancies') return String(value.count);
  if (metric === 'salaryThreshold')
    return `${formatAmount(Number(value.amount))} ${value.currency} · ${value.basis}`;
  if (metric === 'incomeTax')
    return typeof value.label === 'string'
      ? value.label
      : `${formatAmount(Number(value.effectiveRate))}% · ${value.basis}`;
  if (metric === 'netIncome' || metric === 'monthlyRemainder')
    return `${formatAmount(Number(value.amount))} ${value.currency}/мес. · ${value.basis}`;
  return String(value.summary);
}

function formatAmount(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
}

function ParetoSummary({
  countries,
  result,
}: {
  readonly countries: readonly CountryComparisonCountry[];
  readonly result: ReturnType<typeof calculateParetoFrontier>;
}) {
  const frontierNames = result.frontierCountryCodes
    .map((code) => countries.find((country) => country.countryCode === code)?.countryName)
    .filter((name): name is string => Boolean(name));
  return (
    <aside className="career-country-comparison-pareto" aria-live="polite">
      <h3>Граница Парето</h3>
      {result.status === 'ready' ? (
        <p>
          {frontierNames.join(', ')}. Страна остаётся на границе, если нет другой страны не хуже по
          всем общим показателям и лучше хотя бы по одному.
        </p>
      ) : (
        <p>Граница Парето пока не рассчитывается. {result.reason}</p>
      )}
    </aside>
  );
}

/** «Что это значит» of mockup 15 `cmp`: one line per country from its own status and reason. */
function ComparisonMeanings({ meanings }: { readonly meanings: readonly ComparisonMeaning[] }) {
  if (!meanings.length) return null;
  return (
    <section
      className="career-country-comparison-meanings"
      aria-labelledby="career-country-meanings-title"
    >
      <h3 id="career-country-meanings-title">Что это значит</h3>
      <ul>
        {meanings.map((meaning) => (
          <li key={meaning.countryCode}>
            <Info className="career-country-comparison-meaning-icon" aria-hidden="true" size={18} />
            <strong>{meaning.name}</strong>
            <p>{meaning.text}</p>
          </li>
        ))}
      </ul>
      <p className="career-country-comparison-disclaimer">
        <Info aria-hidden="true" size={18} />
        <span>{COUNTRY_FIT_DISCLAIMER}</span>
      </p>
    </section>
  );
}

function missingCellLabel(metric: FactKey, reason: string | undefined): string {
  const label = missingFactLabel(reason);
  return label === '—' ? (MISSING_BY_METRIC[metric] ?? label) : label;
}

/** A missing value that only waits for the candidate's salary says so; any other is a dash with the reason as a hint. */
export function missingFactLabel(reason: string | undefined): string {
  return reason && /укажите[^.]*зарплат/i.test(reason) ? 'укажите зарплату' : '—';
}
