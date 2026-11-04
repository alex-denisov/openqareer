import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
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
import { createGeoBlocker } from './vacancyFitGeoBlocks';
import { vacancyFitProfileStamp } from '../domain/vacancyFitProfileStamp';
import { createCandidateWindowCache } from './candidateWindowCache';
import { mapYielding } from '../vacancies/mapYielding';
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
const preparingFitViews = new Map<string, Promise<number>>();

/** Where a failed background write of the fit order goes (the request's logger on the route). */
interface FitOrderLog {
  warn(details: { readonly errorName: string; readonly rows: number }, message: string): void;
}

/**
 * `background` builds the order with no reader waiting: it only reads. Queueing belongs to a read:
 * every 5 minutes for every recent candidate it would pass the day's ceiling on recounts (04.11)
 * and put absent candidates' rows ahead of the shown ones.
 */
export type FitOrderUse = 'read' | 'background';

/**
 * Runs before pagination, so a cached match on a later page can move to the front.
 *
 * PRB-040: точный разбор всех вакансий с результатом стоил на проде ~4 с
 * синхронного SQL и стоял перед первой страницей каждые 60 с. Вышедшее окно
 * больше не держит ответ: порядок строится по прежним разборам, а свежие
 * считаются в фоне порциями, уступая event loop. Синхронно — только первый
 * раз для этого профиля, когда прежних разборов нет.
 *
 * PRB-041 (prod 03.11): the read that still ran in one piece was this one, inside the page build,
 * with each stale row's retry, seal and queue write on top. `prepare` reads the same views in
 * slices before the build, so the build only sorts; a caller that skips it reads in one piece.
 */
export function withVacancyFitOrder(
  deps: RouteDeps,
  candidateId: string,
  sort: VacancySort = DEFAULT_VACANCY_SORT,
  log?: FitOrderLog,
  use: FitOrderUse = 'read',
) {
  const money = sort.by === 'money' ? createMoneyReader(deps) : undefined;
  const reader = createFitViewReader(deps, candidateId, log, use);
  const stamp = reader
    ? vacancyFitProfileStamp(
        deps.candidateStore.getSnapshot(candidateId),
        deps.candidateStore.getCandidateWorkspace(candidateId),
      )
    : 'none';
  const key = `${candidateId}|${stamp}`;
  let prepared = false;
  const order = (items: readonly MatchedVacancyItem[]): MatchedVacancyItem[] => {
    const known = fitViewsCache.peek(key);
    if (!known) {
      const views = reader
        ? reader.read(reader.scoredIds(items))
        : new Map<string, VacancyFitView>();
      fitViewsCache.write(key, views);
      return orderByFit(items, views, sort, money);
    }
    if (prepared) return orderByFit(items, known.value, sort, money);
    if (known.stale && reader) void refreshFitViews(key, reader, items);
    const landed = reader ? viewsLandedSince(known.value, reader.scoredIds(items)) : [];
    if (landed.length === 0) return orderByFit(items, known.value, sort, money);
    const patched = new Map([...known.value, ...reader!.read(landed)]);
    fitViewsCache.write(key, patched);
    return orderByFit(items, patched, sort, money);
  };
  const prepare = async (items: readonly MatchedVacancyItem[]): Promise<number> => {
    const rows = reader ? await prepareFitViews(key, reader, items) : 0;
    prepared = true;
    return rows;
  };
  return Object.assign(order, { prepare, fitStamp: stamp });
}

/** Порядок подборки и то, от чего он зависит помимо выдачи (ключ кэша списка). */
export type MatchedOrder = ((items: readonly MatchedVacancyItem[]) => MatchedVacancyItem[]) & {
  /** What the candidate chose about the order: a change is seen at once, never served from the old list. */
  readonly cacheKey: string;
  /** What landed from the sweep: a change rebuilds the list behind the reader. */
  readonly dataKey: string;
  /** The profile the percents were counted for. */
  readonly fitStamp: string;
  /** Reads the percents the order needs without holding the event loop; call before the order. Resolves to the rows read. */
  readonly prepare: (items: readonly MatchedVacancyItem[]) => Promise<number>;
};

/**
 * 28.10: «по совпадению» ведёт процент; вакансии компаний «Хочу» поднимаются только
 * среди вакансий с тем же процентом (B422 стал вторым ключом). «Деньги» отметку не учитывают.
 */
export function withWantedCompanyOrder(
  deps: RouteDeps,
  candidateId: string,
  sort: VacancySort = DEFAULT_VACANCY_SORT,
  log?: FitOrderLog,
  use: FitOrderUse = 'read',
): MatchedOrder {
  const byFit = withVacancyFitOrder(deps, candidateId, sort, log, use);
  if (sort.by !== 'fit') return Object.assign(byFit, { cacheKey: '', dataKey: '' });
  const wanted = wantedCompanyKeys(deps.candidateCompanyWantsRepo, candidateId);
  // Кэш списка держит уже упорядоченную подборку: новая отметка должна давать новый ключ.
  const cacheKey = [...wanted].sort().join(',');
  // 01.11: a result that landed must reach the ordered list too, not wait out the list window.
  const dataKey = String(deps.vacancyMechanics?.cachedVacancyIds(candidateId).size ?? 0);
  return Object.assign(
    (items: readonly MatchedVacancyItem[]): MatchedVacancyItem[] =>
      wantedCompaniesBreakTies(byFit(items), wanted, (left, right) =>
        compareFitDirected(left.explanation.fitView, right.explanation.fitView, sort.dir),
      ),
    { cacheKey, dataKey, prepare: byFit.prepare, fitStamp: byFit.fitStamp },
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
  readYielding(ids: readonly string[]): Promise<Map<string, VacancyFitView>>;
}

function createFitViewReader(
  deps: RouteDeps,
  candidateId: string,
  log: FitOrderLog | undefined,
  use: FitOrderUse,
): FitViewReader | undefined {
  const runtime = deps.vacancyMechanics;
  if (!runtime) return undefined;
  const context = createVacancyFitContextReader(deps, candidateId);
  const geoBlocks = createGeoBlocker(deps, candidateId);
  const readRow = (id: string) => {
    const target = readVacancyFitTarget(deps, id);
    if (!target) return undefined;
    const input = context(target, []);
    const view = runtime.view(input, { queueRequirements: use === 'read' });
    const compact = compactFitView(
      geoBlocks(target, textStillLoading(id, target.description, view, target.fullText, target.textHidden)),
    );
    const stale = view.state === 'not_requested' || view.state === 'refreshing';
    return { id, view: compact, staleInput: stale ? input : undefined };
  };
  const collect = (rows: readonly (ReturnType<typeof readRow>)[]) => {
    const present = rows.flatMap((row) => (row ? [row] : []));
    if (use === 'read') {
      requeueStaleRows(
        runtime,
        present.flatMap((row) => (row.staleInput ? [row.staleInput] : [])),
        log,
      );
    }
    return new Map(present.map((row) => [row.id, row.view]));
  };
  return {
    // Точный разбор дорог (отпечатки всех фактов, проверка результата, полный
    // текст вакансии) — только для вакансий с сохранённым результатом.
    scoredIds(items) {
      const scored = runtime.cachedVacancyIds(candidateId);
      return items.map((item) => item.cluster.id).filter((id) => scored.has(id));
    },
    read: (ids) => collect(ids.map(readRow)),
    readYielding: async (ids) => collect(await mapYielding(ids, readRow)),
  };
}

/** PRB-041: each row retries, seals and writes, so it runs after the read and in slices. */
function requeueStaleRows<Input>(
  runtime: { enqueue(input: Input): unknown },
  inputs: readonly Input[],
  log?: FitOrderLog,
): void {
  if (inputs.length === 0) return;
  const rows = inputs.slice(0, STALE_REFIT_LIMIT);
  void yieldToEventLoop()
    .then(() => mapYielding(rows, (input) => runtime.enqueue(input)))
    .catch((error: unknown) =>
      log?.warn(
        { errorName: error instanceof Error ? error.name : 'UnknownError', rows: rows.length },
        'fit-requeue-failed',
      ),
    );
}

function prepareFitViews(
  key: string,
  reader: FitViewReader,
  items: readonly MatchedVacancyItem[],
): Promise<number> {
  const running = preparingFitViews.get(key);
  if (running) return running;
  const work = readViewsAhead(key, reader, items).finally(() => preparingFitViews.delete(key));
  preparingFitViews.set(key, work);
  return work;
}

async function readViewsAhead(
  key: string,
  reader: FitViewReader,
  items: readonly MatchedVacancyItem[],
): Promise<number> {
  const known = fitViewsCache.peek(key);
  if (!known) {
    const views = await reader.readYielding(reader.scoredIds(items));
    fitViewsCache.write(key, views);
    return views.size;
  }
  if (known.stale) void refreshFitViews(key, reader, items);
  const landed = viewsLandedSince(known.value, reader.scoredIds(items));
  if (landed.length === 0) return 0;
  const read = await reader.readYielding(landed);
  // A background refresh may have written while this read yielded; its views stay.
  fitViewsCache.write(key, new Map([...(fitViewsCache.peek(key)?.value ?? known.value), ...read]));
  return read.size;
}

const HH_CLUSTER_PREFIX = 'cluster-src-hh-search:';

/**
 * 01.11: an hh row whose text the background loader has not read yet is still counting, not
 * «мало требований»: the search page carries no text, so «no description» is not its verdict.
 * 02.11 АЙСБЕРРИ: neither is «no requirements» read from the search snippet before the full text.
 */
export function textStillLoading(
  clusterId: string,
  description: string,
  view: VacancyFitView,
  fullText = Boolean(description?.trim()),
  textHidden = false,
): VacancyFitView {
  if (!clusterId.startsWith(HH_CLUSTER_PREFIX)) return view;
  // 02.11: the employer hid the text, so «считаем» would never end.
  if (textHidden && !fullText) {
    const { result: _snippetResult, ...rest } = view;
    return { ...rest, state: 'no_description', textHidden: true };
  }
  const loading =
    (view.state === 'no_description' && !description?.trim()) ||
    (view.state === 'no_requirements' && !fullText);
  return loading ? { ...view, state: 'not_requested' } : view;
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
      await yieldToEventLoop();
      for (const entry of await reader.readYielding(ids.slice(start, start + FIT_REFRESH_SLICE))) {
        views.set(...entry);
      }
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
export async function withShownPageFitViews(
  deps: RouteDeps,
  candidateId: string,
  items: readonly MatchedVacancyItem[],
): Promise<MatchedVacancyItem[]> {
  const runtime = deps.vacancyMechanics;
  if (!runtime) return [...items];
  const context = createVacancyFitContextReader(deps, candidateId);
  const geoBlocks = createGeoBlocker(deps, candidateId);
  return mapYielding(items, (item) => {
    const target = readVacancyFitTarget(deps, item.cluster.id);
    if (!target) return item;
    const view = runtime.view(context(target, []));
    const fitView = compactFitView(
      geoBlocks(
        target,
        textStillLoading(
          item.cluster.id,
          target.description,
          view,
          target.fullText,
          target.textHidden,
        ),
      ),
    );
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
  const implied = new Set((view.result?.implied ?? []).map((item) => item.requirementId));
  const points = (view.result?.assessments ?? [])
    .filter((item) => text.has(item.requirementId))
    .slice(0, MAX_FIT_POINTS)
    .map((item) => ({
      text: (text.get(item.requirementId) ?? '').slice(0, MAX_FIT_POINT_CHARS),
      status: implied.has(item.requirementId) ? ('matched' as const) : item.status,
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
/**
 * PRB-041 (prod 03.11): a preload callback or a sweep chunk queued its rows in one piece — up to
 * 1 s on the event loop for one page. Rows are queued in slices, letting queued requests run.
 */
export async function requestFitForVacancyIds(
  deps: RouteDeps,
  candidateId: string,
  vacancyIds: readonly string[],
  backgroundRank?: number,
  slicing: { readonly sliceMs?: number; readonly now?: () => number } = {},
  refreshSlot?: () => boolean,
): Promise<void> {
  const runtime = deps.vacancyMechanics;
  if (!runtime) return;
  const context = createVacancyFitContextReader(deps, candidateId);
  await mapYielding(
    vacancyIds.map((id, index) => ({ id, index })),
    ({ id, index }) => {
      const target = readVacancyFitTarget(deps, id);
      if (!target) return;
      const input = context(target, []);
      // 02.11 prod profile: the sweep opened every counted row's result to learn it was counted.
      if (backgroundRank !== undefined && runtime.hasCurrentResult(input)) return;
      // 01.11: `refreshing` shows the old version's percent; the sweep queues the current one too.
      const state = runtime.view(input).state;
      if (!['not_requested', 'failed', 'refreshing'].includes(state)) return;
      // Only the background precompute passes a slot: a counted row keeps its old percent past the day's ceiling.
      // 04.11: a row with its job held spent a slot on every sweep and queued nothing.
      if (state === 'refreshing' && refreshSlot && (runtime.fitJobHoldsKey(input) || !refreshSlot())) return;
      runtime.enqueue(input, {
        ...(backgroundRank === undefined ? {} : { backgroundRank: backgroundRank + index }),
        // `refreshing` has just spent its slot above.
        ...(refreshSlot && state !== 'refreshing' ? { reviveSlot: refreshSlot } : {}),
      });
    },
    slicing,
  );
}

/**
 * Показанная страница сама ставит расчёт в очередь фонового воркера: процент
 * появляется по мере обработки, без кнопки на каждой вакансии. Расход
 * ограничен бюджетом B522 в воркере.
 *
 * PRB-041: each row's enqueue retries, seals and writes; a 100-row page did it in one piece
 * (1.3 s, 6 s at offset 333 on prod 03.11), so rows go in slices with turns between them.
 */
export async function requestFitForShownPage(
  deps: RouteDeps,
  candidateId: string,
  items: readonly MatchedVacancyItem[],
  slicing: { readonly sliceMs?: number; readonly now?: () => number } = {},
): Promise<void> {
  const runtime = deps.vacancyMechanics;
  if (!runtime) return;
  const context = createVacancyFitContextReader(deps, candidateId);
  await mapYielding(
    vacanciesAwaitingFit(items),
    (id) => {
      const target = readVacancyFitTarget(deps, id);
      if (target) runtime.enqueue(context(target, []));
    },
    slicing,
  );
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
