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
  z.object({
    id: z.string().min(1).optional(),
    title: z.string().trim().min(1).max(200),
  }).passthrough(),
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
  const roles = body.roles.map((role) => typeof role === 'string' ? role : role.title);
  const kept = new Set(body.roles.flatMap((role) =>
    typeof role === 'string' ? [role] : [role.id, role.title].filter((value): value is string => Boolean(value)),
  ));
  const previouslyChosen = new Set(stored.campaign?.roles ?? []);
  const removedAutoIds = (stored.campaign?.auto?.roles ?? [])
    .filter(
      (role) =>
        (previouslyChosen.has(role.id) || previouslyChosen.has(role.title)) &&
        !kept.has(role.id) &&
        !kept.has(role.title),
    )
    .map((role) => role.id);
  candidateStore.saveCandidateWorkspace(candidate.id, {
    ...stored,
    campaign: {
      roles,
      regions: body.regions,
      remoteOnly: body.remoteOnly ?? stored.campaign?.remoteOnly ?? false,
      revision: previousRevision + 1,
      updatedAt: new Date().toISOString(),
      ...(stored.campaign?.auto ? { auto: stored.campaign.auto } : {}),
      ...((stored.campaign?.dismissed?.length || removedAutoIds.length)
        ? { dismissed: [...new Set([...(stored.campaign?.dismissed ?? []), ...removedAutoIds])] }
        : {}),
    },
  });

  return {
    data: campaignMeta(readCampaign(candidateStore, candidate.id)),
    meta: { requestId: request.id },
  };
};

const handleRebuildCampaignRoles: Handler = async (deps, request, reply) => {
  const candidate = authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
  if (!candidate) return undefined;
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  void rebuildCampaignRoles(deps, candidate.id, { force: true }).catch((error) => {
    request.log.error({ error }, 'campaign_roles_rebuild_failed');
  });
  return reply.code(202).send({ data: { status: 'queued' }, meta: { requestId: request.id } });
};

export function registerCampaignRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/campaign', withDeps(deps, handleReadCampaign));
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
