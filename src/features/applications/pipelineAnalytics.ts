import type { ApplicationStage } from '../../../shared/applicationStage';
import type { ApplicationView } from './applicationsApi';
import { archiveReasonLabel } from './archiveReasonLabel';
import { SKIP_REASONS } from '../../../shared/skipReasons';

export const MIN_PIPELINE_SAMPLE_SIZE = 20;

export interface StageFunnelStep {
  readonly stage: ApplicationStage;
  readonly label: string;
  readonly count: number;
  readonly conversionFromPrevious: number | null;
  readonly conversionFromApplied: number | null;
}

export type BottleneckSeverity = 'info' | 'warning' | 'success';

export interface PipelineBottleneck {
  readonly id:
    'need_more_data' | 'low_response_rate' | 'low_interview_rate' | 'low_offer_rate' | 'healthy';
  readonly severity: BottleneckSeverity;
  readonly title: string;
  readonly description: string;
  readonly recommendation: string;
}

export interface SourceBreakdownItem {
  readonly source: string;
  readonly sourceLabel: string;
  readonly total: number;
  readonly responded: number;
  readonly interview: number;
  readonly offer: number;
}

export interface PipelineAnalyticsSummary {
  readonly totalCount: number;
  readonly activeCount: number;
  readonly rejectedCount: number;
  readonly archivedCount: number;
  readonly averageCycleDays: number | null;
  readonly steps: readonly StageFunnelStep[];
  readonly overallConversionRate: number | null;
  readonly bottleneck: PipelineBottleneck;
  readonly sources: readonly SourceBreakdownItem[];
  readonly archiveReasons: ReadonlyArray<{ readonly reason: string; readonly count: number }>;
}

const STAGE_ORDER: readonly ApplicationStage[] = [
  'saved',
  'applied',
  'responded',
  'interview',
  'offer',
];

const STAGE_LABELS: Record<ApplicationStage, string> = {
  saved: 'Было в избранном',
  applied: 'Откликнулись',
  responded: 'Ответ компании',
  interview: 'Интервью',
  offer: 'Получен оффер',
  rejected: 'Отказ',
  archived: 'В архиве',
};

import { humanSourceLabel } from './sourceLabels';

/**
 * Проверяет, проходила ли карточка через указанный этап воронки.
 */
function applicationReachedStage(app: ApplicationView, targetStage: ApplicationStage): boolean {
  return app.stage === targetStage || app.archivePreviousStage === targetStage || (app.reachedStages?.includes(targetStage) ?? false);
}

/**
 * Рассчитывает этапы воронки и их конверсии.
 */
function buildFunnelSteps(applications: readonly ApplicationView[]): readonly StageFunnelStep[] {
  const counts = STAGE_ORDER.map((stage) => {
    const reached = applications.filter((app) => applicationReachedStage(app, stage)).length;
    return { stage, count: reached };
  });

  const appliedCount = counts.find((c) => c.stage === 'applied')?.count ?? 0;

  return counts.map((item, index) => {
    const prevCount = index > 0 ? counts[index - 1].count : 0;
    const conversionFromPrevious =
      index > 0 && prevCount > 0 ? Math.round((applications.filter((app) => applicationReachedStage(app, STAGE_ORDER[index - 1]) && applicationReachedStage(app, item.stage)).length / prevCount) * 100) : null;
    const conversionFromApplied =
      index >= 1 && appliedCount > 0 ? Math.round((applications.filter((app) => applicationReachedStage(app, 'applied') && applicationReachedStage(app, item.stage)).length / appliedCount) * 100) : null;

    return {
      stage: item.stage,
      label: STAGE_LABELS[item.stage],
      count: item.count,
      conversionFromPrevious,
      conversionFromApplied,
    };
  });
}

/**
 * Диагностирует узкие места в воронке по критериям US-7.6.
 */
function diagnoseBottlenecks(steps: readonly StageFunnelStep[]): PipelineBottleneck {
  const applied = steps.find((step) => step.stage === 'applied')?.count ?? 0;
  if (applied < MIN_PIPELINE_SAMPLE_SIZE) return {
    id: 'need_more_data', severity: 'info', title: 'Мало данных: воронка',
    description: 'Меньше 20 откликов: узкие места не определены.',
    recommendation: 'Это ограничение сводки, а не оценка качества вашего поиска.',
  };
  const transitions = steps.slice(2).filter((step) => step.conversionFromPrevious !== null);
  const smallest = transitions.reduce<StageFunnelStep | undefined>((result, step) => !result || step.conversionFromPrevious! < result.conversionFromPrevious! ? step : result, undefined);
  if (!smallest || smallest.conversionFromPrevious === 100) return {
    id: 'healthy', severity: 'info', title: 'Явного разрыва не видно',
    description: 'В записанных переходах нет потери между сопоставимыми этапами. Пропущенные этапы и незавершённые процессы ограничивают вывод.',
    recommendation: 'Обновляйте этапы после новых событий; рыночные нормы здесь не оцениваются.',
  };
  const id = smallest.stage === 'responded' ? 'low_response_rate' : smallest.stage === 'interview' ? 'low_interview_rate' : 'low_offer_rate';
  return { id, severity: 'warning', title: `Меньше переходов: ${smallest.label}`,
    description: `Наименьшая записанная конверсия в выборке — ${smallest.conversionFromPrevious}%. Это наблюдение, а не причина отказов или прогноз.`,
    recommendation: 'Проверьте незавершённые отклики и полноту истории, затем разберите конкретные карточки со стратегом.' };
}

/**
 * Рассчитывает среднее время прохождения отклика в днях.
 */
function calculateAverageCycleDays(applications: readonly ApplicationView[]): number | null {
  const durations: number[] = [];
  const oneDayMs = 24 * 60 * 60 * 1000;

  for (const app of applications) {
    if (!app.appliedAt || !app.stageChangedAt) continue;
    const start = new Date(app.appliedAt).getTime();
    const end = new Date(app.stageChangedAt).getTime();
    if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
      durations.push((end - start) / oneDayMs);
    }
  }

  if (durations.length === 0) return null;
  const avg = durations.reduce((sum, val) => sum + val, 0) / durations.length;
  return Math.round(avg * 10) / 10;
}

/**
 * Группирует отклики по источникам вакансий.
 */
function buildSourceBreakdown(
  applications: readonly ApplicationView[],
): readonly SourceBreakdownItem[] {
  const groups = new Map<string, ApplicationView[]>();

  for (const app of applications) {
    const src = app.vacancy?.source ?? 'other';
    const list = groups.get(src) ?? [];
    list.push(app);
    groups.set(src, list);
  }

  return Array.from(groups.entries()).map(([source, items]) => ({
    source,
    sourceLabel: humanSourceLabel(source),
    total: items.length,
    responded: items.filter((a) => applicationReachedStage(a, 'responded')).length,
    interview: items.filter((a) => applicationReachedStage(a, 'interview')).length,
    offer: items.filter((a) => applicationReachedStage(a, 'offer')).length,
  }));
}

function closureReasonLabel(application: ApplicationView): string {
  if (application.closedReason) {
    const skipReason = SKIP_REASONS.find((reason) => reason.id === application.closedReason);
    if (skipReason) return skipReason.label;
    if (application.closedReason === 'company_declined') return 'Отказ компании';
    return /^[a-z][a-z0-9_-]*$/iu.test(application.closedReason)
      ? archiveReasonLabel('unknown')
      : application.closedReason;
  }
  return archiveReasonLabel(application.archiveReason, application.archiveStaleDays);
}

function countArchiveReasons(
  applications: readonly ApplicationView[],
): ReadonlyArray<{ readonly reason: string; readonly count: number }> {
  const reasonMap = new Map<string, number>();
  for (const application of applications) {
    if (application.stage !== 'rejected' && application.stage !== 'archived') continue;
    const reason = closureReasonLabel(application);
    reasonMap.set(reason, (reasonMap.get(reason) ?? 0) + 1);
  }
  return Array.from(reasonMap.entries()).map(([reason, count]) => ({ reason, count }));
}

/**
 * Главная функция расчета аналитики конверсии воронки.
 */
export function computePipelineAnalytics(
  applications: readonly ApplicationView[],
): PipelineAnalyticsSummary {
  const totalCount = applications.length;
  const activeCount = applications.filter(
    (app) => app.stage !== 'rejected' && app.stage !== 'archived',
  ).length;
  const rejectedCount = applications.filter((app) => app.stage === 'rejected').length;
  const archivedCount = applications.filter((app) => app.stage === 'archived').length;

  const steps = buildFunnelSteps(applications);
  const appliedCount = steps.find((s) => s.stage === 'applied')?.count ?? 0;


  const overallConversionRate =
    appliedCount > 0 ? Math.round((applications.filter((app) => applicationReachedStage(app, 'applied') && applicationReachedStage(app, 'offer')).length / appliedCount) * 100) : null;

  const bottleneck = diagnoseBottlenecks(steps);

  const averageCycleDays = calculateAverageCycleDays(
    applications.filter((a) => a.stage !== 'saved'),
  );

  return {
    totalCount,
    activeCount,
    rejectedCount,
    archivedCount,
    averageCycleDays,
    steps,
    overallConversionRate,
    bottleneck,
    sources: buildSourceBreakdown(applications),
    archiveReasons: countArchiveReasons(applications),
  };
}
