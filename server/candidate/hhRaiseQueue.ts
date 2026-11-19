import { DatabaseSync } from 'node:sqlite';
import { cabinetB640Enabled, type CabinetB640Config } from '../auth/cabinetB640Access';
import type { SqliteHhRaiseRepository } from './sqliteHhRaiseRepository';

/** Сколько ждать исхода взятого клиентом задания, прежде чем считать его брошенным. */
export const STALE_RUNNING_MS = 15 * 60_000;

/**
 * B699: планировщик только ставит задание в очередь кандидата; ничего не исполняет и в hh не ходит.
 * Исполняет клиент в окне сессии кандидата (claim → result). Берёт только кандидатов с флагом B640.
 */
export function queueDueRaises(
  repository: SqliteHhRaiseRepository,
  now: Date,
  isFlagged: (candidateId: string) => boolean,
  limit = 50,
): number {
  repository.releaseStale(new Date(now.getTime() - STALE_RUNNING_MS).toISOString(), now.toISOString());
  let queued = 0;
  for (const row of repository.listDue(now.toISOString(), limit)) {
    if (!isFlagged(row.candidateId)) continue;
    repository.enqueue(row.candidateId, row.resumeId, now.toISOString());
    queued += 1;
  }
  return queued;
}

/** Флаг кабинета по кандидату: имя входа читается из таблицы пользователей на каждый вызов. */
export function candidateFlagLookup(
  database: DatabaseSync,
  config: CabinetB640Config,
): (candidateId: string) => boolean {
  const statement = database.prepare("SELECT username FROM users WHERE candidate_id = ? AND role = 'candidate'");
  return (candidateId) => {
    const row = statement.get(candidateId) as { username: string } | undefined;
    return cabinetB640Enabled(config, row?.username);
  };
}
