import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { runCandidateFootprintAudit } from '../osint/candidateFootprintWorker';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  withDeps,
} from './helpers';

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

  // Client-supplied source rows are test fixtures, not evidence. Production
  // audits must use server-owned retrieval receipts and candidate profile data;
  // accepting arbitrary publicPosts here made a fabricated post sufficient for
  // a completed safe score.
  const options = undefined;

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

  const audit = candidateReputationRepo?.getLatestAudit(candidate.id, { trustedOnly: true }) ?? null;

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
