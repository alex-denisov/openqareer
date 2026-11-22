import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  LINKEDIN_QUEUE_PAGE_MAX, LINKEDIN_QUEUE_STATES, LINKEDIN_RHYTHM_DAYS, type LinkedinQueueItem, type LinkedinRhythm,
} from '../../shared/b640LinkedinQueue';
import { DEFAULT_ACCOUNT_TIMEZONE, isValidTimezone } from '../../shared/timezoneUtils';
import type { LinkedinQueueRepository, ChangeResult } from '../linkedinQueue/linkedinQueueRepository';
import type { PostReminders } from '../linkedinQueue/postReminders';
import { isLinkedinUrl } from '../linkedinQueue/linkedinUrl';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError } from './helpers';
import { linkedinQueueFor, postRemindersFor } from './linkedinPostReminders';

const BASE = '/api/v1/candidate/b640/linkedin';
const MAX_AHEAD_MS = 366 * 86_400_000;
const READ_LIMIT = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };
const WRITE_LIMIT = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

const rhythmSchema = z.object({
  postsPerWeek: z.number().int().min(1).max(7),
  days: z.array(z.enum(LINKEDIN_RHYTHM_DAYS)).min(1).max(7),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u),
  timezone: z.string().refine(isValidTimezone),
}).strict();
const futureAt = z.string().datetime({ offset: true }).refine((value) => {
  const time = Date.parse(value);
  return time > Date.now() && time < Date.now() + MAX_AHEAD_MS;
});
const idSchema = z.object({ id: z.string().min(1).max(100) });
const querySchema = z.object({
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(LINKEDIN_QUEUE_PAGE_MAX).default(LINKEDIN_QUEUE_PAGE_MAX),
  state: z.enum(LINKEDIN_QUEUE_STATES).optional(),
});
const enqueueSchema = z.object({ draftId: z.string().min(1).max(100), at: futureAt.optional() }).strict();
const patchSchema = z.object({ at: futureAt }).strict();
const publishedSchema = z.object({ url: z.string().max(500).refine(isLinkedinUrl).optional() }).strict();
const remindedSchema = z.object({}).strict();

interface Context { readonly candidateId: string; readonly timezone: string; readonly repo: LinkedinQueueRepository }

function context(deps: RouteDeps, repo: LinkedinQueueRepository, request: FastifyRequest, reply: FastifyReply): Context | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  const zone = deps.authService.getUser?.(principal.userId)?.timezone;
  return { candidateId: principal.candidate.id, timezone: isValidTimezone(zone) ? (zone as string) : DEFAULT_ACCOUNT_TIMEZONE, repo };
}

const bad = (request: FastifyRequest, reply: FastifyReply, code: string, message: string) => sendError(reply, request, 400, code, message, false);
const ok = (request: FastifyRequest, data: unknown) => ({ data, meta: { requestId: request.id } });

function changed(request: FastifyRequest, reply: FastifyReply, result: ChangeResult) {
  if (result.ok) return ok(request, result.item);
  if (result.error === 'not_found') return sendError(reply, request, 404, 'queue_item_not_found', 'Запись очереди не найдена.', false);
  return sendError(reply, request, 409, 'queue_item_state', 'Запись очереди сейчас в другом состоянии.', false);
}

const ENQUEUE_ERRORS = {
  not_found: [404, 'draft_not_found', 'Черновик не найден.'],
  not_approved: [409, 'draft_not_approved', 'В очередь ставится только одобренный и ещё не опубликованный черновик.'],
  already_queued: [409, 'draft_already_queued', 'Черновик уже в очереди или опубликован.'],
  no_slot: [409, 'no_free_slot', 'В ближайшие месяцы нет свободного слота ритма.'],
} as const;

function registerRhythm(app: FastifyInstance, deps: RouteDeps, repo: LinkedinQueueRepository): void {
  app.get(`${BASE}/rhythm`, READ_LIMIT, async (request, reply) => {
    const ctx = context(deps, repo, request, reply);
    if (!ctx) return reply;
    return ok(request, repo.getRhythm(ctx.candidateId, ctx.timezone));
  });
  app.put(`${BASE}/rhythm`, WRITE_LIMIT, async (request, reply) => {
    const ctx = context(deps, repo, request, reply);
    if (!ctx) return reply;
    const parsed = rhythmSchema.safeParse(request.body);
    if (!parsed.success) return bad(request, reply, 'invalid_rhythm', 'Проверьте ритм: посты в неделю, дни, время и пояс.');
    const days = LINKEDIN_RHYTHM_DAYS.filter((day) => parsed.data.days.includes(day));
    const rhythm: LinkedinRhythm = { ...parsed.data, days };
    return ok(request, repo.setRhythm(ctx.candidateId, rhythm));
  });
}

function registerQueueRead(app: FastifyInstance, deps: RouteDeps, repo: LinkedinQueueRepository, reminders: PostReminders): void {
  app.get(`${BASE}/queue`, READ_LIMIT, async (request, reply) => {
    const ctx = context(deps, repo, request, reply);
    if (!ctx) return reply;
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return bad(request, reply, 'invalid_query', 'Проверьте параметры очереди.');
    return ok(request, repo.list(ctx.candidateId, parsed.data));
  });
  app.post(`${BASE}/queue`, WRITE_LIMIT, async (request, reply) => {
    const ctx = context(deps, repo, request, reply);
    if (!ctx) return reply;
    const parsed = enqueueSchema.safeParse(request.body);
    if (!parsed.success) return bad(request, reply, 'invalid_queue_request', 'Проверьте черновик и время: оно должно быть в будущем.');
    const result = repo.enqueue(ctx.candidateId, parsed.data.draftId, parsed.data.at && new Date(parsed.data.at).toISOString(), repo.getRhythm(ctx.candidateId, ctx.timezone));
    if (result.ok) {
      reminders.schedule(ctx.candidateId, result.item);
      return ok(request, result.item);
    }
    const [status, code, message] = ENQUEUE_ERRORS[result.error];
    return sendError(reply, request, status, code, message, false);
  });
}

function registerItemChanges(app: FastifyInstance, deps: RouteDeps, repo: LinkedinQueueRepository, reminders: PostReminders): void {
  const item = (
    method: 'patch' | 'delete' | 'post', suffix: string, schema: z.ZodType | null,
    run: (ctx: Context, id: string, body: never) => ChangeResult,
  ) => app[method](`${BASE}/queue/:id${suffix}`, WRITE_LIMIT, async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = context(deps, repo, request, reply);
    if (!ctx) return reply;
    const params = idSchema.safeParse(request.params);
    const body = schema ? schema.safeParse(request.body ?? {}) : { success: true as const, data: undefined };
    if (!params.success || !body.success) return bad(request, reply, 'invalid_queue_request', 'Проверьте время или ссылку на публикацию.');
    return changed(request, reply, run(ctx, params.data.id, body.data as never));
  });
  // B695: перенос ставит напоминание на новое время, удаление и публикация снимают его.
  const after = (result: ChangeResult, then: (item: LinkedinQueueItem) => void) => {
    if (result.ok) then(result.item);
    return result;
  };
  item('patch', '', patchSchema, (ctx, id, body: { at: string }) =>
    after(ctx.repo.reschedule(ctx.candidateId, id, new Date(body.at).toISOString()), (moved) => reminders.schedule(ctx.candidateId, moved)));
  item('delete', '', null, (ctx, id) => after(ctx.repo.remove(ctx.candidateId, id), () => reminders.withdraw(ctx.candidateId, id)));
  item('post', '/published', publishedSchema, (ctx, id, body: { url?: string }) =>
    after(ctx.repo.markPublished(ctx.candidateId, id, body.url ?? null), () => reminders.withdraw(ctx.candidateId, id)));
  item('post', '/reminded', remindedSchema, (ctx, id) => ctx.repo.markReminded(ctx.candidateId, id));
}

/**
 * B694/B695: ритм и очередь публикаций LinkedIn за флагом `cabinetB640`. Только наше хранение:
 * на LinkedIn ничего не уходит. Когда время пришло, строка становится `due`, а уведомление
 * `post_reminder` (записано заранее на это время) появляется в «Сегодня» и уходит в Telegram;
 * кандидат публикует сам.
 */
export function registerB640LinkedinQueueRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const repo = linkedinQueueFor(deps);
  const reminders = postRemindersFor(deps, app.log, repo);
  if (!repo || !reminders) return;
  registerRhythm(app, deps, repo);
  registerQueueRead(app, deps, repo, reminders);
  registerItemChanges(app, deps, repo, reminders);
}
