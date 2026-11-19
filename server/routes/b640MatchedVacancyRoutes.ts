import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  B640_SORT_DIRECTIONS,
  B640_SORT_KEYS,
} from '../../shared/b640Vacancies';
import { DEFAULT_VACANCY_SORT, type VacancySort } from '../../shared/vacancySort';
import { sortMatchedByColumn, type ColumnSortKey } from '../vacancies/matchedColumnSort';
import { matchedVacancySourceRegistry } from '../vacancies/matchedVacancyFacets';
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
import { selectionFitLimit } from './fitSelectionSweep';
import { candidatePlan, withDeps } from './helpers';
import { withRequestScopedCandidateReads } from './requestScopedCandidateReads';


const querySchema = matchedVacanciesQuerySchema
  .omit({ sort: true, dir: true, offset: true })
  .extend({
    ...pagingSchema,
    sort: z.enum(B640_SORT_KEYS).default('fit'),
    direction: z.enum(B640_SORT_DIRECTIONS).default('desc'),
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
  const order = savedOrder(deps, candidateId);
  const filters = listFilters(query, order);
  const read = await prepareMatchedRead(deps, candidateId, context.targetRoles, order, request.log);
  const snapshot = await readMatchedSnapshot(
    deps.multiSourceEngine,
    candidateId,
    context.confirmedSkills,
    context.targetRoles,
    context.targetLevel,
    context.geography,
  );
  const sourceRegistry = matchedVacancySourceRegistry(deps.multiSourceEngine.getSources?.() ?? []);
  const { list } = await readMatchedList(
    {
      ...context,
      candidateStore: deps.candidateStore,
      titleParseStore: deps.titleParseStore,
      candidateId,
      snapshot,
      filters,
      sourceRegistry,
      order: read.order,
      seal: false,
      ...(typeof deps.multiSourceEngine.getCatalogTotals === 'function'
        ? { catalogTotals: () => deps.multiSourceEngine.getCatalogTotals!() }
        : {}),
    },
    request.log,
  );
  return { list, saved: order, fitLimit: read.fitLimit, targetLevel: read.targetLevel };
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
  const sealed = await sealedAnswer(deps, backgroundDeps, request, candidate.id, context, query);
  if (sealed) return sealed;
  const read = await readList(deps, request, candidate.id, context, query);
  const { list, fitLimit, targetLevel } = read;
  const { rows, byFit } = await orderRows(deps, request, candidate.id, context, read, query);
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

/** B674: подборка с сортировкой по любому столбцу; запомненную сортировку и запечатанный список прежнего маршрута читает как он, но не пишет. */
export function registerB640MatchedVacancyRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/b640/matched-vacancies', withDeps(deps, getMatchedVacancies));
}
