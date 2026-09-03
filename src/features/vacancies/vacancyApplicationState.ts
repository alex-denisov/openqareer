import type {
  VacancyApplication,
  VacancyApplicationSnapshot,
  VacancyApplicationStatus,
} from '../../../shared/vacancyApplication';

/**
 * Состояние ручных откликов на экране (B165, срез 1).
 *
 * Логика вынесена из хука: кандидат уходит на площадку сразу по ссылке, и
 * экран обязан показать состояние до ответа сервера — а правило «отклик не
 * понижается» должно проверяться тестом, а не рендером.
 */
export function optimisticApplication(
  clusterId: string,
  status: VacancyApplicationStatus,
  vacancy: VacancyApplicationSnapshot,
  now = new Date().toISOString(),
): VacancyApplication {
  return {
    clusterId,
    status,
    vacancy,
    openedAt: now,
    appliedAt: status === 'applied' ? now : null,
    confirmedBy: status === 'applied' ? 'candidate' : null,
  };
}

/**
 * Подтверждённый отклик не понижается: открыть ту же ссылку ещё раз — не
 * откат отклика, и дата подтверждения при этом не переписывается.
 */
export function mergeApplication(
  current: readonly VacancyApplication[],
  next: VacancyApplication,
): VacancyApplication[] {
  const existing = current.find((application) => application.clusterId === next.clusterId);
  const kept: VacancyApplication =
    existing?.status === 'applied'
      ? {
          ...next,
          status: 'applied',
          openedAt: existing.openedAt ?? next.openedAt,
          appliedAt: existing.appliedAt ?? next.appliedAt,
          confirmedBy: 'candidate',
        }
      : next;
  return [kept, ...current.filter((application) => application.clusterId !== next.clusterId)];
}
