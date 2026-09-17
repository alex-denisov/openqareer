import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { runCandidateFootprintAudit } from '../osint/candidateFootprintWorker';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  withDeps,
} from './helpers';

const startAuditBodySchema = z
  .object({
    options: z
      .object({
        experience: z
          .array(
            z.object({
              id: z.string(),
              company: z.string(),
              role: z.string(),
              startDate: z.string(),
              endDate: z.string().optional(),
              current: z.boolean().optional(),
            }),
          )
          .optional(),
        externalProfiles: z
          .array(
            z.object({
              platform: z.string(),
              company: z.string(),
              role: z.string(),
              startDate: z.string(),
              endDate: z.string().optional(),
              current: z.boolean().optional(),
            }),
          )
          .optional(),
        publicPosts: z
          .array(
            z.object({
              id: z.string(),
              sourcePlatform: z.string(),
              sourceUrl: z.string().optional(),
              publishedAt: z.string().optional(),
              content: z.string(),
            }),
          )
          .optional(),
      })
      .optional(),
  })
  .optional();

async function handleStartAudit(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const { authService, candidateStore, config, candidateReputationRepo } = deps;
  if (!hasSafeMutationOrigin(request, config)) {
    return csrfError(request, reply);
  }
  const candidate = authenticateCandidate(
    request,
    reply,
    candidateStore,
    authService,
    config,
  );
  if (!candidate || !candidateReputationRepo) {
    return undefined;
  }

  const parsed = startAuditBodySchema.safeParse(request.body ?? {});
  const options = parsed.success ? parsed.data?.options : undefined;

  const audit = await runCandidateFootprintAudit({
    candidateId: candidate.id,
    repo: candidateReputationRepo,
    candidateStore,
    options,
  });

  return {
    data: { audit },
    meta: { requestId: request.id },
  };
}

async function handleGetAudit(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const { authService, candidateStore, config, candidateReputationRepo } = deps;
  const candidate = authenticateCandidate(
    request,
    reply,
    candidateStore,
    authService,
    config,
  );
  if (!candidate) {
    return undefined;
  }

  const audit = candidateReputationRepo?.getLatestAudit(candidate.id) ?? null;

  return {
    data: { audit },
    meta: { requestId: request.id },
  };
}

export function registerReputationAuditRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): void {
  app.post(
    '/api/v1/candidate/reputation-audit/start',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    withDeps(deps, handleStartAudit),
  );

  app.get(
    '/api/v1/candidate/reputation-audit',
    withDeps(deps, handleGetAudit),
  );
}
