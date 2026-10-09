import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { performance } from 'node:perf_hooks';
import type { CandidateRegion } from '../../src/features/workspace/candidateRegions';
import type { CampaignResolution } from '../vacancies/campaign';
import { applyVacancyDecisions } from '../vacancies/applyVacancyDecisions';
import { filterVacanciesByDecisionProfile } from '../../shared/workPreferences';
import { buildMatchedVacancyPage } from '../vacancies/matchedVacancyPage';
import { normalizeTitleKey } from '../vacancies/titleParse/normalizeTitleKey';
import { buildMatchedVacancyFacets } from '../vacancies/matchedVacancyFacets';
import {
  filterMatchedVacancies,
  matchedVacanciesQuerySchema,
  type MatchedVacancyFilters,
} from '../vacancies/matchedVacancyFilters';
import { markGeography } from '../vacancies/vacancyGeography';
import {
  invalidateAllMatchedVacancies,
  readMatchedSnapshot,
  readMatchProfile,
} from '../vacancies/matchedPoolContext';
import { countMatchedVacanciesByRole } from '../vacancies/vacancyRoleCounts';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { addStoredVacancyLevels } from '../vacancies/storedVacancyLevels';
import type { RouteDeps } from './deps';
import { campaignMeta, readCampaign } from './campaignContext';
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
  const geographyAndRemote = campaign.remoteOnly
    ? snapshot.filter((item) => item.cluster.isRemote)
    : snapshot;
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

function buildMatchedResponse(
  snapshot: readonly MatchedVacancyItem[],
  targetRoles: string[],
  campaign: CampaignResolution,
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
  targetLevel: ReturnType<typeof readTargetLevel>,
  titleParseStore: RouteDeps['titleParseStore'],
  filters: MatchedVacancyFilters,
) {
  const { offset } = filters;
  const pageAndExplanationsStartedAt = performance.now();
  const matched = finishMatchedVacancies(
    snapshot,
    targetRoles,
    campaign,
    candidateStore,
    candidateId,
  );
  const hypothesisSnapshot = campaign.remoteOnly
    ? snapshot.filter((item) => item.cluster.isRemote)
    : snapshot;
  const counts = countMatchedVacanciesByRole(hypothesisSnapshot, targetRoles);
  const campaignWithHypotheses = readCampaign(candidateStore, candidateId, counts);
  const readLevel = (item: MatchedVacancyItem) =>
    titleParseStore.getByKey(normalizeTitleKey(item.cluster.canonicalTitle))?.levelRank;
  const facets =
    offset === 0 ? buildMatchedVacancyFacets(matched, targetRoles, readLevel) : undefined;
  const filtered = filterMatchedVacancies(matched, filters, targetRoles, readLevel);
  const page = buildMatchedVacancyPage(filtered, offset);
  const pageAndExplanationsMs = elapsedMs(pageAndExplanationsStartedAt);
  const titleParseStartedAt = performance.now();
  const data = addStoredVacancyLevels(page.items, targetLevel, (key) =>
    titleParseStore.getByKey(key),
  );
  return {
    data,
    page,
    facets,
    preloadIds: filtered.slice(0, 20).map((item) => item.cluster.id.replace(/^cluster-/u, '')),
    campaignWithHypotheses,
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

const handleMatchedVacancies: Handler = async (
  { authService, candidateStore, config, multiSourceEngine, titleParseStore },
  request,
  reply,
) => {
  const requestStartedAt = performance.now();
  const cold = !observedMatchEngines.has(multiSourceEngine);
  observedMatchEngines.add(multiSourceEngine);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const filters = matchedVacanciesQuerySchema.parse(request.query);
  const { offset } = filters;
  const candidateCampaignStartedAt = performance.now();
  const { confirmedSkills } = readMatchProfile(candidateStore, candidate.id);
  const campaign = readCampaign(candidateStore, candidate.id);
  const targetRoles = [...campaign.roles.value];
  const candidateCampaignMs = elapsedMs(candidateCampaignStartedAt);

  if (confirmedSkills.length === 0 && targetRoles.length === 0) {
    filterMatchedVacancies([], filters, targetRoles);
    return unconfirmedCandidateMatchResponse(request.id, offset, campaign);
  }

  const targetLevel = readTargetLevel(candidateStore, candidate.id, targetRoles);
  const { response, semanticQueryAndSqlMs } = await readMatchedPage(
    multiSourceEngine,
    candidateStore,
    candidate.id,
    confirmedSkills,
    targetRoles,
    targetLevel,
    campaign,
    titleParseStore,
    filters,
  );

  // Чтение последовательное, охватывает первые 20 совпадений и не задерживает
  // ответ списка; размер транспортного ответа страницей остаётся прежним.
  preloadTopMatchedDescriptions(multiSourceEngine, response.preloadIds, offset, request);

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
        return reply
          .code(400)
          .send({
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
