import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import {
  isWithin,
  pageOf,
  parseMs,
  type FreshnessWindow,
  type VacancyPoolPage,
  type VacancyPoolQuery,
} from './vacancyPoolQuery';
import type { StoredSourceState, VacancyLink, VacancyPoolStore } from './vacancyPoolStore';

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
export class MemoryVacancyPoolStore implements VacancyPoolStore {
  private rows: Map<string, StoredRow> = new Map();
  private states: Map<string, StoredSourceState> = new Map();

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

  *iterateVacancies(window: FreshnessWindow): IterableIterator<UnifiedVacancy> {
    for (const vacancy of this.loadVacancies(window)) yield vacancy;
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

  loadSourceLinks(sourceId: string): VacancyLink[] {
    return Array.from(this.aliveRows())
      .filter((row) => row.sourceId === sourceId)
      .map((row) => ({ id: row.vacancy.id, url: row.vacancy.url }));
  }

  loadSourceStates(): StoredSourceState[] {
    return Array.from(this.states.values());
  }

  saveSourceState(state: StoredSourceState): void {
    this.states.set(state.sourceId, state);
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
  ): void {
    for (const vacancy of vacancies) this.upsert(sourceId, vacancy);
    const dropBeforeMs = parseMs(dropObservedBefore);
    if (dropBeforeMs === undefined) return;
    for (const [id, row] of this.rows) {
      if (row.expiredAt !== undefined || row.sourceId !== sourceId) continue;
      const observedMs = parseMs(row.vacancy.provenance.observedAt);
      if (observedMs === undefined || observedMs < dropBeforeMs) this.rows.delete(id);
    }
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
  }
}
