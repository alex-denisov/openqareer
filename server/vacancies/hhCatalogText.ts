import type { VacancyDescriptionLoadResult } from './multiSourceVacancyEngine';

/**
 * Фоновое дочитывание текста hh.ru для публичного каталога (B535).
 *
 * Кабинет дочитывает карточку hh по запросу кандидата, а каталог показывал
 * только заголовок, работодателя и место. Этот шаг воркера обслуживания идёт
 * тем же загрузчиком и транспортом (`HhVacancyDescriptionLoader`, не чаще
 * одного чтения в секунду): сначала карточки каталога, свежие первыми, потом
 * остальной пул. Снятая работодателем вакансия уходит в архив загрузчиком
 * движка. Первая неудача обрывает тик: hh, возможно, притормаживает нас, и
 * та же позиция повторяется следующим тиком.
 */

const DEFAULT_PER_TICK = 10;

export interface HhCatalogTextEngine {
  /** Площадка включена, право подтверждено и загрузчик подключён. */
  hhTextReady(): boolean;
  loadHhTextCandidates(
    cursor: string | undefined,
    limit: number,
  ): { ids: string[]; cursor?: string };
  loadVacancyDescription(
    id: string,
  ): Promise<Pick<VacancyDescriptionLoadResult, 'status' | 'unavailable'>>;
}

export interface HhCatalogTextReport {
  readonly requested: number;
  readonly loaded: number;
  /** Работодатель снял вакансию — запись ушла в архив. */
  readonly retired: number;
  readonly failed: number;
}

const EMPTY: HhCatalogTextReport = { requested: 0, loaded: 0, retired: 0, failed: 0 };

export class HhCatalogTextBackfill {
  private readonly engine: HhCatalogTextEngine;
  private readonly perTick: number;
  private cursor: string | undefined;
  private running = false;

  constructor(options: { engine: HhCatalogTextEngine; perTick?: number }) {
    this.engine = options.engine;
    this.perTick = options.perTick ?? DEFAULT_PER_TICK;
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

  private async loadPage(): Promise<HhCatalogTextReport> {
    const page = this.engine.loadHhTextCandidates(this.cursor, this.perTick);
    let loaded = 0;
    let retired = 0;
    for (const [index, id] of page.ids.entries()) {
      const result = await this.engine.loadVacancyDescription(id);
      if (result.status === 'failed') {
        return { requested: index + 1, loaded, retired, failed: 1 };
      }
      if (result.status === 'loaded') loaded += 1;
      else if (result.unavailable) retired += 1;
    }
    // Проход закончен — следующий тик начинает с самых свежих карточек каталога.
    this.cursor = page.cursor;
    return { requested: page.ids.length, loaded, retired, failed: 0 };
  }
}
