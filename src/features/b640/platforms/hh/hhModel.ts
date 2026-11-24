import type { CandidateConnection } from '../../../coach/coachApi';
import type { HhResumeSnapshot } from '../../../../../shared/hhCandidateSession';
import { formatDay, formatWhen } from '../format';

export interface HhUsage {
  readonly hhBoostsCount: number;
  readonly lastHhBoostAt: string | null;
}

export interface HhStat {
  readonly id: string;
  readonly label: string;
  readonly value: string;
}

export type HhView =
  | { readonly kind: 'off' }
  | { readonly kind: 'on'; readonly stats: readonly HhStat[] };

function importedAt(connection: CandidateConnection): string | null {
  if (connection.status === 'connected') return connection.lastImportedAt;
  if (connection.status === 'imported') return connection.importedAt;
  return null;
}

/** B704: последнее чтение данных резюме — импорт в профиль или снимок резюме для откликов. */
function lastReadAt(connection: CandidateConnection, snapshot: HhResumeSnapshot | null): string | null {
  const imported = importedAt(connection);
  const read = snapshot?.selected ? snapshot.readAt : null;
  if (!imported || !read) return imported ?? read;
  return Date.parse(read) > Date.parse(imported) ? read : imported;
}

/** Цифры экрана hh.ru только из того, что отдаёт сервер: без выдуманных нулей. */
export function buildHhView(
  connections: readonly CandidateConnection[],
  usage: HhUsage | null,
  snapshot: HhResumeSnapshot | null = null,
): HhView {
  const hh = connections.find((item) => item.platform === 'hh');
  if (!hh || hh.status === 'disconnected') return { kind: 'off' };
  const stats: HhStat[] = [];
  const lastBoost = formatWhen(usage?.lastHhBoostAt);
  if (lastBoost) stats.push({ id: 'last', label: 'Последнее поднятие', value: lastBoost });
  if (usage) stats.push({ id: 'today', label: 'Поднятий сегодня', value: String(usage.hhBoostsCount) });
  const loaded = formatDay(lastReadAt(hh, snapshot));
  if (loaded) stats.push({ id: 'loaded', label: 'Данные из резюме обновлены', value: loaded });
  return { kind: 'on', stats };
}
