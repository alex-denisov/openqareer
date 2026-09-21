import {
  ArrowRight,
  CheckCircle,
  WarningCircle,
} from '@phosphor-icons/react';
import {
  CoachApiError,
  type VacancySubscription,
  type VacancySourceRegistryEntry,
} from '../coach/coachApi';
import type { CareerJourney } from '../journey/careerJourneyEngine';
import type { ReasonedCareerAction } from '../next-action/careerActionPolicy';
import { diagnosticActionDestination } from '../diagnostic/careerDiagnostic';


export const fallbackSources = [
  { id: 'hh', name: 'hh.ru', market: 'Россия и СНГ' },
  { id: 'remotive', name: 'Remotive', market: 'Международный remote' },
] as const;

export { FollowUpActionCard } from '../applications/FollowUpActionCard';

export function SourceAttribution({ source }: { source: VacancySourceRegistryEntry }) {
  return (
    <a
      className="career-source-attribution"
      href={source.attributionUrl}
      target="_blank"
      rel="noreferrer"
    >
      Источник: {source.name}
    </a>
  );
}

export function sourceHealthLabel(status?: VacancySourceRegistryEntry['health']['status']) {
  return {
    healthy: 'источник доступен',
    degraded: 'временные ошибки',
    unavailable: 'временно недоступен',
    official_access_required: 'нужен официальный доступ',
    not_checked: 'ещё не проверен',
  }[status ?? 'not_checked'];
}

export function sourceFailureMessage(errorCode: string) {
  if (errorCode === 'source_replaced_review_required') {
    return 'Площадка перестала отвечать, сбор переключён на Remotive. Проверьте направление и нажмите «Собрать сейчас».';
  }
  if (errorCode === 'official_access_required') {
    return 'Площадка закрыла API. Направление сохранено, новых вакансий с неё не будет, пока доступ не появится.';
  }
  if (errorCode === 'source_rate_limited') {
    return 'Площадка попросила подождать (rate limit). Повторим автоматически.';
  }
  return 'Источник сейчас недоступен. Поиск сохранён и повторится по расписанию.';
}

export function AtsReadability({
  journey,
  onNavigate,
}: {
  journey?: CareerJourney;
  onNavigate: (view: IntelligenceDestination) => void;
}) {
  const findings = (journey?.diagnostic.findings ?? []).filter((finding) =>
    ['readability', 'ats', 'evidence', 'freshness'].includes(finding.dimension),
  );
  const known = findings.filter((finding) => finding.certainty === 'fact').length;
  return (
    <section className="career-ats-card" aria-labelledby="career-ats-title">
      <header>
        <div>
          <span>ATS-читаемость</span>
          <h3 id="career-ats-title">
            {findings.length
              ? `${known} из ${findings.length} проверок с фактом`
              : 'Нужен исходный CV'}
          </h3>
        </div>
        {findings.some((finding) => finding.status === 'issue') ? (
          <WarningCircle size={20} />
        ) : (
          <CheckCircle size={20} />
        )}
      </header>
      {findings.length ? (
        <dl>
          {findings.map((finding) => (
            <div key={finding.id}>
              <dt>{findingLabel(finding.dimension)}</dt>
              <dd className={`is-${finding.status}`}>{finding.title}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>Загрузите PDF или DOCX: без исходной вёрстки нельзя честно оценить порядок чтения.</p>
      )}
      <DiagnosticAction journey={journey} onNavigate={onNavigate} />
    </section>
  );
}

function DiagnosticAction({
  journey,
  onNavigate,
}: {
  journey?: CareerJourney;
  onNavigate: (view: IntelligenceDestination) => void;
}) {
  const action = journey?.diagnostic.nextAction;
  return (
    <button
      className="career-inline-link"
      type="button"
      onClick={() => onNavigate(action ? diagnosticActionDestination(action) : 'profile')}
    >
      {action?.label ?? 'Добавить документ'} <ArrowRight size={15} />
    </button>
  );
}

export function MarketAnalytics({ subscription }: { subscription: VacancySubscription }) {
  const analytics = subscription.analytics;
  const primaryCurrency = analytics.currencies[0];
  return (
    <>
      <dl className="career-market-metrics">
        <div>
          <dt>Найдено в последней выборке</dt>
          <dd>{analytics.sourceFound ?? '—'}</dd>
        </div>
        <div>
          <dt>Зарплата указана</dt>
          <dd>
            {analytics.salaryKnown} из {analytics.sampleSize}
          </dd>
        </div>
        <div>
          <dt>Медиана вилки</dt>
          <dd>{primaryCurrency ? salaryMedian(primaryCurrency) : 'Нет данных'}</dd>
        </div>
        <div>
          <dt>Главная локация</dt>
          <dd>{analytics.topLocations[0]?.location ?? 'Нет данных'}</dd>
        </div>
      </dl>
      <p className="career-market-freshness">
        {analytics.observedTo
          ? `Наблюдения: ${dateLabel(analytics.observedFrom)} — ${dateLabel(analytics.observedTo)}`
          : 'Наблюдений пока нет'}
        {' · '}неизвестная зарплата: {analytics.unknownSalary}
      </p>
    </>
  );
}

export function NextAction({
  journey,
  onNavigate,
}: {
  journey?: CareerJourney;
  onNavigate: (view: IntelligenceDestination) => void;
}) {
  const reasonedAction = journey?.reasonedAction;
  const destination = reasonedAction
    ? reasonedDestination(reasonedAction.destination)
    : journey?.nextAction.destination ?? 'profile';
  return (
    <section className="career-next-action-card">
      <span>Следующее действие</span>
      <h3>
        {reasonedAction?.headline ??
          journey?.nextAction.headline ??
          'Уточнить основу профиля'}
      </h3>
      <p>
        {reasonedAction?.rationale ??
          journey?.nextAction.reason ??
          'Добавьте CV или ответьте стратегу: следующий шаг появится только после проверяемого факта.'}
      </p>
      {reasonedAction ? (
        <ReasonedActionDetails action={reasonedAction} onNavigate={onNavigate} />
      ) : journey?.nextAction.expectedChange ? (
        <div className="career-next-action-effect">
          <strong>Что изменится</strong>
          <p>{journey.nextAction.expectedChange}</p>
        </div>
      ) : null}
      <button type="button" onClick={() => onNavigate(destination)}>
        {reasonedAction?.label ?? journey?.nextAction.label ?? 'Открыть профиль'}{' '}
        <ArrowRight size={16} />
      </button>
    </section>
  );
}

function ReasonedActionDetails({
  action,
  onNavigate,
}: {
  action: ReasonedCareerAction;
  onNavigate: (view: IntelligenceDestination) => void;
}) {
  return (
    <>
      <div className="career-next-action-effect">
        <strong>Что изменится</strong>
        <p>{action.expectedChange}</p>
      </div>
      <div className="career-next-action-alternatives" aria-label="Другой путь">
        <strong>Другой путь</strong>
        <div>
          {action.alternatives.map((alternative) => (
            <button
              type="button"
              key={alternative.id}
              onClick={() => onNavigate(reasonedDestination(alternative.destination))}
            >
              {alternative.label}
            </button>
          ))}
        </div>
      </div>
      <small className="career-next-action-boundary">{action.approvalBoundary}</small>
    </>
  );
}

function reasonedDestination(
  destination: ReasonedCareerAction['destination'],
): IntelligenceDestination {
  return ({
    coach: 'today',
    profile: 'profile',
    evidence: 'profile',
    career: 'career',
    search: 'opportunities',
  } satisfies Record<ReasonedCareerAction['destination'], IntelligenceDestination>)[
    destination
  ];
}

function salaryMedian(currency: VacancySubscription['analytics']['currencies'][number]) {
  const value = currency.medianFrom ?? currency.medianTo;
  if (value === null) return 'Нет данных';
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value)} ${currency.currency}`;
}

export function cadenceLabel(minutes: number) {
  if (minutes % 1_440 === 0) return `${minutes / 1_440} дн.`;
  if (minutes % 60 === 0) return `${minutes / 60} ч.`;
  return `${minutes} мин.`;
}

function dateLabel(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function findingLabel(dimension: CareerJourney['diagnostic']['findings'][number]['dimension']) {
  return {
    readability: 'Извлечение текста',
    ats: 'Структура и формат',
    evidence: 'Доказательность',
    freshness: 'Актуальность',
    contradictions: 'Расхождения',
    market: 'Рыночная проверка',
  }[dimension];
}

export function intelligenceError(reason: unknown): string {
  if (reason instanceof CoachApiError || reason instanceof Error) {
    return reason.message;
  }
  return 'Не удалось обновить рыночную выборку. Поиск сохранён.';
}

export type IntelligenceDestination = 'today' | 'profile' | 'career' | 'opportunities';
