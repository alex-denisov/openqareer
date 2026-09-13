import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import type { HhSearchTransportResult } from './hhSearchFetcher';
import { buildCrawlPlan, planQueryUrl, type HhCrawlPlan } from './hhCrawlPlan';
import { runHhCrawl, HH_CRAWL_ABANDONED, type HhCrawlProgress } from './hhCrawlRunner';
import { parseHhSearchState } from './hhSearchState';
import type { HhCrawlSettingsStore } from './hhCrawlSettings';
import { keepKnownRoleIds } from './hhRoleCatalog';

/**
 * Когда какой обход делать (B214, срез 4).
 *
 * ДВА ПРОХОДА ВМЕСТО ОДНОГО. Полный веер по всем ролям — это около 1200
 * обращений и двадцать минут: ради него держать площадку занятой каждые
 * четверть часа незачем, а новые вакансии появляются постоянно. Поэтому обход
 * раздвоен: частый быстрый берёт только опубликованное за сутки и стоит
 * несколько минут, редкий глубокий добирает всё за выбранный срок и дробится
 * по ролям, опыту и регионам.
 *
 * ВЛАДЕЛЬЦУ НЕ НУЖНО НИЧЕГО НАЖИМАТЬ. Режим выбирается по отметке последнего
 * глубокого прохода, отметка лежит в базе и переживает выкат. Провалившийся
 * глубокий проход отметку не ставит — иначе один отказ площадки отложил бы
 * следующую попытку на сутки.
 */

/** Как часто нужен глубокий проход. */
export const FULL_SWEEP_INTERVAL_MS = 20 * 60 * 60 * 1000;

/**
 * Сколько страниц берёт быстрый проход у одной роли.
 *
 * Три — не «поменьше на всякий случай», а расчёт: быстрый проход идёт каждые
 * двадцать минут по выдаче, отсортированной от свежих, и за такое окно у одной
 * роли выходит единицы вакансий. Полноту обеспечивает не он, а глубокий проход
 * раз в сутки; частый проход отвечает только за то, чтобы новое появлялось
 * быстро, и стоить он должен минуты, а не часа.
 */
const FRESH_PAGES_PER_ROLE = 3;

/** Быстрый проход смотрит только последние сутки. */
const FRESH_PERIOD_DAYS = 1;

export type HhCrawlMode = 'fresh' | 'full';

export interface HhCrawlCoordinatorDeps {
  readonly fetchPage: (url: string) => Promise<HhSearchTransportResult>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now?: () => Date;
  readonly delayMs?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: HhCrawlProgress & { mode: HhCrawlMode }) => void;
  readonly sourceName?: string;
}

export interface HhCollectResult {
  readonly mode: HhCrawlMode;
  readonly vacancies: readonly UnifiedVacancy[];
  readonly pagesRead: number;
  readonly errors: number;
  readonly expectedResults: number;
  readonly truncatedQueries: number;
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
    const mode = this.chooseMode(settings.lastFullSweepAt, now);

    const searchPeriodDays = mode === 'full' ? settings.searchPeriodDays : FRESH_PERIOD_DAYS;
    const plan =
      mode === 'full'
        ? await this.planFullSweep(roleIds, searchPeriodDays)
        : planFreshSweep(roleIds);

    const result = await runHhCrawl(plan, {
      fetchPage: this.deps.fetchPage,
      sleep: this.deps.sleep,
      searchPeriodDays,
      ...(this.deps.delayMs === undefined ? {} : { delayMs: this.deps.delayMs }),
      ...(this.deps.signal ? { signal: this.deps.signal } : {}),
      ...(this.deps.sourceName ? { sourceName: this.deps.sourceName } : {}),
      now: () => now.toISOString(),
      ...(this.deps.onProgress
        ? { onProgress: (progress) => this.deps.onProgress?.({ ...progress, mode }) }
        : {}),
    });

    // Отметка ставится только после того, как глубокий проход действительно
    // дошёл до конца. Упавший проход обязан повториться, а не считаться сделанным.
    if (mode === 'full' && !result.stoppedEarly) {
      this.settings.markFullSweep(now.toISOString());
    }

    return {
      mode,
      vacancies: result.vacancies,
      pagesRead: result.pagesRead,
      errors: result.errors,
      expectedResults: plan.expectedResults,
      truncatedQueries: plan.truncatedQueries,
    };
  }

  private chooseMode(lastFullSweepAt: string | undefined, now: Date): HhCrawlMode {
    if (!lastFullSweepAt) return 'full';
    const last = Date.parse(lastFullSweepAt);
    // Нечитаемая отметка — это отсутствие отметки, а не «только что».
    if (!Number.isFinite(last)) return 'full';
    return now.getTime() - last > FULL_SWEEP_INTERVAL_MS ? 'full' : 'fresh';
  }

  /** Спрашивает у площадки размер каждой части: план строится по факту, не по догадке. */
  private async planFullSweep(
    roleIds: readonly string[],
    searchPeriodDays: number,
  ): Promise<HhCrawlPlan> {
    return buildCrawlPlan(roleIds, {
      searchPeriodDays,
      countResults: async (query) => {
        const response = await this.deps.fetchPage(planQueryUrl(query, searchPeriodDays, 0));
        await this.deps.sleep(this.deps.delayMs ?? 1_000);
        // Отказ на замере — не «ноль записей». Считать его нулём значит молча
        // выбросить из плана целую роль, а потом отчитаться успешным проходом,
        // который ничего не собрал. Размер неизвестен — планировать нечего.
        if (response.status !== 200 || !response.body) {
          throw new Error(`${HH_CRAWL_ABANDONED}: план, ${response.status}`);
        }
        try {
          return parseHhSearchState(response.body, { observedAt: '' }).totalResults;
        } catch {
          throw new Error(`${HH_CRAWL_ABANDONED}: план, выдача нечитаема`);
        }
      },
    });
  }
}

/**
 * Быстрый проход плана не спрашивает: он берёт у каждой роли несколько первых
 * страниц свежей выдачи. Пустая страница обрывает роль, поэтому у маленьких
 * ролей лишних обращений не будет.
 */
function planFreshSweep(roleIds: readonly string[]): HhCrawlPlan {
  const queries = roleIds.map((roleId) => ({
    roleId,
    totalResults: FRESH_PAGES_PER_ROLE * 50,
    pages: FRESH_PAGES_PER_ROLE,
    truncated: false,
  }));
  return {
    queries,
    expectedResults: queries.length * FRESH_PAGES_PER_ROLE * 50,
    expectedPages: queries.length * FRESH_PAGES_PER_ROLE,
    truncatedQueries: 0,
  };
}
