import { compareMatchedVacancies } from '../../shared/vacancyMatchOrder';
import type { RouteDeps } from './deps';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import type { VacancyFitView } from '../../shared/vacancyFit';
import { createVacancyFitContextReader, readVacancyFitTarget } from './vacancyFitContext';
import { vacancyFitProfileStamp } from '../domain/vacancyFitProfileStamp';
import { createCandidateWindowCache } from './candidateWindowCache';
import { wantedCompaniesFirst, wantedCompanyKeys } from '../domain/wantedCompanyOrder';

const FIT_ORDER_WINDOW_MS = 60_000;
/** Столько точных разборов считается между уступками event loop при фоновом пересчёте. */
const FIT_REFRESH_SLICE = 25;
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

/**
 * B422: в порядке «по соответствию» вакансии компаний «Хочу» идут первыми,
 * внутри групп — порядок разбора. Свежесть отметку не учитывает.
 */
export function withWantedCompanyOrder(
  deps: RouteDeps,
  candidateId: string,
  sort: 'fit' | 'freshness' = 'fit',
) {
  const byFit = withVacancyFitOrder(deps, candidateId, sort);
  if (sort !== 'fit') return byFit;
  const wanted = wantedCompanyKeys(deps.candidateCompanyWantsRepo, candidateId);
  return (items: readonly MatchedVacancyItem[]): MatchedVacancyItem[] =>
    wantedCompaniesFirst(byFit(items), wanted);
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
      for (const id of ids) {
        const target = readVacancyFitTarget(deps, id);
        if (target) views.set(id, compactFitView(runtime.view(context(target, []))));
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
    return fitView ? { ...item, explanation: { ...item.explanation, fitView } } : item;
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
    return { ...item, explanation: { ...item.explanation, fitView } };
  });
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
      .filter((item) => ['not_requested', 'failed'].includes(item.explanation.fitView?.state ?? ''))
      .slice(0, FIT_PAGE_LIMIT)
      .map((item) => item.cluster.id)
  );
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
  const a = left.explanation.fitView?.result;
  const b = right.explanation.fitView?.result;
  const score = (result: typeof a) =>
    result?.status === 'assessed' ? result.coveragePercent : null;
  const aScore = score(a),
    bScore = score(b);
  if (aScore === null && bScore !== null) return 1;
  if (aScore !== null && bScore === null) return -1;
  if (aScore !== null && bScore !== null) {
    const mandatory =
      a?.requiredCoverage.percent !== null && b?.requiredCoverage.percent !== null
        ? (b?.requiredCoverage.percent ?? 0) - (a?.requiredCoverage.percent ?? 0)
        : 0;
    return mandatory || bScore - aScore || compareMatchedVacancies(left, right);
  }
  return compareMatchedVacancies(left, right);
}
