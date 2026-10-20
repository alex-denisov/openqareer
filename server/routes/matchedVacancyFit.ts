import { compareMatchedVacancies } from '../../shared/vacancyMatchOrder';
import type { RouteDeps } from './deps';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import type { VacancyFitView } from '../../shared/vacancyFit';
import { createVacancyFitContextReader, readVacancyFitTarget } from './vacancyFitContext';
import { vacancyFitProfileStamp } from '../domain/vacancyFitProfileStamp';
import { createFitOrderCache } from './fitOrderCache';

const FIT_ORDER_WINDOW_MS = 60_000;
const fitOrderCache = createFitOrderCache<MatchedVacancyItem>(FIT_ORDER_WINDOW_MS);

/** Runs before pagination, so a cached match on a later page can move to the front. */
export function withVacancyFitOrder(
  deps: RouteDeps,
  candidateId: string,
  sort: 'fit' | 'freshness' = 'fit',
) {
  const context = deps.vacancyMechanics
    ? createVacancyFitContextReader(deps, candidateId)
    : undefined;
  const stamp = context
    ? vacancyFitProfileStamp(
        deps.candidateStore.getSnapshot(candidateId),
        deps.candidateStore.getCandidateWorkspace(candidateId),
      )
    : 'none';
  return (items: readonly MatchedVacancyItem[]): MatchedVacancyItem[] => {
    const key = [
      candidateId,
      sort,
      stamp,
      items.length,
      items[0]?.cluster.id,
      items.at(-1)?.cluster.id,
    ].join('|');
    return [...fitOrderCache.read(key, () => decorateAndSort(items))];
  };

  function decorateAndSort(items: readonly MatchedVacancyItem[]): MatchedVacancyItem[] {
    const decorated = items.map((item) => {
      if (!context || !deps.vacancyMechanics) return item;
      const target = readVacancyFitTarget(deps, item.cluster.id);
      if (!target) return item;
      const fitView = compactFitView(deps.vacancyMechanics.view(context(target, [])));
      return { ...item, explanation: { ...item.explanation, fitView } };
    });
    return decorated.sort((left, right) => compareFitOrder(left, right, sort));
  }
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
