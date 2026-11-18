import type { VacancyCluster } from '../domain/unifiedVacancy';
import type { RouteDeps } from '../routes/deps';
import { createClusterFromVacancy } from './vacancyDeduplicator';

type Engine = Pick<RouteDeps['multiSourceEngine'], 'getActiveCluster' | 'getVacancy'>;

const ROW_PREFIX = 'cluster-';

/**
 * B707: кластер вакансии по id строки подборки (`cluster-<запись>`) или по id записи пула
 * (`src-hh-search:<n>` из ссылки hh.ru) — для одобрения письма, резюме под вакансию и «Своей
 * вакансии». Порядок:
 * 1. активный кластер по id как есть;
 * 2. по id строки `cluster-<запись>` — это включает ключ `member`, если кластер склеен вокруг
 *    другого основателя (B247 S5);
 * 3. сохранённого активного кластера нет — кластер из той же живой записи пула, как его
 *    собирает подборка на запросе (по ней же пишется письмо).
 * Снятая или неизвестная запись даёт `undefined`: вызывающий отвечает 410 или 404, как раньше.
 */
export function resolvePoolVacancyCluster(engine: Engine, id: string): VacancyCluster | undefined {
  const direct = engine.getActiveCluster(id);
  if (direct) return direct;
  const recordId = id.startsWith(ROW_PREFIX) ? id.slice(ROW_PREFIX.length) : id;
  if (!recordId) return undefined;
  const rowId = ROW_PREFIX + recordId;
  const byRow = rowId === id ? undefined : engine.getActiveCluster(rowId);
  if (byRow) return byRow;
  const record = engine.getVacancy?.(recordId);
  if (record?.status !== 'active') return undefined;
  const cluster = createClusterFromVacancy(record);
  return cluster.id === rowId ? cluster : undefined;
}
