import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  buildB640NotificationFeed,
  type B640ApplicationContext,
} from '../domain/b640Notifications';
import { sessionCandidate } from './b640VacancyContext';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';
import { notificationRepositoryFor } from './notificationRepositoryAccess';

const PATH = '/api/v1/candidate/b640/notifications';
/** Сколько последних уведомлений лента разбирает за один запрос. */
const FEED_ROW_LIMIT = 500;

const querySchema = z
  .object({
    category: z.enum(['all', 'invitations', 'responses', 'vacancies']).default('all'),
    cursor: z.coerce.number().int().min(0).max(FEED_ROW_LIMIT).default(0),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

/**
 * Отклики из уведомлений, по одному чтению на отклик. `getApplication` только
 * читает; `listApplications` переносит старые отклики и пишет в базу — на GET нельзя.
 */
function applicationContexts(
  deps: RouteDeps,
  candidateId: string,
  needed: ReadonlySet<string>,
): Map<string, B640ApplicationContext> {
  const contexts = new Map<string, B640ApplicationContext>();
  for (const id of needed) {
    const application = deps.candidateStore.getApplication(candidateId, id);
    if (!application) continue;
    const receipt = application.deliveryReceipt;
    contexts.set(application.id, {
      stage: application.stage,
      company: application.vacancy?.company ?? null,
      role: application.vacancy?.title ?? null,
      interviewAt: application.nearestInterview?.scheduledAt ?? null,
      failureNote: receipt?.kind === 'failure_note' ? receipt.value : null,
    });
  }
  return contexts;
}

type FeedQuery = z.infer<typeof querySchema>;

function readFeed(deps: RouteDeps, candidateId: string, query: FeedQuery) {
  const stored = notificationRepositoryFor(deps).listForFeed(candidateId, {
    max: FEED_ROW_LIMIT,
    now: new Date().toISOString(),
  });
  const needed = new Set(
    stored.rows.filter((row) => row.sourceType === 'application').map((row) => row.sourceId),
  );
  return buildB640NotificationFeed({
    rows: stored.rows,
    applications: applicationContexts(deps, candidateId, needed),
    unreadCount: stored.unreadCount,
    category: query.category,
    offset: query.cursor,
    limit: query.limit,
  });
}

async function listNotifications(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return reply;
  const candidate = sessionCandidate(request, reply, principal.candidate);
  if (!candidate) return reply;
  const query = querySchema.safeParse(request.query ?? {});
  if (!query.success) {
    return sendError(
      reply,
      request,
      400,
      'invalid_query',
      'Проверьте параметры ленты уведомлений.',
      false,
    );
  }
  try {
    const data = readFeed(deps, candidate.id, query.data);
    return { data, meta: { requestId: request.id } };
  } catch (error) {
    request.log.error(
      {
        code: 'b640_notification_feed_failed',
        candidateId: candidate.id,
        failureType: error instanceof Error ? error.name : 'UnknownError',
      },
      'b640-notification-feed-failed',
    );
    return sendError(
      reply,
      request,
      503,
      'notification_storage_unavailable',
      'Уведомления временно недоступны.',
      true,
    );
  }
}

export function registerB640NotificationRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get(
    PATH,
    { config: { rateLimit: { max: 600, timeWindow: '1 hour' } } },
    withDeps(deps, listNotifications),
  );
}
