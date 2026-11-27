import { roleTitleRu } from '../vacancies/roleTitleRu';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { footprintFindingCounts } from '../domain/footprintRisk';
import {
  buildB640NotificationFeed,
  type B640ApplicationContext,
} from '../domain/b640Notifications';
import { registerB640DeliverySettingsRoutes } from './b640DeliverySettingsRoutes';
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

/** B671: напоминание ссылается на интервью; компания и роль — из его отклика, время — его. */
function interviewContexts(
  deps: RouteDeps,
  candidateId: string,
  needed: ReadonlySet<string>,
): Map<string, B640ApplicationContext> {
  const contexts = new Map<string, B640ApplicationContext>();
  for (const id of needed) {
    const interview = deps.candidateStore.getInterviewSubject(candidateId, id);
    if (!interview) continue;
    contexts.set(id, {
      stage: interview.stage,
      company: interview.vacancyCompany ?? null,
      role: interview.vacancyTitle ?? null,
      interviewAt: interview.scheduledAt,
      failureNote: null,
    });
  }
  return contexts;
}

type FeedQuery = z.infer<typeof querySchema>;

/** B671: роль поиска нужна только ленте с подборками «Новые вакансии по вашей роли». */
function searchRolesOf(
  deps: RouteDeps,
  candidateId: string,
  rows: readonly { readonly kind: string }[],
): string[] {
  if (!rows.some((row) => row.kind === 'new_vacancies_by_role')) return [];
  // B737: роль поиска хранится английским названием онтологии, кандидату — по-русски.
  const campaign = readCampaign(deps.candidateStore, candidateId);
  return campaign.roles.value
    .map((title) => roleTitleRu(title, campaign.ownTitlesRu).trim())
    .filter(Boolean);
}

/** B671 (n01b): «Цифровой след: N новых находок» — то же число, что на экране следа (B801). */
function findingCountsOf(
  deps: RouteDeps,
  candidateId: string,
  rows: readonly { readonly kind: string; readonly sourceId: string }[],
): Map<string, number> {
  const ids = new Set(
    rows.filter((row) => row.kind === 'footprint_findings').map((row) => row.sourceId),
  );
  const repository = deps.candidateReputationRepo;
  if (ids.size === 0 || !repository) return new Map();
  const discrepancies =
    repository.getLatestAudit(candidateId, { trustedOnly: true })?.consistencyDiscrepancies ?? [];
  const audits = repository.listFootprintAudits(candidateId).filter((audit) => ids.has(audit.id));
  return footprintFindingCounts(audits, discrepancies);
}

function readFeed(deps: RouteDeps, candidateId: string, query: FeedQuery) {
  const repository = notificationRepositoryFor(deps);
  const invitation = repository.getInvitationPreference(candidateId);
  const replies = repository.getPreferences(candidateId).find((item) => item.key === 'ev-reply');
  const now = new Date().toISOString();
  const stored = repository.listForFeed(candidateId, {
    max: FEED_ROW_LIMIT,
    now,
    keepReplies: invitation.stored,
  });
  const sourceIds = (type: string) =>
    new Set(stored.rows.filter((row) => row.sourceType === type).map((row) => row.sourceId));
  return buildB640NotificationFeed({
    rows: stored.rows,
    applications: new Map([
      ...applicationContexts(deps, candidateId, sourceIds('application')),
      ...interviewContexts(deps, candidateId, sourceIds('interview')),
    ]),
    now,
    unreadCount: stored.unreadCount,
    inApp: invitation.stored
      ? { replies: replies?.app ?? true, invitations: invitation.app }
      : undefined,
    category: query.category,
    offset: query.cursor,
    limit: query.limit,
    searchRoles: searchRolesOf(deps, candidateId, stored.rows),
    findingCounts: findingCountsOf(deps, candidateId, stored.rows),
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
  registerB640DeliverySettingsRoutes(app, deps);
}
