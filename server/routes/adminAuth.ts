import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthPrincipal } from '../auth/authService';
import {
  isAdminRole,
  isCareerPartnerRole,
  resolveAdminPermissions,
  roleCan,
  type AdminPermission,
} from '../../shared/roleMatrix';
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
  const path = request.routeOptions.url ?? request.url.split('?')[0];
  if (isAdminRole(principal.role) && roleCan(principal.role, 'admin.console')) {
    const required = adminRoutePermissions(path, request.method);
    if (required && required.every((permission) => hasAdminPermission(deps, principal, permission))) {
      return principal;
    }
    if (!required) return principal;
  } else if (isCareerPartnerRole(principal.role) && isPartnerRoute(path)) {
    const required = adminRoutePermissions(path, request.method);
    if (required?.length && required.every((permission) => hasAdminPermission(deps, principal, permission))) {
      return principal;
    }
  }
  if (!isAdminRole(principal.role) && !isCareerPartnerRole(principal.role)) {
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
  void sendError(reply, request, 403, 'forbidden', 'Недостаточно прав для этого действия.', false);
  return null;
}

function hasAdminPermission(
  deps: Pick<RouteDeps, 'authService'>,
  principal: AuthPrincipal,
  permission: AdminPermission,
): boolean {
  const snapshot = deps.authService.getAdminPermissionSnapshot?.(principal.userId);
  const permissions = snapshot?.permissions ??
    (deps.authService.getAdminPermissionSnapshot
      ? null
      : resolveAdminPermissions(principal.role));
  return permissions?.[permission] === true;
}

function isPartnerRoute(path: string): boolean {
  return path.startsWith('/api/v1/admin/partner/candidates') ||
    path === '/api/v1/admin/audit' ||
    path.startsWith('/api/v1/admin/linkedin') ||
    path.startsWith('/api/v1/admin/vacancy-sources') ||
    path.startsWith('/api/v1/admin/vacancies') ||
    path.startsWith('/api/v1/admin/runtime-memory') ||
    path.startsWith('/api/v1/admin/hh-crawl-filter') ||
    path === '/api/v1/provider/status';
}

function adminRoutePermissions(path: string, method: string): AdminPermission[] | null {
  if (path.startsWith('/api/v1/admin/users')) {
    if (path.endsWith('/permissions')) return [];
    return ['can_view_candidates'];
  }
  if (path.startsWith('/api/v1/admin/partner/candidates')) {
    return path.endsWith('/campaign') && method !== 'GET'
      ? ['can_view_candidates', 'can_edit_campaigns']
      : ['can_view_candidates'];
  }
  if (path === '/api/v1/provider/status') return ['can_manage_pool'];
  const required: AdminPermission[] = [];
  if (path.includes('/audit')) required.push('can_view_audit');
  if (
    path.startsWith('/api/v1/admin/linkedin') ||
    path.startsWith('/api/v1/admin/vacancy-sources') ||
    path.startsWith('/api/v1/admin/vacancies') ||
    path.startsWith('/api/v1/admin/runtime-memory') ||
    path.startsWith('/api/v1/admin/hh-crawl-filter')
  ) required.push('can_manage_pool');
  return required.length ? required : null;
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
