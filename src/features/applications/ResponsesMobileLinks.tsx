import { CaretRight, ChartBar, Archive } from '@phosphor-icons/react';
import type { ApplicationView } from './applicationsApi';
import { computePipelineAnalytics } from './pipelineAnalytics';

export function isClosedResponse(application: ApplicationView): boolean {
  return application.stage === 'rejected' || application.stage === 'archived';
}

function percent(part: number, total: number): string {
  if (total <= 0) return '0 %';
  return (
    ((part / total) * 100).toLocaleString('ru-RU', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }) + ' %'
  );
}

/** «hh.ru 8,1 % · LinkedIn 13,7 %»: share of responses that got an answer. */
export function channelSummary(applications: readonly ApplicationView[]): string {
  const sources = computePipelineAnalytics(applications).sources;
  if (sources.length === 0) return 'Нет данных за выбранный период';
  return sources
    .map((source) => `${source.sourceLabel} ${percent(source.responded, source.total)}`)
    .join(' · ');
}

export function closedResponseReasons(applications: readonly ApplicationView[]) {
  const reasonCounts = computePipelineAnalytics(applications).archiveReasons;
  const counts = new Map(reasonCounts.map((item) => [item.reason, item.count]));
  const recordedCount = [...counts.values()].reduce((total, count) => total + count, 0);
  const missingCount = applications.length - recordedCount;
  if (missingCount > 0) {
    counts.set('unknown', (counts.get('unknown') ?? 0) + missingCount);
  }
  return [...counts].map(([reason, count]) => ({ reason, count }));
}

function closedSummary(applications: readonly ApplicationView[]): string {
  return closedResponseReasons(applications)
    .map(
      (item) =>
        `${item.reason.charAt(0).toLowerCase()}${item.reason.slice(1)} ${item.count.toLocaleString('ru-RU')}`,
    )
    .join(' · ');
}

export function ResponsesMobileLinks({
  applications,
  allApplications,
  onOpenChannels,
  onOpenClosed,
}: {
  readonly applications: readonly ApplicationView[];
  readonly allApplications: readonly ApplicationView[];
  readonly onOpenChannels: () => void;
  readonly onOpenClosed: () => void;
}) {
  const closedApplications = allApplications.filter(isClosedResponse);
  return (
    <nav className="career-responses-mobile-links" aria-label="Итоги откликов">
      <button type="button" className="career-responses-mobile-link" onClick={onOpenChannels}>
        <span className="career-responses-mobile-link-icon">
          <ChartBar aria-hidden="true" />
        </span>
        <span>
          <strong>Результативность по каналам</strong>
          <small>{channelSummary(applications)}</small>
        </span>
        <span aria-hidden="true" />
        <CaretRight aria-hidden="true" />
      </button>
      {closedApplications.length > 0 ? (
        <button type="button" className="career-responses-mobile-link" onClick={onOpenClosed}>
          <span className="career-responses-mobile-link-icon">
            <Archive aria-hidden="true" />
          </span>
          <span>
            <strong>Закрыто</strong>
            <small>{closedSummary(closedApplications)}</small>
          </span>
          <span className="career-responses-mobile-link-count career-numeric">
            {closedApplications.length.toLocaleString('ru-RU')}
          </span>
          <CaretRight aria-hidden="true" />
        </button>
      ) : null}
    </nav>
  );
}
