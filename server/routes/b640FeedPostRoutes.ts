import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  FEED_APPROVE_BATCH_MAX, FEED_POST_EXCERPT_MAX, FEED_POST_PAGE_MAX, FEED_POST_TEXT_MAX, FEED_POST_URL_MAX,
  type FeedApproveResult, type FeedPostCreated,
} from '../../shared/b640FeedComments';
import { DEFAULT_ACCOUNT_TIMEZONE, isValidTimezone } from '../../shared/timezoneUtils';
import { FeedPostRepository } from '../linkedinQueue/feedPostRepository';
import { LinkedinQueueRepository } from '../linkedinQueue/linkedinQueueRepository';
import { isLinkedinUrl } from '../linkedinQueue/linkedinUrl';
import { requireCabinetB640 } from './cabinetB640Flag';
import { applyWorkflowTransition, prepareDraftText, type CandidateDraftRouteDeps } from './candidateDraftRoutes';
import type { CandidateIdentity } from '../data/candidateStore';
import { sendError } from './helpers';

const BASE = '/api/v1/candidate/b640/linkedin/feed-posts';
const READ_LIMIT = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };
const WRITE_LIMIT = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
const APPROVE_LIMIT = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

const createSchema = z.object({
  url: z.string().trim().max(FEED_POST_URL_MAX).refine(isLinkedinUrl).optional(),
  // The model must read the post itself: a comment written from a bare link would be invented.
  text: z.string().trim().min(1).max(FEED_POST_TEXT_MAX),
}).strict();
const listSchema = z.object({
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(FEED_POST_PAGE_MAX).default(FEED_POST_PAGE_MAX),
});
const approveSchema = z.object({
  draftIds: z.array(z.string().min(1).max(100)).min(1).max(FEED_APPROVE_BATCH_MAX)
    .refine((ids) => new Set(ids).size === ids.length),
}).strict();

const ok = (request: FastifyRequest, data: unknown) => ({ data, meta: { requestId: request.id } });

/** Ссылка без параметров запроса и якоря: метки отслеживания нам не нужны. */
function cleanUrl(value: string): string {
  const url = new URL(value);
  url.search = '';
  url.hash = '';
  return url.toString();
}

interface Context {
  readonly candidate: CandidateIdentity;
  readonly timezone: string;
}

function context(deps: CandidateDraftRouteDeps, request: FastifyRequest, reply: FastifyReply): Context | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  const zone = deps.authService.getUser?.(principal.userId)?.timezone;
  return { candidate: principal.candidate, timezone: isValidTimezone(zone) ? (zone as string) : DEFAULT_ACCOUNT_TIMEZONE };
}

async function createFeedComment(
  deps: CandidateDraftRouteDeps, feed: FeedPostRepository, request: FastifyRequest, reply: FastifyReply,
  candidate: Context['candidate'], body: z.infer<typeof createSchema>,
) {
  const postUrl = body.url ? cleanUrl(body.url) : null;
  const excerpt = body.text.slice(0, FEED_POST_EXCERPT_MAX);
  const topic = `Комментарий к посту: ${excerpt || postUrl}`.slice(0, 200);
  const prepared = await prepareDraftText(deps, request, reply, candidate, {
    kind: 'comment', topic, sourceText: body.text.slice(0, 2000), inputType: 'text', tone: 'expert', length: 'short',
  });
  if (!prepared) return reply;
  try {
    const draft = deps.candidateDraftRepository.create({
      candidateId: candidate.id, kind: 'comment', topic, targetPostUrl: postUrl, text: prepared.text.slice(0, 600), localDate: prepared.localDate,
    });
    try {
      feed.add(candidate.id, draft.id, postUrl, excerpt, draft.createdAt);
    } catch (error) {
      deps.candidateDraftRepository.setStatus(candidate.id, draft.id, 'rejected');
      throw error;
    }
    const created: FeedPostCreated = { draftId: draft.id, postUrl, postExcerpt: excerpt, comment: draft.text };
    return ok(request, created);
  } catch (error) {
    request.log.error({ code: 'feed_post_save_failed', failureType: error instanceof Error ? error.name : 'UnknownError', candidateId: candidate.id }, 'b640-feed-post-save-failed');
    return sendError(reply, request, 500, 'draft_save_failed', 'Не получилось сохранить черновик. Попробуйте позже.', false);
  }
}

function approveOne(
  deps: CandidateDraftRouteDeps, feed: FeedPostRepository, queue: LinkedinQueueRepository,
  ctx: Context, draftId: string,
): FeedApproveResult {
  const fail = (reason: Extract<FeedApproveResult, { ok: false }>['reason']): FeedApproveResult => ({ draftId, ok: false, reason });
  const state = feed.stateOf(ctx.candidate.id, draftId);
  if (!state) return fail('not_found');
  if (state === 'published') return fail('already_published');
  if (state === 'queued') return fail('already_queued');
  const database = deps.candidateActionRepository!.getDatabase();
  const approved = applyWorkflowTransition(database, ctx.candidate.id, draftId, 'approved', ctx.timezone);
  if ('error' in approved) return fail(approved.error === 'already_published' ? 'already_published' : 'not_found');
  const queued = queue.enqueue(ctx.candidate.id, draftId, undefined, queue.getRhythm(ctx.candidate.id, ctx.timezone));
  if (queued.ok) return { draftId, ok: true, scheduledAt: queued.item.scheduledAt, queueItemId: queued.item.id };
  return fail(queued.error === 'not_approved' ? 'not_found' : queued.error);
}

function registerReads(app: FastifyInstance, deps: CandidateDraftRouteDeps, feed: FeedPostRepository): void {
  app.get(BASE, READ_LIMIT, async (request, reply) => {
    const ctx = context(deps, request, reply);
    if (!ctx) return reply;
    const parsed = listSchema.safeParse(request.query);
    if (!parsed.success) return sendError(reply, request, 400, 'invalid_query', 'Проверьте параметры списка.', false);
    return ok(request, feed.list(ctx.candidate.id, parsed.data.offset, parsed.data.limit));
  });
}

function registerWrites(app: FastifyInstance, deps: CandidateDraftRouteDeps, feed: FeedPostRepository, queue: LinkedinQueueRepository): void {
  const busy = new Set<string>();
  app.post(BASE, WRITE_LIMIT, async (request, reply) => {
    const ctx = context(deps, request, reply);
    if (!ctx) return reply;
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, request, 400, 'invalid_feed_post', 'Нужна ссылка на пост linkedin.com или текст поста до 3000 знаков.', false);
    if (busy.has(ctx.candidate.id)) return sendError(reply, request, 429, 'draft_request_busy', 'Черновик уже готовится. Дождитесь результата.', false);
    busy.add(ctx.candidate.id);
    try {
      return await createFeedComment(deps, feed, request, reply, ctx.candidate, parsed.data);
    } finally {
      busy.delete(ctx.candidate.id);
    }
  });
  app.post(`${BASE}/approve`, APPROVE_LIMIT, async (request, reply) => {
    const ctx = context(deps, request, reply);
    if (!ctx) return reply;
    const parsed = approveSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, request, 400, 'invalid_approve_request', `Выберите от 1 до ${FEED_APPROVE_BATCH_MAX} разных черновиков.`, false);
    return ok(request, { results: parsed.data.draftIds.map((id) => approveOne(deps, feed, queue, ctx, id)) });
  });
}

/**
 * B396: комментарии к постам ленты за флагом `cabinetB640`. Пост приносит кандидат, на linkedin.com
 * с сервера не уходит ни одного запроса. Черновик живёт в общем механизме (`kind: comment`),
 * одобренный встаёт в очередь B694; публикует кандидат сам.
 */
export function registerB640FeedPostRoutes(app: FastifyInstance, deps: CandidateDraftRouteDeps): void {
  const database = deps.candidateActionRepository?.getDatabase();
  const hasDrafts = database?.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'candidate_drafts'").get();
  if (!database || !hasDrafts) return;
  const feed = new FeedPostRepository(database);
  const queue = new LinkedinQueueRepository(database);
  registerReads(app, deps, feed);
  registerWrites(app, deps, feed, queue);
}
