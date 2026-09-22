import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthPrincipal } from '../auth/authService';
import { isAdminRole, roleCan } from '../../shared/roleMatrix';
import type { RouteDeps } from './deps';
import {
  authenticateSession,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
} from './helpers';

export function requireAdmin(
  deps: Pick<RouteDeps, 'authService' | 'config'>,
  request: FastifyRequest,
  reply: FastifyReply,
): AuthPrincipal | null {
  const principal = authenticateSession(request, deps.authService, deps.config);
  if (!principal) {
    void sendError(reply, request, 401, 'unauthorized', 'Нужен вход в аккаунт.', false);
    return null;
  }
  if (!isAdminRole(principal.role) || !roleCan(principal.role, 'admin.console')) {
    void sendError(
      reply,
      request,
      403,
      'forbidden',
      'Раздел доступен только администратору.',
      false,
    );
    return null;
  }
  return principal;
}

export function requireAdminMutation(
  deps: Pick<RouteDeps, 'authService' | 'config'>,
  request: FastifyRequest,
  reply: FastifyReply,
): AuthPrincipal | null {
  const principal = requireAdmin(deps, request, reply);
  if (!principal) return null;
  if (!hasSafeMutationOrigin(request, deps.config)) {
    void csrfError(request, reply);
    return null;
  }
  return principal;
}
