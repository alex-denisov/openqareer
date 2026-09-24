import type { DatabaseSync } from 'node:sqlite';

const VISIT_DEBOUNCE_MS = 30 * 60 * 1000;

interface VisitRow {
  last_visited_at: string | null;
}

export interface RecordVisitResult {
  /** Отметка предыдущего визита; `null` — визитов ещё не было. */
  readonly since: string | null;
}

/**
 * `POST /visits` (B251, S4, architecture.md §4). Отметку визита сдвигаем,
 * только если с прошлой прошло больше 30 минут — иначе каждая перезагрузка
 * страницы обнуляла бы «с прошлого визита».
 */
export class SqliteCandidateVisitRepository {
  constructor(private readonly database: DatabaseSync) {}

  recordVisit(candidateId: string, now: string): RecordVisitResult {
    const row = this.database
      .prepare('SELECT last_visited_at FROM candidate_visits WHERE candidate_id = ?')
      .get(candidateId) as unknown as VisitRow | undefined;

    if (!row || row.last_visited_at === null) {
      this.database
        .prepare(
          `INSERT INTO candidate_visits (candidate_id, last_visited_at, previous_visited_at)
           VALUES (?, ?, NULL)
           ON CONFLICT (candidate_id) DO UPDATE SET last_visited_at = excluded.last_visited_at`,
        )
        .run(candidateId, now);
      return { since: null };
    }

    const elapsedMs = Date.parse(now) - Date.parse(row.last_visited_at);
    if (elapsedMs >= VISIT_DEBOUNCE_MS) {
      this.database
        .prepare(
          `UPDATE candidate_visits SET previous_visited_at = last_visited_at, last_visited_at = ?
           WHERE candidate_id = ?`,
        )
        .run(now, candidateId);
    }

    return { since: row.last_visited_at };
  }

  getSinceLastVisit(candidateId: string): string | null {
    const row = this.database
      .prepare('SELECT last_visited_at FROM candidate_visits WHERE candidate_id = ?')
      .get(candidateId) as unknown as VisitRow | undefined;
    return row?.last_visited_at ?? null;
  }
}
