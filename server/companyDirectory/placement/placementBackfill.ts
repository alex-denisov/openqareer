import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { adoptBoardCompany } from './directoryFromBoards';
import { PLACEMENT_TABLES } from './placementSchema';
import { buildLinkageIndex, type DirectoryRow } from './placementLinkage';
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

const DEFAULT_CHUNK = 300;
/** Имя компании — запрос по записям доски; в одной порции не больше 20 таких. */
const ADOPT_PER_STEP = 20;

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
  private work: readonly Work[] | undefined;
  private cursor = 0;
  private changedTotal = 0;
  private duplicateSources = 0;
  private adopted = 0;
  private adoptedThisStep = 0;
  private readonly sourceOf: StatementSync;
  private readonly dropMoved: StatementSync;
  private readonly upsert: StatementSync;

  constructor(private readonly database: DatabaseSync, options: Options = {}) {
    this.chunk = options.chunk ?? DEFAULT_CHUNK;
    this.now = options.now ?? Date.now;
    // Обслуживатель может стартовать раньше API, создающего таблицы пула.
    database.exec(PLACEMENT_TABLES);
    this.sourceOf = database.prepare('SELECT source_id AS sourceId FROM company_placement WHERE placement_id = ?');
    this.dropMoved = database.prepare('DELETE FROM company_placement WHERE source_id = ? AND placement_id <> ?');
    this.upsert = database.prepare(`INSERT INTO company_placement
        (placement_id, company_key, type, provider, slug, url, priority, source_id, discovered_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(placement_id) DO UPDATE SET company_key = excluded.company_key, updated_at = excluded.updated_at
      WHERE company_key IS NULL AND excluded.company_key IS NOT NULL`);
  }

  private buildWork(): readonly Work[] {
    const directory = this.database.prepare(`SELECT company_key AS companyKey, company_name AS companyName,
        website_url AS websiteUrl, careers_url AS careersUrl, ats_provider AS atsProvider, ats_slug AS atsSlug
      FROM company_directory ORDER BY company_key`).all() as unknown as DirectoryRecord[];
    const index = buildLinkageIndex(directory);
    const sources = this.database.prepare('SELECT source_id AS id FROM vacancy_source_state ORDER BY source_id')
      .all() as unknown as { id: string }[];
    return [
      ...sources.map(({ id }) => ({ ...placementOf(id, index), discoveredBy: 'source' as const, url: null })),
      ...directory.flatMap(directoryWork),
    ];
  }

  /** Одна порция; `done` — проход закончен, следующий вызов начнёт новый. */
  step(): PlacementBackfillReport {
    const startedAt = this.now();
    this.work ??= this.buildWork();
    const slice = this.work.slice(this.cursor, this.cursor + this.chunk);
    let changed = 0;
    this.adoptedThisStep = 0;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const item of slice) changed += this.write(item);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    this.cursor += slice.length;
    this.changedTotal += changed;
    const done = this.cursor >= this.work.length;
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

  /** Доска работодателя вне справочника заводит свою компанию (B643). */
  private withAdoptedCompany(item: Work): Work {
    if (item.discoveredBy !== 'source' || item.companyKey || (item.type !== 'ats' && item.type !== 'employer_site')) return item;
    if (this.adoptedThisStep >= ADOPT_PER_STEP) return item;
    this.adoptedThisStep += 1;
    const companyKey = adoptBoardCompany(this.database, item, new Date(this.now()).toISOString());
    if (companyKey) this.adopted += 1;
    return companyKey ? { ...item, companyKey } : item;
  }

  private reset(): void {
    this.work = undefined;
    this.cursor = 0;
    this.changedTotal = 0;
    this.duplicateSources = 0;
    this.adopted = 0;
  }
}

/** Бюджет одного такта и пауза между проходами. */
export const PLACEMENT_TICK_BUDGET_MS = 300;
export const PLACEMENT_PASS_PAUSE_MS = 6 * 60 * 60_000;

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
        this.nextPassAt = this.now() + PLACEMENT_PASS_PAUSE_MS;
        return report;
      }
    }
    return undefined;
  }
}
