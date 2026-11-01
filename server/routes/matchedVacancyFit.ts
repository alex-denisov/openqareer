import { compareMatchedVacancies } from '../../shared/vacancyMatchOrder';
import {
  compareFitDirected,
  compareMoney,
  DEFAULT_VACANCY_SORT,
  type VacancySort,
} from '../../shared/vacancySort';
import { createMoneyReader, type MoneyReader } from './matchedVacancyMoney';
import type { RouteDeps } from './deps';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import type { VacancyFitView } from '../../shared/vacancyFit';
import { vacancyFitStage } from '../../shared/vacancyFitPercent';
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
  sort: VacancySort = DEFAULT_VACANCY_SORT,
) {
  const money = sort.by === 'money' ? createMoneyReader(deps) : undefined;
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
      return orderByFit(items, views, sort, money);
    }
    if (known.stale && reader) void refreshFitViews(key, reader, items);
    const landed = reader ? viewsLandedSince(known.value, reader.scoredIds(items)) : [];
    if (landed.length === 0) return orderByFit(items, known.value, sort, money);
    const patched = new Map([...known.value, ...reader!.read(landed)]);
    fitViewsCache.write(key, patched);
    return orderByFit(items, patched, sort, money);
  };
}

/** Порядок подборки и то, от чего он зависит помимо выдачи (ключ кэша списка). */
export type MatchedOrder = ((items: readonly MatchedVacancyItem[]) => MatchedVacancyItem[]) & {
  readonly cacheKey: string;
};

/**
 * 28.10: «по совпадению» ведёт процент; вакансии компаний «Хочу» поднимаются только
 * среди вакансий с тем же процентом (B422 стал вторым ключом). «Деньги» отметку не учитывают.
 */
export function withWantedCompanyOrder(
  deps: RouteDeps,
  candidateId: string,
  sort: VacancySort = DEFAULT_VACANCY_SORT,
): MatchedOrder {
  const byFit = withVacancyFitOrder(deps, candidateId, sort);
  if (sort.by !== 'fit') return Object.assign(byFit, { cacheKey: '' });
  const wanted = wantedCompanyKeys(deps.candidateCompanyWantsRepo, candidateId);
  // Кэш списка держит уже упорядоченную подборку: новая отметка должна давать новый ключ.
  // 01.11: a result that landed must reach the ordered list too, not wait out the list window.
  const scored = deps.vacancyMechanics?.cachedVacancyIds(candidateId).size ?? 0;
  const cacheKey = [...wanted].sort().join(',') + (scored > 0 ? `|${scored}` : '');
  return Object.assign(
    (items: readonly MatchedVacancyItem[]): MatchedVacancyItem[] =>
      wantedCompaniesBreakTies(byFit(items), wanted, (left, right) =>
        compareFitDirected(left.explanation.fitView, right.explanation.fitView, sort.dir),
      ),
    { cacheKey },
  );
}

/** Rows read on one list request when their percent landed after the order snapshot. */
export const LANDED_FIT_READ_LIMIT = 200;

/**
 * 01.11 (prod 589377dc): the order came from a snapshot up to a window old, so percents the sweep
 * counted meanwhile showed on the page but did not move the row. Rows with a stored result that
 * the snapshot has not counted yet are read again at once.
 */
export function viewsLandedSince(
  known: FitViews,
  scoredIds: readonly string[],
  limit = LANDED_FIT_READ_LIMIT,
): string[] {
  return scoredIds
    .filter((id) => {
      const view = known.get(id);
      return !view || view.state === 'refreshing' || vacancyFitStage(view) === 'counting';
    })
    .slice(0, limit);
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
        views.set(id, compactFitView(textStillLoading(id, target.description, view)));
      }
      return views;
    },
  };
}

const HH_CLUSTER_PREFIX = 'cluster-src-hh-search:';

/**
 * 01.11: an hh row whose text the background loader has not read yet is still counting, not
 * «мало требований»: the search page carries no text, so «no description» is not its verdict.
 */
export function textStillLoading(
  clusterId: string,
  description: string,
  view: VacancyFitView,
): VacancyFitView {
  if (view.state !== 'no_description' || !clusterId.startsWith(HH_CLUSTER_PREFIX)) return view;
  if (description?.trim()) return view;
  return { ...view, state: 'not_requested' };
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
  sort: VacancySort,
  money?: MoneyReader,
): MatchedVacancyItem[] {
  const decorated = items.map((item) => {
    const fitView = views.get(item.cluster.id);
    return fitView
      ? { ...item, explanation: explanationWithFitView(item.explanation, fitView) }
      : item;
  });
  if (sort.by !== 'money' || !money) {
    return decorated.sort((left, right) => compareFitOrder(left, right, sort));
  }
  const amounts = new Map(decorated.map((item) => [item.cluster.id, money(item)]));
  return decorated.sort(
    (left, right) =>
      compareMoney(amounts.get(left.cluster.id), amounts.get(right.cluster.id), sort.dir) ||
      compareFitOrder(left, right),
  );
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
    const view = runtime.view(context(target, []));
    const fitView = compactFitView(textStillLoading(item.cluster.id, target.description, view));
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
  const withPoints = explanationWithFitPoints(explanation, fitView);
  const coverage = fitView.result?.coverage;
  if (!coverage || coverage.total === 0) return { ...withPoints, fitView };
  const sentence = `Совпало ${coverage.matched} из ${coverage.total} требований вакансии.`;
  return {
    ...withPoints,
    fitView,
    requirements: { matched: coverage.matched, total: coverage.total },
    summary: COVERAGE_SENTENCE.test(explanation.summary)
      ? explanation.summary.replace(COVERAGE_SENTENCE, sentence)
      : `${sentence} ${explanation.summary}`,
  };
}

const FIT_PAGE_LIMIT = 20;
const MAX_FIT_POINTS = 24;
const MAX_FIT_POINT_CHARS = 120;

/**
 * 01.11: with a fit result the card's lists are its verdicts, so a 100 % card never lists
 * «Не хватает» items from the older term matcher; without one the old lists are preliminary.
 */
function explanationWithFitPoints(explanation: Explanation, fitView: VacancyFitView): Explanation {
  const points = fitView.points;
  if (!fitView.result || !points?.length) return { ...explanation, pointsSource: 'preliminary' };
  const texts = (statuses: readonly string[]) =>
    points.filter((point) => statuses.includes(point.status)).map((point) => point.text);
  const matchingPoints = texts(['matched']);
  const missingPoints = texts(['unmatched', 'unknown']);
  return {
    ...explanation,
    matchingPoints,
    partialPoints: texts(['partial']),
    missingPoints,
    matchingFacts: matchingPoints.map((text) => ({ text })),
    matchingCount: matchingPoints.length,
    missingCount: missingPoints.length,
    pointsSource: 'fit',
  };
}

/**
 * Страница списка режется по байтам: полный разбор (тексты требований, цитаты
 * фактов) на каждой вакансии оставлял одну вакансию на странице. В списке —
 * только сводка; раскрытая карточка читает полный разбор сама.
 */
export function compactFitView(view: VacancyFitView): VacancyFitView {
  const text = new Map(view.requirements.map((item) => [item.id, item.text]));
  const points = (view.result?.assessments ?? [])
    .filter((item) => text.has(item.requirementId))
    .slice(0, MAX_FIT_POINTS)
    .map((item) => ({
      text: (text.get(item.requirementId) ?? '').slice(0, MAX_FIT_POINT_CHARS),
      status: item.status,
    }));
  return {
    ...view,
    requirements: [],
    ...(points.length ? { points } : {}),
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
    // 01.11: `refreshing` shows the old version's percent; the sweep queues the current one too.
    if (!['not_requested', 'failed', 'refreshing'].includes(runtime.view(input).state)) return;
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

/** «Совпадение» in the chosen direction; rows that cannot be counted go last (29.10). */
export function compareFitOrder(
  left: MatchedVacancyItem,
  right: MatchedVacancyItem,
  sort: Pick<VacancySort, 'dir'> = DEFAULT_VACANCY_SORT,
): number {
  return (
    compareFitDirected(left.explanation.fitView, right.explanation.fitView, sort.dir) ||
    compareMatchedVacancies(left, right)
  );
}
