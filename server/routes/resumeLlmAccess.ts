import type { FastifyRequest } from 'fastify';
import type { RouteDeps } from './deps';
import { authenticateSession, candidateHasLlmAccess } from './helpers';

export function resumeStructurerForRequest(
  deps: RouteDeps,
  request: FastifyRequest,
): RouteDeps['resumeStructurer'] {
  if (deps.config.billingEnforcement !== true) return deps.resumeStructurer;
  const principal = authenticateSession(request, deps.authService, deps.config);
  const bearer = request.headers.authorization?.startsWith('Bearer ')
    ? request.headers.authorization.slice('Bearer '.length)
    : '';
  const candidateId = principal?.candidate?.id ?? deps.candidateStore.authenticate(bearer)?.id;
  return candidateId && candidateHasLlmAccess(deps, candidateId)
    ? deps.resumeStructurer
    : undefined;
}

export function resumeStructurerForCandidate(
  deps: RouteDeps,
  candidateId: string,
): RouteDeps['resumeStructurer'] {
  return candidateHasLlmAccess(deps, candidateId) ? deps.resumeStructurer : undefined;
}
