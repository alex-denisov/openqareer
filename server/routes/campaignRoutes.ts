import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CANDIDATE_REGIONS } from '../../src/features/workspace/candidateRegions';
import { campaignMeta, readCampaign } from './campaignContext';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import { rebuildCampaignRoles } from '../vacancies/rebuildCampaignRoles';
import { handleChangeCareerRole } from './careerRoleChangeRoute';

type Handler = (
  deps: RouteDeps,
  request: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
) => Promise<unknown>;

/**
 * Явный выбор кампании (B247, срез 1) — чтение и запись рядом со стратегией,
 * тем же стилем: `candidateWorkspace` остаётся единственным местом хранения,
 * без отдельной таблицы и без миграции (решение архитектора).
 */
const handleReadCampaign: Handler = async (deps, request, reply) => {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  return {
    data: campaignMeta(readCampaign(deps.candidateStore, candidate.id)),
    meta: { requestId: request.id },
  };
};

const campaignRoleChoiceSchema = z.union([
  z.string().trim().min(1).max(200),
  z
    .object({
      id: z.string().min(1).optional(),
      title: z.string().trim().min(1).max(200),
    })
    .passthrough(),
]);

const campaignChoiceSchema = z.object({
  roles: z.array(campaignRoleChoiceSchema).max(10),
  regions: z.array(z.enum(CANDIDATE_REGIONS)).max(CANDIDATE_REGIONS.length),
  remoteOnly: z.boolean().optional(),
});

const WORKSPACE_REQUIRED = {
  status: 409,
  code: 'candidate_workspace_required',
  message: 'Пройдите мастер знакомства прежде, чем выбирать кампанию.',
} as const;

const handleSaveCampaign: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const body = campaignChoiceSchema.parse(request.body);

  const stored = candidateStore.getCandidateWorkspace(candidate.id);
  if (!stored) {
    return sendError(
      reply,
      request,
      WORKSPACE_REQUIRED.status,
      WORKSPACE_REQUIRED.code,
      WORKSPACE_REQUIRED.message,
      false,
    );
  }
  const previousRevision = stored.campaign?.revision ?? 0;
  const roles = body.roles.map((role) => (typeof role === 'string' ? role : role.title));
  candidateStore.saveCandidateWorkspace(candidate.id, {
    ...stored,
    campaign: {
      roles,
      regions: body.regions,
      remoteOnly: body.remoteOnly ?? stored.campaign?.remoteOnly ?? false,
      revision: previousRevision + 1,
      updatedAt: new Date().toISOString(),
      ...(stored.campaign?.auto ? { auto: stored.campaign.auto } : {}),
      ...(stored.campaign?.careerRoles ? { careerRoles: stored.campaign.careerRoles } : {}),
      // A saved list is not a refusal: the premises form replaces it with one role. 03.11 that
      // dismissed CTO and CIO for adenisov.test. A role is declined by removing it on «Карьера».
      ...(stored.campaign?.dismissed?.length ? { dismissed: stored.campaign.dismissed } : {}),
    },
  });
  deps.matchedPoolPrecompute?.prioritizeCampaign(candidate.id);
  return {
    data: campaignMeta(readCampaign(candidateStore, candidate.id)),
    meta: { requestId: request.id },
  };
};

const handleRebuildCampaignRoles: Handler = async (deps, request, reply) => {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  void rebuildCampaignRoles(deps, candidate.id, {
    force: true,
    log: (fields, message) => request.log.info(fields, message),
  }).catch((error) => {
    request.log.error({ error }, 'campaign_roles_rebuild_failed');
  });
  return reply.code(202).send({ data: { status: 'queued' }, meta: { requestId: request.id } });
};

export function registerCampaignRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/campaign', withDeps(deps, handleReadCampaign));
  app.post(
    '/api/v1/candidate/career-roles',
    { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } },
    withDeps(deps, handleChangeCareerRole),
  );
  app.post(
    '/api/v1/candidate/campaign',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    withDeps(deps, handleSaveCampaign),
  );
  app.post(
    '/api/v1/candidate/campaign/roles/rebuild',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    withDeps(deps, handleRebuildCampaignRoles),
  );
}
