import type { VacancyDescriptionLoadResult } from './multiSourceVacancyEngine';

/**
 * Фоновое дочитывание текста hh.ru для публичного каталога (B535).
 *
 * Кабинет дочитывает карточку hh по запросу кандидата, а каталог показывал
 * только заголовок, работодателя и место. Этот шаг воркера обслуживания идёт
 * тем же загрузчиком и транспортом (`HhVacancyDescriptionLoader`, не чаще
 * одного чтения в секунду): сначала карточки каталога, свежие первыми, потом
 * остальной пул. Снятая работодателем вакансия уходит в архив загрузчиком
 * движка.
 *
 * Неудача одной записи не держит очередь (прод 21.10: одна скрытая вакансия,
 * отвечавшая 403, остановила догон на 41 тик): попытка отмечается временем и
 * счётчиком, запись повторяется позже с растущим отступом, обход идёт дальше.
 * Тик обрывается только на признаке блокировки площадки — отказ 403/429/451
 * или пауза загрузчика после такого отказа.
 */

const DEFAULT_PER_TICK = 10;
/** Первый повтор неудачной записи через час, дальше вдвое дольше, не реже суток. */
export const HH_TEXT_RETRY_BASE_MS = 60 * 60 * 1_000;
const HH_TEXT_RETRY_MAX_MS = 24 * 60 * 60 * 1_000;
/** После стольких неудач запись не запрашивается до перезапуска воркера. */
const HH_TEXT_MAX_ATTEMPTS = 5;

export interface HhCatalogTextEngine {
  /** Площадка включена, право подтверждено и загрузчик подключён. */
  hhTextReady(): boolean;
  loadHhTextCandidates(
    cursor: string | undefined,
    limit: number,
  ): { ids: string[]; cursor?: string };
  loadVacancyDescription(
    id: string,
  ): Promise<Pick<VacancyDescriptionLoadResult, 'status' | 'unavailable' | 'blocked'>>;
}

export interface HhCatalogTextReport {
  readonly requested: number;
  readonly loaded: number;
  /** Работодатель снял вакансию — запись ушла в архив. */
  readonly retired: number;
  readonly failed: number;
  /** Тик оборван признаком блокировки площадки. */
  readonly blocked?: boolean;
}

export interface HhTextAttempts {
  readonly count: number;
  readonly lastAt: number;
  readonly nextAt: number;
}

const EMPTY: HhCatalogTextReport = { requested: 0, loaded: 0, retired: 0, failed: 0 };

export class HhCatalogTextBackfill {
  private readonly engine: HhCatalogTextEngine;
  private readonly perTick: number;
  private readonly now: () => number;
  private readonly attempts = new Map<string, HhTextAttempts>();
  private cursor: string | undefined;
  private running = false;

  constructor(options: { engine: HhCatalogTextEngine; perTick?: number; now?: () => number }) {
    this.engine = options.engine;
    this.perTick = options.perTick ?? DEFAULT_PER_TICK;
    this.now = options.now ?? Date.now;
  }

  /** Отметка неудачных попыток записи: время, счётчик, когда повторить. */
  attemptsOf(id: string): HhTextAttempts | undefined {
    return this.attempts.get(id);
  }

  /** Один тик; если прошлый ещё идёт, новый не начинается. */
  async step(): Promise<HhCatalogTextReport> {
    if (this.running || !this.engine.hhTextReady()) return EMPTY;
    this.running = true;
    try {
      return await this.loadPage();
    } finally {
      this.running = false;
    }
  }

  private waiting(id: string): boolean {
    const attempts = this.attempts.get(id);
    if (!attempts) return false;
    return attempts.count >= HH_TEXT_MAX_ATTEMPTS || attempts.nextAt > this.now();
  }

  private markFailed(id: string): void {
    const previous = this.attempts.get(id);
    const count = (previous?.count ?? 0) + 1;
    const delay = Math.min(HH_TEXT_RETRY_BASE_MS * 2 ** (count - 1), HH_TEXT_RETRY_MAX_MS);
    const lastAt = this.now();
    this.attempts.set(id, { count, lastAt, nextAt: lastAt + delay });
  }

  private async loadPage(): Promise<HhCatalogTextReport> {
    const page = this.engine.loadHhTextCandidates(this.cursor, this.perTick);
    const tally = { requested: 0, loaded: 0, retired: 0, failed: 0 };
    for (const id of page.ids) {
      if (this.waiting(id)) continue;
      const result = await this.engine.loadVacancyDescription(id);
      // Пауза загрузчика: запроса не было, запись не виновата — повторить её.
      if (result.blocked === 'backoff') return { ...tally, blocked: true };
      tally.requested += 1;
      if (result.status === 'failed') {
        tally.failed += 1;
        this.markFailed(id);
        if (result.blocked === 'refused') return { ...tally, blocked: true };
        continue;
      }
      this.attempts.delete(id);
      if (result.status === 'loaded') tally.loaded += 1;
      else if (result.unavailable) tally.retired += 1;
    }
    // Страница пройдена — дальше; конец прохода начинает с самых свежих карточек.
    this.cursor = page.cursor;
    return tally;
  }
}
