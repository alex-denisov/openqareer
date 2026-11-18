import type { VacancyCluster } from '../domain/unifiedVacancy';
import { createClusterFromVacancy } from '../vacancies/vacancyDeduplicator';
import type { RouteDeps } from './deps';

type Engine = Pick<RouteDeps['multiSourceEngine'], 'getActiveCluster' | 'getVacancy'>;

/**
 * B707: кластер вакансии для одобрения письма и резюме под неё. Сначала — активный кластер
 * (прямой id или ключ `member`). Строка подборки носит id `cluster-<запись>` кластера,
 * собранного на запросе; если сохранённого активного кластера для записи нет, кластер
 * собирается из той же живой записи пула, по которой письмо и написано. Снятая запись пула
 * сюда не попадает: вызывающий отвечает 410.
 */
export function resolveLetterCluster(engine: Engine, vacancyId: string): VacancyCluster | undefined {
  const active = engine.getActiveCluster(vacancyId);
  if (active) return active;
  if (!vacancyId.startsWith('cluster-')) return undefined;
  const record = engine.getVacancy?.(vacancyId.slice('cluster-'.length));
  if (record?.status !== 'active') return undefined;
  const cluster = createClusterFromVacancy(record);
  return cluster.id === vacancyId ? cluster : undefined;
}
