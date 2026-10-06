import {
  Briefcase,
  ChartBar,
  ChatCircleText,
  Funnel,
  WarningCircle,
  CheckCircle,
  Info,
} from '@phosphor-icons/react';
import type { CoachTurnStage, CoachTurnSubject } from '../coach/coachApi';
import type { ApplicationView } from './applicationsApi';
import {
  computePipelineAnalytics,
  type PipelineAnalyticsSummary,
  type StageFunnelStep,
  type SourceBreakdownItem,
  type PipelineBottleneck,
} from './pipelineAnalytics';
import { archiveReasonLabel } from './archiveReasonLabel';
import { humanSourceLabel } from './sourceLabels';
import type { ApplicationArchiveReason } from '../../../shared/applicationArchive';

export interface PipelineAnalyticsViewProps {
  readonly applications: readonly ApplicationView[];
  readonly onOpenVacancies: () => void;
  readonly onOpenExpert?: (
    stage: CoachTurnStage,
    subject?: CoachTurnSubject,
    subjectTitle?: string,
  ) => void;
}

/**
 * Дашборд конверсии воронки поиска (B355, US-07.4, EPIC-07 US-7.6).
 * Показывает конверсию откликов по этапам, среднее время и выявление узких мест
 * с рекомендациями карьерного стратега.
 */
export function PipelineAnalyticsView({
  applications,
  onOpenVacancies,
  onOpenExpert,
}: PipelineAnalyticsViewProps) {
  if (applications.length === 0) {
    return <AnalyticsEmptyState onOpenVacancies={onOpenVacancies} />;
  }

  const summary = computePipelineAnalytics(applications);

  return (
    <div className="career-pipeline-analytics" aria-label="Аналитика воронки поиска">
      <AnalyticsHeader summary={summary} />
      <AnalyticsSummaryCards summary={summary} />
      <div className="career-pipeline-analytics-grid">
        <FunnelDiagram steps={summary.steps} totalCount={summary.totalCount} />
        <BottleneckCard bottleneck={summary.bottleneck} onOpenExpert={onOpenExpert} />
      </div>
      <div className="career-pipeline-analytics-secondary">
        <SourcesTable sources={summary.sources} />
        {summary.archiveReasons.length > 0 ? (
          <ArchiveReasonsList reasons={summary.archiveReasons} />
        ) : null}
      </div>
    </div>
  );
}

function AnalyticsEmptyState({ onOpenVacancies }: { readonly onOpenVacancies: () => void }) {
  return (
    <div className="career-responses-empty" role="status">
      <ChartBar size={32} weight="regular" aria-hidden="true" />
      <h3>Пока нет данных для аналитики</h3>
      <p>
        Здесь появится сквозная конверсия откликов, воронка этапов и рекомендации
        стратега по узким местам поиска.
      </p>
      <p className="career-responses-empty-step">
        Откликнитесь на вакансии из подборки, чтобы сформировать воронку.
      </p>
      <div className="career-responses-empty-actions">
        <button
          type="button"
          className="career-btn career-btn-primary career-btn-sm"
          onClick={onOpenVacancies}
        >
          <Briefcase size={14} aria-hidden="true" /> Перейти к вакансиям
        </button>
      </div>
    </div>
  );
}

function AnalyticsHeader({ summary }: { readonly summary: PipelineAnalyticsSummary }) {
  return (
    <header className="career-pipeline-analytics-head">
      <div className="career-pipeline-analytics-title-group">
        <h2 className="career-pipeline-analytics-title">
          <Funnel size={20} aria-hidden="true" /> Аналитика воронки
        </h2>
        <p className="career-pipeline-analytics-subtitle">
          Конверсия этапов, скорость прохождения и выявление узких мест кампании
        </p>
      </div>
      <div className="career-pipeline-analytics-meta">
        <span className="career-pipeline-meta-pill">
          Всего откликов: <strong className="is-mono">{summary.totalCount}</strong>
        </span>
        <span className="career-pipeline-meta-pill">
          В процессе: <strong className="is-mono">{summary.activeCount}</strong>
        </span>
      </div>
    </header>
  );
}

function AnalyticsSummaryCards({ summary }: { readonly summary: PipelineAnalyticsSummary }) {
  const offerStep = summary.steps.find((s) => s.stage === 'offer');
  const offerCount = offerStep?.count ?? 0;

  return (
    <div className="career-pipeline-kpis">
      <div className="career-pipeline-kpi-card">
        <span className="career-pipeline-kpi-label">Сквозная конверсия</span>
        <span className="career-pipeline-kpi-value is-mono">
          {summary.overallConversionRate}%
        </span>
        <span className="career-pipeline-kpi-hint">отклик → оффер</span>
      </div>
      <div className="career-pipeline-kpi-card">
        <span className="career-pipeline-kpi-label">Получено офферов</span>
        <span className="career-pipeline-kpi-value is-mono">{offerCount}</span>
        <span className="career-pipeline-kpi-hint">успешные финишные этапы</span>
      </div>
      <div className="career-pipeline-kpi-card">
        <span className="career-pipeline-kpi-label">Средний цикл</span>
        <span className="career-pipeline-kpi-value is-mono">
          {summary.averageCycleDays !== null ? `${summary.averageCycleDays} дн.` : '—'}
        </span>
        <span className="career-pipeline-kpi-hint">от отклика до статуса</span>
      </div>
      <div className="career-pipeline-kpi-card">
        <span className="career-pipeline-kpi-label">Отказы и архив</span>
        <span className="career-pipeline-kpi-value is-mono">
          {summary.rejectedCount + summary.archivedCount}
        </span>
        <span className="career-pipeline-kpi-hint">закрытые позиции</span>
      </div>
    </div>
  );
}

function FunnelDiagram({
  steps,
  totalCount,
}: {
  readonly steps: readonly StageFunnelStep[];
  readonly totalCount: number;
}) {
  const maxCount = Math.max(totalCount, 1);

  return (
    <section className="career-pipeline-card career-pipeline-funnel" aria-labelledby="funnel-diagram-title">
      <h3 id="funnel-diagram-title" className="career-pipeline-card-title">
        Этапы воронки поиска
      </h3>
      <div className="career-pipeline-funnel-steps" role="list">
        {steps.map((step) => {
          const share = Math.min(
            100,
            Math.max(step.count > 0 ? 10 : 0, Math.round((step.count / maxCount) * 10) * 10),
          );
          return (
            <div key={step.stage} className="career-pipeline-funnel-row" role="listitem">
              <div className="career-pipeline-funnel-info">
                <span className="career-pipeline-funnel-name">{step.label}</span>
                <span className="career-pipeline-funnel-count is-mono">{step.count}</span>
              </div>
              <div className="career-pipeline-funnel-track">
                <div
                  className="career-pipeline-funnel-fill"
                  data-share={share}
                  aria-hidden="true"
                />
              </div>
              <div className="career-pipeline-funnel-rates">
                {step.conversionFromPrevious !== null ? (
                  <span className="career-pipeline-funnel-badge">
                    <span className="is-mono">{step.conversionFromPrevious}%</span> от пред.
                  </span>
                ) : (
                  <span className="career-pipeline-funnel-badge is-base">база</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function BottleneckCard({
  bottleneck,
  onOpenExpert,
}: {
  readonly bottleneck: PipelineBottleneck;
  readonly onOpenExpert?: (
    stage: CoachTurnStage,
    subject?: CoachTurnSubject,
    subjectTitle?: string,
  ) => void;
}) {
  const icon =
    bottleneck.severity === 'warning' ? (
      <WarningCircle size={20} weight="fill" aria-hidden="true" />
    ) : bottleneck.severity === 'success' ? (
      <CheckCircle size={20} weight="fill" aria-hidden="true" />
    ) : (
      <Info size={20} weight="fill" aria-hidden="true" />
    );

  return (
    <section
      className={`career-pipeline-card career-pipeline-bottleneck-card is-${bottleneck.severity}`}
      aria-labelledby="bottleneck-card-title"
    >
      <div className="career-pipeline-bottleneck-header">
        <span className="career-pipeline-bottleneck-icon">{icon}</span>
        <h3 id="bottleneck-card-title" className="career-pipeline-card-title">
          {bottleneck.title}
        </h3>
      </div>
      <p className="career-pipeline-bottleneck-desc">{bottleneck.description}</p>
      <div className="career-pipeline-bottleneck-tip">
        <strong>Совет стратега:</strong> {bottleneck.recommendation}
      </div>
      {onOpenExpert ? (
        <div className="career-pipeline-bottleneck-actions">
          <button
            type="button"
            className="career-btn career-btn-secondary career-btn-sm"
            onClick={() => onOpenExpert('responses', undefined, 'Аналитика воронки')}
          >
            <ChatCircleText size={14} aria-hidden="true" /> Обсудить со стратегом
          </button>
        </div>
      ) : null}
    </section>
  );
}

function SourcesTable({ sources }: { readonly sources: readonly SourceBreakdownItem[] }) {
  if (sources.length === 0) return null;

  return (
    <section className="career-pipeline-card career-pipeline-sources-table" aria-labelledby="sources-table-title">
      <h3 id="sources-table-title" className="career-pipeline-card-title">
        Эффективность каналов
      </h3>
      <div className="career-pipeline-table-wrap">
        <table className="career-pipeline-table">
          <thead>
            <tr>
              <th scope="col">Источник</th>
              <th scope="col" className="is-num">
                Всего
              </th>
              <th scope="col" className="is-num">
                Ответы
              </th>
              <th scope="col" className="is-num">
                Интервью
              </th>
              <th scope="col" className="is-num">
                Офферы
              </th>
            </tr>
          </thead>
          <tbody>
            {sources.map((src) => (
              <tr key={src.source}>
                <th
                  scope="row"
                  className="career-pipeline-source-name"
                  data-source-id={src.source}
                >
                  {humanSourceLabel(src.source)}
                </th>
                <td className="is-num is-mono">{src.total}</td>
                <td className="is-num is-mono">{src.responded}</td>
                <td className="is-num is-mono">{src.interview}</td>
                <td className="is-num is-mono">{src.offer}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatReason(rawReason: string): string {
  if (
    rawReason === 'candidate' ||
    rawReason === 'vacancy_closed' ||
    rawReason === 'stale' ||
    rawReason === 'unknown'
  ) {
    return archiveReasonLabel(rawReason as ApplicationArchiveReason);
  }
  return rawReason;
}

function ArchiveReasonsList({
  reasons,
}: {
  readonly reasons: ReadonlyArray<{ readonly reason: string; readonly count: number }>;
}) {
  return (
    <section className="career-pipeline-card" aria-labelledby="reasons-list-title">
      <h3 id="reasons-list-title" className="career-pipeline-card-title">
        Причины закрытия вакансий
      </h3>
      <ul className="career-pipeline-reasons-list">
        {reasons.map((item) => (
          <li key={item.reason} className="career-pipeline-reason-item">
            <span className="career-pipeline-reason-label">{formatReason(item.reason)}</span>
            <span className="career-pipeline-reason-count is-mono">{item.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
