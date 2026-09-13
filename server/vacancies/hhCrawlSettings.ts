import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATION_30 } from '../data/sqliteSchema';
import { DEFAULT_SELECTED_ROLE_IDS, keepKnownRoleIds } from './hhRoleCatalog';

/**
 * Настройки веера обхода hh.ru: какие роли собирать и за какой срок (B214).
 *
 * ЭТО НАСТРОЙКА ВЛАДЕЛЬЦА. Он выбирает роли множественным выбором и может
 * расширить набор в любой момент; по умолчанию собирается категория
 * «Информационные технологии» — те самые 25 ролей, которые он назвал.
 *
 * Отметка последнего полного прохода лежит здесь же: без неё каждый выкат
 * начинал бы глубокий обход заново, и площадка видела бы всплеск обращений на
 * каждый деплой.
 */

/** Дальше этого срока площадка всё равно не отдаёт, а ближе одного дня смысла нет. */
const MIN_PERIOD_DAYS = 1;
const MAX_PERIOD_DAYS = 30;

export interface HhCrawlSettingsValue {
  readonly roleIds: readonly string[];
  readonly searchPeriodDays: number;
  readonly lastFullSweepAt?: string;
}

export interface HhCrawlSettingsStore {
  read(): HhCrawlSettingsValue;
  saveRoles(roleIds: readonly string[], searchPeriodDays: number): void;
  markFullSweep(atIso: string): void;
}

export class SqliteHhCrawlSettings implements HhCrawlSettingsStore {
  constructor(private readonly database: DatabaseSync) {}

  public read(): HhCrawlSettingsValue {
    const row = this.database
      .prepare(
        'SELECT role_ids, search_period_days, last_full_sweep_at FROM hh_crawl_settings WHERE id = 1',
      )
      .get() as
      | { role_ids: string; search_period_days: number; last_full_sweep_at: string | null }
      | undefined;

    if (!row) {
      return { roleIds: [...DEFAULT_SELECTED_ROLE_IDS], searchPeriodDays: MAX_PERIOD_DAYS };
    }

    // Список чистится и на чтении: роль могла исчезнуть из справочника площадки
    // после того, как владелец её выбрал, и обход не должен спрашивать пустоту.
    const stored = keepKnownRoleIds(safeParseRoles(row.role_ids));
    return {
      roleIds: stored.length > 0 ? stored : [...DEFAULT_SELECTED_ROLE_IDS],
      searchPeriodDays: row.search_period_days,
      ...(row.last_full_sweep_at ? { lastFullSweepAt: row.last_full_sweep_at } : {}),
    };
  }

  public saveRoles(roleIds: readonly string[], searchPeriodDays: number): void {
    const known = keepKnownRoleIds(roleIds);
    // Пустой набор — это не «собирать всё», а «не собирать ничего». Принимать
    // его молча значит тихо выключить обход настройкой, которая выглядит как
    // сужение фильтра.
    if (known.length === 0) {
      throw new Error('hh_crawl_roles_empty');
    }
    if (
      !Number.isInteger(searchPeriodDays) ||
      searchPeriodDays < MIN_PERIOD_DAYS ||
      searchPeriodDays > MAX_PERIOD_DAYS
    ) {
      throw new Error('hh_crawl_period_out_of_range');
    }

    this.database
      .prepare(
        `INSERT INTO hh_crawl_settings (id, role_ids, search_period_days, updated_at)
         VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           role_ids = excluded.role_ids,
           search_period_days = excluded.search_period_days,
           updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify(known), searchPeriodDays, new Date().toISOString());
  }

  public markFullSweep(atIso: string): void {
    const current = this.read();
    this.database
      .prepare(
        `INSERT INTO hh_crawl_settings (id, role_ids, search_period_days, last_full_sweep_at, updated_at)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           last_full_sweep_at = excluded.last_full_sweep_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        JSON.stringify(current.roleIds),
        current.searchPeriodDays,
        atIso,
        new Date().toISOString(),
      );
  }
}

function safeParseRoles(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Открывает собственное соединение и применяет свою миграцию — тем же приёмом,
 * что хранилище пула вакансий. Таблица создаётся идемпотентно, поэтому порядок
 * относительно общего применителя миграций значения не имеет.
 */
export function createHhCrawlSettings(options: { databasePath: string }): SqliteHhCrawlSettings {
  if (options.databasePath !== ':memory:') {
    mkdirSync(dirname(options.databasePath), { recursive: true });
  }
  const database = new DatabaseSync(options.databasePath);
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec(MIGRATION_30);
  return new SqliteHhCrawlSettings(database);
}
