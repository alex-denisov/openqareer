import type { MatchedVacancyItem } from './multiSourceVacancyEngine';

/**
 * Один снимок подбора на одно чтение пула.
 *
 * ЗАЧЕМ. Кабинет читает пул страницами — шестьюдесятью запросами (INC-029,
 * PRB-023), — и каждый запрос считал подбор заново: проход по всем активным
 * кластерам, сравнение с профилем кандидата и сортировка. Замер на проде
 * (`1e2436e`, 2026-09-09) показал цену: после перехода на параллельное чтение
 * круг вырос с 1.2 с до 3.4 с, потому что пять запросов в полёте становятся в
 * очередь к одному потоку сервера. Выигрыш от параллельности почти весь ушёл
 * в пересчёт.
 *
 * И ЭТО НЕ ТОЛЬКО СКОРОСТЬ. Смещения страниц считаются по конкретному списку.
 * Пройди между страницами опрос площадок — список меняется, и то же смещение
 * указывает уже на другую запись: чтение получает дыру или повтор. Снимок
 * держит одно чтение на одном списке.
 *
 * Снимок живёт полторы минуты: дольше — и кабинет показывал бы вчерашний
 * подбор, короче — не хватило бы на медленное чтение по каналу владельца
 * (65 с в том же замере).
 */
const DEFAULT_TTL_MS = 90_000;

/** Больше снимков одновременно не держим: это верхняя граница памяти. */
const DEFAULT_MAX_ENTRIES = 200;

interface Snapshot {
  readonly items: MatchedVacancyItem[];
  readonly storedAt: number;
}

export interface MatchedPoolSnapshotsOptions {
  readonly ttlMs?: number;
  readonly maxEntries?: number;
  readonly clock?: () => number;
}

export class MatchedPoolSnapshots {
  private readonly entries = new Map<string, Snapshot>();
  private readonly pending = new Map<string, Promise<MatchedVacancyItem[]>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly clock: () => number;

  constructor(options: MatchedPoolSnapshotsOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.clock = options.clock ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * Возвращает снимок подбора кандидата, считая его при первом обращении.
   *
   * `profileKey` — отпечаток того, из чего считается подбор: сменился профиль,
   * сменился и снимок. Иначе кандидат, подтвердивший навык, продолжал бы
   * читать старый подбор до конца минуты.
   */
  read(
    candidateId: string,
    profileKey: string,
    compute: () => MatchedVacancyItem[],
  ): MatchedVacancyItem[] {
    const key = `${candidateId} ${profileKey}`;
    const now = this.clock();
    const stored = this.entries.get(key);
    if (stored && now - stored.storedAt < this.ttlMs) return stored.items;

    const items = compute();
    this.entries.set(key, { items, storedAt: now });
    this.evict(now);
    return items;
  }

  /**
   * Читает уже посчитанный снимок, ничего не считая (B251, S4). `/today` на
   * холодном кэше отдаёт очередь без новых вакансий и `vacanciesPending:
   * true`, а не запускает синхронный подбор в HTTP-обработчике (B230).
   */
  peek(candidateId: string, profileKey: string): MatchedVacancyItem[] | undefined {
    const key = `${candidateId} ${profileKey}`;
    const stored = this.entries.get(key);
    if (!stored || this.clock() - stored.storedAt >= this.ttlMs) return undefined;
    return stored.items;
  }

  /** Role hypotheses and paged vacancies share one asynchronous computation.
   * A failed read never becomes a cached empty pool; TTL starts on completion. */
  async readAsync(
    candidateId: string,
    profileKey: string,
    compute: () => Promise<MatchedVacancyItem[]>,
  ): Promise<MatchedVacancyItem[]> {
    const key = `${candidateId} ${profileKey}`;
    const stored = this.entries.get(key);
    if (stored && this.clock() - stored.storedAt < this.ttlMs) return stored.items;
    const running = this.pending.get(key);
    if (running) return running;
    if (this.pending.size >= this.maxEntries) throw new Error('vacancy_match_queue_full');
    const computation = Promise.resolve().then(compute).then((items) => {
      const now = this.clock();
      this.entries.set(key, { items, storedAt: now });
      this.evict(now);
      return items;
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, computation);
    return computation;
  }

  private evict(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.storedAt >= this.ttlMs) this.entries.delete(key);
    }
    // Порядок обхода `Map` — порядок вставки: вытесняется самый старый снимок.
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}
