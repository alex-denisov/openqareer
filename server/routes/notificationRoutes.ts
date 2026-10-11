import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from './deps';
import { authenticateCandidate, csrfError, hasSafeMutationOrigin, sendError } from './helpers';
import { closeNotificationRepositoryFor, notificationRepositoryFor } from './notificationRepositoryAccess';
import { NotificationCursorError } from '../data/sqliteNotificationRepository';
import type { NotificationPreferenceKey } from '../data/notificationPolicy';

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(256).optional(),
});
const preferenceKeySchema = z.enum([
  'ev-reply', 'ev-reminder', 'ev-approval', 'ev-delivery-error', 'ev-target-company', 'ev-weekly-digest',
]);
const preferenceBodySchema = z.object({ app: z.boolean(), email: z.boolean() }).strict();

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const handleListNotifications: Handler = async (deps, request, reply) => {
  const candidate = authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
  if (!candidate) return undefined;
  const query = listQuerySchema.safeParse(request.query ?? {});
  if (!query.success) return sendError(reply, request, 400, 'invalid_notification_page', 'Проверьте параметры списка уведомлений.', false);
  try {
    const data = notificationRepositoryFor(deps).list(candidate.id, { ...query.data, now: new Date().toISOString() });
    return { data, meta: { requestId: request.id } };
  } catch (error) {
    if (error instanceof NotificationCursorError) return sendError(reply, request, 400, 'invalid_notification_cursor', 'Не удалось продолжить этот список. Обновите страницу.', false);
    request.log.error({ code: 'notification_list_failed', candidateId: candidate.id, failureType: error instanceof Error ? error.name : 'UnknownError' }, 'candidate-notification-list-failed');
    return sendError(reply, request, 503, 'notification_storage_unavailable', 'Уведомления временно недоступны.', true);
  }
};

const handleMarkNotificationRead: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
  if (!candidate) return undefined;
  const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
  if (!params.success) return sendError(reply, request, 400, 'invalid_notification_id', 'Проверьте уведомление.', false);
  const readAt = new Date().toISOString();
  const changed = notificationRepositoryFor(deps).markRead(candidate.id, params.data.id, readAt);
  if (!changed) return sendError(reply, request, 404, 'notification_not_found', 'Уведомление не найдено.', false);
  return { data: { id: params.data.id, readAt }, meta: { requestId: request.id } };
};

const handleMarkAllNotificationsRead: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
  if (!candidate) return undefined;
  const updated = notificationRepositoryFor(deps).markAllRead(candidate.id, new Date().toISOString());
  return { data: { updated }, meta: { requestId: request.id } };
};

const handleGetNotificationPreferences: Handler = async (deps, request, reply) => {
  const candidate = authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
  if (!candidate) return undefined;
  return { data: { events: notificationRepositoryFor(deps).getPreferences(candidate.id) }, meta: { requestId: request.id } };
};

const handleSetNotificationPreference: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
  if (!candidate) return undefined;
  const params = z.object({ key: preferenceKeySchema }).safeParse(request.params);
  const body = preferenceBodySchema.safeParse(request.body);
  if (!params.success || !body.success) return sendError(reply, request, 400, 'invalid_notification_preference', 'Проверьте настройки события.', false);
  const updatedAt = new Date().toISOString();
  const data = notificationRepositoryFor(deps).setPreference(candidate.id, params.data.key as NotificationPreferenceKey, body.data, updatedAt);
  return { data: { ...data, updatedAt }, meta: { requestId: request.id } };
};

export function registerNotificationRoutes(app: FastifyInstance, deps: RouteDeps): void {
  notificationRepositoryFor(deps);
  app.addHook('onClose', () => closeNotificationRepositoryFor(deps));
  app.get('/api/v1/candidate/notifications', { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } }, async (request, reply) => handleListNotifications(deps, request, reply));
  app.put('/api/v1/candidate/notifications/:id/read', { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } }, async (request, reply) => handleMarkNotificationRead(deps, request, reply));
  app.put('/api/v1/candidate/notifications/read-all', { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (request, reply) => handleMarkAllNotificationsRead(deps, request, reply));
  app.get('/api/v1/candidate/notifications/preferences', async (request, reply) => handleGetNotificationPreferences(deps, request, reply));
  app.put('/api/v1/candidate/notifications/preferences/:key', async (request, reply) => handleSetNotificationPreference(deps, request, reply));
}
