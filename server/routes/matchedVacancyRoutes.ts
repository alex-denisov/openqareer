import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
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

const handleMatchedVacancies: Handler = async (
  { authService, candidateStore, config, multiSourceEngine, titleParseStore },
  request,
  reply,
) => {
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const { offset } = matchedVacanciesQuerySchema.parse(request.query);
  const { confirmedSkills } = readMatchProfile(candidateStore, candidate.id);
  const campaign = readCampaign(candidateStore, candidate.id);
  const targetRoles = [...campaign.roles.value];

  if (confirmedSkills.length === 0 && targetRoles.length === 0) {
    return unconfirmedCandidateMatchResponse(request.id, offset, campaign);
  }

  const targetLevel = readTargetLevel(candidateStore, candidate.id, targetRoles);
  const snapshot = await readMatchedSnapshot(
    multiSourceEngine,
    candidate.id,
    confirmedSkills,
    targetRoles,
    targetLevel,
  );
  const matched = finishMatchedVacancies(
    snapshot,
    targetRoles,
    campaign,
    candidateStore,
    candidate.id,
  );
  const hypothesisSnapshot = campaign.remoteOnly
    ? snapshot.filter((item) => item.cluster.isRemote)
    : snapshot;
  const vacancyCountsByRole = countMatchedVacanciesByRole(hypothesisSnapshot, targetRoles);
  const campaignWithHypotheses = readCampaign(candidateStore, candidate.id, vacancyCountsByRole);
  const page = buildMatchedVacancyPage(matched, offset);

  return {
    data: addStoredVacancyLevels(page.items, targetLevel, (key) => titleParseStore.getByKey(key)),
    meta: {
      requestId: request.id,
      total: page.total,
      offset: page.offset,
      nextOffset: page.nextOffset,
      ...(page.pageOffsets ? { pageOffsets: page.pageOffsets } : {}),
      campaign: campaignMeta(campaignWithHypotheses),
      candidateLevel: targetLevel ?? null,
    },
  };
};

export function registerMatchedVacancyRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/matched-vacancies', withDeps(deps, handleMatchedVacancies));
}
