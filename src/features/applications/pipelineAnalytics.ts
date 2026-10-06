import type { ApplicationStage } from '../../../shared/applicationStage';
import type { ApplicationView } from './applicationsApi';

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
    | 'need_more_data'
    | 'low_response_rate'
    | 'low_interview_rate'
    | 'low_offer_rate'
    | 'healthy';
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
  readonly overallConversionRate: number;
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
  saved: 'Сохранено',
  applied: 'Откликнулись',
  responded: 'Ответ компании',
  interview: 'Интервью',
  offer: 'Получен оффер',
  rejected: 'Отказ',
  archived: 'В архиве',
};

const SOURCE_LABELS: Record<string, string> = {
  hh: 'hh.ru',
  linkedin: 'LinkedIn',
  recruiter: 'Рекрутер',
  other: 'Другой источник',
};

/**
 * Проверяет, проходила ли карточка через указанный этап воронки.
 */
function applicationReachedStage(app: ApplicationView, targetStage: ApplicationStage): boolean {
  if (targetStage === 'saved') return true;

  const currentStageIndex = STAGE_ORDER.indexOf(app.stage);
  const targetStageIndex = STAGE_ORDER.indexOf(targetStage);

  if (currentStageIndex >= targetStageIndex && targetStageIndex !== -1) {
    return true;
  }

  // Если карточка закрыта (rejected или archived), смотрим историю
  if (app.stage === 'rejected' || app.stage === 'archived') {
    if (targetStage === 'applied') return true;
    if (app.archivePreviousStage) {
      const prevIndex = STAGE_ORDER.indexOf(app.archivePreviousStage);
      if (prevIndex >= targetStageIndex && targetStageIndex !== -1) {
        return true;
      }
    }
    if (targetStage === 'interview' && app.nearestInterview !== null) {
      return true;
    }
  }

  return false;
}

/**
 * Рассчитывает этапы воронки и их конверсии.
 */
function buildFunnelSteps(
  applications: readonly ApplicationView[],
): readonly StageFunnelStep[] {
  const counts = STAGE_ORDER.map((stage) => {
    const reached = applications.filter((app) => applicationReachedStage(app, stage)).length;
    return { stage, count: reached };
  });

  const appliedCount = counts.find((c) => c.stage === 'applied')?.count ?? 0;

  return counts.map((item, index) => {
    const prevCount = index > 0 ? counts[index - 1].count : 0;
    const conversionFromPrevious =
      index > 0 && prevCount > 0 ? Math.round((item.count / prevCount) * 100) : null;
    const conversionFromApplied =
      index >= 1 && appliedCount > 0
        ? Math.round((item.count / appliedCount) * 100)
        : null;

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
function diagnoseInterviewBottleneck(
  interviewCount: number,
  respondedCount: number,
  offerCount: number,
  closedCount: number,
): PipelineBottleneck {
  const interviewRate = interviewCount / respondedCount;
  if (respondedCount >= 2 && interviewRate < 0.25) {
    return {
      id: 'low_interview_rate',
      severity: 'warning',
      title: 'Узкое место: переход от ответа к интервью',
      description:
        'Отклики просматривают, но на собеседование не приглашают. Обычно дело в позиционировании и вводном блоке резюме.',
      recommendation:
        'Усильте первые строки резюме и сопроводительного письма измеримыми достижениями.',
    };
  }

  if (interviewCount >= 2 && offerCount === 0 && closedCount > 0) {
    return {
      id: 'low_offer_rate',
      severity: 'warning',
      title: 'Узкое место: конверсия после интервью',
      description: 'Интервью назначаются, но этап оффера пока не достигнут.',
      recommendation:
        'Подготовьте примеры по методике STAR (ситуация, задача, действие, результат) и разберите сложные вопросы с экспертом.',
    };
  }

  return {
    id: 'healthy',
    severity: 'success',
    title: 'Воронка стабильна',
    description: 'Показатели конверсии соответствуют здоровому рыночному поиску.',
    recommendation: 'Сохраняйте темп откликов и готовьтесь к следующим раундам.',
  };
}

/**
 * Диагностирует узкие места в воронке по критериям US-7.6.
 */
function diagnoseBottlenecks(
  appliedCount: number,
  respondedCount: number,
  interviewCount: number,
  offerCount: number,
  closedCount: number,
): PipelineBottleneck {
  if (appliedCount < 3) {
    return {
      id: 'need_more_data',
      severity: 'info',
      title: 'Сбор статистики',
      description: 'В воронке пока мало отправленных откликов для статистических выводов.',
      recommendation:
        'Отправьте от 5 до 10 целевых откликов, чтобы выявить закономерности и узкие места.',
    };
  }

  const responseRate = respondedCount / appliedCount;
  if (responseRate < 0.15) {
    return {
      id: 'low_response_rate',
      severity: 'warning',
      title: 'Узкое место: низкий отклик работодателей',
      description:
        'Менее 15% откликов получают ответ или просмотр. Частая причина — несоответствие резюме фильтрам ATS или нецелевой канал.',
      recommendation:
        'Проверьте ключевые слова в резюме под требования вакансий и протестируйте прямые контакты с нанимателями.',
    };
  }

  return diagnoseInterviewBottleneck(
    interviewCount,
    respondedCount,
    offerCount,
    closedCount,
  );
}

/**
 * Рассчитывает среднее время прохождения отклика в днях.
 */
function calculateAverageCycleDays(applications: readonly ApplicationView[]): number | null {
  const durations: number[] = [];
  const oneDayMs = 24 * 60 * 60 * 1000;

  for (const app of applications) {
    if (!app.createdAt || !app.stageChangedAt) continue;
    const start = new Date(app.createdAt).getTime();
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
    sourceLabel: SOURCE_LABELS[source] ?? source,
    total: items.length,
    responded: items.filter((a) => applicationReachedStage(a, 'responded')).length,
    interview: items.filter((a) => applicationReachedStage(a, 'interview')).length,
    offer: items.filter((a) => applicationReachedStage(a, 'offer')).length,
  }));
}

function countArchiveReasons(
  applications: readonly ApplicationView[],
): ReadonlyArray<{ readonly reason: string; readonly count: number }> {
  const reasonMap = new Map<string, number>();
  for (const app of applications) {
    const reason = app.closedReason ?? app.archiveReason;
    if (reason) {
      reasonMap.set(reason, (reasonMap.get(reason) ?? 0) + 1);
    }
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
  const respondedCount = steps.find((s) => s.stage === 'responded')?.count ?? 0;
  const interviewCount = steps.find((s) => s.stage === 'interview')?.count ?? 0;
  const offerCount = steps.find((s) => s.stage === 'offer')?.count ?? 0;

  const overallConversionRate =
    appliedCount > 0 ? Math.round((offerCount / appliedCount) * 100) : 0;

  const bottleneck = diagnoseBottlenecks(
    appliedCount,
    respondedCount,
    interviewCount,
    offerCount,
    rejectedCount + archivedCount,
  );

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
