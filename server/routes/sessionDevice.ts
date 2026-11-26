import type { FastifyReply, FastifyRequest } from 'fastify';
import { deviceLabelOf } from '../auth/deviceLabel';
import type { RouteDeps } from './deps';
import { extractSessionToken, setSessionCookie } from './helpers';

/** B754: название устройства сессии из user agent; пишется один раз, первым — при входе. */
export function labelDevice(
  deps: RouteDeps,
  request: FastifyRequest,
  sessionToken: string = extractSessionToken(request, deps.config),
): void {
  const label = deviceLabelOf(request.headers['user-agent'], request.headers.origin);
  if (label) deps.authService.labelSession?.(sessionToken, label);
}

/** Новая сессия: cookie и название устройства из запроса, которым она открыта. */
export function startSession(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  sessionToken: string,
): void {
  setSessionCookie(reply, sessionToken, deps.config.secureCookies);
  labelDevice(deps, request, sessionToken);
}
