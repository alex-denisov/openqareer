import type { UnifiedVacancy, VacancyCluster } from '../domain/unifiedVacancy';
import {
  ClusterIndex,
  createClusterFromVacancy,
  isDuplicatePrepared,
  memberKeysOf,
  mergeVacancyIntoCluster,
  prepareCluster,
  prepareVacancy,
  vacancyClusterLookup,
  type ClusterRepresentative,
  type PreparedVacancy,
  type VacancyClusterLookup,
  type VacancyMemberRef,
} from './vacancyDeduplicator';

/** Что сведению по ключам нужно от хранилища — и ничего сверх этого. */
export interface KeyedClusterStore {
  loadClusterRepresentatives(lookups: readonly VacancyClusterLookup[]): ClusterRepresentative[];
  loadClustersByKeys(lookups: readonly VacancyClusterLookup[]): VacancyCluster[];
  getCluster(clusterId: string): VacancyCluster | undefined;
  saveClusters(clusters: VacancyCluster[]): void;
  deleteCluster(clusterId: string): void;
}

export interface KeyedClusterResult {
  readonly updated: number;
  readonly created: number;
  /** Сколько кандидатов хранилище отдало партии — для журнала и замеров. */
  readonly candidates: number;
}

/**
 * Сводит партию новых записей с кластерами, которые задели их ключи (B230).
 *
 * Полная пересборка берёт в кучу весь пул и все кластеры — на проде это
 * гигабайты. Здесь кандидаты приходят представителями, собранными из строк
 * `vacancy_cluster_keys` (без JSON), сравнение идёт теми же правилами, что и
 * в `IncrementalClusterBuilder`, а целиком читается только кластер, с которым
 * запись совпала. В куче — партия, представители её соседей и совпавшие
 * кластеры.
 */
export function clusterBatchByKeys(
  store: KeyedClusterStore,
  batch: readonly UnifiedVacancy[],
): KeyedClusterResult {
  if (batch.length === 0) return { updated: 0, created: 0, candidates: 0 };
  const representatives = store.loadClusterRepresentatives(batch.map(vacancyClusterLookup));
  const session = new KeyedSession(store, representatives);
  for (const vacancy of batch) session.add(vacancy);
  return session.flush();
}

/** Одна партия: индекс кандидатов, совпавшие кластеры и новые — до записи. */
class KeyedSession {
  private readonly index = new ClusterIndex();
  private readonly prepared: PreparedVacancy[] = [];
  private readonly clusterIds: string[] = [];
  private readonly byMember = new Map<string, number>();
  private readonly loaded = new Map<number, VacancyCluster>();
  private readonly updated = new Set<number>();
  private readonly created: VacancyCluster[] = [];
  private readonly candidates: number;

  constructor(
    private readonly store: KeyedClusterStore,
    representatives: readonly ClusterRepresentative[],
  ) {
    this.candidates = representatives.length;
    for (const representative of representatives) {
      const position = this.register(representative.clusterId, representative.prepared);
      for (const member of representative.members) this.byMember.set(member, position);
    }
  }

  add(vacancy: UnifiedVacancy): void {
    const position = this.findPosition(vacancy);
    if (position === undefined) {
      const cluster = createClusterFromVacancy(vacancy);
      const created = this.register(cluster.id, prepareCluster(cluster));
      this.loaded.set(created, cluster);
      this.created.push(cluster);
      for (const member of memberKeysOf(vacancy)) this.byMember.set(member, created);
      return;
    }
    const cluster = this.clusterAt(position);
    if (!cluster) return;
    mergeVacancyIntoCluster(cluster, vacancy);
    const representative = prepareCluster(cluster);
    this.prepared[position] = representative;
    this.index.add(position, representative);
    for (const member of memberKeysOf(vacancy)) this.byMember.set(member, position);
    if (!this.created.includes(cluster)) this.updated.add(position);
  }

  flush(): KeyedClusterResult {
    const affected = [
      ...Array.from(this.updated, (position) => this.loaded.get(position)!),
      ...this.created,
    ];
    if (affected.length > 0) this.store.saveClusters(affected);
    return {
      updated: this.updated.size,
      created: this.created.length,
      candidates: this.candidates,
    };
  }

  private register(clusterId: string, prepared: PreparedVacancy): number {
    const position = this.clusterIds.length;
    this.clusterIds.push(clusterId);
    this.prepared.push(prepared);
    this.index.add(position, prepared);
    return position;
  }

  /** Сначала членство (повторное наблюдение), потом правила склейки. */
  private findPosition(vacancy: UnifiedVacancy): number | undefined {
    for (const member of memberKeysOf(vacancy)) {
      const direct = this.byMember.get(member);
      if (direct !== undefined) return direct;
    }
    const candidate = prepareVacancy(vacancy);
    return this.index
      .candidates(candidate)
      .find((position) => isDuplicatePrepared(candidate, this.prepared[position]!));
  }

  /** JSON кластера читается один раз и только для совпавшего. */
  private clusterAt(position: number): VacancyCluster | undefined {
    const cached = this.loaded.get(position);
    if (cached) return cached;
    const cluster = this.store.getCluster(this.clusterIds[position]!);
    if (cluster) this.loaded.set(position, cluster);
    return cluster;
  }
}

export interface DetachResult {
  readonly updated: number;
  readonly deleted: number;
}

/**
 * Снимает записи с их кластеров точечно: ушедшая из среза площадки запись
 * покидает кластер, опустевший кластер удаляется, кластер с другими
 * площадками остаётся. Раньше это требовало полной пересборки.
 */
export function detachVacanciesByKeys(
  store: KeyedClusterStore,
  gone: readonly VacancyMemberRef[],
): DetachResult {
  if (gone.length === 0) return { updated: 0, deleted: 0 };
  const goneKeys = new Set(gone.flatMap(memberKeysOf));
  const clusters = store.loadClustersByKeys(
    gone.map((vacancy) => ({
      direct: memberKeysOf(vacancy).map((key) => ({ kind: 'member' as const, key })),
      companyTokens: [],
      titleTokens: [],
    })),
  );
  const updated: VacancyCluster[] = [];
  let deleted = 0;
  for (const cluster of clusters) {
    const remaining = cluster.sources.filter(
      (source) =>
        !(source.externalId && goneKeys.has(source.externalId)) &&
        !(source.sourceUrl && goneKeys.has(source.sourceUrl)),
    );
    const removed = cluster.sources.length - remaining.length;
    if (removed === 0) continue;
    const count = Math.max(0, cluster.vacanciesCount - removed);
    if (count === 0 || remaining.length === 0) {
      store.deleteCluster(cluster.id);
      deleted += 1;
      continue;
    }
    updated.push({ ...cluster, sources: remaining, vacanciesCount: count });
  }
  if (updated.length > 0) store.saveClusters(updated);
  return { updated: updated.length, deleted };
}
