import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { adoptBoardCompany, topCompanyName } from './directoryFromBoards';
import { PLACEMENT_TABLES } from './placementSchema';
import type { DirectoryRow, LinkageIndex } from './placementLinkage';
import { PLACEMENT_PRIORITY, placementOf, type Placement } from './placementModel';

/**
 * B643-3 — размещения из реестра площадок и справочника. Проход строит список
 * работы один раз (несколько тысяч площадок и ~26 тыс. компаний), затем пишет
 * его порциями: одна порция — одна короткая транзакция, между порциями цикл
 * событий свободен. Повторный проход ничего не меняет.
 */

export interface PlacementBackfillReport {
  readonly done: boolean;
  readonly processed: number;
  readonly changed: number;
  readonly changedTotal: number;
  readonly duplicateSources: number;
  readonly adoptedCompanies: number;
  readonly ms: number;
}

interface Options {
  readonly chunk?: number;
  readonly now?: () => number;
}

type Work = Placement & { readonly discoveredBy: 'source' | 'directory'; readonly url: string | null };

const DEFAULT_CHUNK = 200;
const SOURCE_INDEX_TTL_MS = 60 * 60_000;
/** Имена компаний читаются до транзакции и не дольше 150 мс на порцию. */
const ADOPT_LOOKUP_BUDGET_MS = 150;

interface DirectoryRecord extends DirectoryRow {
  readonly careersUrl: string | null;
}

function siteHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

function directoryWork(row: DirectoryRecord): Work[] {
  const work: Work[] = [];
  if (row.atsProvider && row.atsSlug) {
    const slug = row.atsSlug.toLowerCase();
    work.push({
      placementId: `ats:${row.atsProvider}:${slug}`, companyKey: row.companyKey, type: 'ats',
      provider: row.atsProvider, slug, priority: PLACEMENT_PRIORITY.ats, sourceId: '', discoveredBy: 'directory', url: null,
    });
  }
  const url = row.careersUrl ?? row.websiteUrl;
  const host = siteHost(url);
  if (host) {
    work.push({
      placementId: `site:${host}`, companyKey: row.companyKey, type: 'employer_site', provider: null,
      slug: null, priority: PLACEMENT_PRIORITY.employer_site, sourceId: '', discoveredBy: 'directory', url,
    });
  }
  return work;
}

export class PlacementBackfill {
  private readonly chunk: number;
  private readonly now: () => number;
  private sources: { index: LinkageIndex; ids: readonly string[]; builtAt: number } | undefined;
  private cursor = 0;
  private directoryCursor = '';
  private directoryDone = false;
  private readonly directoryPage: StatementSync;
  private changedTotal = 0;
  private duplicateSources = 0;
  private adopted = 0;
  private names = new Map<string, string | null>();
  private readonly sourceOf: StatementSync;
  private readonly companyOfSource: StatementSync;
  private readonly dropMoved: StatementSync;
  private readonly upsert: StatementSync;

  constructor(private readonly database: DatabaseSync, options: Options = {}) {
    this.chunk = options.chunk ?? DEFAULT_CHUNK;
    this.now = options.now ?? Date.now;
    // Обслуживатель может стартовать раньше API, создающего таблицы пула.
    database.exec(PLACEMENT_TABLES);
    this.directoryPage = database.prepare(`SELECT company_key AS companyKey, company_name AS companyName,
        website_url AS websiteUrl, careers_url AS careersUrl, ats_provider AS atsProvider, ats_slug AS atsSlug
      FROM company_directory
      WHERE company_key > ? AND (ats_provider IS NOT NULL OR careers_url IS NOT NULL OR website_url IS NOT NULL)
      ORDER BY company_key LIMIT ?`);
    this.sourceOf = database.prepare('SELECT source_id AS sourceId FROM company_placement WHERE placement_id = ?');
    this.companyOfSource = database.prepare('SELECT company_key AS companyKey FROM company_placement WHERE source_id = ?');
    this.dropMoved = database.prepare('DELETE FROM company_placement WHERE source_id = ? AND placement_id <> ?');
    this.upsert = database.prepare(`INSERT INTO company_placement
        (placement_id, company_key, type, provider, slug, url, priority, source_id, discovered_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(placement_id) DO UPDATE SET
        company_key = COALESCE(company_key, excluded.company_key),
        source_id = COALESCE(source_id, excluded.source_id),
        updated_at = excluded.updated_at
      WHERE (company_key IS NULL AND excluded.company_key IS NOT NULL)
         OR (source_id IS NULL AND excluded.source_id IS NOT NULL)`);
  }

  /**
   * Площадки — список целиком (их тысячи); справочник (до ~165 тыс. строк после
   * B644) — порциями по курсору ключа и только строки с доской или сайтом.
   * Связь площадки с компанией — точечными запросами, без загрузки справочника.
   */
  private buildSourceIndex(): { index: LinkageIndex; ids: readonly string[]; builtAt: number } {
    const hasKey = this.database.prepare('SELECT 1 AS hit FROM company_directory WHERE company_key = ?');
    // B649-4 13.11: все доски справочника в Map держали такт до 7 с; теперь точечно по индексу.
    // Последняя по rowid строка выигрывает, как раньше в Map.
    const boardOf = this.database.prepare(`SELECT company_key AS k FROM company_directory
        WHERE ats_provider = ? AND ats_slug = ? COLLATE NOCASE ORDER BY rowid DESC LIMIT 1`);
    const boards = {
      get: (key: string): string | undefined => {
        const at = key.indexOf(':');
        if (at <= 0) return undefined;
        const row = boardOf.get(key.slice(0, at), key.slice(at + 1)) as { k: string } | undefined;
        return row?.k;
      },
    };
    const index: LinkageIndex = { byKey: { has: (key) => hasKey.get(key) !== undefined }, byBoard: boards, byName: new Map() };
    const ids = (this.database.prepare('SELECT source_id AS id FROM vacancy_source_state ORDER BY source_id')
      .all() as unknown as { id: string }[]).map(({ id }) => id);
    return { index, ids, builtAt: this.now() };
  }

  private nextDirectoryWork(): readonly Work[] {
    const rows = this.directoryPage.all(this.directoryCursor, this.chunk) as unknown as DirectoryRecord[];
    if (rows.length === 0) return [];
    this.directoryCursor = rows[rows.length - 1]!.companyKey;
    return rows.flatMap(directoryWork);
  }

  /** Следующая порция работы: сначала площадки, затем страницы справочника. */
  private nextSlice(): readonly Work[] | undefined {
    // Карта досок и список площадок живут час: короткие повторы прохода их не перечитывают.
    if (!this.sources || this.now() - this.sources.builtAt > SOURCE_INDEX_TTL_MS) this.sources = this.buildSourceIndex();
    const { index, ids } = this.sources;
    if (this.cursor < ids.length) {
      const slice = ids.slice(this.cursor, this.cursor + this.chunk);
      this.cursor += slice.length;
      return slice.map((id) => ({ ...placementOf(id, index), discoveredBy: 'source' as const, url: null }));
    }
    if (this.directoryDone) return undefined;
    const slice = this.nextDirectoryWork();
    if (slice.length === 0) this.directoryDone = true;
    return slice;
  }

  /** Одна порция; `done` — проход закончен, следующий вызов начнёт новый. */
  step(): PlacementBackfillReport {
    const startedAt = this.now();
    const slice = this.nextSlice() ?? [];
    let changed = 0;
    this.names = this.lookupNames(slice);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const item of slice) changed += this.write(item);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    this.changedTotal += changed;
    const done = this.directoryDone;
    const report = { done, processed: slice.length, changed, changedTotal: this.changedTotal,
      duplicateSources: this.duplicateSources, adoptedCompanies: this.adopted, ms: this.now() - startedAt };
    if (done) this.reset();
    return report;
  }

  private write(work: Work): number {
    const item = this.withAdoptedCompany(work);
    const sourceId = item.sourceId || null;
    let changed = 0;
    if (sourceId) {
      const existing = this.sourceOf.get(item.placementId) as { sourceId: string | null } | undefined;
      if (existing?.sourceId && existing.sourceId !== sourceId) {
        this.duplicateSources += 1;
        return 0;
      }
      changed += Number(this.dropMoved.run(sourceId, item.placementId).changes);
    }
    changed += Number(this.upsert.run(item.placementId, item.companyKey, item.type, item.provider, item.slug,
      item.url, item.priority, sourceId, item.discoveredBy, this.now()).changes);
    return changed;
  }

  private needsCompany(item: Work): boolean {
    return item.discoveredBy === 'source' && !item.companyKey && (item.type === 'ats' || item.type === 'employer_site');
  }

  /** Компания, уже заведённая для этой доски прошлым проходом. */
  private knownCompany(sourceId: string): string | null {
    const row = this.companyOfSource.get(sourceId) as { companyKey: string | null } | undefined;
    return row?.companyKey ?? null;
  }

  /** Чтение вне транзакции: запись не держит блокировку, пока ищутся имена. */
  private lookupNames(slice: readonly Work[]): Map<string, string | null> {
    const startedAt = this.now();
    const names = new Map<string, string | null>();
    for (const item of slice) {
      if (this.now() - startedAt >= ADOPT_LOOKUP_BUDGET_MS) break;
      if (this.needsCompany(item) && !this.knownCompany(item.sourceId)) names.set(item.sourceId, topCompanyName(this.database, item.sourceId));
    }
    return names;
  }

  /** Доска работодателя вне справочника заводит свою компанию (B643). */
  private withAdoptedCompany(item: Work): Work {
    if (!this.needsCompany(item)) return item;
    const known = this.knownCompany(item.sourceId);
    if (known) return { ...item, companyKey: known };
    if (!this.names.has(item.sourceId)) return item;
    const name = this.names.get(item.sourceId) ?? null;
    const companyKey = adoptBoardCompany(this.database, item, new Date(this.now()).toISOString(), name);
    if (companyKey) this.adopted += 1;
    return companyKey ? { ...item, companyKey } : item;
  }

  private reset(): void {
    this.cursor = 0;
    this.directoryCursor = '';
    this.directoryDone = false;
    this.changedTotal = 0;
    this.duplicateSources = 0;
    this.adopted = 0;
  }
}

/** Бюджет одного такта и пауза между проходами. */
export const PLACEMENT_TICK_BUDGET_MS = 300;
export const PLACEMENT_PASS_PAUSE_MS = 6 * 60 * 60_000;
/** Проход, заведший компании, повторяется скоро: остаток досок ждёт своей очереди. */
export const PLACEMENT_ADOPT_PAUSE_MS = 5 * 60_000;

/** Такт обслуживания: порции в бюджете 300 мс, после прохода — пауза 6 ч. */
export class PlacementBackfillTicker {
  private nextPassAt = 0;

  constructor(
    private readonly backfill: Pick<PlacementBackfill, 'step'>,
    private readonly now: () => number = Date.now,
  ) {}

  /** Отчёт законченного прохода, иначе `undefined`. */
  tick(): PlacementBackfillReport | undefined {
    const startedAt = this.now();
    if (startedAt < this.nextPassAt) return undefined;
    while (this.now() - startedAt < PLACEMENT_TICK_BUDGET_MS) {
      const report = this.backfill.step();
      if (report.done) {
        this.nextPassAt = this.now() + (report.adoptedCompanies > 0 ? PLACEMENT_ADOPT_PAUSE_MS : PLACEMENT_PASS_PAUSE_MS);
        return report;
      }
    }
    return undefined;
  }
}
