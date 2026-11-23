import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  B640_SORT_DIRECTIONS,
  B640_SORT_KEYS,
} from '../../shared/b640Vacancies';
import { meetsMonthlySalaryMinimum } from '../../shared/monthlySalaryMinimum';
import { DEFAULT_VACANCY_SORT, type VacancySort } from '../../shared/vacancySort';
import { getCurrencyRates } from '../currency/cbrRates';
import { sortMatchedByColumn, type ColumnSortKey } from '../vacancies/matchedColumnSort';
import { cachedMatchedSourceRegistry } from '../vacancies/matchedSourceRegistryCache';
import {
  matchedVacanciesQuerySchema,
  type MatchedVacancyFilters,
} from '../vacancies/matchedVacancyFilters';
import { trim } from '../vacancies/matchedVacancyPage';
import { readMatchedSnapshot } from '../vacancies/matchedPoolContext';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { addStoredVacancyLevels } from '../vacancies/storedVacancyLevels';
import {
  campaignMeta,
  invalidQuery,
  nextOffsetOf,
  pagingSchema,
  profileIsEmpty,
  readB640ListContext,
  sessionCandidate,
  type B640ListContext,
} from './b640VacancyContext';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { withShownPageFitViews, withWantedCompanyOrder } from './matchedVacancyFit';
import { readMatchedList } from './matchedVacancyList';
import { fitWorkIds, prepareMatchedRead, startFitWork, startShownPageFit, withMarketSalary } from './matchedVacancyRoutes';
import { readB640Sealed } from './b640SealedAnswer';
import { careerTimeZone, observedWithinDays } from './careerRoleCounts';
import { selectionFitLimit } from './fitSelectionSweep';
import { candidatePlan, withDeps } from './helpers';
import { titleFactsCount } from './matchedFitRelevance';
import { withRequestScopedCandidateReads } from './requestScopedCandidateReads';


/** Валюты фильтра «Зарплата» списка (MoneyCurrency без «как в вакансии» — она считается в рублях). */
const MONEY_FILTER_CURRENCIES = ['RUB', 'USD', 'EUR', 'AED'] as const;

const querySchema = matchedVacanciesQuerySchema
  .omit({ sort: true, dir: true, offset: true })
  .extend({
    ...pagingSchema,
    sort: z.enum(B640_SORT_KEYS).default('fit'),
    direction: z.enum(B640_SORT_DIRECTIONS).default('desc'),
    /**
     * B726: фильтр «Дата» на сервере — те же дни и та же граница дня, что у числа роли «Карьеры».
     * Без него в серверном порядке число подборки с «Датой» было неизвестно, пока не дочитаны все порции.
     */
    days: z.coerce.number().int().min(0).max(366).optional(),
    tz: z.string().max(64).optional(),
    /**
     * B765 (B645 s07): «Зарплата от» в месяц, в валюте `moneyCurrency`, — тоже на сервере, иначе
     * «Показать N» и «осталось N» не знали числа, пока подборка не дочитана.
     */
    money: z.coerce.number().int().min(1).max(1_000_000_000).optional(),
    moneyCurrency: z.enum(MONEY_FILTER_CURRENCIES).default('RUB'),
  });
type Query = z.infer<typeof querySchema>;

/**
 * Список строится ровно с тем выбором, который взял бы прежний маршрут: запомненная сортировка
 * читается без записи. Так ключ запечатанной строки и список в памяти те же, и новый маршрут
 * ничего в них не меняет. Порядок запроса ложится в памяти поверх готового списка.
 */
function savedOrder(deps: RouteDeps, candidateId: string): VacancySort {
  return deps.candidateStore.getCandidateWorkspace(candidateId)?.vacancySort ?? DEFAULT_VACANCY_SORT;
}

/** Только фильтры подборки: страница и сортировка запроса не входят в ключ списка. */
function listFilters(query: Query, order: VacancySort): MatchedVacancyFilters {
  const { region, level, source, role, remote, place, placeRemote } = query;
  return { offset: 0, region, level, source, role, remote, place, placeRemote, sort: order.by, dir: order.dir };
}

/**
 * B776: основной вид подборки — только роли. Его список пишется в запечатанную строку, как у
 * прежнего маршрута, иначе после перезапуска первое открытие строило его заново (прод 23.11,
 * 13 ролей — 14–18 с). Сужающие фильтры не пишутся (B674): строк на кандидата четыре, и выбор
 * фильтров вытеснял бы общий список. Ключ строки — тот же выбор, что у чтения (`readB640Sealed`).
 */
function sealsMainView(filters: MatchedVacancyFilters): boolean {
  const { region, level, source, place, remote, placeRemote } = filters;
  return !remote && !placeRemote && [region, level, source, place].every((values) => !values?.length);
}

function emptyResponse(request: FastifyRequest, query: Query, context: B640ListContext) {
  return {
    data: [],
    meta: {
      requestId: request.id,
      reason: 'candidate_profile_unconfirmed',
      sort: { by: query.sort, direction: query.direction },
      total: 0,
      offset: query.offset,
      limit: query.limit,
      nextOffset: null,
      campaign: campaignMeta(context.campaign),
    },
  };
}

async function readList(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  context: B640ListContext,
  query: Query,
) {
  const startedAt = performance.now();
  const order = savedOrder(deps, candidateId);
  const filters = listFilters(query, order);
  const read = await prepareMatchedRead(deps, candidateId, context.targetRoles, order, request.log);
  const snapshotAt = performance.now();
  const snapshot = await readMatchedSnapshot(
    deps.multiSourceEngine,
    candidateId,
    context.confirmedSkills,
    context.targetRoles,
    context.targetLevel,
    context.geography,
  );
  const { registry: sourceRegistry } = cachedMatchedSourceRegistry(deps.multiSourceEngine);
  const listAt = performance.now();
  const { list, served } = await readMatchedList(
    {
      ...context,
      candidateStore: deps.candidateStore,
      titleParseStore: deps.titleParseStore,
      candidateId,
      snapshot,
      filters,
      sourceRegistry,
      order: read.order,
      seal: sealsMainView(filters),
      ...(typeof deps.multiSourceEngine.getCatalogTotals === 'function'
        ? { catalogTotals: () => deps.multiSourceEngine.getCatalogTotals!() }
        : {}),
    },
    request.log,
  );
  const timing: ListReadTiming = {
    served,
    setupMs: roundMs(snapshotAt - startedAt),
    snapshotMs: roundMs(listAt - snapshotAt),
    listReadMs: roundMs(performance.now() - listAt),
    ...(served === 'built'
      ? { prepareMs: list.prepareMs, listMs: list.listMs, phasesMs: list.phasesMs }
      : {}),
  };
  return { list, saved: order, fitLimit: read.fitLimit, targetLevel: read.targetLevel, timing };
}

/** B770: what the b640 list spent, by step; built lists carry their phases. */
interface ListReadTiming {
  readonly served: string;
  readonly setupMs: number;
  readonly snapshotMs: number;
  readonly listReadMs: number;
  readonly prepareMs?: number;
  readonly listMs?: number;
  readonly phasesMs?: Readonly<Record<string, number>>;
}

const roundMs = (ms: number): number => Number(ms.toFixed(2));

function logListTiming(
  request: FastifyRequest,
  query: Query,
  timing: ListReadTiming,
  orderMs: number,
): void {
  request.log.info(
    {
      ...timing,
      orderMs: roundMs(orderMs),
      offset: query.offset,
      sort: query.sort,
      titleFacts: titleFactsCount(),
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1_048_576),
    },
    'b640-matched-timing',
  );
}

type Rows = readonly MatchedVacancyItem[];

/** Порядок «Совпадение» или «Деньги» поверх готового списка; список уже в этом порядке — не трогаем. */
async function reordered(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  context: B640ListContext,
  rows: Rows,
  order: VacancySort,
): Promise<Rows> {
  const wanted = withWantedCompanyOrder(deps, candidateId, order, request.log, 'read', context.targetRoles);
  await wanted.prepare(rows);
  return wanted(rows);
}

interface Ordering {
  readonly rows: Rows;
  /** Те же строки по совпадению: по нему идёт подсчёт процентов, каким бы ни был столбец. */
  readonly byFit: Rows;
}

async function orderRows(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  context: B640ListContext,
  read: { readonly list: { readonly filtered: Rows }; readonly saved: VacancySort },
  query: Query,
): Promise<Ordering> {
  const { filtered } = read.list;
  const sameAsSaved = (order: VacancySort) => order.by === read.saved.by && order.dir === read.saved.dir;
  const arrange = (order: VacancySort) =>
    sameAsSaved(order) ? Promise.resolve(filtered) : reordered(deps, request, candidateId, context, filtered, order);
  const byFit = await arrange(DEFAULT_VACANCY_SORT);
  if (query.sort === 'fit' || query.sort === 'money') {
    return { byFit, rows: await arrange({ by: query.sort, dir: query.direction }) };
  }
  return { byFit, rows: sortMatchedByColumn(byFit, query.sort as ColumnSortKey, query.direction) };
}

/** B702: страница из списка прошлого процесса; проценты, уровни и деньги читаются как обычно. */
async function sealedAnswer(
  deps: RouteDeps,
  backgroundDeps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  context: B640ListContext,
  query: Query,
) {
  const saved = savedOrder(deps, candidateId);
  const slice = readB640Sealed(deps, backgroundDeps, request, {
    candidateId,
    context,
    filters: listFilters(query, saved),
    saved,
    sort: query.sort,
    direction: query.direction,
    offset: query.offset,
    limit: query.limit,
  });
  if (!slice) return undefined;
  const shown = slice.rows.map(trim);
  const levels = addStoredVacancyLevels(shown, context.targetLevel, (key) => deps.titleParseStore.getByKey(key));
  const data = withMarketSalary(deps, await withShownPageFitViews(deps, candidateId, levels));
  const fitLimit = selectionFitLimit(candidatePlan(deps, candidateId));
  startShownPageFit(backgroundDeps, candidateId, data, query.offset, fitLimit, request);
  request.log.info({ rows: slice.total, offset: query.offset }, 'b640-matched-served-sealed');
  return {
    data,
    meta: {
      requestId: request.id,
      sort: { by: query.sort, direction: query.direction },
      total: slice.total,
      offset: query.offset,
      limit: query.limit,
      nextOffset: nextOffsetOf(query.offset, shown.length, slice.total),
      campaign: campaignMeta(slice.campaignWithHypotheses),
      candidateLevel: context.targetLevel ?? null,
      ...(query.offset === 0 ? { facets: slice.facets } : {}),
    },
  };
}

/** Строки с месячной суммой не ниже `money` и строки без месячной суммы; без `money` — все. */
function withinMoney(rows: Rows, query: Query): Rows {
  const { money, moneyCurrency } = query;
  if (!money) return rows;
  const rates = getCurrencyRates();
  return rows.filter((item) => meetsMonthlySalaryMinimum(item.cluster.salary, money, moneyCurrency, rates));
}

/** Строки за последние `days` дней кандидата; без `days` — все. */
function withinDays(rows: Rows, query: Query): Rows {
  const { days } = query;
  if (!days) return rows;
  const now = new Date();
  const timeZone = careerTimeZone(query);
  return rows.filter((item) => observedWithinDays(item, days, now, timeZone));
}

const getMatchedVacancies = async (
  backgroundDeps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> => {
  const principal = requireCabinetB640(request, reply, backgroundDeps);
  if (!principal) return reply;
  const candidate = sessionCandidate(request, reply, principal.candidate);
  if (!candidate) return reply;
  const parsed = querySchema.safeParse(request.query);
  if (!parsed.success) return invalidQuery(request, reply);
  const query = parsed.data;
  const deps = withRequestScopedCandidateReads(backgroundDeps);
  const context = readB640ListContext(deps, candidate.id);
  if (profileIsEmpty(context)) return emptyResponse(request, query, context);
  // Запечатанный список прошлого процесса — без окна дат и суммы: с ними читаем список как обычно.
  const sealed = query.days || query.money
    ? undefined
    : await sealedAnswer(deps, backgroundDeps, request, candidate.id, context, query);
  if (sealed) return sealed;
  const read = await readList(deps, request, candidate.id, context, query);
  const { list, fitLimit, targetLevel } = read;
  const orderStartedAt = performance.now();
  const ordered = await orderRows(deps, request, candidate.id, context, read, query);
  logListTiming(request, query, read.timing, performance.now() - orderStartedAt);
  const { byFit } = ordered;
  const rows = withinMoney(withinDays(ordered.rows, query), query);
  const shown = rows.slice(query.offset, query.offset + query.limit).map(trim);
  const levels = addStoredVacancyLevels(shown, targetLevel, (key) => deps.titleParseStore.getByKey(key));
  const data = withMarketSalary(deps, await withShownPageFitViews(deps, candidate.id, levels));
  // Подсчёт процентов идёт по порядку совпадения, а не по выбранному столбцу.
  const work = fitWorkIds(byFit, query.offset, fitLimit);
  startFitWork(backgroundDeps, candidate.id, { ...work, data }, { offset: query.offset, fitLimit }, request);
  return {
    data,
    meta: {
      requestId: request.id,
      sort: { by: query.sort, direction: query.direction },
      total: rows.length,
      offset: query.offset,
      limit: query.limit,
      nextOffset: nextOffsetOf(query.offset, shown.length, rows.length),
      campaign: campaignMeta(list.campaignWithHypotheses),
      candidateLevel: targetLevel ?? null,
      ...(query.offset === 0 ? { facets: list.facets } : {}),
    },
  };
};

/**
 * B675: вся подборка кандидата по фильтрам списка, в порядке списка, для разбора «Помочь выбрать».
 * Читается тем же путём, что и список (без записи запечатанной строки); `null` — фильтры неверны.
 */
export async function readB640PoolRows(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  context: B640ListContext,
  filters: Readonly<Record<string, string>>,
): Promise<Rows | null> {
  const parsed = querySchema.safeParse(filters);
  if (!parsed.success) return null;
  const read = await readList(deps, request, candidateId, context, parsed.data);
  return read.list.filtered;
}

/** B674: подборка с сортировкой по любому столбцу; запомненную сортировку читает как прежний маршрут, но не пишет; запечатанный список пишет только для основного вида (B776). */
export function registerB640MatchedVacancyRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/b640/matched-vacancies', withDeps(deps, getMatchedVacancies));
}
