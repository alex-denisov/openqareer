import type { VacancyApplicationSnapshot } from '../../shared/vacancyApplication';
import type { RouteDeps } from './deps';
import { readVacancyFitTarget } from './vacancyFitContext';

/** Сколько знаков описания хранит отклик: движку вопросов хватает начала текста. */
export const APPLICATION_DESCRIPTION_LIMIT = 1500;

/**
 * B635: снимок вакансии в отклике дополняется описанием из пула на момент
 * отклика. Вопросы подготовки к интервью строятся по нему, даже когда
 * вакансия ушла из пула. Описание от клиента не перезаписывается.
 */
export function snapshotWithDescription(
  engine: RouteDeps['multiSourceEngine'],
  clusterId: string | null,
  snapshot: VacancyApplicationSnapshot | undefined,
): VacancyApplicationSnapshot | undefined {
  if (!snapshot || !clusterId || snapshot.description?.trim()) return snapshot;
  const description = readVacancyFitTarget(
    { multiSourceEngine: engine },
    clusterId,
  )?.description.trim();
  return description
    ? { ...snapshot, description: description.slice(0, APPLICATION_DESCRIPTION_LIMIT) }
    : snapshot;
}
