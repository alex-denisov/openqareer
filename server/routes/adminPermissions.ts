import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthPrincipal } from '../auth/authTypes';
import type { RouteDeps } from './deps';
import { requireAdmin, requireAdminMutation } from './adminAuth';
import { adminPermissionPatchSchema } from './schemas';
import { sendError, withDeps } from './helpers';

function requireSuperAdmin(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  mutation = false,
): AuthPrincipal | null {
  const principal = mutation
    ? requireAdminMutation(deps, request, reply)
    : requireAdmin(deps, request, reply);
  if (!principal) return null;
  if (principal.role === 'admin') return principal;
  void sendError(reply, request, 403, 'forbidden', 'Недостаточно прав.', false);
  return null;
}

async function handleGetPermissions(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireSuperAdmin(deps, request, reply);
  if (!principal) return;
  const { userId } = request.params as { userId: string };
  const snapshot = deps.authService.getAdminPermissionSnapshot?.(userId);
  if (!snapshot) {
    return sendError(reply, request, 404, 'not_found', 'Пользователь не найден.', false);
  }
  return { data: snapshot, meta: { requestId: request.id } };
}

async function handleSetPermission(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireSuperAdmin(deps, request, reply, true);
  if (!principal) return;
  const { userId } = request.params as { userId: string };
  const change = adminPermissionPatchSchema.parse(request.body ?? {});
  try {
    const snapshot = deps.authService.setAdminPermission?.(
      userId,
      change.permission,
      change.enabled,
      principal,
    );
    if (!snapshot) throw new Error('User record was not updated.');
    return { data: snapshot, meta: { requestId: request.id } };
  } catch (error) {
    return sendPermissionError(reply, request, error);
  }
}

function sendPermissionError(reply: FastifyReply, request: FastifyRequest, error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message === 'Пользователь не найден.') {
    return sendError(reply, request, 404, 'not_found', message, false);
  }
  if (message.startsWith('Последний суперадминистратор')) {
    return sendError(reply, request, 409, 'last_superadmin', message, false);
  }
  request.log.error({ error }, 'admin_permission_update_failed');
  return sendError(
    reply,
    request,
    500,
    'permission_update_failed',
    'Не удалось сохранить право.',
    true,
  );
}

export function registerAdminPermissionRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/admin/users/:userId/permissions', withDeps(deps, handleGetPermissions));
  app.patch('/api/v1/admin/users/:userId/permissions', withDeps(deps, handleSetPermission));
}
