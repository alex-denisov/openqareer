import {
  calculateParetoFrontier,
  visibleFact,
  type CountryComparisonCountry,
  type CountryComparisonFact,
} from '../../../shared/countryFit/countryComparison';
import './CountryComparisonPanel.css';

type FactKey = keyof CountryComparisonCountry['facts'];
type PanelState = 'ready' | 'loading' | 'empty' | 'error';

const CRITERIA: readonly { readonly key: FactKey; readonly label: string }[] = [
  { key: 'netIncome', label: 'Чистый доход после налогов' },
  { key: 'monthlyRemainder', label: 'Остаток после жилья и расходов' },
  { key: 'access', label: 'Доступ к работе и переезду' },
  { key: 'processingTime', label: 'Срок оформления' },
  { key: 'relocationVacancies', label: 'Вакансии с релокацией' },
  { key: 'salaryThreshold', label: 'Порог дохода для статуса' },
  { key: 'incomeTax', label: 'Эффективная ставка налога' },
  { key: 'workingLanguage', label: 'Рабочий язык' },
  { key: 'familyAndResidence', label: 'Семья и дальнейшее проживание' },
];

export interface CountryComparisonPanelProps {
  readonly countries?: readonly CountryComparisonCountry[];
  readonly state?: PanelState;
  readonly errorMessage?: string;
  readonly onRetry?: () => void;
}

export function CountryComparisonPanel({
  countries = [],
  state = 'ready',
  errorMessage = 'Не удалось загрузить сравнение стран.',
  onRetry,
}: CountryComparisonPanelProps) {
  if (state === 'loading')
    return <PanelStateMessage busy>Загружаем проверенные данные по странам…</PanelStateMessage>;
  if (state === 'error') return <ErrorState message={errorMessage} onRetry={onRetry} />;
  if (state === 'empty' || countries.length === 0)
    return <PanelStateMessage>Выберите страны для сравнения.</PanelStateMessage>;
  if (countries.length > 3)
    return <PanelStateMessage>Для читаемого сравнения выберите до трёх стран.</PanelStateMessage>;
  return <ReadyComparison countries={countries} />;
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
}: {
  readonly countries: readonly CountryComparisonCountry[];
}) {
  const pareto = calculateParetoFrontier(countries);
  return (
    <section
      className="career-country-comparison"
      aria-labelledby="career-country-comparison-title"
    >
      <h2 id="career-country-comparison-title" className="career-country-comparison-title">
        Сравнение стран
      </h2>
      <DesktopMatrix countries={countries} />
      <MobileStack countries={countries} />
      <ParetoSummary countries={countries} result={pareto} />
    </section>
  );
}

function DesktopMatrix({ countries }: { readonly countries: readonly CountryComparisonCountry[] }) {
  return (
    <div className="career-country-comparison-desktop">
      <table className="career-country-comparison-table">
        <caption>
          Сопоставимые показатели по выбранным странам. Каждое значение сопровождается источником
          или причиной отсутствия данных.
        </caption>
        <thead>
          <tr>
            <th scope="col">Критерий</th>
            {countries.map((country) => (
              <th scope="col" key={country.countryCode}>
                {country.countryName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CRITERIA.map((criterion) => (
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

function MobileStack({ countries }: { readonly countries: readonly CountryComparisonCountry[] }) {
  return (
    <div className="career-country-comparison-mobile">
      {CRITERIA.map((criterion) => (
        <section className="career-country-comparison-mobile-criterion" key={criterion.key}>
          <h3>{criterion.label}</h3>
          <dl>
            {countries.map((country) => (
              <div className="career-country-comparison-mobile-entry" key={country.countryCode}>
                <dt>{country.countryName}</dt>
                <dd>
                  <FactContent fact={country.facts[criterion.key]} metric={criterion.key} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

function FactContent({
  fact,
  metric,
}: {
  readonly fact: CountryComparisonFact<unknown>;
  readonly metric: FactKey;
}) {
  const visible = visibleFact(fact, metric);
  if (visible.status !== 'available') {
    const label = visible.status === 'unknown' ? 'Статус неизвестен' : 'Нет проверенных данных';
    return (
      <div className="career-country-comparison-no-data">
        <strong>{label}</strong>
        <span>{visible.reason}</span>
      </div>
    );
  }
  return (
    <div className="career-country-comparison-fact">
      <strong className="career-country-comparison-value">
        {formatFact(metric, visible.value)}
      </strong>
      <ul className="career-country-comparison-sources" aria-label="Источники значения">
        {visible.sources.map((source, index) => (
          <li key={`${source.title}-${index}`}>
            {source.url ? (
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.title}
              </a>
            ) : (
              <span>{source.title}</span>
            )}
            {source.dataYear && <span> · год шкалы: {source.dataYear}</span>}
            <span> · получено: {source.capturedAt}</span>
            {metric === 'relocationVacancies' && source.sampleSize && (
              <span> · выборка: {source.sampleSize}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatFact(metric: FactKey, fact: unknown): string {
  const value = fact as Record<string, unknown>;
  if (metric === 'access') return String(value.label);
  if (metric === 'processingTime')
    return `${value.amount} ${value.unit === 'days' ? 'дн.' : 'нед.'}`;
  if (metric === 'relocationVacancies')
    return `${value.count} из ${value.sampleSize}: ${value.scope} · ${value.periodStart} — ${value.periodEnd}`;
  if (metric === 'salaryThreshold')
    return `${formatAmount(Number(value.amount))} ${value.currency} · ${value.basis}`;
  if (metric === 'incomeTax')
    return `${formatAmount(Number(value.effectiveRate))}% · ${value.basis}`;
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
