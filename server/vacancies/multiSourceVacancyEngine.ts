import { compareMatchedVacancies } from '../../shared/vacancyMatchOrder';
import type {
  UnifiedVacancy,
  VacancyCluster,
  VacancyMatchExplanation,
  VacancySourceConfig,
} from '../domain/unifiedVacancy';
import { clusterVacancies } from './vacancyDeduplicator';
import { DEFAULT_VACANCY_SOURCES } from './defaultVacancySources';
import { matchCandidateWithVacancy, type CandidateMatchProfile } from './vacancyMatcher';
import type { VacancyPoolStore } from './vacancyPoolStore';

export type SourceFetcher = (
  source: VacancySourceConfig,
  options?: { query?: string },
) => Promise<UnifiedVacancy[]>;

/**
 * What one sync actually did. `syncSource` used to return `void`, so an admin
 * route could only answer `success: true` — including for a run that failed
 * outright and for a source id that does not exist (B161 review §3).
 */
export interface SourceSyncOutcome {
  readonly sourceId: string;
  readonly status: 'healthy' | 'error' | 'unknown_source' | 'disabled' | 'skipped_needs_query';
  /** How many records the source returned before the freshness filter. */
  readonly fetched: number;
  /** How many of them the pool now holds for this source. */
  readonly kept: number;
  readonly message?: string;
}

export interface MatchedVacancyItem {
  cluster: VacancyCluster;
  explanation: VacancyMatchExplanation;
}

export interface VacancyQueryFilter {
  sourceId?: string;
  type?: string;
  query?: string;
  isRemote?: boolean;
  limit?: number;
  offset?: number;
}

export interface VacancyQueryResult {
  total: number;
  items: UnifiedVacancy[];
  statsBySource: Array<{ sourceId: string; sourceName: string; count: number }>;
}

const MAX_VACANCY_AGE_DAYS = 30;

function isVacancyFresh(
  publishedAt: string,
  nowMs: number = Date.now(),
  maxAgeDays: number = MAX_VACANCY_AGE_DAYS,
): boolean {
  const pubTime = new Date(publishedAt).getTime();
  if (Number.isNaN(pubTime)) return false;
  const ageMs = nowMs - pubTime;
  return ageMs >= 0 && ageMs <= maxAgeDays * 24 * 60 * 60 * 1000;
}

export class MultiSourceVacancyEngine {
  private sources: Map<string, VacancySourceConfig> = new Map();
  private rawVacancies: Map<string, UnifiedVacancy> = new Map();
  private clusters: VacancyCluster[] = [];
  private fetcher?: SourceFetcher;
  /** Where the pool survives a restart. Absent means memory only (tests). */
  private readonly pool?: VacancyPoolStore;
  /** In-flight syncs, so a slow source cannot be started twice at once. */
  private running: Map<string, Promise<SourceSyncOutcome>> = new Map();

  constructor(options?: {
    sources?: VacancySourceConfig[];
    fetcher?: SourceFetcher;
    pool?: VacancyPoolStore;
  }) {
    const initial = options?.sources ?? DEFAULT_VACANCY_SOURCES;
    for (const src of initial) {
      this.sources.set(src.id, { ...src });
    }
    this.fetcher = options?.fetcher;
    this.pool = options?.pool;
  }

  /**
   * Loads what an earlier process synced. Without it a restart — and therefore
   * every deploy — served an empty «Возможности» until the scheduler's next
   * run, and every source claimed it had never been read (B164).
   */
  public restore(nowMs: number = Date.now()): { restored: number } {
    if (!this.pool) return { restored: 0 };
    const oldestPublishedAt = new Date(
      nowMs - MAX_VACANCY_AGE_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    this.pool.prune(Array.from(this.sources.keys()), oldestPublishedAt);

    this.rawVacancies.clear();
    for (const vacancy of this.pool.loadVacancies()) {
      // A source the registry no longer lists must not come back through
      // storage. A disabled one keeps its slice, exactly as it does in memory
      // when it is switched off between syncs.
      if (!this.sources.has(vacancy.provenance.sourceId)) continue;
      if (!isVacancyFresh(vacancy.publishedAt, nowMs)) continue;
      this.rawVacancies.set(vacancy.id, vacancy);
    }

    for (const state of this.pool.loadSourceStates()) {
      const source = this.sources.get(state.sourceId);
      if (!source) continue;
      source.lastSyncAt = state.lastSyncAt;
      source.lastStatus = state.lastStatus;
      source.lastErrorMessage = state.lastErrorMessage;
      source.itemsFoundTotal = state.itemsFoundTotal;
      source.itemsActiveTotal = state.itemsActiveTotal;
    }

    this.recluster();
    return { restored: this.rawVacancies.size };
  }

  public getSources(): VacancySourceConfig[] {
    return Array.from(this.sources.values());
  }

  public getSource(id: string): VacancySourceConfig | undefined {
    return this.sources.get(id);
  }

  public addOrUpdateSource(source: VacancySourceConfig): void {
    this.sources.set(source.id, { ...source });
  }

  public toggleSource(sourceId: string, enabled: boolean): VacancySourceConfig {
    const source = this.sources.get(sourceId);
    if (!source) throw new Error(`Источник ${sourceId} не найден`);
    source.enabled = enabled;
    return { ...source };
  }

  public removeSource(id: string): boolean {
    return this.sources.delete(id);
  }

  public getActiveClusters(): VacancyCluster[] {
    return this.clusters.filter((c) => c.status === 'active');
  }

  public getVacancies(filter: VacancyQueryFilter = {}): VacancyQueryResult {
    let all = Array.from(this.rawVacancies.values()).filter((v) =>
      isVacancyFresh(v.publishedAt),
    );

    const statsMap = new Map<string, number>();
    for (const v of all) {
      const sId = v.provenance?.sourceId ?? 'unknown';
      statsMap.set(sId, (statsMap.get(sId) ?? 0) + 1);
    }
    const statsBySource = Array.from(this.sources.values()).map((s) => ({
      sourceId: s.id,
      sourceName: s.name,
      count: statsMap.get(s.id) ?? 0,
    }));

    if (filter.sourceId) {
      all = all.filter((v) => v.provenance?.sourceId === filter.sourceId);
    }
    if (filter.type) {
      all = all.filter((v) => v.provenance?.sourceType === filter.type);
    }
    if (filter.isRemote !== undefined) {
      all = all.filter((v) => v.isRemote === filter.isRemote);
    }
    if (filter.query) {
      const q = filter.query.toLowerCase();
      all = all.filter(
        (v) =>
          v.title.toLowerCase().includes(q) ||
          v.company.toLowerCase().includes(q) ||
          (v.description && v.description.toLowerCase().includes(q)) ||
          v.requiredSkills.some((s) => s.toLowerCase().includes(q)),
      );
    }

    // Sort newest first
    all.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

    const total = all.length;
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 20;
    const items = all.slice(offset, offset + limit);

    return {
      total,
      items,
      statsBySource,
    };
  }

  public async syncSource(
    sourceId: string,
    query?: string,
    nowMs: number = Date.now(),
  ): Promise<SourceSyncOutcome> {
    const inFlight = this.running.get(sourceId);
    if (inFlight) return inFlight;
    const started = this.runSync(sourceId, query, nowMs).finally(() => {
      this.running.delete(sourceId);
    });
    this.running.set(sourceId, started);
    return started;
  }

  private async runSync(
    sourceId: string,
    query: string | undefined,
    nowMs: number,
  ): Promise<SourceSyncOutcome> {
    const source = this.sources.get(sourceId);
    if (!source) return { sourceId, status: 'unknown_source', fetched: 0, kept: 0 };
    if (!source.enabled) return { sourceId, status: 'disabled', fetched: 0, kept: 0 };
    // An endpoint that answers nothing usable without a search term must be
    // skipped rather than recorded as an empty success (B164).
    if (source.requiresQuery && !query?.trim()) {
      return { sourceId, status: 'skipped_needs_query', fetched: 0, kept: 0 };
    }

    try {
      // No transport means the source was never contacted. Reporting that as a
      // healthy empty result would be a measurement we never took (B161).
      if (!this.fetcher) {
        throw new Error('vacancy_source_transport_unavailable');
      }
      const fetched: UnifiedVacancy[] = await this.fetcher(
        source,
        query ? { query } : undefined,
      );

      // Название площадки едет вместе с записью: на экране кандидат читает
      // источник, а не тип транспорта (PRB-017).
      const freshFetched = fetched
        .filter((v) => isVacancyFresh(v.publishedAt))
        .map((v) =>
          v.provenance ? { ...v, provenance: { ...v.provenance, sourceName: source.name } } : v,
        );

      // A successful sync replaces this source's slice. Merging instead meant a
      // vacancy the employer took down an hour after one reading stayed
      // matchable — and openable — for thirty days (B161 review §1).
      this.replaceSourceSlice(source.id, freshFetched);

      // The clock of the run, so the next due check measures the same instant
      // the scheduler used rather than drifting against wall time.
      source.lastSyncAt = new Date(nowMs).toISOString();
      source.lastStatus = 'healthy';
      source.lastErrorMessage = undefined;
      source.itemsFoundTotal = freshFetched.length;
      source.itemsActiveTotal = freshFetched.filter((v) => v.status === 'active').length;
      this.persistSourceState(source);

      this.recluster();
      return {
        sourceId,
        status: 'healthy',
        fetched: fetched.length,
        kept: freshFetched.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      source.lastSyncAt = new Date(nowMs).toISOString();
      source.lastStatus = 'error';
      source.lastErrorMessage = message;
      this.persistSourceState(source);
      // A failed reading is not evidence that the source went empty, so the
      // slice it delivered last time stays until a successful run replaces it.
      return { sourceId, status: 'error', fetched: 0, kept: 0, message };
    }
  }

  /**
   * Swaps everything this source contributed for what it just returned. Other
   * sources are untouched, so one shrinking feed cannot empty the pool.
   */
  private replaceSourceSlice(sourceId: string, vacancies: UnifiedVacancy[]): void {
    for (const [id, vacancy] of this.rawVacancies) {
      if (vacancy.provenance?.sourceId === sourceId) this.rawVacancies.delete(id);
    }
    for (const vacancy of vacancies) {
      this.rawVacancies.set(vacancy.id, vacancy);
    }
    this.pool?.replaceSourceSlice(sourceId, vacancies);
  }

  private persistSourceState(source: VacancySourceConfig): void {
    this.pool?.saveSourceState({
      sourceId: source.id,
      ...(source.lastSyncAt ? { lastSyncAt: source.lastSyncAt } : {}),
      ...(source.lastStatus ? { lastStatus: source.lastStatus } : {}),
      ...(source.lastErrorMessage ? { lastErrorMessage: source.lastErrorMessage } : {}),
      itemsFoundTotal: source.itemsFoundTotal,
      itemsActiveTotal: source.itemsActiveTotal,
    });
  }

  /**
   * Syncs the sources whose own refresh interval has elapsed. Without this
   * nothing but an admin button ever filled the pool, so a fresh process — and
   * therefore every deploy — served an empty «Возможности» until someone
   * pressed it by hand (B161 review §2).
   */
  public async syncDue(nowMs: number = Date.now()): Promise<SourceSyncOutcome[]> {
    const due = Array.from(this.sources.values()).filter(
      (source) => source.enabled && !source.requiresQuery && this.isDue(source, nowMs),
    );
    return Promise.all(due.map((source) => this.syncSource(source.id, undefined, nowMs)));
  }

  private isDue(source: VacancySourceConfig, nowMs: number): boolean {
    if (!source.lastSyncAt) return true;
    const last = Date.parse(source.lastSyncAt);
    if (Number.isNaN(last)) return true;
    return nowMs - last >= source.refreshIntervalMinutes * 60_000;
  }

  public async syncAll(query?: string): Promise<SourceSyncOutcome[]> {
    const enabled = Array.from(this.sources.values()).filter((s) => s.enabled);
    return Promise.all(enabled.map((s) => this.syncSource(s.id, query)));
  }

  public recluster(): void {
    const freshVacancies = Array.from(this.rawVacancies.values()).filter((v) =>
      isVacancyFresh(v.publishedAt),
    );
    this.clusters = clusterVacancies(freshVacancies);
  }

  public getMatchedVacancies(candidate: CandidateMatchProfile): MatchedVacancyItem[] {
    const active = this.getActiveClusters();
    const matched: MatchedVacancyItem[] = [];

    for (const cluster of active) {
      const explanation = matchCandidateWithVacancy(candidate, cluster);
      matched.push({ cluster, explanation });
    }

    return matched.sort(compareMatchedVacancies);
  }


  public async testSource(
    sourceId: string,
    query?: string,
  ): Promise<{
    sourceId: string;
    sourceName: string;
    type: string;
    success: boolean;
    latencyMs: number;
    count: number;
    vacancies: UnifiedVacancy[];
    message?: string;
  }> {
    const source = this.sources.get(sourceId);
    if (!source) {
      throw new Error(`Источник вакансий ${sourceId} не найден`);
    }
    const start = Date.now();
    try {
      if (!this.fetcher) {
        throw new Error('vacancy_source_transport_unavailable');
      }
      const fetched: UnifiedVacancy[] = await this.fetcher(source, { query });
      const latencyMs = Date.now() - start;
      return {
        sourceId: source.id,
        sourceName: source.name,
        type: source.type,
        success: true,
        latencyMs,
        count: fetched.length,
        vacancies: fetched.slice(0, 15),
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      return {
        sourceId: source.id,
        sourceName: source.name,
        type: source.type,
        success: false,
        latencyMs,
        count: 0,
        vacancies: [],
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
