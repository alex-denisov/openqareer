import type { CandidateConnection } from '../../coach/coachApi';

const DAY = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' });

/** p04b: день последнего чтения площадки «12.11»; `undefined` — не читали, `null` — дата не читается. */
export function importedDay(
  connections: readonly CandidateConnection[],
  platform: CandidateConnection['platform'],
): string | null | undefined {
  const connection = connections.find((item) => item.platform === platform);
  if (!connection || connection.status === 'disconnected') return undefined;
  const iso = connection.status === 'connected' ? connection.lastImportedAt : connection.importedAt;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : DAY.format(date);
}
