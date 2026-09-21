import type { UnifiedVacancy, VacancyCluster } from '../domain/unifiedVacancy';
import type { CandidateMatchProfile } from './vacancyMatcher';
import {
  clusterProjectionOf,
  DEFAULT_MATCH_CANDIDATE_LIMIT,
  extractMatchTerms,
  freshnessWindow,
  isWithin,
  pageOf,
  parseMs,
  searchTextOf,
  type FreshnessWindow,
  type MatchCandidateQueryOptions,
  type VacancyPoolPage,
  type VacancyPoolQuery,
} from './vacancyPoolQuery';
import type {
  MergeSliceResult,
  StoredSourceState,
  VacancyLink,
  VacancyPoolStore,
} from './vacancyPoolStore';
import {
  catalogEntryRowOfCluster,
  type CatalogEntriesPage,
  type CatalogEntriesQuery,
  type CatalogEntryRow,
} from './vacancyCatalogProjection';
import { catalogListings } from './vacancyCatalogFacets';

interface StoredRow {
  readonly vacancy: UnifiedVacancy;
  /** Площадка, от чьего имени запись записана — как `source_id` в базе. */
  readonly sourceId: string;
  readonly expiredAt?: string;
}

/**
 * Пул в памяти для тестов и для процесса без базы. Отвечает на те же вопросы,
 * что и SQLite, по тем же правилам — тест паритета держит обе реализации
 * рядом (B221). Похороненная запись остаётся строкой с датой смерти, как в
 * базе, чтобы «снято» не превращалось в «никогда не видели» (B200 срез 2).
 */
function compareCandidates(a: UnifiedVacancy, b: UnifiedVacancy, preferRemote: boolean): number {
  if (preferRemote) {
    const remoteA = a.isRemote ? 1 : 0;
    const remoteB = b.isRemote ? 1 : 0;
    if (remoteB !== remoteA) return remoteB - remoteA;
  }
  const timeA = parseMs(a.publishedAt) ?? 0;
  const timeB = parseMs(b.publishedAt) ?? 0;
  if (timeB !== timeA) return timeB - timeA;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export class MemoryVacancyPoolStore implements VacancyPoolStore {
  private rows: Map<string, StoredRow> = new Map();
  private states: Map<string, StoredSourceState> = new Map();
  private clusters: Map<string, VacancyCluster> = new Map();

  private *aliveRows(): IterableIterator<StoredRow> {
    for (const row of this.rows.values()) {
      if (row.expiredAt === undefined) yield row;
    }
  }

  private *alive(): IterableIterator<UnifiedVacancy> {
    for (const row of this.aliveRows()) yield row.vacancy;
  }

  loadVacancies(window?: FreshnessWindow): UnifiedVacancy[] {
    const alive = Array.from(this.alive());
    return window ? alive.filter((v) => isWithin(parseMs(v.publishedAt), window)) : alive;
  }

  *iterateClusterInput(window: FreshnessWindow): IterableIterator<UnifiedVacancy> {
    for (const vacancy of this.loadVacancies(window)) yield clusterProjectionOf(vacancy);
  }

  getVacancy(id: string): UnifiedVacancy | undefined {
    const row = this.rows.get(id);
    return row && row.expiredAt === undefined ? row.vacancy : undefined;
  }

  hasVacancy(id: string): boolean {
    return this.getVacancy(id) !== undefined;
  }

  countVacancies(window: FreshnessWindow): number {
    return this.loadVacancies(window).length;
  }

  countBySource(window: FreshnessWindow): ReadonlyMap<string, number> {
    const counts = new Map<string, number>();
    for (const row of this.aliveRows()) {
      if (!isWithin(parseMs(row.vacancy.publishedAt), window)) continue;
      counts.set(row.sourceId, (counts.get(row.sourceId) ?? 0) + 1);
    }
    return counts;
  }

  countSourceSlice(sourceId: string): { total: number; active: number } {
    let total = 0;
    let active = 0;
    for (const row of this.aliveRows()) {
      if (row.sourceId !== sourceId) continue;
      total += 1;
      if (row.vacancy.status === 'active') active += 1;
    }
    return { total, active };
  }

  queryVacancies(query: VacancyPoolQuery): VacancyPoolPage {
    const rows = Array.from(this.aliveRows()).filter(
      (row) => !query.sourceIds || query.sourceIds.includes(row.sourceId),
    );
    return pageOf(
      rows.map((row) => row.vacancy),
      { ...query, sourceIds: undefined },
    );
  }

  queryMatchCandidates(
    candidate: CandidateMatchProfile,
    options?: MatchCandidateQueryOptions,
  ): UnifiedVacancy[] {
    const limit = options?.limit ?? DEFAULT_MATCH_CANDIDATE_LIMIT;
    if (limit <= 0) return [];
    const window = freshnessWindow(options?.nowMs);
    const preferRemote = Boolean(candidate.preferredRemote);
    const terms = extractMatchTerms(candidate);

    const activeRows = Array.from(this.aliveRows()).filter(
      (row) =>
        row.vacancy.status === 'active' && isWithin(parseMs(row.vacancy.publishedAt), window),
    );

    const results: UnifiedVacancy[] = [];
    const seenIds = new Set<string>();

    if (terms.length > 0) {
      const matched = activeRows.filter((row) => {
        const text = searchTextOf(row.vacancy);
        return terms.some((term) => text.includes(term));
      });
      matched.sort((a, b) => compareCandidates(a.vacancy, b.vacancy, preferRemote));
      for (const row of matched.slice(0, limit)) {
        results.push(clusterProjectionOf(row.vacancy));
        seenIds.add(row.vacancy.id);
      }
    }

    if (results.length < limit) {
      const remaining = activeRows.filter((row) => !seenIds.has(row.vacancy.id));
      remaining.sort((a, b) => compareCandidates(a.vacancy, b.vacancy, preferRemote));
      for (const row of remaining.slice(0, limit - results.length)) {
        results.push(clusterProjectionOf(row.vacancy));
        seenIds.add(row.vacancy.id);
      }
    }

    return results;
  }

  loadSourceLinks(sourceId: string): VacancyLink[] {
    return Array.from(this.aliveRows())
      .filter((row) => row.sourceId === sourceId)
      .map((row) => ({ id: row.vacancy.id, url: row.vacancy.url }));
  }

  loadSourceStates(): StoredSourceState[] {
    return Array.from(this.states.values());
  }

  saveSourceState(state: StoredSourceState): void {
    const current = this.states.get(state.sourceId);
    const requestedAt = [current?.syncRequestedAt, state.syncRequestedAt]
      .filter((value): value is string => typeof value === 'string')
      .sort()
      .at(-1);
    this.states.set(state.sourceId, {
      ...state,
      ...(requestedAt ? { syncRequestedAt: requestedAt } : {}),
      ...(current?.syncRequestedAt &&
      requestedAt === current.syncRequestedAt &&
      current.syncStartedAt
        ? { syncStartedAt: current.syncStartedAt }
        : state.syncStartedAt
          ? { syncStartedAt: state.syncStartedAt }
          : {}),
    });
  }

  requestSourceSync(sourceId: string, requestedAt: string): void {
    const current = this.states.get(sourceId);
    this.states.set(sourceId, {
      sourceId,
      itemsFoundTotal: current?.itemsFoundTotal ?? 0,
      itemsActiveTotal: current?.itemsActiveTotal ?? 0,
      ...(current ?? {}),
      syncRequestedAt:
        !current?.syncRequestedAt || current.syncRequestedAt < requestedAt
          ? requestedAt
          : current.syncRequestedAt,
    });
  }

  markSourceSyncStarted(sourceId: string, requestedAt: string, startedAt: string): boolean {
    const current = this.states.get(sourceId);
    if (!current || current.syncRequestedAt !== requestedAt) return false;
    this.states.set(sourceId, { ...current, syncStartedAt: startedAt });
    return true;
  }

  clearSourceSyncRequest(sourceId: string, requestedAt: string): boolean {
    const current = this.states.get(sourceId);
    if (!current || current.syncRequestedAt !== requestedAt) return false;
    const { syncRequestedAt: _requestedAt, syncStartedAt: _startedAt, ...rest } = current;
    this.states.set(sourceId, rest);
    return true;
  }

  /** Как в базе: обновляется запись, но не дата смерти. */
  private upsert(sourceId: string, vacancy: UnifiedVacancy): void {
    const existing = this.rows.get(vacancy.id);
    this.rows.set(vacancy.id, {
      vacancy,
      sourceId,
      ...(existing?.expiredAt ? { expiredAt: existing.expiredAt } : {}),
    });
  }

  replaceSourceSlice(sourceId: string, vacancies: readonly UnifiedVacancy[]): void {
    for (const [id, row] of this.rows) {
      if (row.expiredAt === undefined && row.sourceId === sourceId) this.rows.delete(id);
    }
    for (const vacancy of vacancies) this.upsert(sourceId, vacancy);
  }

  mergeSourceSlice(
    sourceId: string,
    vacancies: readonly UnifiedVacancy[],
    dropObservedBefore?: string,
  ): MergeSliceResult {
    for (const vacancy of vacancies) this.upsert(sourceId, vacancy);
    const dropBeforeMs = parseMs(dropObservedBefore);
    const dropped: VacancyLink[] = [];
    if (dropBeforeMs === undefined) return { dropped };
    for (const [id, row] of this.rows) {
      if (row.expiredAt !== undefined || row.sourceId !== sourceId) continue;
      const observedMs = parseMs(row.vacancy.provenance.observedAt);
      if (observedMs === undefined || observedMs < dropBeforeMs) {
        dropped.push({ id, url: row.vacancy.url });
        this.rows.delete(id);
      }
    }
    return { dropped };
  }

  markExpired(vacancyIds: readonly string[], atIso: string): number {
    let buried = 0;
    for (const id of vacancyIds) {
      const row = this.rows.get(id);
      if (!row || row.expiredAt !== undefined) continue;
      this.rows.set(id, { ...row, expiredAt: atIso });
      buried += 1;
    }
    return buried;
  }

  prune(knownSourceIds: readonly string[], oldestPublishedAt: string): void {
    const known = new Set(knownSourceIds);
    for (const [id, row] of this.rows) {
      if (row.vacancy.publishedAt < oldestPublishedAt || !known.has(row.sourceId)) {
        this.rows.delete(id);
      }
    }
    for (const sourceId of this.states.keys()) {
      if (!known.has(sourceId)) this.states.delete(sourceId);
    }
    if (knownSourceIds.length === 0) {
      this.clusters.clear();
    }
  }

  saveClusters(clusters: VacancyCluster[]): void {
    for (const cluster of clusters) {
      this.clusters.set(cluster.id, cluster);
    }
  }

  replaceClusters(clusters: VacancyCluster[]): void {
    this.clusters.clear();
    this.saveClusters(clusters);
  }

  loadClusters(): VacancyCluster[] {
    return Array.from(this.clusters.values());
  }

  pruneClustersBefore(oldestPublishedAt: string): number {
    let removed = 0;
    for (const [id, cluster] of this.clusters) {
      if (cluster.lastSeenAt >= oldestPublishedAt) continue;
      this.clusters.delete(id);
      removed += 1;
    }
    return removed;
  }

  upsertCluster(cluster: VacancyCluster): void {
    this.clusters.set(cluster.id, cluster);
  }

  deleteCluster(clusterId: string): void {
    this.clusters.delete(clusterId);
  }

  countClusters(): number {
    return this.clusters.size;
  }

  loadCatalogEntriesPage(query: CatalogEntriesQuery): CatalogEntriesPage {
    const rows = Array.from(this.clusters.values())
      .filter((cluster) => cluster.status === 'active')
      .map(catalogEntryRowOfCluster)
      .filter((entry): entry is CatalogEntryRow => entry !== null)
      .filter((entry) => !query.place || entry.placeSlug === query.place)
      .filter((entry) => !query.role || entry.roleSlug === query.role)
      .sort(
        (a, b) =>
          (parseMs(b.publishedAt) ?? 0) - (parseMs(a.publishedAt) ?? 0) ||
          a.key.localeCompare(b.key),
      );
    const total = rows.length;
    const after = query.after;
    const filtered = after
      ? rows.filter((entry) => {
          const publishedMs = parseMs(entry.publishedAt) ?? 0;
          return (
            publishedMs < after.publishedMs ||
            (publishedMs === after.publishedMs && entry.key > after.key)
          );
        })
      : rows;
    const limit = Math.max(1, Math.min(Math.trunc(query.limit), 50_000));
    const selected = filtered.slice(0, limit);
    return {
      items: selected,
      total,
      ...(filtered.length > limit && selected.length > 0
        ? {
            nextCursor: {
              publishedMs: parseMs(selected[selected.length - 1]!.publishedAt) ?? 0,
              key: selected[selected.length - 1]!.key,
            },
          }
        : {}),
    };
  }

  loadCatalogListings() {
    return catalogListings(
      Array.from(this.clusters.values())
        .filter((cluster) => cluster.status === 'active')
        .map(catalogEntryRowOfCluster)
        .filter((entry): entry is CatalogEntryRow => entry !== null),
    );
  }

  getCatalogEntry(key: string): CatalogEntryRow | undefined {
    for (const cluster of this.clusters.values()) {
      const entry = catalogEntryRowOfCluster(cluster);
      if (entry?.status === 'active' && entry.key === key) return entry;
    }
    return undefined;
  }

  getCluster(clusterId: string): VacancyCluster | undefined {
    return this.clusters.get(clusterId);
  }

  catalogProjectionReady(): boolean {
    return true;
  }

  backfillCatalogEntriesStep(): number {
    return 0;
  }

  pendingCatalogEntries(): number {
    return 0;
  }
}
