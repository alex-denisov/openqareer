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
const DEFAULT_TTL_MS = 10 * 60_000;

/**
 * PRB-041 (prod 03.11): the first read past the window waited 5–6 s for the rebuild, on whichever
 * offset came first. Until this age it gets the old snapshot and the rebuild runs behind it; the
 * key still carries the profile, so a candidate's own edit never reads the old list.
 */
const DEFAULT_MAX_AGE_MS = 20 * 60_000;

/** Больше снимков одновременно не держим: это верхняя граница памяти. */
const DEFAULT_MAX_ENTRIES = 200;

interface Snapshot {
  readonly items: MatchedVacancyItem[];
  readonly storedAt: number;
}

export interface MatchedPoolSnapshotsOptions {
  readonly ttlMs?: number;
  readonly maxAgeMs?: number;
  readonly maxEntries?: number;
  readonly clock?: () => number;
  readonly onRebuildFailed?: (error: unknown) => void;
}

export interface MatchedPoolReadOptions {
  /** For a background pass: its next candidate waits for the rebuild instead of running beside it. */
  readonly awaitRebuild?: boolean;
}

export class MatchedPoolSnapshots {
  private readonly entries = new Map<string, Snapshot>();
  private readonly pending = new Map<string, Promise<MatchedVacancyItem[]>>();
  private generation = 0;
  private readonly ttlMs: number;
  private readonly maxAgeMs: number;
  private onRebuildFailed: ((error: unknown) => void) | undefined;
  private readonly maxEntries: number;
  private readonly clock: () => number;

  constructor(options: MatchedPoolSnapshotsOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.onRebuildFailed = options.onRebuildFailed;
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.clock = options.clock ?? Date.now;
  }

  setRebuildFailureLog(log: (error: unknown) => void): void {
    this.onRebuildFailed = log;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Смена кампании меняет смысл подбора, поэтому старые ключи кандидата не ждут TTL. */
  deleteCandidate(candidateId: string): void {
    const prefix = `${this.generation} ${candidateId} `;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  /** Shared pool writes affect every candidate's ranking and explanations. */
  invalidateAll(): void {
    this.generation += 1;
    this.entries.clear();
    this.pending.clear();
  }

  private key(candidateId: string, profileKey: string): string {
    return `${this.generation} ${candidateId} ${profileKey}`;
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
    const key = this.key(candidateId, profileKey);
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
    const key = this.key(candidateId, profileKey);
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
    options: MatchedPoolReadOptions = {},
  ): Promise<MatchedVacancyItem[]> {
    const key = this.key(candidateId, profileKey);
    const stored = this.entries.get(key);
    const age = stored ? this.clock() - stored.storedAt : Number.POSITIVE_INFINITY;
    if (stored && age < this.ttlMs) return stored.items;
    if (stored && age < this.maxAgeMs && !options.awaitRebuild) {
      this.rebuildBehind(key, compute);
      return stored.items;
    }
    const running = this.pending.get(key);
    if (running) return running;
    if (this.pending.size >= this.maxEntries) throw new Error('vacancy_match_queue_full');
    return this.computeInto(key, compute);
  }

  /** At most one per key; a full queue or a failure leaves the old snapshot in place. */
  private rebuildBehind(key: string, compute: () => Promise<MatchedVacancyItem[]>): void {
    if (this.pending.has(key) || this.pending.size >= this.maxEntries) return;
    this.computeInto(key, compute).catch((error: unknown) => this.onRebuildFailed?.(error));
  }

  private computeInto(
    key: string,
    compute: () => Promise<MatchedVacancyItem[]>,
  ): Promise<MatchedVacancyItem[]> {
    const generation = this.generation;
    const computation = Promise.resolve()
      .then(compute)
      .then((items) => {
        if (generation === this.generation) {
          const now = this.clock();
          this.entries.set(key, { items, storedAt: now });
          this.evict(now);
        }
        return items;
      })
      .finally(() => {
        this.pending.delete(key);
      });
    this.pending.set(key, computation);
    return computation;
  }

  private evict(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.storedAt >= Math.max(this.ttlMs, this.maxAgeMs)) this.entries.delete(key);
    }
    // Порядок обхода `Map` — порядок вставки: вытесняется самый старый снимок.
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}
