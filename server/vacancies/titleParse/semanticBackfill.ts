import type { DatabaseSync } from 'node:sqlite';
import { TAXONOMY_VERSION, type FunctionCode } from '../../../shared/roleTaxonomy';
import { MIGRATION_35 } from '../../data/sqliteSchema';
import { normalizeTitleKey } from './normalizeTitleKey';
import { rulesParse } from './rulesParse';

/**
 * Фоновое наполнение смыслового индекса правилами (B267 S2, план §4 фаза 1).
 *
 * Живёт в процессе обслуживания на его соединении: HTTP-процесс этот код не
 * вызывает. Обход идёт по первичному ключу `vacancy_pool_index` курсором в
 * памяти — без LIKE и без полного чтения пула; одна порция — одна короткая
 * транзакция. Название, которое правила не узнали, получает код `other`:
 * иначе строка без семантики выбиралась бы на каждом проходе заново.
 */

export interface SemanticBackfillReport {
  readonly scanned: number;
  readonly backfilled: number;
  readonly newKeys: number;
  readonly pruned: number;
  readonly passFinished: boolean;
  readonly relabeled: number;
}

interface PoolRow {
  id: string;
  published_ms: number | null;
  is_remote: number | null;
  title: string | null;
}

interface ParsedTitle {
  readonly functions: readonly FunctionCode[];
  readonly levelRank: number | null;
  readonly roleId?: string;
}

const PRUNE_CHUNK = 5_000;
/** Названий на переразбор за шаг: удаление строк индекса идёт по `title_key`. */
const RELABEL_CHUNK = 200;

export class SemanticBackfill {
  private readonly database: DatabaseSync;
  private cursor = '';
  /** Устаревших разборов не осталось — до рестарта таблицу больше не обходим. */
  private relabelDone = false;

  constructor(database: DatabaseSync) {
    this.database = database;
    this.database.exec(MIGRATION_35);
  }

  /**
   * Одна порция: окно из следующих `chunk` ключей индекса после курсора.
   * Цена шага — O(chunk) и в первом проходе, и когда почти всё уже размечено:
   * LIMIT по совпадениям на размеченном пуле обходил бы весь индекс за шаг.
   */
  step(chunk: number): SemanticBackfillReport {
    const relabeled = this.relabelStale(RELABEL_CHUNK);
    const windowEnd = this.windowEnd(chunk);
    const rows = this.readWindow(windowEnd);
    const { backfilled, newKeys } = this.writeChunk(rows);
    const passFinished = windowEnd === null;
    this.cursor = windowEnd ?? '';
    const pruned = passFinished ? this.pruneOrphans() : 0;
    return { scanned: rows.length, backfilled, newKeys, pruned, passFinished, relabeled };
  }

  /**
   * Смена словаря (`TAXONOMY_VERSION`): разбор правилами старой версии
   * пересчитывается, строки индекса по этому названию удаляются, и ближайший
   * проход наполнения вставляет их заново уже с новым разбором. Модельный
   * разбор не трогается — он главнее правил.
   */
  private relabelStale(limit: number): number {
    if (this.relabelDone) return 0;
    const stale = this.database
      .prepare(
        `SELECT title_key, sample_title FROM title_parse
         WHERE parsed_by = 'rules' AND taxonomy_version < ? LIMIT ?`,
      )
      .all(TAXONOMY_VERSION, limit) as { title_key: string; sample_title: string }[];
    if (stale.length === 0) {
      this.relabelDone = true;
      return 0;
    }
    const parsed = stale.map((row) => ({ ...row, parsed: rulesParseOrOther(row.sample_title) }));
    const update = this.database.prepare(
      `UPDATE title_parse SET functions = ?, level_rank = ?, taxonomy_version = ?, parsed_at = ?
       WHERE title_key = ? AND parsed_by = 'rules'`,
    );
    const drop = this.database.prepare('DELETE FROM vacancy_semantic WHERE title_key = ?');
    const now = Date.now();
    this.database.exec('BEGIN');
    try {
      for (const row of parsed) {
        update.run(
          JSON.stringify(row.parsed.functions),
          row.parsed.levelRank,
          TAXONOMY_VERSION,
          now,
          row.title_key,
        );
        drop.run(row.title_key);
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return stale.length;
  }

  /** Сколько названий уже в кеше — для журнала в конце прохода. */
  countKeys(): number {
    return (this.database.prepare('SELECT count(*) AS n FROM title_parse').get() as { n: number })
      .n;
  }

  /** Последний ключ окна; `null` — окно дошло до конца индекса. */
  private windowEnd(chunk: number): string | null {
    const row = this.database
      .prepare('SELECT id FROM vacancy_pool_index WHERE id > ? ORDER BY id LIMIT 1 OFFSET ?')
      .get(this.cursor, chunk - 1) as { id: string } | undefined;
    return row?.id ?? null;
  }

  private readWindow(windowEnd: string | null): PoolRow[] {
    // Два текста запроса, а не `? IS NULL OR id <= ?`: иначе планировщик не
    // берёт верхнюю границу в диапазон индекса и дочитывает его до конца.
    const upperBound = windowEnd === null ? '' : 'AND i.id <= ?';
    const params = windowEnd === null ? [this.cursor] : [this.cursor, windowEnd];
    return this.database
      .prepare(
        `SELECT i.id, i.published_ms, i.is_remote, json_extract(p.payload, '$.title') AS title
         FROM vacancy_pool_index i JOIN vacancy_pool p ON p.id = i.id
         WHERE i.id > ? ${upperBound} AND i.expired = 0
           AND NOT EXISTS (SELECT 1 FROM vacancy_semantic s WHERE s.id = i.id)
         ORDER BY i.id`,
      )
      .all(...params) as unknown as PoolRow[];
  }

  /**
   * Разбор (правила, чтение кеша) идёт до `BEGIN`: HTTP-процесс пишет в ту же
   * базу и ждёт блокировку синхронно, поэтому в транзакции остаются только
   * вставки — миллисекунды, а не сотни миллисекунд разбора.
   */
  private writeChunk(rows: readonly PoolRow[]): { backfilled: number; newKeys: number } {
    if (rows.length === 0) return { backfilled: 0, newKeys: 0 };
    const { resolved, newKeys } = this.resolveTitles(rows);
    const insertKey = this.database.prepare(
      `INSERT INTO title_parse
         (title_key, sample_title, functions, level_rank, role_label, parsed_by, model, taxonomy_version, priority, parsed_at)
       VALUES (?, ?, ?, ?, NULL, 'rules', NULL, ?, 0, ?)
       ON CONFLICT(title_key) DO NOTHING`,
    );
    const insertSemantic = this.database.prepare(
      `INSERT OR IGNORE INTO vacancy_semantic (id, function_code, level_rank, title_key, published_ms, is_remote)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const enqueueModel = this.database.prepare(
      `INSERT OR IGNORE INTO title_parse_model_queue (title_key, eligible, failures, frozen)
       VALUES (?, ?, 0, 0)`,
    );
    const now = Date.now();
    this.database.exec('BEGIN');
    try {
      for (const key of newKeys) {
        insertKey.run(
          key.titleKey,
          key.title,
          JSON.stringify(key.parsed.functions),
          key.parsed.levelRank,
          TAXONOMY_VERSION,
          now,
        );
        enqueueModel.run(key.titleKey, isUncertain(key.parsed) ? 1 : 0);
      }
      for (const { row, titleKey, parsed } of resolved) {
        for (const code of parsed.functions) {
          insertSemantic.run(
            row.id,
            code,
            parsed.levelRank,
            titleKey,
            row.published_ms,
            row.is_remote,
          );
        }
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    return { backfilled: rows.length, newKeys: newKeys.length };
  }

  /** Память порции → кеш `title_parse` (модельный разбор главнее правил) → правила. */
  private resolveTitles(rows: readonly PoolRow[]) {
    const readKey = this.database.prepare(
      'SELECT functions, level_rank FROM title_parse WHERE title_key = ?',
    );
    const known = new Map<string, ParsedTitle>();
    const newKeys: { titleKey: string; title: string; parsed: ParsedTitle }[] = [];
    const resolved = rows.map((row) => {
      const title = row.title?.trim() ?? '';
      const titleKey = normalizeTitleKey(title) || title.toLowerCase();
      let parsed = known.get(titleKey);
      if (!parsed) {
        const cached = readKey.get(titleKey) as
          { functions: string; level_rank: number | null } | undefined;
        parsed = cached
          ? {
              functions: JSON.parse(cached.functions) as FunctionCode[],
              levelRank: cached.level_rank,
            }
          : rulesParseOrOther(title);
        if (!cached) newKeys.push({ titleKey, title, parsed });
        known.set(titleKey, parsed);
      }
      return { row, titleKey, parsed };
    });
    return { resolved, newKeys };
  }

  /** Строки вакансий, ушедших из живого пула, — ограниченной порцией за проход. */
  private pruneOrphans(): number {
    return Number(
      this.database
        .prepare(
          `DELETE FROM vacancy_semantic WHERE rowid IN (
             SELECT s.rowid FROM vacancy_semantic s
             LEFT JOIN vacancy_pool_index i ON i.id = s.id
             WHERE i.id IS NULL OR i.expired = 1
             LIMIT ?)`,
        )
        .run(PRUNE_CHUNK).changes,
    );
  }
}

function isUncertain(parsed: ParsedTitle): boolean {
  return parsed.functions.includes('other') || parsed.functions.length === 2 || !parsed.roleId;
}

function rulesParseOrOther(title: string): ParsedTitle {
  const parsed = rulesParse(title);
  return parsed.functions.length > 0
    ? parsed
    : { functions: ['other'], levelRank: parsed.levelRank };
}
