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
  targetRoles: readonly string[],
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
  snapshot: readonly MatchedVacancyItem[], targetRoles: readonly string[], campaign: CampaignResolution,
  candidateStore: RouteDeps['candidateStore'], candidateId: string,
  targetLevel: ReturnType<typeof readTargetLevel>, titleParseStore: RouteDeps['titleParseStore'], offset: number,
) {
  const pageAndExplanationsStartedAt = performance.now();
  const matched = finishMatchedVacancies(snapshot, targetRoles, campaign, candidateStore, candidateId);
  const hypothesisSnapshot = campaign.remoteOnly ? snapshot.filter((item) => item.cluster.isRemote) : snapshot;
  const counts = countMatchedVacanciesByRole(hypothesisSnapshot, targetRoles);
  const campaignWithHypotheses = readCampaign(candidateStore, candidateId, counts);
  const page = buildMatchedVacancyPage(matched, offset);
  const pageAndExplanationsMs = elapsedMs(pageAndExplanationsStartedAt);
  const titleParseStartedAt = performance.now();
  const data = addStoredVacancyLevels(page.items, targetLevel, (key) => titleParseStore.getByKey(key));
  return { data, page, campaignWithHypotheses, pageAndExplanationsMs, titleParseAndLevelsMs: elapsedMs(titleParseStartedAt) };
}

function logMatchedTiming(
  request: FastifyRequest, mode: 'legacy' | 'semantic', cold: boolean,
  candidateCampaignMs: number, semanticQueryAndSqlMs: number, response: ReturnType<typeof buildMatchedResponse>, requestStartedAt: number,
): void {
  request.log.info({
    mode, cold, candidateCampaignMs, semanticQueryAndSqlMs, clusterJsonAndClustersMs: 0,
    titleParseAndLevelsMs: response.titleParseAndLevelsMs,
    pageAndExplanationsMs: response.pageAndExplanationsMs, enrichmentsMs: elapsedMs(requestStartedAt),
  }, 'matched-vacancies-timing');
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
  const semanticQueryStartedAt = performance.now();
  const snapshot = await readMatchedSnapshot(
    multiSourceEngine,
    candidate.id,
    confirmedSkills,
    targetRoles,
    targetLevel,
  );
  const semanticQueryAndSqlMs = elapsedMs(semanticQueryStartedAt);
  const response = buildMatchedResponse(
    snapshot, targetRoles, campaign, candidateStore, candidate.id, targetLevel, titleParseStore, offset,
  );

  logMatchedTiming(
    request, config.matchMode ?? 'legacy', cold, candidateCampaignMs,
    semanticQueryAndSqlMs, response, requestStartedAt,
  );

  return {
    data: response.data,
    meta: {
      requestId: request.id,
      total: response.page.total,
      offset: response.page.offset,
      nextOffset: response.page.nextOffset,
      ...(response.page.pageOffsets ? { pageOffsets: response.page.pageOffsets } : {}),
      campaign: campaignMeta(response.campaignWithHypotheses),
      candidateLevel: targetLevel ?? null,
    },
  };
};

export function registerMatchedVacancyRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/matched-vacancies', withDeps(deps, handleMatchedVacancies));
}
