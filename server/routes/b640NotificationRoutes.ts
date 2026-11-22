import { roleTitleRu } from '../vacancies/roleTitleRu';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  buildB640NotificationFeed,
  searchRoleLabel,
  type B640ApplicationContext,
} from '../domain/b640Notifications';
import { readCampaign } from './campaignContext';
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

/** B671: роль поиска нужна только ленте с подборками «Новые вакансии по вашей роли». */
function searchRoleOf(
  deps: RouteDeps,
  candidateId: string,
  rows: readonly { readonly kind: string }[],
): string | null {
  if (!rows.some((row) => row.kind === 'new_vacancies_by_role')) return null;
  // B737: роль поиска хранится английским названием онтологии, кандидату — по-русски.
  return searchRoleLabel(
    readCampaign(deps.candidateStore, candidateId).roles.value.map(roleTitleRu),
  );
}

function readFeed(deps: RouteDeps, candidateId: string, query: FeedQuery) {
  const repository = notificationRepositoryFor(deps);
  const invitation = repository.getInvitationPreference(candidateId);
  const replies = repository.getPreferences(candidateId).find((item) => item.key === 'ev-reply');
  const stored = repository.listForFeed(candidateId, {
    max: FEED_ROW_LIMIT,
    now: new Date().toISOString(),
    keepReplies: invitation.stored,
  });
  const needed = new Set(
    stored.rows.filter((row) => row.sourceType === 'application').map((row) => row.sourceId),
  );
  return buildB640NotificationFeed({
    rows: stored.rows,
    applications: applicationContexts(deps, candidateId, needed),
    unreadCount: stored.unreadCount,
    inApp: invitation.stored
      ? { replies: replies?.app ?? true, invitations: invitation.app }
      : undefined,
    category: query.category,
    offset: query.cursor,
    limit: query.limit,
    searchRole: searchRoleOf(deps, candidateId, stored.rows),
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

const INVITATION_PATH = `${PATH}/preferences/invitations`;
const invitationSchema = z
  .object({ app: z.boolean(), email: z.boolean(), telegram: z.boolean() })
  .strict();

function storageUnavailable(
  request: FastifyRequest,
  reply: FastifyReply,
  candidateId: string,
  error: unknown,
) {
  request.log.error(
    {
      code: 'b640_invitation_preference_failed',
      candidateId,
      failureType: error instanceof Error ? error.name : 'UnknownError',
    },
    'b640-invitation-preference-failed',
  );
  return sendError(
    reply,
    request,
    503,
    'notification_storage_unavailable',
    'Настройка временно недоступна.',
    true,
  );
}

/** N02 «Приглашения»: чтение ничего не пишет; без сохранённого ключа — значения «Ответов». */
async function readInvitationPreference(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return reply;
  const candidate = sessionCandidate(request, reply, principal.candidate);
  if (!candidate) return reply;
  try {
    const { app, email, telegram } = notificationRepositoryFor(deps).getInvitationPreference(
      candidate.id,
    );
    return {
      data: { key: 'ev-invitation', app, email, telegram },
      meta: { requestId: request.id },
    };
  } catch (error) {
    return storageUnavailable(request, reply, candidate.id, error);
  }
}

async function writeInvitationPreference(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return reply;
  const candidate = sessionCandidate(request, reply, principal.candidate);
  if (!candidate) return reply;
  const body = invitationSchema.safeParse(request.body ?? {});
  if (!body.success) {
    return sendError(
      reply,
      request,
      400,
      'invalid_preference',
      'Проверьте настройку приглашений.',
      false,
    );
  }
  try {
    const saved = notificationRepositoryFor(deps).setInvitationPreference(candidate.id, body.data);
    return { data: { key: 'ev-invitation', ...saved }, meta: { requestId: request.id } };
  } catch (error) {
    return storageUnavailable(request, reply, candidate.id, error);
  }
}

export function registerB640NotificationRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get(
    PATH,
    { config: { rateLimit: { max: 600, timeWindow: '1 hour' } } },
    withDeps(deps, listNotifications),
  );
  app.get(
    INVITATION_PATH,
    { config: { rateLimit: { max: 600, timeWindow: '1 hour' } } },
    withDeps(deps, readInvitationPreference),
  );
  app.put(
    INVITATION_PATH,
    { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } },
    withDeps(deps, writeInvitationPreference),
  );
}
