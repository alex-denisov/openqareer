import type { UnifiedVacancy, VacancyCluster } from '../domain/unifiedVacancy';
import type { RouteDeps } from '../routes/deps';
import { clusterVacancies, createClusterFromVacancy, sourceMemberKey } from './vacancyDeduplicator';

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

/** Больше источников у кластера — заведомо ложная склейка: сверяем первые, запрос остаётся точечным. */
const MAX_MEMBERS = 100;

function memberRecords(
  engine: Engine,
  stored: VacancyCluster,
  own: UnifiedVacancy,
): UnifiedVacancy[] {
  return stored.sources.slice(0, MAX_MEMBERS).flatMap((source) => {
    const key = sourceMemberKey(source);
    if (!key || key === own.id) return [];
    const record = engine.getVacancy?.(key);
    return record?.status === 'active' ? [record] : [];
  });
}

/**
 * B765 (B645 23.11): карточка строки подборки. Строка `cluster-<запись>` — сама запись: подборка
 * собирает её из той же записи пула. Через ключ участника `getActiveCluster` отдавал склеенный
 * кластер другой вакансии (Arootah: 200–300 $/ч основателя вместо 275–425 $/ч строки).
 * B678: площадки строки — те участники склеенного кластера, которых с ней сводят правила
 * подборки: hh.ru у той же вакансии остаётся, чужие вакансии склейки отпадают.
 * Снятая запись — прежний порядок `resolvePoolVacancyCluster`.
 */
export function resolveRowVacancyCluster(engine: Engine, id: string): VacancyCluster | undefined {
  const resolved = resolvePoolVacancyCluster(engine, id);
  if (!resolved || !id.startsWith(ROW_PREFIX)) return resolved;
  if (resolved.id === id && resolved.sources.length <= 1) return resolved;
  const record = engine.getVacancy?.(id.slice(ROW_PREFIX.length));
  if (record?.status !== 'active') return resolved;
  const own = createClusterFromVacancy(record);
  if (own.id !== id) return resolved;
  const pieces = clusterVacancies([record, ...memberRecords(engine, resolved, record)]);
  if (resolved.id === id && pieces.length === 1) return resolved;
  const sources = pieces.find((piece) => piece.id === id)?.sources ?? own.sources;
  return { ...own, sources, vacanciesCount: sources.length };
}
