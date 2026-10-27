import type { FastifyRequest } from 'fastify';
import type { RouteDeps } from './deps';
import { authenticateSession } from './helpers';

/**
 * Reading the résumé is not a paid operation. The wizard asks for the document
 * before the candidate can choose any plan, so a plan gate here left Free
 * candidates with the rules reader alone, and on an hh.ru PDF it found no
 * places at all (owner report, 2026-10-27). The rules parser stays the floor
 * for a provider outage; anonymous parsing still gets no model.
 */
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
  return candidateId ? deps.resumeStructurer : undefined;
}

export function resumeStructurerForCandidate(deps: RouteDeps): RouteDeps['resumeStructurer'] {
  return deps.resumeStructurer;
}
