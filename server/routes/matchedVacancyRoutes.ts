import { getCurrencyRates } from '../currency/cbrRates';
import { matchGeographyOf } from '../vacancies/matchGeography';
import { vacancyFitProfileStamp } from '../domain/vacancyFitProfileStamp';
import { readSortedFilters } from './matchedVacancySort';
import { DEFAULT_VACANCY_SORT, type VacancySort } from '../../shared/vacancySort';
import {
  selectionFitLimit,
  selectionStamp,
  selectionToCount,
  selectionToRead,
  sweepSelectionFit,
} from './fitSelectionSweep';
import { attachMarketSalaryEstimates } from '../vacancies/marketSalary/attachMarketSalaryEstimates';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { performance } from 'node:perf_hooks';
import type { CampaignResolution } from '../vacancies/campaign';
import { buildMatchedVacancyPage } from '../vacancies/matchedVacancyPage';
import {
  finishMatchedRows,
  readMatchedList,
  type MatchedList,
  type MatchedListInput,
  readSealedMatchedList,
} from './matchedVacancyList';
import { rebuildBehindSealedList } from './matchedListWarm';
import type { SealedMatchedList, SealedPage } from './sealedMatchedList';
import type { StaleListServed } from './staleListCache';
import { matchedVacancySourceRegistry } from '../vacancies/matchedVacancyFacets';
import {
  filterMatchedVacancies,
  type MatchedVacancyFilters,
} from '../vacancies/matchedVacancyFilters';
import {
  markMatchedVacanciesStale,
  readMatchedSnapshot,
  readMatchProfile,
} from '../vacancies/matchedPoolContext';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { addStoredVacancyLevels } from '../vacancies/storedVacancyLevels';
import type { RouteDeps } from './deps';
import { campaignMeta, readCampaign } from './campaignContext';
import {
  requestFitForShownPage,
  requestFitForVacancyIds,
  vacanciesToWarm,
  withShownPageFitViews,
  withWantedCompanyOrder,
  matchedOrderChoiceKeys,
} from './matchedVacancyFit';
import { unconfirmedCandidateMatchResponse } from './matchedVacancyResponse';
import { authenticateCandidate, candidatePlan, withDeps } from './helpers';
import { readTargetLevel } from './vacancyRoleContext';
import { startOrderSetupTiming } from './orderSetupTiming';
import { withRequestScopedCandidateReads } from './requestScopedCandidateReads';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

/** Первый запрос к конкретному движку равен первому запросу процесса в runtime. */
const observedMatchEngines = new WeakSet<object>();

function elapsedMs(startedAt: number): number {
  return Number((performance.now() - startedAt).toFixed(2));
}

export function finishMatchedVacancies(
  snapshot: readonly MatchedVacancyItem[],
  targetRoles: string[],
  campaign: CampaignResolution,
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
): MatchedVacancyItem[] {
  return finishMatchedRows(snapshot, targetRoles, campaign, {
    profile: candidateStore.decisionProfileRepo.get(candidateId),
    decisions: candidateStore.listVacancyDecisions(candidateId),
    rates: getCurrencyRates(),
  });
}

/** Снимок подбора уже отобран по уровню; роль — тот же признак, что в списке (B485). */
function roleLevelMatchCount(
  snapshot: readonly MatchedVacancyItem[],
  targetRoles: readonly string[],
): number {
  if (targetRoles.length === 0) return snapshot.length;
  return snapshot.filter((item) => item.explanation.roleMatch !== 'none').length;
}

/** «N из M по ролям» на «Карьере»: числа шапки «Вакансий» из уже прочитанного снимка. */
export function conditionsMarketCount(
  snapshot: readonly MatchedVacancyItem[],
  listed: readonly MatchedVacancyItem[],
  targetRoles: readonly string[],
  campaign: Pick<CampaignResolution, 'remoteOnly'>,
): { readonly withinConditions: number; readonly byRoles: number } {
  const considered = campaign.remoteOnly
    ? snapshot.filter((item) => item.cluster.isRemote)
    : snapshot;
  return {
    withinConditions: listed.length,
    byRoles: roleLevelMatchCount(considered, targetRoles),
  };
}

function buildMatchedResponse(
  list: MatchedList,
  served: StaleListServed,
  targetLevel: ReturnType<typeof readTargetLevel>,
  titleParseStore: RouteDeps['titleParseStore'],
  filters: MatchedVacancyFilters,
  fitLimit: number,
) {
  const pageAndExplanationsStartedAt = performance.now();
  const page = buildMatchedVacancyPage(list.filtered, filters.offset, undefined, list.pageOffsets);
  const pageAndExplanationsMs = elapsedMs(pageAndExplanationsStartedAt), titleParseStartedAt = performance.now();
  const data = addStoredVacancyLevels(page.items, targetLevel, (key) =>
    titleParseStore.getByKey(key),
  );
  return {
    data,
    page,
    facets: filters.offset === 0 ? list.facets : undefined,
    ...fitWorkIds(list.filtered, filters.offset, fitLimit),
    campaignWithHypotheses: list.campaignWithHypotheses,
    listCached: served !== 'built',
    listServed: served,
    pageAndExplanationsMs,
    titleParseAndLevelsMs: elapsedMs(titleParseStartedAt),
  };
}

type ShownPage = Pick<
  ReturnType<typeof buildMatchedResponse>,
  'data' | 'page' | 'facets' | 'campaignWithHypotheses' | 'listCached' | 'pageAndExplanationsMs' | 'titleParseAndLevelsMs'
> & { readonly listServed: StaleListServed | 'sealed' };

function logMatchedTiming(
  request: FastifyRequest,
  mode: 'legacy' | 'semantic',
  cold: boolean,
  candidateCampaignMs: number,
  semanticQueryAndSqlMs: number,
  response: ShownPage,
  requestStartedAt: number,
  steps: Readonly<Record<string, number>> = {},
): void {
  request.log.info(
    {
      ...steps,
      mode,
      cold,
      candidateCampaignMs,
      semanticQueryAndSqlMs,
      clusterJsonAndClustersMs: 0,
      titleParseAndLevelsMs: response.titleParseAndLevelsMs,
      pageAndExplanationsMs: response.pageAndExplanationsMs,
      listCached: response.listCached,
      listServed: response.listServed,
      enrichmentsMs: elapsedMs(requestStartedAt),
    },
    'matched-vacancies-timing',
  );
}

/** Rows whose text and fit a list read starts: the top, the best uncounted, the whole selection. */
function fitWorkIds(items: readonly MatchedVacancyItem[], offset: number, fitLimit: number) {
  return {
    warmIds: vacanciesToWarm(items),
    countIds: offset === 0 ? selectionToCount(items, fitLimit) : [],
    readIds: offset === 0 ? selectionToRead(items) : [],
    selectionKey: selectionStamp(items.map((item) => item.cluster.id)),
  };
}

/**
 * Не задерживает ответ списка: верх и лучшие непосчитанные строки дочитываются сразу, вся
 * подборка — фоном по релевантности (CPO 28.10), расчёт ставится после текста.
 */
function startFitWork(
  deps: RouteDeps,
  candidateId: string,
  response: {
    readonly data: readonly MatchedVacancyItem[];
    readonly warmIds: readonly string[];
    readonly countIds: readonly string[];
    readonly readIds: readonly string[];
    readonly selectionKey: string;
  },
  { offset, fitLimit }: { readonly offset: number; readonly fitLimit: number },
  request: FastifyRequest,
): void {
  const logFailure = (rows: number) => (error: unknown) =>
    request.log.warn(
      { errorName: error instanceof Error ? error.name : 'UnknownError', rows },
      'fit-request-failed',
    );
  // B580: on Free a page past the first 300 rows is counted card by card, when opened.
  const shown = response.data.slice(0, Math.max(0, fitLimit - offset));
  void requestFitForShownPage(deps, candidateId, shown).catch(logFailure(shown.length));
  const engine = deps.multiSourceEngine;
  const requestFit = (ids: readonly string[]) => {
    void requestFitForVacancyIds(deps, candidateId, ids).catch(logFailure(ids.length));
  };
  preloadTopMatchedDescriptions(engine, response.warmIds, offset, request, requestFit);
  if (typeof engine.requestHhTextPriority !== 'function') return;
  void sweepSelectionFit(
    candidateId,
    response.countIds,
    // 01.11: hh text for the whole selection is read by the maintenance worker, rows in
    // selection order; the HTTP path only writes the queue (the shown page warms above).
    (ids, rank) => engine.requestHhTextPriority!(ids, rank),
    // The sweep queues below the shown page: after an edit, paid plans see the visible rows first.
    (ids, rank) => requestFitForVacancyIds(deps, candidateId, ids, rank),
    `${vacancyFitStampOf(deps, candidateId)}|${response.selectionKey}`,
    response.readIds,
  );
}

function vacancyFitStampOf(deps: RouteDeps, candidateId: string): string {
  return vacancyFitProfileStamp(
    deps.candidateStore.getSnapshot(candidateId),
    deps.candidateStore.getCandidateWorkspace(candidateId),
  );
}

function preloadTopMatchedDescriptions(
  engine: RouteDeps['multiSourceEngine'],
  clusterIds: readonly string[],
  offset: number,
  request: FastifyRequest,
  requestFit: (clusterIds: readonly string[]) => void,
): void {
  if (offset !== 0 || clusterIds.length === 0) return;
  // The fit is queued after the text is read: queued earlier it would see an empty description.
  if (typeof engine.preloadVacancyDescriptions !== 'function') return requestFit(clusterIds);
  const vacancyIds = clusterIds.map((id) => id.replace(/^cluster-/u, ''));
  void engine
    .preloadVacancyDescriptions(vacancyIds, vacancyIds.length)
    .then((summary) => {
      requestFit(clusterIds);
      if (summary.loaded > 0) markMatchedVacanciesStale(engine);
      request.log.info({ event: 'hh-description-preload', ...summary }, 'hh-description-preload');
    })
    .catch(() => {
      requestFit(clusterIds);
      // Keep provider details and vacancy URLs out of the log. Counts make an
      // unexpected preload failure visible without writing vacancy content.
      request.log.warn(
        {
          event: 'hh-description-preload',
          requested: vacancyIds.length,
          loaded: 0,
          skipped: 0,
          failed: vacancyIds.length,
        },
        'hh-description-preload',
      );
    });
}

type MatchedPageRead = Omit<MatchedListInput, 'snapshot' | 'geography' | 'catalogTotals'> & {
  readonly confirmedSkills: string[];
  readonly targetLevel: ReturnType<typeof readTargetLevel>;
};

async function readMatchedPage(
  engine: RouteDeps['multiSourceEngine'],
  read: MatchedPageRead,
  log: FastifyRequest['log'],
  fitLimit: number,
) {
  // The profile reads before this ran in one piece with the request start (prod 03.11).
  await yieldToEventLoop();
  const startedAt = performance.now();
  const geography = matchGeographyOf(read.campaign.careerGeography);
  const snapshot = await readMatchedSnapshot(
    engine,
    read.candidateId,
    read.confirmedSkills,
    read.targetRoles,
    read.targetLevel,
    geography,
  );
  const snapshotMs = elapsedMs(startedAt);
  const catalogTotals =
    typeof engine.getCatalogTotals === 'function'
      ? { catalogTotals: () => engine.getCatalogTotals!() }
      : {};
  const { list, served } = await readMatchedList(
    { ...read, snapshot, geography, ...catalogTotals },
    log,
  );
  const built = served === 'built';
  return {
    response: buildMatchedResponse(
      list,
      served,
      read.targetLevel,
      read.titleParseStore,
      read.filters,
      fitLimit,
    ),
    semanticQueryAndSqlMs: elapsedMs(startedAt),
    readSteps: {
      snapshotMs,
      prepareMs: built ? list.prepareMs : 0,
      prepareRows: built ? list.prepareRows : 0,
      listMs: built ? list.listMs : 0,
    },
  };
}

function matchedVacancyResponse(
  response: ShownPage,
  requestId: string,
  targetLevel: ReturnType<typeof readTargetLevel>,
  sort: VacancySort = DEFAULT_VACANCY_SORT,
) {
  return {
    data: response.data,
    meta: {
      requestId,
      sort,
      total: response.page.total,
      offset: response.page.offset,
      nextOffset: response.page.nextOffset,
      ...(response.page.pageOffsets ? { pageOffsets: response.page.pageOffsets } : {}),
      campaign: campaignMeta(response.campaignWithHypotheses),
      candidateLevel: targetLevel ?? null,
      ...(response.facets ? { facets: response.facets } : {}),
    },
  };
}

/** B546: the page carries the estimate the maintenance process computed. */
function withMarketSalary(deps: RouteDeps, items: MatchedVacancyItem[]): MatchedVacancyItem[] {
  const store = deps.marketSalaryEstimates;
  if (!store) return items;
  return attachMarketSalaryEstimates(items, {
    store,
    readTitle: (key) => deps.titleParseStore.getByKey(key) ?? undefined,
  });
}

/**
 * Fit views, salary and fit work for a built page, each step timed (CPO prod 02.11). Each step
 * lets queued requests through first (prod 03.11: four parallel pages held the loop 0.3–1.1 s).
 * Fit work starts after the page is built and with the unscoped deps: its sweep outlives the request.
 */
async function finishMatchedPage(
  deps: RouteDeps,
  backgroundDeps: RouteDeps,
  candidateId: string,
  orderedPage: ReturnType<typeof buildMatchedResponse>,
  context: { readonly offset: number; readonly fitLimit: number; readonly request: FastifyRequest },
) {
  await yieldToEventLoop();
  const fitViewsStartedAt = performance.now();
  const shown = await withShownPageFitViews(deps, candidateId, orderedPage.data);
  const fitViewsMs = elapsedMs(fitViewsStartedAt);
  const salaryStartedAt = performance.now();
  const response = { ...orderedPage, data: withMarketSalary(deps, shown) };
  const salaryMs = elapsedMs(salaryStartedAt);
  await yieldToEventLoop();
  const fitWorkStartedAt = performance.now();
  startFitWork(backgroundDeps, candidateId, response, context, context.request);
  return { response, steps: { fitViewsMs, salaryMs, fitWorkMs: elapsedMs(fitWorkStartedAt) } };
}

/** What a read needs before the list, timed: on a cold process the stored results open here. */
async function prepareMatchedRead(
  deps: RouteDeps,
  candidateId: string,
  targetRoles: readonly string[],
  sort: VacancySort,
  log: FastifyRequest['log'],
) {
  const warmStartedAt = performance.now();
  await deps.vacancyMechanics?.warmCachedVacancyIds?.(candidateId);
  const warmFitIdsMs = elapsedMs(warmStartedAt);
  const setup = startOrderSetupTiming(deps.candidateStore);
  const targetLevel = readTargetLevel(setup.store, candidateId, [...targetRoles]);
  const fitLimit = setup.step('planMs', () => selectionFitLimit(candidatePlan(deps, candidateId)));
  const order = setup.step('orderMs', () => withWantedCompanyOrder(deps, candidateId, sort, log, 'read', targetRoles));
  return { targetLevel, fitLimit, order, warmFitIdsMs, orderSetupMs: setup.finish(log) };
}

interface SealedRead {
  readonly candidateId: string;
  readonly filters: MatchedVacancyFilters;
  readonly confirmedSkills: readonly string[];
  readonly targetRoles: string[];
  readonly campaign: ReturnType<typeof readCampaign>;
  readonly sort: VacancySort;
  readonly startTiming: {
    readonly mode: 'legacy' | 'semantic';
    readonly cold: boolean;
    readonly candidateCampaignMs: number;
    readonly beforeCampaignMs: number;
    readonly requestStartedAt: number;
  };
}

/** The page as a built list would give it; rows and percents are read live, no fit work starts. */
async function sealedResponse(
  deps: RouteDeps,
  candidateId: string,
  sealed: SealedMatchedList,
  page: SealedPage,
  targetLevel: ReturnType<typeof readTargetLevel>,
): Promise<ShownPage> {
  const levels = addStoredVacancyLevels([...page.items], targetLevel, (key) => deps.titleParseStore.getByKey(key));
  const shown = await withShownPageFitViews(deps, candidateId, levels);
  return {
    data: withMarketSalary(deps, shown),
    page: {
      items: [...page.items],
      total: sealed.total,
      offset: page.offset,
      nextOffset: page.nextOffset,
      ...(page.offset === 0 ? { pageOffsets: sealed.pageOffsets } : {}),
    },
    facets: page.offset === 0 ? sealed.facets : undefined,
    campaignWithHypotheses: sealed.campaignWithHypotheses,
    listCached: true,
    listServed: 'sealed',
    pageAndExplanationsMs: 0,
    titleParseAndLevelsMs: 0,
  };
}

/** PRB-055: what a new process answers before the stored results and the pool are touched. */
async function answerFromSealedList(
  deps: RouteDeps,
  backgroundDeps: RouteDeps,
  read: SealedRead,
  request: FastifyRequest,
) {
  const { candidateId, filters, startTiming } = read;
  const startedAt = performance.now();
  const targetLevel = readTargetLevel(deps.candidateStore, candidateId, read.targetRoles);
  const geography = matchGeographyOf(read.campaign.careerGeography);
  const order = matchedOrderChoiceKeys(deps, candidateId, read.sort);
  let sealed: SealedMatchedList | undefined;
  let page: SealedPage | undefined;
  try {
    sealed = readSealedMatchedList({ ...read, candidateStore: deps.candidateStore, targetLevel, geography, order });
    page = sealed?.pages.find(({ offset }) => offset === filters.offset);
  } catch (error) {
    // A row that does not open is a cold read, not a failed one.
    request.log.warn({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'matched-list-unseal-failed');
  }
  if (!sealed || !page) return undefined;
  const sealedReadMs = elapsedMs(startedAt);
  const response = await sealedResponse(deps, candidateId, sealed, page, targetLevel);
  rebuildBehindSealedList(backgroundDeps, candidateId, request.query, request.log);
  const { mode, cold, candidateCampaignMs, beforeCampaignMs, requestStartedAt } = startTiming;
  logMatchedTiming(request, mode, cold, candidateCampaignMs, sealedReadMs, response, requestStartedAt, { beforeCampaignMs, sealedReadMs });
  return matchedVacancyResponse(response, request.id, targetLevel, read.sort);
}

const handleMatchedVacancies: Handler = async (backgroundDeps, request, reply) => {
  const deps = withRequestScopedCandidateReads(backgroundDeps), requestStartedAt = performance.now();
  const { authService, candidateStore, config, multiSourceEngine, titleParseStore } = deps;
  const cold = !observedMatchEngines.has(multiSourceEngine);
  observedMatchEngines.add(multiSourceEngine);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const { filters, sort } = readSortedFilters(deps, candidate.id, request.query);
  const { offset } = filters;
  const sourceRegistry = matchedVacancySourceRegistry(multiSourceEngine.getSources?.() ?? []);
  const knownSourceIds = sourceRegistry.map(({ id }) => id);
  const beforeCampaignMs = elapsedMs(requestStartedAt);
  const candidateCampaignStartedAt = performance.now();
  const { confirmedSkills } = readMatchProfile(candidateStore, candidate.id);
  const campaign = readCampaign(candidateStore, candidate.id);
  const targetRoles = [...campaign.roles.value];
  const candidateCampaignMs = elapsedMs(candidateCampaignStartedAt);

  if (confirmedSkills.length === 0 && targetRoles.length === 0) {
    filterMatchedVacancies([], filters, targetRoles, undefined, knownSourceIds);
    return unconfirmedCandidateMatchResponse(request.id, offset, campaign, sourceRegistry);
  }

  const startTiming = { mode: config.matchMode ?? 'legacy', cold, candidateCampaignMs, beforeCampaignMs, requestStartedAt } as const;
  const sealedAnswer = await answerFromSealedList(deps, backgroundDeps, { candidateId: candidate.id, filters, confirmedSkills, targetRoles, campaign, sort, startTiming }, request);
  if (sealedAnswer) return sealedAnswer;

  const { targetLevel, fitLimit, order, ...setupSteps } = await prepareMatchedRead(deps, candidate.id, targetRoles, sort, request.log);
  const { response: orderedPage, semanticQueryAndSqlMs, readSteps } = await readMatchedPage(
    multiSourceEngine,
    {
      candidateStore, confirmedSkills, targetRoles, targetLevel,
      campaign, titleParseStore, filters, sourceRegistry,
      candidateId: candidate.id,
      order,
    },
    request.log,
    fitLimit,
  );
  const page = await finishMatchedPage(deps, backgroundDeps, candidate.id, orderedPage, { offset, fitLimit, request });
  logMatchedTiming(
    request,
    config.matchMode ?? 'legacy',
    cold,
    candidateCampaignMs,
    semanticQueryAndSqlMs,
    page.response,
    requestStartedAt,
    { beforeCampaignMs, ...setupSteps, ...readSteps, ...page.steps },
  );

  return matchedVacancyResponse(page.response, request.id, targetLevel, sort);
};

export function registerMatchedVacancyRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get(
    '/api/v1/candidate/matched-vacancies',
    withDeps(deps, async (routeDeps, request, reply) => {
      try {
        return await handleMatchedVacancies(routeDeps, request, reply);
      } catch (error) {
        if (!(error instanceof ZodError)) throw error;
        return reply.code(400).send({
          error: {
            code: 'invalid_query',
            message: 'Неизвестное значение фильтра вакансий',
            requestId: request.id,
            retryable: false,
          },
        });
      }
    }),
  );
}
