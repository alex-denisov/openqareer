import { sourceKind } from './poolLiveness';

/**
 * Доска ATS работодателя — по роду источника из `sourceKind` (B642): `ats-*` и
 * `src-fh-<провайдер>-*` (доски, найденные через репозиторий freehire) — одно
 * и то же. Старый префикс `ats_` сведение дублей знало раньше.
 */
export function isAtsBoardSourceId(sourceId: string): boolean {
  return sourceId.startsWith('ats_') || sourceKind(sourceId).kind === 'ats';
}
