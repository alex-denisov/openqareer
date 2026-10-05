import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CAPABILITY_CONSENTS_APPROVED } from '../../src/features/legal/capabilityConsents';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';

async function handleStartAudit(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  if (!hasSafeMutationOrigin(request, deps.config)) {
    return csrfError(request, reply);
  }
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const code = CAPABILITY_CONSENTS_APPROVED
    ? 'query_plan_required'
    : 'consent_text_not_approved';
  const message = CAPABILITY_CONSENTS_APPROVED
    ? 'Перед запуском проверьте план запросов цифрового следа.'
    : 'Скоро: ждёт утверждения текста согласия.';
  return sendError(reply, request, 409, code, message, false);
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
