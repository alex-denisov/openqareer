/**
 * B550: состояние сохранённых вакансий для вкладки «Сохранённые» — деньги из
 * кластера и закрытие на площадке (B200: живость ссылки, снятая запись).
 * Неизвестная вакансия в ответ не попадает: интерфейс не помечает то, о чём
 * сервер ничего не знает. Каждый id читается по одному, без подъёма всех
 * кластеров (PRB-041).
 */

interface ClusterLike {
  readonly status: 'active' | 'archived';
  readonly salary?: { readonly from?: number; readonly to?: number; readonly currency?: string };
  readonly deadLink?: boolean;
  readonly linkStatus?: 'open' | 'gone' | 'unknown';
}

export interface SavedVacancyStateSource {
  getActiveCluster(clusterId: string): ClusterLike | undefined;
  isKnownVacancyGone(clusterId: string): boolean;
  getVacancy(id: string): { readonly archivedAt?: string } | undefined;
}

export interface SavedVacancyStateView {
  readonly closed: boolean;
  readonly closedAt?: string;
  readonly salary?: { readonly from?: number; readonly to?: number; readonly currency?: string };
}

export const SAVED_VACANCY_STATES_LIMIT = 100;

function closedState(source: SavedVacancyStateSource, clusterId: string): SavedVacancyStateView {
  const memberId = clusterId.startsWith('cluster-')
    ? clusterId.slice('cluster-'.length)
    : clusterId;
  const closedAt = memberId ? source.getVacancy(memberId)?.archivedAt : undefined;
  return closedAt ? { closed: true, closedAt } : { closed: true };
}

function stateFor(
  source: SavedVacancyStateSource,
  clusterId: string,
): SavedVacancyStateView | undefined {
  const cluster = source.getActiveCluster(clusterId);
  if (cluster) {
    if (cluster.deadLink || cluster.linkStatus === 'gone') return { closed: true };
    return cluster.salary ? { closed: false, salary: cluster.salary } : { closed: false };
  }
  return source.isKnownVacancyGone(clusterId) ? closedState(source, clusterId) : undefined;
}

export function savedVacancyStates(
  source: SavedVacancyStateSource,
  clusterIds: readonly string[],
): Record<string, SavedVacancyStateView> {
  const entries = [...new Set(clusterIds)].slice(0, SAVED_VACANCY_STATES_LIMIT).flatMap((id) => {
    const state = stateFor(source, id);
    return state ? [[id, state] as const] : [];
  });
  return Object.fromEntries(entries);
}
