import { CaretRight } from '@phosphor-icons/react';
import type { ApplicationView } from './applicationsApi';
import { ArchiveReasonsList } from './PipelineAnalyticsView';
import { computePipelineAnalytics } from './pipelineAnalytics';

export function ResponsesMobileLinks({
  applications,
  allApplications,
}: {
  readonly applications: readonly ApplicationView[];
  readonly allApplications: readonly ApplicationView[];
}) {
  const sources = computePipelineAnalytics(applications).sources;
  const closedApplications = allApplications.filter(
    (application) => application.stage === 'rejected' || application.stage === 'archived',
  );
  const reasonCounts = closedResponseReasons(closedApplications);
  const sourceSummary = sources.length
    ? sources
        .map((source) => `${source.sourceLabel} ${source.total.toLocaleString('ru-RU')}`)
        .join(' · ')
    : 'Нет данных за выбранный период';

  return (
    <div className="career-responses-mobile-links">
      <a className="career-responses-mobile-link" href="#career-responses-channel-performance">
        <span>
          <strong>Результативность по каналам</strong>
          <small>{sourceSummary}</small>
        </span>
        <CaretRight aria-hidden="true" />
      </a>
      {closedApplications.length > 0 ? (
        <details className="career-responses-mobile-closed">
          <summary>
            <span>
              <strong>Закрыто · {closedApplications.length.toLocaleString('ru-RU')}</strong>
              <small>Разбивка по причинам</small>
            </span>
            <CaretRight aria-hidden="true" />
          </summary>
          <ArchiveReasonsList reasons={reasonCounts} title="Причины закрытия откликов" />
        </details>
      ) : null}
    </div>
  );
}

function closedResponseReasons(applications: readonly ApplicationView[]) {
  const reasonCounts = computePipelineAnalytics(applications).archiveReasons;
  const counts = new Map(reasonCounts.map((item) => [item.reason, item.count]));
  const recordedCount = [...counts.values()].reduce((total, count) => total + count, 0);
  const missingCount = applications.length - recordedCount;
  if (missingCount > 0) {
    counts.set('unknown', (counts.get('unknown') ?? 0) + missingCount);
  }
  return [...counts].map(([reason, count]) => ({ reason, count }));
}
