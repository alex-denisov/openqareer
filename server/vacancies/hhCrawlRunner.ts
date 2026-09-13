import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { parseHhSearchState } from './hhSearchState';
import { planQueryUrl, type HhCrawlPlan } from './hhCrawlPlan';
import type { HhSearchTransportResult } from './hhSearchFetcher';

/**
 * Исполнение веера обхода hh.ru (B214, срез 4).
 *
 * ОДИН ПРОХОД — ОДИН ПАКЕТ. Пересборка кластеров стоит около четырёх секунд на
 * сорока тысячах записей (замер 2026-09-13), и делать её на каждой прочитанной
 * странице — значит занять сервер на час. Поэтому проход накапливает записи у
 * себя и отдаёт их одним пакетом; пересобирает пул вызывающий, один раз.
 *
 * ОТКАЗ ПЛОЩАДКИ ОСТАНАВЛИВАЕТ ПРОХОД. Несколько отказов подряд означают, что
 * площадка закрылась — продолжать значит напрашиваться на блокировку адреса.
 * Одиночный сбой страницы при этом проход не отменяет: он считается и идёт
 * в отчёт, потому что «собрано меньше» обязано иметь названную причину.
 */

export const HH_CRAWL_ABANDONED = 'hh_crawl_abandoned';

/** Пауза между обращениями по умолчанию: обход остаётся заметно вежливее живого человека. */
const DEFAULT_DELAY_MS = 1_000;

/** Сколько отказов подряд означают «площадка закрылась». */
const DEFAULT_REFUSAL_LIMIT = 5;

export interface HhCrawlProgress {
  readonly pagesRead: number;
  readonly pagesPlanned: number;
  readonly vacanciesFound: number;
}

export interface HhCrawlDeps {
  readonly fetchPage: (url: string) => Promise<HhSearchTransportResult>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly searchPeriodDays: number;
  readonly delayMs?: number;
  readonly refusalLimit?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: HhCrawlProgress) => void;
  readonly sourceName?: string;
  readonly now?: () => string;
}

export interface HhCrawlResult {
  readonly vacancies: readonly UnifiedVacancy[];
  readonly pagesRead: number;
  readonly duplicatesSkipped: number;
  readonly errors: number;
  readonly stoppedEarly: boolean;
}

interface SweepState {
  readonly collected: Map<string, UnifiedVacancy>;
  pagesRead: number;
  duplicatesSkipped: number;
  errors: number;
  refusalsInARow: number;
}

/** Что делать дальше после одной страницы. */
type PageOutcome = 'continue' | 'end-query';

function absorb(parsedVacancies: readonly UnifiedVacancy[], state: SweepState): void {
  for (const vacancy of parsedVacancies) {
    if (state.collected.has(vacancy.fingerprint)) {
      state.duplicatesSkipped += 1;
      continue;
    }
    state.collected.set(vacancy.fingerprint, vacancy);
  }
}

async function readPage(
  url: string,
  state: SweepState,
  deps: HhCrawlDeps,
  observedAt: string,
  refusalLimit: number,
): Promise<PageOutcome> {
  const response = await deps.fetchPage(url);
  await deps.sleep(deps.delayMs ?? DEFAULT_DELAY_MS);

  if (response.status !== 200 || !response.body) {
    state.errors += 1;
    state.refusalsInARow += 1;
    if (state.refusalsInARow >= refusalLimit) {
      throw new Error(`${HH_CRAWL_ABANDONED}: ${response.status}`);
    }
    return 'continue';
  }
  state.refusalsInARow = 0;
  state.pagesRead += 1;

  let parsed;
  try {
    parsed = parseHhSearchState(response.body, {
      observedAt,
      ...(deps.sourceName ? { sourceName: deps.sourceName } : {}),
    });
  } catch {
    // Капча или смена разметки: страница пришла с кодом 200 и выглядит
    // обычной, но выдачи в ней нет. Это сбой, а не пустая выдача.
    state.errors += 1;
    return 'continue';
  }

  absorb(parsed.vacancies, state);
  // Выдача кончилась раньше плана — площадка пересчитала её, пока шёл обход.
  return parsed.vacancies.length === 0 ? 'end-query' : 'continue';
}

export async function runHhCrawl(plan: HhCrawlPlan, deps: HhCrawlDeps): Promise<HhCrawlResult> {
  const refusalLimit = deps.refusalLimit ?? DEFAULT_REFUSAL_LIMIT;
  const observedAt = (deps.now ?? (() => new Date().toISOString()))();
  // Ключ — отпечаток записи: одна вакансия попадает в несколько частей веера
  // (роль × опыт × регион пересекаются на границах), и пул не должен считать
  // их разными.
  const state: SweepState = {
    collected: new Map(),
    pagesRead: 0,
    duplicatesSkipped: 0,
    errors: 0,
    refusalsInARow: 0,
  };
  let stoppedEarly = false;

  for (const query of plan.queries) {
    if (stoppedEarly) break;

    for (let page = 0; page < query.pages; page += 1) {
      if (deps.signal?.aborted) {
        stoppedEarly = true;
        break;
      }

      const url = planQueryUrl(query, deps.searchPeriodDays, page);
      const outcome = await readPage(url, state, deps, observedAt, refusalLimit);

      deps.onProgress?.({
        pagesRead: state.pagesRead,
        pagesPlanned: plan.expectedPages,
        vacanciesFound: state.collected.size,
      });

      if (outcome === 'end-query') break;
    }
  }

  return {
    vacancies: [...state.collected.values()],
    pagesRead: state.pagesRead,
    duplicatesSkipped: state.duplicatesSkipped,
    errors: state.errors,
    stoppedEarly,
  };
}
