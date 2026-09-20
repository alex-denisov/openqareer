import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATION_30, MIGRATION_31 } from '../data/sqliteSchema';
import { DEFAULT_SELECTED_ROLE_IDS, keepKnownRoleIds } from './hhRoleCatalog';
import type { HhCrawlPlan } from './hhCrawlPlan';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';

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

/**
 * Где остановился глубокий проход (B219). План лежит вместе с курсором:
 * после перезапуска замеры размера частей не повторяются, а индекс части и
 * страница называют место, с которого читать дальше.
 */
export interface HhCrawlProgress {
  /** Замеры ещё идут (`planning`) или план готов и читаются страницы. */
  readonly phase: 'planning' | 'reading';
  /** По какому набору и сроку строился план: сменились — прогресс негоден. */
  readonly roleIds: readonly string[];
  readonly searchPeriodDays: number;
  /** В фазе замеров — части, собранные по уже замеренным ролям. */
  readonly plan: HhCrawlPlan;
  readonly startedAt: string;
  /** Следующая роль для замера (фаза `planning`). */
  readonly roleIndex: number;
  readonly queryIndex: number;
  readonly page: number;
  readonly pagesRead: number;
  /** Страницы, не прочитанные за весь проход: при ненулевом снятие невиденного не делается. */
  readonly errors: number;
}

/**
 * Готовый план прошлого прохода. Замеры стоят часы (11 часов на 133 ролях,
 * прод 2026-09-15), а размеры ролей день ото дня почти не меняются, поэтому
 * следующий проход берёт структуру дробления отсюда и не замеряет заново.
 */
export interface HhCrawlPlanCache {
  readonly roleIds: readonly string[];
  readonly searchPeriodDays: number;
  readonly plan: HhCrawlPlan;
  readonly plannedAt: string;
}

export interface HhCrawlSettingsStore {
  read(): HhCrawlSettingsValue;
  saveRoles(roleIds: readonly string[], searchPeriodDays: number): void;
  markFullSweep(atIso: string): void;
  /** Снимает отметку: следующий проход будет глубоким. */
  requestFullSweep(): void;
  readProgress(): HhCrawlProgress | undefined;
  saveProgress(progress: HhCrawlProgress): void;
  /** Двигает только курсор: план не переписывается на каждой странице. */
  saveCursor(cursor: { queryIndex: number; page: number }, pagesRead: number, errors: number): void;
  clearProgress(): void;
  readPlanCache(): HhCrawlPlanCache | undefined;
  savePlanCache(cache: HhCrawlPlanCache): void;
}

export class SqliteHhCrawlSettings implements HhCrawlSettingsStore {
  constructor(private readonly database: DatabaseSync) {}

  /** Обслуживатель закрывает свои соединения на SIGTERM (B230). */
  close(): void {
    this.database.close();
  }

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

    // Отметка глубокого прохода снимается вместе с изменением набора: роль,
    // которую владелец только что добавил, обход обязан увидеть сейчас, а не
    // через двадцать часов. Фильтр без этого выглядел бы сломанным.
    this.database
      .prepare(
        `INSERT INTO hh_crawl_settings (id, role_ids, search_period_days, last_full_sweep_at, updated_at)
         VALUES (1, ?, ?, NULL, ?)
         ON CONFLICT(id) DO UPDATE SET
           role_ids = excluded.role_ids,
           search_period_days = excluded.search_period_days,
           last_full_sweep_at = NULL,
           updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify(known), searchPeriodDays, new Date().toISOString());
    // План прохода строился по прежнему набору ролей: продолжать его значит
    // дочитывать роли, которых владелец больше не просил, и не видеть новых.
    this.clearProgress();
  }

  public requestFullSweep(): void {
    const current = this.read();
    this.database
      .prepare(
        `INSERT INTO hh_crawl_settings (id, role_ids, search_period_days, last_full_sweep_at, updated_at)
         VALUES (1, ?, ?, NULL, ?)
         ON CONFLICT(id) DO UPDATE SET
           last_full_sweep_at = NULL,
           updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify(current.roleIds), current.searchPeriodDays, new Date().toISOString());
    this.clearProgress();
  }

  public readProgress(): HhCrawlProgress | undefined {
    const row = this.database
      .prepare(
        `SELECT phase, role_ids, search_period_days, plan_json, started_at, role_index,
                query_index, page, pages_read, errors
         FROM hh_crawl_progress WHERE id = 1`,
      )
      .get() as
      | {
          phase: string;
          role_ids: string;
          search_period_days: number;
          plan_json: string;
          started_at: string;
          role_index: number;
          query_index: number;
          page: number;
          pages_read: number;
          errors: number;
        }
      | undefined;
    if (!row) return undefined;

    const plan = safeParsePlan(row.plan_json);
    // Нечитаемый план — это отсутствие курсора: проход начнётся заново, а не
    // упадёт на каждом тике из-за одной испорченной строки.
    if (!plan) return undefined;
    if (row.phase !== 'planning' && row.phase !== 'reading') return undefined;
    return {
      phase: row.phase,
      roleIds: safeParseRoles(row.role_ids),
      searchPeriodDays: row.search_period_days,
      plan,
      startedAt: row.started_at,
      roleIndex: row.role_index,
      queryIndex: row.query_index,
      page: row.page,
      pagesRead: row.pages_read,
      errors: row.errors,
    };
  }

  public saveProgress(progress: HhCrawlProgress): void {
    this.database
      .prepare(
        `INSERT INTO hh_crawl_progress
           (id, phase, role_ids, search_period_days, plan_json, started_at, role_index,
            query_index, page, pages_read, errors, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           phase = excluded.phase,
           role_ids = excluded.role_ids,
           search_period_days = excluded.search_period_days,
           plan_json = excluded.plan_json,
           started_at = excluded.started_at,
           role_index = excluded.role_index,
           query_index = excluded.query_index,
           page = excluded.page,
           pages_read = excluded.pages_read,
           errors = excluded.errors,
           updated_at = excluded.updated_at`,
      )
      .run(
        progress.phase,
        JSON.stringify(progress.roleIds),
        progress.searchPeriodDays,
        JSON.stringify(progress.plan),
        progress.startedAt,
        progress.roleIndex,
        progress.queryIndex,
        progress.page,
        progress.pagesRead,
        progress.errors,
        new Date().toISOString(),
      );
  }

  public saveCursor(
    cursor: { queryIndex: number; page: number },
    pagesRead: number,
    errors: number,
  ): void {
    this.database
      .prepare(
        `UPDATE hh_crawl_progress
         SET query_index = ?, page = ?, pages_read = ?, errors = ?, updated_at = ?
         WHERE id = 1`,
      )
      .run(cursor.queryIndex, cursor.page, pagesRead, errors, new Date().toISOString());
  }

  public clearProgress(): void {
    this.database.prepare('DELETE FROM hh_crawl_progress WHERE id = 1').run();
  }

  public readPlanCache(): HhCrawlPlanCache | undefined {
    const row = this.database
      .prepare(
        'SELECT role_ids, search_period_days, plan_json, planned_at FROM hh_crawl_plan_cache WHERE id = 1',
      )
      .get() as
      | { role_ids: string; search_period_days: number; plan_json: string; planned_at: string }
      | undefined;
    if (!row) return undefined;
    const plan = safeParsePlan(row.plan_json);
    if (!plan) return undefined;
    return {
      roleIds: safeParseRoles(row.role_ids),
      searchPeriodDays: row.search_period_days,
      plan,
      plannedAt: row.planned_at,
    };
  }

  public savePlanCache(cache: HhCrawlPlanCache): void {
    this.database
      .prepare(
        `INSERT INTO hh_crawl_plan_cache (id, role_ids, search_period_days, plan_json, planned_at)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           role_ids = excluded.role_ids,
           search_period_days = excluded.search_period_days,
           plan_json = excluded.plan_json,
           planned_at = excluded.planned_at`,
      )
      .run(
        JSON.stringify(cache.roleIds),
        cache.searchPeriodDays,
        JSON.stringify(cache.plan),
        cache.plannedAt,
      );
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

function safeParsePlan(raw: string): HhCrawlPlan | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const plan = parsed as Partial<HhCrawlPlan>;
    if (!Array.isArray(plan.queries)) return undefined;
    return plan as HhCrawlPlan;
  } catch {
    return undefined;
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
  applySqliteBusyTimeout(database);
  database.exec(MIGRATION_30);
  database.exec(MIGRATION_31);
  return new SqliteHhCrawlSettings(database);
}
