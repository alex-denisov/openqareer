import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { FunctionCode } from '../../../shared/roleTaxonomy';
import { MIGRATION_35 } from '../../data/sqliteSchema';
import { applySqliteBusyTimeout } from '../../data/sqliteBusyTimeout';

export type TitleParsedBy = 'model' | 'rules';

export interface TitleParseEntry {
  readonly titleKey: string;
  readonly sampleTitle: string;
  readonly functions: readonly FunctionCode[];
  readonly levelRank: number | null;
  readonly roleLabel: string | null;
  readonly parsedBy: TitleParsedBy;
  readonly model: string | null;
  readonly taxonomyVersion: number;
  readonly priority: number;
}

export interface StoredTitleParse extends TitleParseEntry {
  readonly parsedAt: number;
}

interface TitleParseRow {
  title_key: string;
  sample_title: string;
  functions: string;
  level_rank: number | null;
  role_label: string | null;
  parsed_by: TitleParsedBy;
  model: string | null;
  taxonomy_version: number;
  priority: number;
  parsed_at: number;
}

function toStoredEntry(row: TitleParseRow): StoredTitleParse {
  return {
    titleKey: row.title_key,
    sampleTitle: row.sample_title,
    functions: JSON.parse(row.functions) as FunctionCode[],
    levelRank: row.level_rank,
    roleLabel: row.role_label,
    parsedBy: row.parsed_by,
    model: row.model,
    taxonomyVersion: row.taxonomy_version,
    priority: row.priority,
    parsedAt: row.parsed_at,
  };
}

/**
 * Кеш разбора названия, одна строка на `title_key` (B267 §2, §4).
 *
 * `insertIfMissing` намеренно не перезаписывает существующую строку: правила
 * наполняют таблицу первыми (шаг 1 воркера), модель уточняет её позже (шаг
 * 2) — если бы наполнение перетирало модельный разбор при каждом тике,
 * пересчёт `vacancy_semantic` тёк бы по кругу без выигрыша в точности.
 * Обновление модельным результатом — задача среза S4, здесь его ещё нет.
 */
export class SqliteTitleParseStore {
  private readonly database: DatabaseSync;

  constructor(options: { databasePath: string }) {
    if (options.databasePath !== ':memory:') {
      mkdirSync(dirname(options.databasePath), { recursive: true });
    }
    this.database = new DatabaseSync(options.databasePath);
    this.database.exec('PRAGMA journal_mode = WAL;');
    applySqliteBusyTimeout(this.database);
    this.database.exec(MIGRATION_35);
  }

  insertIfMissing(entry: TitleParseEntry): void {
    this.database
      .prepare(
        `INSERT INTO title_parse
          (title_key, sample_title, functions, level_rank, role_label, parsed_by, model, taxonomy_version, priority, parsed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(title_key) DO NOTHING`,
      )
      .run(
        entry.titleKey,
        entry.sampleTitle,
        JSON.stringify(entry.functions),
        entry.levelRank,
        entry.roleLabel,
        entry.parsedBy,
        entry.model,
        entry.taxonomyVersion,
        entry.priority,
        Date.now(),
      );
  }

  getByKey(titleKey: string): StoredTitleParse | undefined {
    const row = this.database
      .prepare('SELECT * FROM title_parse WHERE title_key = ?')
      .get(titleKey) as TitleParseRow | undefined;
    return row ? toStoredEntry(row) : undefined;
  }

  close(): void {
    this.database.close();
  }
}
