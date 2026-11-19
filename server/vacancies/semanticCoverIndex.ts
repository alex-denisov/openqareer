/**
 * B725: покрывающий индекс смыслового подбора.
 *
 * Прод 19.11: каждая ветка подбора проверяла уровень и название по строке
 * `vacancy_semantic`, а индекс `vacancy_semantic_match` их не содержит. Для
 * функции `eng` это 227 тыс. случайных чтений таблицы, 397 МБ и 311 мс, а
 * весь запрос adenisov.test — 1,5 ГБ. С уровнем и названием в индексе та же
 * ветка на копии таблицы читает 23 МБ за 34 мс.
 *
 * Индекс на 2,7 млн строк строится ~6 с, поэтому не при старте
 * веб-процесса, где это съело бы окно здоровья выката, а один раз в
 * обслуживании. До постройки подбор идёт по прежнему индексу.
 */
import type { DatabaseSync } from 'node:sqlite';

export const SEMANTIC_COVER_INDEX = 'vacancy_semantic_match_cover';

const CREATE_SQL = `CREATE INDEX IF NOT EXISTS ${SEMANTIC_COVER_INDEX}
  ON vacancy_semantic(function_code, published_ms DESC, id, level_rank, title_key)`;

const FIRST_RUN_MS = 5 * 60_000;
const RETRY_MS = 30 * 60_000;

interface CoverIndexLog {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

export function hasSemanticCoverIndex(database: DatabaseSync): boolean {
  return (
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get(SEMANTIC_COVER_INDEX) !== undefined
  );
}

export function buildSemanticCoverIndex(database: DatabaseSync): void {
  database.exec(CREATE_SQL);
}

/** Один раз после старта обслуживания; сбой повторяется через полчаса. */
export function scheduleSemanticCoverIndex(database: DatabaseSync, log: CoverIndexLog): () => void {
  let timer: NodeJS.Timeout | undefined;
  const run = () => {
    try {
      if (hasSemanticCoverIndex(database)) return;
      const startedAt = Date.now();
      buildSemanticCoverIndex(database);
      log.info({ ms: Date.now() - startedAt }, 'semantic-cover-index-built');
    } catch (error: unknown) {
      log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'semantic-cover-index-failed',
      );
      timer = setTimeout(run, RETRY_MS);
      timer.unref();
    }
  };
  timer = setTimeout(run, FIRST_RUN_MS);
  timer.unref();
  return () => clearTimeout(timer);
}
