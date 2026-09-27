import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import type { CandidateRegion } from '../../src/features/workspace/candidateRegions';
import type { CampaignResolution } from '../vacancies/campaign';
import { applyVacancyDecisions } from '../vacancies/applyVacancyDecisions';
import { buildMatchedVacancyPage } from '../vacancies/matchedVacancyPage';
import { markGeography } from '../vacancies/vacancyGeography';
import { readMatchedSnapshot, readMatchProfile } from '../vacancies/matchedPoolContext';
import { countMatchedVacanciesByRole } from '../vacancies/vacancyRoleCounts';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { addStoredVacancyLevels } from '../vacancies/storedVacancyLevels';
import type { RouteDeps } from './deps';
import { campaignMeta, readCampaign } from './campaignContext';
import { unconfirmedCandidateMatchResponse } from './matchedVacancyResponse';
import { authenticateCandidate, withDeps } from './helpers';
import { readTargetLevel } from './vacancyRoleContext';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const matchedVacanciesQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
});

/** Первый запрос к конкретному движку равен первому запросу процесса в runtime. */
const observedMatchEngines = new WeakSet<object>();

function elapsedMs(startedAt: number): number {
  return Number((performance.now() - startedAt).toFixed(2));
}

function finishMatchedVacancies(
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
    campaign.regions.value as CandidateRegion[],
  );
  return applyVacancyDecisions(roleFiltered, candidateStore.listVacancyDecisions(candidateId));
}

function buildMatchedResponse(
  snapshot: readonly MatchedVacancyItem[],
  targetRoles: string[],
  campaign: CampaignResolution,
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
  targetLevel: ReturnType<typeof readTargetLevel>,
  titleParseStore: RouteDeps['titleParseStore'],
  offset: number,
) {
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
  const page = buildMatchedVacancyPage(matched, offset);
  const pageAndExplanationsMs = elapsedMs(pageAndExplanationsStartedAt);
  const titleParseStartedAt = performance.now();
  const data = addStoredVacancyLevels(page.items, targetLevel, (key) =>
    titleParseStore.getByKey(key),
  );
  return {
    data,
    page,
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

function preloadFirstPageDescriptions(
  engine: RouteDeps['multiSourceEngine'],
  items: readonly MatchedVacancyItem[],
  offset: number,
): void {
  if (offset !== 0) return;
  if (typeof engine.preloadVacancyDescriptions !== 'function') return;
  const ids = items.map((item) => item.cluster.id.replace(/^cluster-/u, ''));
  void engine.preloadVacancyDescriptions(ids);
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
  offset: number,
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
      offset,
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
  const { offset } = matchedVacanciesQuerySchema.parse(request.query);
  const candidateCampaignStartedAt = performance.now();
  const { confirmedSkills } = readMatchProfile(candidateStore, candidate.id);
  const campaign = readCampaign(candidateStore, candidate.id);
  const targetRoles = [...campaign.roles.value];
  const candidateCampaignMs = elapsedMs(candidateCampaignStartedAt);

  if (confirmedSkills.length === 0 && targetRoles.length === 0) {
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
    offset,
  );

  // Чтение последовательное и не задерживает ответ списка: массового обхода нет.
  preloadFirstPageDescriptions(multiSourceEngine, response.page.items, offset);

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
  app.get('/api/v1/candidate/matched-vacancies', withDeps(deps, handleMatchedVacancies));
}
