import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DEFAULT_ACCOUNT_TIMEZONE, formatLocalDate, isValidTimezone } from '../../shared/timezoneUtils';
import type { CandidateIdentity } from '../data/candidateStore';
import type { LinkedinDraftWriter } from '../providers/linkedinDraftWriter';
import type { SqliteCandidateDraftRepository } from '../candidate/sqliteCandidateDraftRepository';
import type { RouteDeps } from './deps';
import { authenticateCandidate, authenticateSession, csrfError, hasSafeMutationOrigin, sendError } from './helpers';

export type CandidateDraftRouteDeps = RouteDeps & {
  readonly candidateDraftRepository: SqliteCandidateDraftRepository;
  readonly linkedinDraftWriter?: LinkedinDraftWriter;
};
const createSchema = z.object({ kind: z.enum(['post', 'comment']), topic: z.string().trim().min(1).max(200), sourceText: z.string().trim().max(2000).optional() });
const statusSchema = z.object({ status: z.enum(['copied', 'rejected']) });
const limitSchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

// Причина сбоя модели без текста запроса: имя и первые 200 символов сообщения причины.
function describeCause(err: unknown): string | undefined {
  const cause = err instanceof Error ? err.cause : undefined;
  return cause instanceof Error ? `${cause.name}: ${cause.message.slice(0, 200)}` : undefined;
}
function authenticate(deps: CandidateDraftRouteDeps, request: FastifyRequest, reply: FastifyReply, mutate = false): CandidateIdentity | null {
  if (mutate && !hasSafeMutationOrigin(request, deps.config)) { csrfError(request, reply); return null; }
  return authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
}
function accountContext(deps: CandidateDraftRouteDeps, request: FastifyRequest, candidate: CandidateIdentity) {
  const principal = authenticateSession(request, deps.authService, deps.config);
  const user = principal?.candidate?.id === candidate.id ? deps.authService.getUser?.(principal.userId) : null;
  return { tier: user?.subscriptionTier ?? 'free', timezone: isValidTimezone(user?.timezone) ? user!.timezone! : DEFAULT_ACCOUNT_TIMEZONE, headline: user?.headline ?? '' };
}
async function generate(deps: CandidateDraftRouteDeps, request: FastifyRequest, reply: FastifyReply, candidate: CandidateIdentity, input: z.infer<typeof createSchema>) {
  const account = accountContext(deps, request, candidate);
  const limit = account.tier === 'pro' ? (input.kind === 'comment' ? 3 : 0) :
    account.tier === 'executive' || account.tier === 'enterprise' ? (input.kind === 'comment' ? 5 : 2) : 0;
  if (!limit) return sendError(reply, request, 402, 'paywall_required', 'Для этого черновика нужен другой тариф.', false);
  const localDate = formatLocalDate(new Date(), account.timezone);
  if (deps.candidateDraftRepository.countForDay(candidate.id, localDate, input.kind) >= limit)
    return sendError(reply, request, 429, 'draft_daily_limit', `На сегодня черновиков больше нет: лимит ${limit} в день`, false);
  let text: string;
  try {
    if (!deps.linkedinDraftWriter) throw new Error('draft_writer_unavailable');
    const facts = deps.candidateStore.getSnapshot(candidate.id).memory
      .filter(fact => fact.status === 'confirmed' || fact.status === 'corrected').slice(0, 7)
      .map(fact => ({ ref: fact.id, statement: fact.statement }));
    text = (await deps.linkedinDraftWriter.writeDraft({ ...input, profileHeadline: account.headline, facts })).text;
  } catch (err) {
    request.log.error({ code: 'draft_writer_unavailable', failureType: err instanceof Error ? err.name : 'UnknownError', cause: describeCause(err), candidateId: candidate.id }, 'candidate-draft-writer-failed');
    return sendError(reply, request, 503, 'draft_writer_unavailable', 'Не получилось подготовить черновик. Попробуйте позже.', false);
  }
  const targetPostUrl = input.kind === 'comment' && /^https?:\/\/\S+$/u.test(input.sourceText ?? '') ? input.sourceText : null;
  try {
    const draft = deps.candidateDraftRepository.create({ candidateId: candidate.id, kind: input.kind, topic: input.topic, targetPostUrl, text, localDate });
    return reply.send({ data: draft });
  } catch (err) {
    const removed = err instanceof Error && err.message.includes('candidate_not_found');
    request.log.error({ code: removed ? 'candidate_not_found' : 'draft_save_failed', candidateId: candidate.id }, 'candidate-draft-save-failed');
    return sendError(reply, request, removed ? 404 : 500, removed ? 'candidate_not_found' : 'draft_save_failed',
      removed ? 'Профиль удалён. Черновик не сохранён.' : 'Не получилось сохранить черновик. Попробуйте позже.', false);
  }
}
export function registerCandidateDraftRoutes(app: FastifyInstance, deps: CandidateDraftRouteDeps): void {
  // Очередь кандидата охватывает проверку лимита, модель и сохранение, чтобы параллельные запросы не обходили лимит.
  const queues = new Map<string, Promise<unknown>>();
  const pendingCounts = new Map<string, number>();
  app.post('/api/v1/candidate/drafts', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const candidate = authenticate(deps, request, reply, true);
    if (!candidate) return;
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return sendError(reply, request, 400, 'invalid_draft_payload', 'Проверьте тему и текст поста.', false);
    const count = pendingCounts.get(candidate.id) ?? 0;
    if (count >= 3) return sendError(reply, request, 429, 'draft_request_busy', 'Черновик уже готовится. Дождитесь результата.', false);
    pendingCounts.set(candidate.id, count + 1);
    const previous = queues.get(candidate.id) ?? Promise.resolve();
    const operation = previous.then(() => generate(deps, request, reply, candidate, parsed.data));
    const settled = operation.then(() => undefined, () => undefined);
    queues.set(candidate.id, settled);
    try { return await operation; }
    finally {
      const remaining = (pendingCounts.get(candidate.id) ?? 1) - 1;
      if (remaining) pendingCounts.set(candidate.id, remaining); else pendingCounts.delete(candidate.id);
      if (queues.get(candidate.id) === settled) queues.delete(candidate.id);
    }
  });
  app.get('/api/v1/candidate/drafts', async (request, reply) => {
    const candidate = authenticate(deps, request, reply);
    if (!candidate) return;
    const parsed = limitSchema.safeParse(request.query);
    if (!parsed.success) return sendError(reply, request, 400, 'invalid_draft_limit', 'Количество черновиков — от 1 до 50.', false);
    return reply.send({ data: deps.candidateDraftRepository.listRecent(candidate.id, parsed.data.limit) });
  });
  app.patch('/api/v1/candidate/drafts/:id', async (request, reply) => {
    const candidate = authenticate(deps, request, reply, true);
    if (!candidate) return;
    const parsed = statusSchema.safeParse(request.body);
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    if (!parsed.success || !params.success) return sendError(reply, request, 400, 'invalid_draft_status', 'Проверьте статус черновика.', false);
    const draft = deps.candidateDraftRepository.setStatus(candidate.id, params.data.id, parsed.data.status);
    if (!draft) return sendError(reply, request, 404, 'draft_not_found', 'Черновик не найден.', false);
    return reply.send({ data: draft });
  });
}
