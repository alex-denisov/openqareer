import type { UnifiedVacancy } from '../domain/unifiedVacancy';

/** Выборка хранилища ограничена сотней: столько id площадка помнит до следующего обхода. */
const REFILL = 100;

export interface WithoutTextReader {
  load(sourceId: string, limit: number, excludeIds: readonly string[]): UnifiedVacancy[];
  /** Те из `ids`, что всё ещё живы и без текста. */
  reload(sourceId: string, ids: readonly string[]): UnifiedVacancy[];
}

/**
 * Очередь дочитки площадки (B761 25.11). Обход среза площадки разбирает JSON каждой её строки:
 * на проде 914 площадок с работой стоят 23 с за проход, проход нужен раз в 20 с ради двух
 * строк. Обход берёт сотню id, дальше такты читают свои строки по ключу.
 */
export class WithoutTextQueue {
  private readonly ids = new Map<string, readonly string[]>();

  constructor(private readonly reader: WithoutTextReader) {}

  take(sourceId: string, limit: number, excludeIds: readonly string[]): UnifiedVacancy[] {
    const excluded = new Set(excludeIds);
    const queued = (this.ids.get(sourceId) ?? []).filter((id) => !excluded.has(id));
    for (let offset = 0; offset < queued.length; offset += limit) {
      const found = this.reader.reload(sourceId, queued.slice(offset, offset + limit));
      if (found.length === 0) continue;
      this.remember(sourceId, queued.slice(offset + limit));
      return found;
    }
    const fresh = this.reader.load(sourceId, REFILL, excludeIds);
    this.remember(
      sourceId,
      fresh.slice(limit).map((vacancy) => vacancy.id),
    );
    return fresh.slice(0, limit);
  }

  private remember(sourceId: string, ids: readonly string[]): void {
    if (ids.length > 0) this.ids.set(sourceId, ids);
    else this.ids.delete(sourceId);
  }
}
