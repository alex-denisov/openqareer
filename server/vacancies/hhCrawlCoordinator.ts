import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import type { HhSearchTransportResult } from './hhSearchFetcher';
import { buildCrawlPlan, planQueryUrl, type HhCrawlPlan, type HhCrawlQuery } from './hhCrawlPlan';
import {
  runHhCrawl,
  HH_CRAWL_ABANDONED,
  type HhCrawlCursor,
  type HhCrawlProgress as HhCrawlRunProgress,
  type HhCrawlResult,
} from './hhCrawlRunner';
import { parseHhSearchState } from './hhSearchState';
import type { HhCrawlProgress, HhCrawlSettingsStore } from './hhCrawlSettings';
import { keepKnownRoleIds } from './hhRoleCatalog';
import { hhAreaChildren } from './hhAreaTree';

/**
 * Когда какой обход делать (B214, срез 4; B219).
 *
 * ДВА ПРОХОДА ВМЕСТО ОДНОГО. Новые вакансии появляются постоянно, а полное
 * перечисление живых стоит часы. Поэтому обход раздвоен: частый быстрый берёт
 * только опубликованное за сутки и читает роль до первой страницы, на которой
 * нет ни одного неизвестного пулу id; редкий глубокий перечисляет всё за
 * выбранный срок и дробится по ролям, опыту и регионам.
 *
 * ГЛУБОКИЙ ПРОХОД ИДЁТ ПО ТИКАМ (B219). На 133 ролях площадка держит 452 721
 * вакансию за 30 дней (замер 2026-09-15), одни замеры размера частей шли 11
 * часов, а служба перезапускается на каждом выкате — проход ни разу не дошёл
 * до конца. Теперь каждый тик планировщика делает работу в пределах бюджета
 * времени и сохраняет место в базе: сначала замеры по ролям (после каждой
 * роли), потом страницы (после каждой страницы). Улов каждого тика уходит в
 * пул сразу как частичное чтение, а не копится до конца прохода.
 *
 * ПРОТУХШЕЕ СНИМАЕТСЯ ПО ИТОГАМ ПРОХОДА. Ленты изменений у площадки нет, так
 * что единственное доказательство «вакансия снята» — её нет в полном
 * перечислении. Последний тик прохода отдаёт `dropObservedBefore`: всё, что
 * пул не видел с начала прохода, уходит.
 *
 * ВЛАДЕЛЬЦУ НЕ НУЖНО НИЧЕГО НАЖИМАТЬ. Режим выбирается по отметке последнего
 * глубокого прохода и по сохранённому курсору; и то и другое лежит в базе и
 * переживает выкат.
 */

/** Как часто нужен глубокий проход. Новое он больше не ловит — только снятое. */
export const FULL_SWEEP_INTERVAL_MS = 48 * 60 * 60 * 1000;

/** Сколько времени один тик отдаёт обходу; интервал источника — 20 минут. */
export const DEFAULT_TICK_BUDGET_MS = 15 * 60 * 1000;

/** Проход, не дошедший до конца за столько, начинается заново: план протух. */
export const PROGRESS_MAX_AGE_MS = 4 * 24 * 60 * 60 * 1000;

/** Готовый план переиспользуется столько: размеры ролей меняются медленно. */
export const PLAN_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Быстрый проход у роли: до этой страницы включительно читается всегда, дальше
 * — пока на странице есть хоть один неизвестный id. Одна страница минимума —
 * это 133 обращения на тик; три страницы стоили бы вчетверо дороже без пользы.
 */
const FRESH_MIN_PAGES = 1;

/** Потолок площадки на запрос — 40 страниц. */
const FRESH_MAX_PAGES = 40;

/** Быстрый проход смотрит только последние сутки. */
const FRESH_PERIOD_DAYS = 1;

/** Сколько раз подряд замер может отказать, прежде чем тик сдастся. */
const COUNT_REFUSAL_LIMIT = 3;

export type HhCrawlMode = 'fresh' | 'full';

export interface HhCrawlCoordinatorDeps {
  readonly fetchPage: (url: string) => Promise<HhSearchTransportResult>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now?: () => Date;
  /** Часы бюджета, миллисекунды; по умолчанию `Date.now`. */
  readonly clock?: () => number;
  readonly tickBudgetMs?: number;
  readonly delayMs?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: HhCrawlRunProgress & { mode: HhCrawlMode }) => void;
  readonly sourceName?: string;
  /** Знает ли пул запись с таким id — правило остановки быстрого прохода. */
  readonly isKnown?: (id: string) => boolean;
}

export interface HhCollectResult {
  readonly mode: HhCrawlMode;
  readonly vacancies: readonly UnifiedVacancy[];
  readonly pagesRead: number;
  readonly errors: number;
  readonly expectedResults: number;
  readonly truncatedQueries: number;
  /** Глубокий проход дочитан на этом тике (для быстрого — всегда true). */
  readonly finished: boolean;
  /** Ставится на последнем тике глубокого прохода: снять невиденное с этого момента. */
  readonly dropObservedBefore?: string;
}

export class HhCrawlCoordinator {
  constructor(
    private readonly settings: HhCrawlSettingsStore,
    private readonly deps: HhCrawlCoordinatorDeps,
  ) {}

  public async collect(): Promise<HhCollectResult> {
    const now = (this.deps.now ?? (() => new Date()))();
    const settings = this.settings.read();
    const roleIds = keepKnownRoleIds([...settings.roleIds]);
    const progress = this.liveProgress(now, roleIds, settings.searchPeriodDays);
    const mode: HhCrawlMode = progress ? 'full' : this.chooseMode(settings.lastFullSweepAt, now);

    const clock = this.deps.clock ?? Date.now;
    const deadlineMs = clock() + (this.deps.tickBudgetMs ?? DEFAULT_TICK_BUDGET_MS);

    // Свежие сутки добираются на каждом тике, даже глубоком: проход растянут
    // на часы, а новое должно появляться в пуле за минуты. Бюджет у добора тот
    // же: на холодном пуле хвосты 133 ролей — это тысячи страниц, и без предела
    // первый тик после выката шёл бы часы.
    const freshPlan = planFreshSweep(roleIds);
    const fresh = await this.runSweep(freshPlan, FRESH_PERIOD_DAYS, now, mode, { deadlineMs });
    if (mode === 'fresh') return collected(mode, fresh, freshPlan, true);

    return this.continueFullSweep(
      progress,
      roleIds,
      settings.searchPeriodDays,
      now,
      deadlineMs,
      fresh,
    );
  }

  private async continueFullSweep(
    stored: HhCrawlProgress | undefined,
    roleIds: readonly string[],
    searchPeriodDays: number,
    now: Date,
    deadlineMs: number,
    fresh: HhCrawlResult,
  ): Promise<HhCollectResult> {
    const clock = this.deps.clock ?? Date.now;
    let progress = stored ?? this.startSweep(roleIds, searchPeriodDays, now);

    if (progress.phase === 'planning') {
      progress = await this.planRoles(progress, roleIds, searchPeriodDays, deadlineMs);
      if (progress.phase === 'planning') {
        return collected('full', fresh, progress.plan, false);
      }
      this.settings.savePlanCache({
        roleIds,
        searchPeriodDays,
        plan: progress.plan,
        plannedAt: now.toISOString(),
      });
    }

    if (clock() >= deadlineMs) return collected('full', fresh, progress.plan, false);

    const deep = await this.runSweep(progress.plan, searchPeriodDays, now, 'full', {
      start: { queryIndex: progress.queryIndex, page: progress.page },
      deadlineMs,
    });

    // Курсор двигается один раз за тик и только когда улов тика доходит до
    // движка вместе с ним. Двигать его после каждой страницы нельзя: выкат
    // посреди тика унёс бы прочитанное, а курсор уже стоял бы за ним — и по
    // итогам прохода эти живые записи сняли бы как невиденные. Потерять один
    // тик и перечитать его — правильная цена.
    const merged = mergeResults(fresh, deep);
    if (!deep.finished) {
      this.settings.saveCursor(
        deep.cursor,
        progress.pagesRead + deep.pagesRead,
        progress.errors + deep.errors,
      );
      return collected('full', merged, progress.plan, false);
    }

    // Отметка ставится только после того, как глубокий проход действительно
    // дошёл до конца. Упавший или недочитанный проход обязан продолжиться,
    // а не считаться сделанным.
    this.settings.markFullSweep(progress.startedAt);
    this.settings.clearProgress();

    // Снимать невиденное можно только после прохода, который видел всё.
    // Непрочитанная страница или усечённая часть (Москва у крупной роли —
    // больше 2000 без третьей оси) — это живые вакансии, которых проход не
    // видел; снятие их убило бы, как быстрый проход убил 36 376 в B214.
    // Неполный проход срез дополняет, а протухшее ждёт следующего прохода,
    // 30-дневного отсева и проверки живости ссылок — безопасная сторона отказа.
    const sweepErrors = progress.errors + deep.errors;
    const complete = sweepErrors === 0 && progress.plan.truncatedQueries === 0;
    return {
      ...collected('full', merged, progress.plan, true),
      ...(complete ? { dropObservedBefore: progress.startedAt } : {}),
    };
  }

  /**
   * Сохранённый курсор, если он есть, не протух и построен по нынешним
   * настройкам. Смена набора ролей или срока посреди прохода (владелец в
   * админке) делает план негодным: продолжать его значит не замерить новые
   * роли и снять их записи по итогам как невиденные.
   */
  private liveProgress(
    now: Date,
    roleIds: readonly string[],
    searchPeriodDays: number,
  ): HhCrawlProgress | undefined {
    const progress = this.settings.readProgress();
    if (!progress) return undefined;
    const startedAt = Date.parse(progress.startedAt);
    const stale = !Number.isFinite(startedAt) || now.getTime() - startedAt > PROGRESS_MAX_AGE_MS;
    const foreign =
      !sameRoles(progress.roleIds, roleIds) || progress.searchPeriodDays !== searchPeriodDays;
    if (stale || foreign) {
      this.settings.clearProgress();
      return undefined;
    }
    return progress;
  }

  /** Новый проход: с готовым планом из кэша или с пустым планом и замерами. */
  private startSweep(
    roleIds: readonly string[],
    searchPeriodDays: number,
    now: Date,
  ): HhCrawlProgress {
    const cached = this.settings.readPlanCache();
    const cacheUsable =
      cached !== undefined &&
      sameRoles(cached.roleIds, roleIds) &&
      cached.searchPeriodDays === searchPeriodDays &&
      now.getTime() - Date.parse(cached.plannedAt) <= PLAN_CACHE_MAX_AGE_MS;
    const base = { roleIds, searchPeriodDays, startedAt: now.toISOString() };
    const progress: HhCrawlProgress = cacheUsable
      ? {
          ...base,
          phase: 'reading',
          plan: cached.plan,
          roleIndex: roleIds.length,
          queryIndex: 0,
          page: 0,
          pagesRead: 0,
          errors: 0,
        }
      : {
          ...base,
          phase: 'planning',
          plan: emptyPlan(),
          roleIndex: 0,
          queryIndex: 0,
          page: 0,
          pagesRead: 0,
          errors: 0,
        };
    this.settings.saveProgress(progress);
    return progress;
  }

  /**
   * Замеряет роли по одной, пока есть бюджет, и после каждой сохраняет план:
   * перезапуск продолжит со следующей роли, а не с первой.
   */
  private async planRoles(
    progress: HhCrawlProgress,
    roleIds: readonly string[],
    searchPeriodDays: number,
    deadlineMs: number,
  ): Promise<HhCrawlProgress> {
    const clock = this.deps.clock ?? Date.now;
    let current = progress;
    while (current.roleIndex < roleIds.length) {
      if (clock() >= deadlineMs || this.deps.signal?.aborted) return current;
      const rolePlan = await this.planRole(roleIds[current.roleIndex]!, searchPeriodDays);
      current = {
        ...current,
        plan: mergePlans(current.plan, rolePlan),
        roleIndex: current.roleIndex + 1,
      };
      this.settings.saveProgress(current);
    }
    const ready: HhCrawlProgress = { ...current, phase: 'reading' };
    this.settings.saveProgress(ready);
    return ready;
  }

  /** Спрашивает у площадки размер каждой части роли: план строится по факту, не по догадке. */
  private planRole(roleId: string, searchPeriodDays: number): Promise<HhCrawlPlan> {
    return buildCrawlPlan([roleId], {
      searchPeriodDays,
      // Вторая ось: части, не влезшие в потолок даже после дробления по опыту,
      // делятся по дереву регионов площадки — сначала страны, потом области.
      areaChildren: hhAreaChildren,
      countResults: (query) => this.countResults(query, searchPeriodDays),
    });
  }

  /**
   * Один замер с повтором. Сетевой сбой на одном из тысяч замеров — не повод
   * бросать план: именно так 11-часовой проход умер на проде 2026-09-15
   * (`план, 0`). Но отказ за отказом означает, что площадка закрылась.
   */
  private async countResults(query: HhCrawlQuery, searchPeriodDays: number): Promise<number> {
    let lastStatus = 0;
    for (let attempt = 0; attempt < COUNT_REFUSAL_LIMIT; attempt += 1) {
      const response = await this.deps.fetchPage(planQueryUrl(query, searchPeriodDays, 0));
      await this.deps.sleep(this.deps.delayMs ?? 1_000);
      lastStatus = response.status;
      if (response.status !== 200 || !response.body) continue;
      try {
        return parseHhSearchState(response.body, { observedAt: '' }).totalResults;
      } catch {
        // Капча или смена разметки — это тоже отказ, а не «ноль записей».
        continue;
      }
    }
    // Отказ на замере — не «ноль записей». Считать его нулём значит молча
    // выбросить из плана целую роль, а потом отчитаться успешным проходом,
    // который ничего не собрал. Размер неизвестен — планировать нечего.
    throw new Error(`${HH_CRAWL_ABANDONED}: план, ${lastStatus}`);
  }

  private runSweep(
    plan: HhCrawlPlan,
    searchPeriodDays: number,
    now: Date,
    mode: HhCrawlMode,
    extra: {
      readonly start?: HhCrawlCursor;
      readonly deadlineMs?: number;
      readonly onCursor?: (cursor: HhCrawlCursor, pagesRead: number, errors: number) => void;
    },
  ): Promise<HhCrawlResult> {
    return runHhCrawl(plan, {
      fetchPage: this.deps.fetchPage,
      sleep: this.deps.sleep,
      searchPeriodDays,
      now: () => now.toISOString(),
      ...(this.deps.clock ? { clock: this.deps.clock } : {}),
      ...(this.deps.delayMs === undefined ? {} : { delayMs: this.deps.delayMs }),
      ...(this.deps.signal ? { signal: this.deps.signal } : {}),
      ...(this.deps.sourceName ? { sourceName: this.deps.sourceName } : {}),
      ...(this.deps.isKnown ? { isKnown: this.deps.isKnown } : {}),
      ...(this.deps.onProgress
        ? { onProgress: (progress) => this.deps.onProgress?.({ ...progress, mode }) }
        : {}),
      ...(extra.start ? { start: extra.start } : {}),
      ...(extra.deadlineMs === undefined ? {} : { deadlineMs: extra.deadlineMs }),
      ...(extra.onCursor ? { onCursor: extra.onCursor } : {}),
    });
  }

  private chooseMode(lastFullSweepAt: string | undefined, now: Date): HhCrawlMode {
    if (!lastFullSweepAt) return 'full';
    const last = Date.parse(lastFullSweepAt);
    // Нечитаемая отметка — это отсутствие отметки, а не «только что».
    if (!Number.isFinite(last)) return 'full';
    return now.getTime() - last > FULL_SWEEP_INTERVAL_MS ? 'full' : 'fresh';
  }
}

function collected(
  mode: HhCrawlMode,
  result: HhCrawlResult,
  plan: HhCrawlPlan,
  finished: boolean,
): HhCollectResult {
  return {
    mode,
    vacancies: result.vacancies,
    pagesRead: result.pagesRead,
    errors: result.errors,
    expectedResults: plan.expectedResults,
    truncatedQueries: plan.truncatedQueries,
    finished,
  };
}

/** Улов быстрого и глубокого прохода одного тика — один пакет без дублей. */
function mergeResults(fresh: HhCrawlResult, deep: HhCrawlResult): HhCrawlResult {
  const byFingerprint = new Map<string, UnifiedVacancy>();
  for (const vacancy of [...fresh.vacancies, ...deep.vacancies]) {
    byFingerprint.set(vacancy.fingerprint, vacancy);
  }
  return {
    ...deep,
    vacancies: [...byFingerprint.values()],
    pagesRead: fresh.pagesRead + deep.pagesRead,
    duplicatesSkipped: fresh.duplicatesSkipped + deep.duplicatesSkipped,
    errors: fresh.errors + deep.errors,
  };
}

function emptyPlan(): HhCrawlPlan {
  return { queries: [], expectedResults: 0, expectedPages: 0, truncatedQueries: 0 };
}

function mergePlans(base: HhCrawlPlan, added: HhCrawlPlan): HhCrawlPlan {
  return {
    queries: [...base.queries, ...added.queries],
    expectedResults: base.expectedResults + added.expectedResults,
    expectedPages: base.expectedPages + added.expectedPages,
    truncatedQueries: base.truncatedQueries + added.truncatedQueries,
  };
}

function sameRoles(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, i) => id === sortedB[i]);
}

/**
 * Быстрый проход плана не спрашивает: у каждой роли читается хвост свежей
 * выдачи, пока на странице попадается неизвестное пулу. Пустая страница
 * обрывает роль, поэтому у маленьких ролей лишних обращений не будет.
 */
function planFreshSweep(roleIds: readonly string[]): HhCrawlPlan {
  const queries = roleIds.map((roleId) => ({
    roleId,
    totalResults: FRESH_MAX_PAGES * 50,
    pages: FRESH_MAX_PAGES,
    truncated: false,
    stopWhenNothingNewAfter: FRESH_MIN_PAGES,
  }));
  return {
    queries,
    expectedResults: queries.length * FRESH_MAX_PAGES * 50,
    expectedPages: queries.length * FRESH_MAX_PAGES,
    truncatedQueries: 0,
  };
}
