import { attachMarketSalaryEstimates } from '../vacancies/marketSalary/attachMarketSalaryEstimates';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { performance } from 'node:perf_hooks';
import type { CandidateRegion } from '../../src/features/workspace/candidateRegions';
import type { CampaignResolution } from '../vacancies/campaign';
import { applyVacancyDecisions } from '../vacancies/applyVacancyDecisions';
import { filterVacanciesByDecisionProfile } from '../../shared/workPreferences';
import { buildMatchedVacancyPage, planMatchedVacancyPages } from '../vacancies/matchedVacancyPage';
import { createHash } from 'node:crypto';
import { createCandidateWindowCache } from './candidateWindowCache';
import { normalizeTitleKey } from '../vacancies/titleParse/normalizeTitleKey';
import {
  buildMatchedVacancyFacets,
  matchedVacancySourceRegistry,
} from '../vacancies/matchedVacancyFacets';
import type { MatchedVacancySourceDefinition } from '../vacancies/matchedVacancyFacets';
import {
  filterMatchedVacancies,
  matchedVacanciesQuerySchema,
  type MatchedVacancyFilters,
} from '../vacancies/matchedVacancyFilters';
import { markGeography } from '../vacancies/vacancyGeography';
import { withinCareerGeography } from '../vacancies/careerGeography';
import {
  invalidateAllMatchedVacancies,
  readMatchedSnapshot,
  readMatchProfile,
} from '../vacancies/matchedPoolContext';
import { countMatchedVacanciesByRole } from '../vacancies/vacancyRoleCounts';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { addStoredVacancyLevels } from '../vacancies/storedVacancyLevels';
import { matchedCatalogSummary, type CatalogTotals } from '../vacancies/matchedCatalogSummary';
import type { RouteDeps } from './deps';
import { campaignMeta, readCampaign } from './campaignContext';
import {
  requestFitForShownPage,
  withShownPageFitViews,
  withWantedCompanyOrder,
} from './matchedVacancyFit';
import { unconfirmedCandidateMatchResponse } from './matchedVacancyResponse';
import { authenticateCandidate, withDeps } from './helpers';
import { readTargetLevel } from './vacancyRoleContext';

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
  const remoteFiltered = campaign.remoteOnly
    ? snapshot.filter((item) => item.cluster.isRemote)
    : snapshot;
  const career = campaign.careerGeography;
  // CPO 26.10: подборка идёт по городам и форматам «Карьеры», если они заданы.
  const geographyAndRemote = career
    ? remoteFiltered.filter((item) => withinCareerGeography(item, career))
    : remoteFiltered;
  const roleFiltered = markGeography(
    targetRoles.length > 0
      ? geographyAndRemote.filter((item) => item.explanation.roleMatch !== 'none')
      : geographyAndRemote,
    [
      ...(campaign.regions.value as CandidateRegion[]),
      ...((campaign.suggestedRegions ?? []) as CandidateRegion[]),
    ],
  );
  // B384: жёсткие ограничения профиля — теми же функциями, что на клиенте; O(размер подборки).
  const withinProfile = filterVacanciesByDecisionProfile(
    roleFiltered,
    candidateStore.decisionProfileRepo.get(candidateId),
  );
  return applyVacancyDecisions(withinProfile, candidateStore.listVacancyDecisions(candidateId));
}

/** Снимок подбора уже отобран по уровню; роль — тот же признак, что в списке (B485). */
function roleLevelMatchCount(
  snapshot: readonly MatchedVacancyItem[],
  targetRoles: readonly string[],
): number {
  if (targetRoles.length === 0) return snapshot.length;
  return snapshot.filter((item) => item.explanation.roleMatch !== 'none').length;
}

/**
 * PRB-040: каждая страница дочитывания пересчитывала подборку целиком —
 * ~230 мс event loop на четыре записи, сотни страниц на чтение. Посчитанная
 * подборка живёт одно окно; страница — срез. Ключ несёт всё, из чего она
 * считается: снимок пула, фильтры, решения и ограничения кандидата.
 */
const MATCHED_LIST_WINDOW_MS = 60_000;
const matchedListCache = createCandidateWindowCache<MatchedList>(MATCHED_LIST_WINDOW_MS);
const snapshotIds = new WeakMap<readonly MatchedVacancyItem[], number>();
let nextSnapshotId = 0;

function snapshotId(snapshot: readonly MatchedVacancyItem[]): number {
  const known = snapshotIds.get(snapshot);
  if (known !== undefined) return known;
  nextSnapshotId += 1;
  snapshotIds.set(snapshot, nextSnapshotId);
  return nextSnapshotId;
}

interface MatchedList {
  readonly filtered: readonly MatchedVacancyItem[];
  readonly pageOffsets: readonly number[];
  readonly facets: ReturnType<typeof buildMatchedVacancyFacets> & {
    catalogSummary?: ReturnType<typeof matchedCatalogSummary>;
  };
  readonly campaignWithHypotheses: ReturnType<typeof readCampaign>;
}

function matchedListKey(
  snapshot: readonly MatchedVacancyItem[],
  campaign: CampaignResolution,
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
  filters: MatchedVacancyFilters,
  order?: {
    (items: readonly MatchedVacancyItem[]): MatchedVacancyItem[];
    readonly cacheKey?: string;
  },
): string {
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        { ...filters, offset: 0 },
        order?.cacheKey ?? '',
        campaign.regions.value,
        campaign.suggestedRegions ?? [],
        campaign.remoteOnly,
        campaign.careerGeography ?? null,
        candidateStore.decisionProfileRepo.get(candidateId) ?? null,
        candidateStore.listVacancyDecisions(candidateId),
      ]),
    )
    .digest('hex')
    .slice(0, 16);
  return `${candidateId}|${snapshotId(snapshot)}|${fingerprint}`;
}

function computeMatchedList(
  snapshot: readonly MatchedVacancyItem[],
  targetRoles: string[],
  campaign: CampaignResolution,
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
  titleParseStore: RouteDeps['titleParseStore'],
  filters: MatchedVacancyFilters,
  sourceRegistry: readonly MatchedVacancySourceDefinition[],
  decorate: (items: readonly MatchedVacancyItem[]) => MatchedVacancyItem[],
  catalogTotals?: () => CatalogTotals | undefined,
): MatchedList {
  const matched = decorate(
    finishMatchedVacancies(snapshot, targetRoles, campaign, candidateStore, candidateId),
  );
  const hypothesisSnapshot = campaign.remoteOnly
    ? snapshot.filter((item) => item.cluster.isRemote)
    : snapshot;
  const counts = countMatchedVacanciesByRole(hypothesisSnapshot, targetRoles);
  const readLevel = (item: MatchedVacancyItem) =>
    titleParseStore.getByKey(normalizeTitleKey(item.cluster.canonicalTitle))?.levelRank;
  const facets = buildMatchedVacancyFacets(matched, targetRoles, readLevel, sourceRegistry);
  const filtered = filterMatchedVacancies(
    matched,
    filters,
    targetRoles,
    readLevel,
    sourceRegistry.map(({ id }) => id),
  );
  const catalogSummary = matchedCatalogSummary(
    catalogTotals?.(),
    roleLevelMatchCount(hypothesisSnapshot, targetRoles),
  );
  return {
    filtered,
    pageOffsets: planMatchedVacancyPages(filtered),
    facets: catalogSummary ? { ...facets, catalogSummary } : facets,
    campaignWithHypotheses: readCampaign(candidateStore, candidateId, counts),
  };
}

function buildMatchedResponse(
  snapshot: readonly MatchedVacancyItem[],
  targetRoles: string[],
  campaign: CampaignResolution,
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
  targetLevel: ReturnType<typeof readTargetLevel>,
  titleParseStore: RouteDeps['titleParseStore'],
  filters: MatchedVacancyFilters,
  sourceRegistry: readonly MatchedVacancySourceDefinition[],
  decorate: (items: readonly MatchedVacancyItem[]) => MatchedVacancyItem[] = (items) => [...items],
  catalogTotals?: () => CatalogTotals | undefined,
) {
  const pageAndExplanationsStartedAt = performance.now();
  let listCached = true;
  const list = matchedListCache.read(
    matchedListKey(snapshot, campaign, candidateStore, candidateId, filters, decorate),
    () => {
      listCached = false;
      return computeMatchedList(
        snapshot,
        targetRoles,
        campaign,
        candidateStore,
        candidateId,
        titleParseStore,
        filters,
        sourceRegistry,
        decorate,
        catalogTotals,
      );
    },
  );
  const page = buildMatchedVacancyPage(list.filtered, filters.offset, undefined, list.pageOffsets);
  const pageAndExplanationsMs = elapsedMs(pageAndExplanationsStartedAt);
  const titleParseStartedAt = performance.now();
  const data = addStoredVacancyLevels(page.items, targetLevel, (key) =>
    titleParseStore.getByKey(key),
  );
  return {
    data,
    page,
    facets: filters.offset === 0 ? list.facets : undefined,
    preloadIds: list.filtered.slice(0, 20).map((item) => item.cluster.id.replace(/^cluster-/u, '')),
    campaignWithHypotheses: list.campaignWithHypotheses,
    listCached,
    pageAndExplanationsMs,
    titleParseAndLevelsMs: elapsedMs(titleParseStartedAt),
  };
}

function logMatchedTiming(
  request: FastifyRequest,
  mode: 'legacy' | 'semantic',
  cold: boolean,
  candidateCampaignMs: number,
  semanticQueryAndSqlMs: number,
  response: ReturnType<typeof buildMatchedResponse>,
  requestStartedAt: number,
): void {
  request.log.info(
    {
      mode,
      cold,
      candidateCampaignMs,
      semanticQueryAndSqlMs,
      clusterJsonAndClustersMs: 0,
      titleParseAndLevelsMs: response.titleParseAndLevelsMs,
      pageAndExplanationsMs: response.pageAndExplanationsMs,
      listCached: response.listCached,
      enrichmentsMs: elapsedMs(requestStartedAt),
    },
    'matched-vacancies-timing',
  );
}

function preloadTopMatchedDescriptions(
  engine: RouteDeps['multiSourceEngine'],
  vacancyIds: readonly string[],
  offset: number,
  request: FastifyRequest,
): void {
  if (offset !== 0) return;
  if (typeof engine.preloadVacancyDescriptions !== 'function') return;
  if (vacancyIds.length === 0) return;
  void engine
    .preloadVacancyDescriptions(vacancyIds, 20)
    .then((summary) => {
      if (summary.loaded > 0) invalidateAllMatchedVacancies(engine);
      request.log.info({ event: 'hh-description-preload', ...summary }, 'hh-description-preload');
    })
    .catch(() => {
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

async function readMatchedPage(
  engine: RouteDeps['multiSourceEngine'],
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
  confirmedSkills: string[],
  targetRoles: string[],
  targetLevel: ReturnType<typeof readTargetLevel>,
  campaign: CampaignResolution,
  titleParseStore: RouteDeps['titleParseStore'],
  filters: MatchedVacancyFilters,
  sourceRegistry: readonly MatchedVacancySourceDefinition[],
  decorate: (items: readonly MatchedVacancyItem[]) => MatchedVacancyItem[] = (items) => [...items],
) {
  const startedAt = performance.now();
  const snapshot = await readMatchedSnapshot(
    engine,
    candidateId,
    confirmedSkills,
    targetRoles,
    targetLevel,
  );
  return {
    response: buildMatchedResponse(
      snapshot,
      targetRoles,
      campaign,
      candidateStore,
      candidateId,
      targetLevel,
      titleParseStore,
      filters,
      sourceRegistry,
      decorate,
      typeof engine.getCatalogTotals === 'function' ? () => engine.getCatalogTotals() : undefined,
    ),
    semanticQueryAndSqlMs: elapsedMs(startedAt),
  };
}

function matchedVacancyResponse(
  response: ReturnType<typeof buildMatchedResponse>,
  requestId: string,
  targetLevel: ReturnType<typeof readTargetLevel>,
) {
  return {
    data: response.data,
    meta: {
      requestId,
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

const handleMatchedVacancies: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config, multiSourceEngine, titleParseStore } = deps;
  const requestStartedAt = performance.now();
  const cold = !observedMatchEngines.has(multiSourceEngine);
  observedMatchEngines.add(multiSourceEngine);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const filters = matchedVacanciesQuerySchema.parse(request.query);
  const { offset } = filters;
  const sourceRegistry = matchedVacancySourceRegistry(multiSourceEngine.getSources?.() ?? []);
  const knownSourceIds = sourceRegistry.map(({ id }) => id);
  const candidateCampaignStartedAt = performance.now();
  const { confirmedSkills } = readMatchProfile(candidateStore, candidate.id);
  const campaign = readCampaign(candidateStore, candidate.id);
  const targetRoles = [...campaign.roles.value];
  const candidateCampaignMs = elapsedMs(candidateCampaignStartedAt);

  if (confirmedSkills.length === 0 && targetRoles.length === 0) {
    filterMatchedVacancies([], filters, targetRoles, undefined, knownSourceIds);
    return unconfirmedCandidateMatchResponse(request.id, offset, campaign, sourceRegistry);
  }

  const targetLevel = readTargetLevel(candidateStore, candidate.id, targetRoles);
  const { response: orderedPage, semanticQueryAndSqlMs } = await readMatchedPage(
    multiSourceEngine,
    candidateStore,
    candidate.id,
    confirmedSkills,
    targetRoles,
    targetLevel,
    campaign,
    titleParseStore,
    filters,
    sourceRegistry,
    withWantedCompanyOrder(deps, candidate.id, filters.sort ?? 'fit'),
  );
  const shown = withShownPageFitViews(deps, candidate.id, orderedPage.data);
  const response = { ...orderedPage, data: withMarketSalary(deps, shown) };

  // Чтение последовательное, охватывает первые 20 совпадений и не задерживает
  // ответ списка; размер транспортного ответа страницей остаётся прежним.
  preloadTopMatchedDescriptions(multiSourceEngine, response.preloadIds, offset, request);
  requestFitForShownPage(deps, candidate.id, response.data);

  logMatchedTiming(
    request,
    config.matchMode ?? 'legacy',
    cold,
    candidateCampaignMs,
    semanticQueryAndSqlMs,
    response,
    requestStartedAt,
  );

  return matchedVacancyResponse(response, request.id, targetLevel);
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
