import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SEARCH_CONSENT_POLICY_VERSION } from '../../shared/searchConsent';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';

const putBodySchema = z.object({ granted: z.boolean() });

async function handleGetConsent(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const { authService, candidateStore, config, searchConsentRepo } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;

  const consent = searchConsentRepo?.get(candidate.id) ?? {
    granted: false,
    policyVersion: '',
    updatedAt: '',
  };
  return { data: { consent }, meta: { requestId: request.id } };
}

async function handlePutConsent(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const { authService, candidateStore, config, searchConsentRepo } = deps;
  if (!hasSafeMutationOrigin(request, config)) {
    return csrfError(request, reply);
  }
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;

  const parsed = putBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return sendError(reply, request, 400, 'invalid_request', 'Поле granted должно быть true или false.', false);
  }
  if (!searchConsentRepo) {
    return sendError(
      reply,
      request,
      503,
      'search_consent_unavailable',
      'Сохранение согласия временно недоступно. Попробуйте ещё раз позже.',
      true,
    );
  }

  const consent = searchConsentRepo.set(candidate.id, {
    granted: parsed.data.granted,
    policyVersion: SEARCH_CONSENT_POLICY_VERSION,
  });
  return { data: { consent }, meta: { requestId: request.id } };
}

export function registerSearchConsentRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/search-consent', withDeps(deps, handleGetConsent));
  app.put('/api/v1/candidate/search-consent', withDeps(deps, handlePutConsent));
}
