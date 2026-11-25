import { sourceMemberKey } from './vacancyDeduplicator';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';

/** Записи, которые сверка застала снятыми с площадки (B797). */
export type ClosedReader = () => ReadonlySet<string>;

/**
 * B797: снимок подборки живёт дольше, чем вакансия на площадке. Строка уходит, только когда сняты
 * все её записи; несверенные показываются, поэтому отказ площадки список не сжимает.
 */
export function withoutClosedRows(
  rows: readonly MatchedVacancyItem[],
  closed: ReadonlySet<string>,
): readonly MatchedVacancyItem[] {
  if (closed.size === 0) return rows;
  return rows.filter(
    ({ cluster }) =>
      !(cluster.sources.length > 1
        ? cluster.sources.every((source) => closed.has(sourceMemberKey(source) ?? ''))
        : closed.has(cluster.id.replace(/^cluster-/u, ''))),
  );
}
