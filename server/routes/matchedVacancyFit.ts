import { compareMatchedVacancies } from '../../shared/vacancyMatchOrder';
import { compareFitPercent } from '../../shared/vacancyFitPercent';
import type { RouteDeps } from './deps';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import type { VacancyFitView } from '../../shared/vacancyFit';
import { createVacancyFitContextReader, readVacancyFitTarget } from './vacancyFitContext';
import { vacancyFitProfileStamp } from '../domain/vacancyFitProfileStamp';
import { createCandidateWindowCache } from './candidateWindowCache';
import { wantedCompaniesBreakTies, wantedCompanyKeys } from '../domain/wantedCompanyOrder';

const FIT_ORDER_WINDOW_MS = 60_000;
/** Столько точных разборов считается между уступками event loop при фоновом пересчёте. */
const FIT_REFRESH_SLICE = 25;
/**
 * B562: a vacancy with a stored result whose profile key changed (imported facts now count) has a
 * completed queue row, so the shown page never asks again. One read re-queues at most this many;
 * the worker spends within the B522 budget.
 */
export const STALE_REFIT_LIMIT = 50;
type FitViews = ReadonlyMap<string, VacancyFitView>;
const fitViewsCache = createCandidateWindowCache<FitViews>(FIT_ORDER_WINDOW_MS);
const refreshingFitViews = new Set<string>();

/**
 * Runs before pagination, so a cached match on a later page can move to the front.
 *
 * PRB-040: точный разбор всех вакансий с результатом стоил на проде ~4 с
 * синхронного SQL и стоял перед первой страницей каждые 60 с. Вышедшее окно
 * больше не держит ответ: порядок строится по прежним разборам, а свежие
 * считаются в фоне порциями, уступая event loop. Синхронно — только первый
 * раз для этого профиля, когда прежних разборов нет.
 */
export function withVacancyFitOrder(
  deps: RouteDeps,
  candidateId: string,
  sort: 'fit' | 'freshness' = 'fit',
) {
  const reader = createFitViewReader(deps, candidateId);
  const stamp = reader
    ? vacancyFitProfileStamp(
        deps.candidateStore.getSnapshot(candidateId),
        deps.candidateStore.getCandidateWorkspace(candidateId),
      )
    : 'none';
  const key = `${candidateId}|${stamp}`;
  return (items: readonly MatchedVacancyItem[]): MatchedVacancyItem[] => {
    const known = fitViewsCache.peek(key);
    if (!known) {
      const views = reader
        ? reader.read(reader.scoredIds(items))
        : new Map<string, VacancyFitView>();
      fitViewsCache.write(key, views);
      return orderByFit(items, views, sort);
    }
    if (known.stale && reader) void refreshFitViews(key, reader, items);
    return orderByFit(items, known.value, sort);
  };
}

/** Порядок подборки и то, от чего он зависит помимо выдачи (ключ кэша списка). */
export type MatchedOrder = ((items: readonly MatchedVacancyItem[]) => MatchedVacancyItem[]) & {
  readonly cacheKey: string;
};

/**
 * 28.10: «по совпадению» ведёт процент; вакансии компаний «Хочу» поднимаются только
 * среди вакансий с тем же процентом (B422 стал вторым ключом). Свежесть отметку не учитывает.
 */
export function withWantedCompanyOrder(
  deps: RouteDeps,
  candidateId: string,
  sort: 'fit' | 'freshness' = 'fit',
): MatchedOrder {
  const byFit = withVacancyFitOrder(deps, candidateId, sort);
  if (sort !== 'fit') return Object.assign(byFit, { cacheKey: '' });
  const wanted = wantedCompanyKeys(deps.candidateCompanyWantsRepo, candidateId);
  // Кэш списка держит уже упорядоченную подборку: новая отметка должна давать новый ключ.
  const cacheKey = [...wanted].sort().join(',');
  return Object.assign(
    (items: readonly MatchedVacancyItem[]): MatchedVacancyItem[] =>
      wantedCompaniesBreakTies(byFit(items), wanted, (left, right) =>
        compareFitPercent(left.explanation.fitView, right.explanation.fitView),
      ),
    { cacheKey },
  );
}

interface FitViewReader {
  scoredIds(items: readonly MatchedVacancyItem[]): string[];
  read(ids: readonly string[]): Map<string, VacancyFitView>;
}

function createFitViewReader(deps: RouteDeps, candidateId: string): FitViewReader | undefined {
  const runtime = deps.vacancyMechanics;
  if (!runtime) return undefined;
  const context = createVacancyFitContextReader(deps, candidateId);
  return {
    // Точный разбор дорог (отпечатки всех фактов, проверка результата, полный
    // текст вакансии) — только для вакансий с сохранённым результатом.
    scoredIds(items) {
      const scored = runtime.cachedVacancyIds(candidateId);
      return items.map((item) => item.cluster.id).filter((id) => scored.has(id));
    },
    read(ids) {
      const views = new Map<string, VacancyFitView>();
      let requeued = 0;
      for (const id of ids) {
        const target = readVacancyFitTarget(deps, id);
        if (!target) continue;
        const input = context(target, []);
        const view = runtime.view(input);
        if (
          (view.state === 'not_requested' || view.state === 'refreshing') &&
          requeued < STALE_REFIT_LIMIT
        ) {
          runtime.enqueue(input);
          requeued += 1;
        }
        views.set(id, compactFitView(view));
      }
      return views;
    },
  };
}

async function refreshFitViews(
  key: string,
  reader: FitViewReader,
  items: readonly MatchedVacancyItem[],
): Promise<void> {
  if (refreshingFitViews.has(key)) return;
  refreshingFitViews.add(key);
  try {
    const ids = reader.scoredIds(items);
    const views = new Map<string, VacancyFitView>();
    for (let start = 0; start < ids.length; start += FIT_REFRESH_SLICE) {
      for (const entry of reader.read(ids.slice(start, start + FIT_REFRESH_SLICE))) {
        views.set(...entry);
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    fitViewsCache.write(key, views);
  } catch {
    // Прежний порядок остаётся в силе, а следующее чтение после окна
    // попробует пересчёт снова: отказ фона не должен ронять список.
  } finally {
    refreshingFitViews.delete(key);
  }
}

function orderByFit(
  items: readonly MatchedVacancyItem[],
  views: FitViews,
  sort: 'fit' | 'freshness',
): MatchedVacancyItem[] {
  const decorated = items.map((item) => {
    const fitView = views.get(item.cluster.id);
    return fitView
      ? { ...item, explanation: explanationWithFitView(item.explanation, fitView) }
      : item;
  });
  return decorated.sort((left, right) => compareFitOrder(left, right, sort));
}

/**
 * Показанная страница получает текущее состояние разбора для каждой вакансии:
 * «в очереди», «нет описания», свежий процент — без окна кэша порядка.
 */
export function withShownPageFitViews(
  deps: RouteDeps,
  candidateId: string,
  items: readonly MatchedVacancyItem[],
): MatchedVacancyItem[] {
  const runtime = deps.vacancyMechanics;
  if (!runtime) return [...items];
  const context = createVacancyFitContextReader(deps, candidateId);
  return items.map((item) => {
    const target = readVacancyFitTarget(deps, item.cluster.id);
    if (!target) return item;
    const fitView = compactFitView(runtime.view(context(target, [])));
    return { ...item, explanation: explanationWithFitView(item.explanation, fitView) };
  });
}

type Explanation = MatchedVacancyItem['explanation'];
const COVERAGE_SENTENCE = /^Совпало \d+ из \d+ требований вакансии\./u;

/**
 * Строка и раскрытая карточка считают требования одним разбором: счёт правил по
 * тегам («2 из 3») уступает разбору требований из текста, когда тот готов (B525).
 */
export function explanationWithFitView(
  explanation: Explanation,
  fitView: VacancyFitView,
): Explanation {
  const coverage = fitView.result?.coverage;
  if (!coverage || coverage.total === 0) return { ...explanation, fitView };
  const sentence = `Совпало ${coverage.matched} из ${coverage.total} требований вакансии.`;
  return {
    ...explanation,
    fitView,
    requirements: { matched: coverage.matched, total: coverage.total },
    summary: COVERAGE_SENTENCE.test(explanation.summary)
      ? explanation.summary.replace(COVERAGE_SENTENCE, sentence)
      : `${sentence} ${explanation.summary}`,
  };
}

const FIT_PAGE_LIMIT = 20;

/**
 * Страница списка режется по байтам: полный разбор (тексты требований, цитаты
 * фактов) на каждой вакансии оставлял одну вакансию на странице. В списке —
 * только сводка; раскрытая карточка читает полный разбор сама.
 */
export function compactFitView(view: VacancyFitView): VacancyFitView {
  return {
    ...view,
    requirements: [],
    ...(view.result ? { result: { ...view.result, assessments: [] } } : {}),
  };
}

/** Вакансии страницы без расчёта или с упавшим расчётом (B524). */
export function vacanciesAwaitingFit(items: readonly MatchedVacancyItem[]): string[] {
  return (
    items
      // Упавший расчёт (провайдер недоступен) повторяется при следующем показе, а не ждёт нажатия.
      // `refreshing` shows the previous version's percent: the current one still has to be queued (B562-r).
      .filter((item) =>
        ['not_requested', 'failed', 'refreshing'].includes(item.explanation.fitView?.state ?? ''),
      )
      .slice(0, FIT_PAGE_LIMIT)
      .map((item) => item.cluster.id)
  );
}

const WARM_UNCOUNTED_LIMIT = 20;
const WARM_STATES = new Set(['not_requested', 'failed', 'refreshing', 'no_description']);

/**
 * 28.10: строка без процента стоит после посчитанных, поэтому в первую страницу не попадает
 * и полный текст (hh.ru) для неё не дочитывался — «нет описания» навсегда. Греются верх
 * списка и лучшие непосчитанные строки ниже него: их текст и расчёт.
 */
export function vacanciesToWarm(
  items: readonly MatchedVacancyItem[],
  limit = WARM_UNCOUNTED_LIMIT,
): string[] {
  const top = items.slice(0, limit).map((item) => item.cluster.id);
  const uncounted = items
    .slice(limit)
    .filter((item) => {
      const state = item.explanation.fitView?.state;
      return state === undefined || WARM_STATES.has(state);
    })
    .slice(0, limit)
    .map((item) => item.cluster.id);
  return [...top, ...uncounted];
}

/** Ставит расчёт для перечисленных вакансий, которым он ещё нужен (после дочитывания текста). */
/** `backgroundRank` — the first row's place in the selection sweep; absent for rows on screen. */
export function requestFitForVacancyIds(
  deps: RouteDeps,
  candidateId: string,
  vacancyIds: readonly string[],
  backgroundRank?: number,
): void {
  const runtime = deps.vacancyMechanics;
  if (!runtime) return;
  const context = createVacancyFitContextReader(deps, candidateId);
  vacancyIds.forEach((id, index) => {
    const target = readVacancyFitTarget(deps, id);
    if (!target) return;
    const input = context(target, []);
    if (!['not_requested', 'failed'].includes(runtime.view(input).state)) return;
    runtime.enqueue(
      input,
      backgroundRank === undefined ? {} : { backgroundRank: backgroundRank + index },
    );
  });
}

/**
 * Показанная страница сама ставит расчёт в очередь фонового воркера: процент
 * появляется по мере обработки, без кнопки на каждой вакансии. Расход
 * ограничен бюджетом B522 в воркере.
 */
export function requestFitForShownPage(
  deps: RouteDeps,
  candidateId: string,
  items: readonly MatchedVacancyItem[],
): void {
  const runtime = deps.vacancyMechanics;
  if (!runtime) return;
  const context = createVacancyFitContextReader(deps, candidateId);
  for (const id of vacanciesAwaitingFit(items)) {
    const target = readVacancyFitTarget(deps, id);
    if (target) runtime.enqueue(context(target, []));
  }
}

export function compareFitOrder(
  left: MatchedVacancyItem,
  right: MatchedVacancyItem,
  sort: 'fit' | 'freshness' = 'fit',
): number {
  if (sort === 'freshness') {
    const time = (item: MatchedVacancyItem) => {
      const timestamp = Date.parse(item.cluster.firstObservedAt);
      return Number.isFinite(timestamp) ? timestamp : 0;
    };
    return time(right) - time(left) || compareMatchedVacancies(left, right);
  }
  // 28.10 mockup: the order the row's percent promises — descending; rows without one go last.
  return (
    compareFitPercent(left.explanation.fitView, right.explanation.fitView) ||
    compareMatchedVacancies(left, right)
  );
}
