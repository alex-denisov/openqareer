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

const campaignChoiceSchema = z.object({
  roles: z.array(z.string().trim().min(1).max(200)).max(10),
  regions: z.array(z.enum(CANDIDATE_REGIONS)).max(CANDIDATE_REGIONS.length),
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
  candidateStore.saveCandidateWorkspace(candidate.id, {
    ...stored,
    campaign: {
      roles: body.roles,
      regions: body.regions,
      revision: previousRevision + 1,
      updatedAt: new Date().toISOString(),
    },
  });

  return {
    data: campaignMeta(readCampaign(candidateStore, candidate.id)),
    meta: { requestId: request.id },
  };
};

export function registerCampaignRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/campaign', withDeps(deps, handleReadCampaign));
  app.post(
    '/api/v1/candidate/campaign',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    withDeps(deps, handleSaveCampaign),
  );
}
