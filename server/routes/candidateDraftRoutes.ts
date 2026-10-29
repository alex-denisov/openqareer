import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { collectDraftFacts } from '../candidate/draftFacts';
import type { CandidateDraft, CandidateDraftStatus, SqliteCandidateDraftRepository } from '../candidate/sqliteCandidateDraftRepository';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DEFAULT_ACCOUNT_TIMEZONE, formatLocalDate, isValidTimezone } from '../../shared/timezoneUtils';
import type { CandidateIdentity, CandidateSnapshot } from '../data/candidateStore';
import type { LinkedinDraftWriter } from '../providers/linkedinDraftWriter';
import type { RouteDeps } from './deps';
import { authenticateCandidate, authenticateSession, csrfError, hasSafeMutationOrigin, sendError } from './helpers';
import { recordNotificationFromSource } from './notificationRepositoryAccess';
import { requireTariffQuota } from './tariffQuotaGuard';

export type CandidateDraftRouteDeps = RouteDeps & {
  readonly candidateDraftRepository: SqliteCandidateDraftRepository;
  readonly linkedinDraftWriter?: LinkedinDraftWriter;
};

const createSchema = z.object({
  kind: z.enum(['post', 'comment']),
  topic: z.string().trim().min(1).max(200),
  sourceText: z.string().trim().max(2000).optional(),
  inputType: z.enum(['topic', 'text', 'sketch']).default('topic'),
  tone: z.enum(['business', 'personal', 'expert']).default('business'),
  length: z.enum(['short', 'medium', 'long']).default('medium'),
  topicId: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
});
const statusSchema = z.object({ status: z.enum(['copied', 'rejected', 'approved', 'published']) });
const editSchema = z.object({ text: z.string().trim().min(1).max(1300) });
const updateSchema = z.union([statusSchema, editSchema]);
const limitSchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });
const topicQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(3),
  offset: z.coerce.number().int().min(0).max(100).default(0),
});
const cadenceWindowMs = 7 * 24 * 60 * 60 * 1000;
const publicationCheckIntervalMs = 15 * 60 * 1000;
const publicationLookaheadMs = 9 * 24 * 60 * 60 * 1000;

interface DraftTopic {
  readonly id: string;
  readonly title: string;
  readonly source: string;
  readonly sourceRef: string;
}

interface DraftWorkflowRow {
  readonly draft_id: string;
  readonly candidate_id: string;
  readonly approved_at: string;
  readonly published_at: string | null;
}

interface DraftDatabaseRow {
  readonly id: string;
  readonly candidate_id: string;
  readonly kind: 'post' | 'comment';
  readonly topic: string;
  readonly target_post_url: string | null;
  readonly text: string;
  readonly status: CandidateDraftStatus;
  readonly local_date: string;
  readonly created_at: string;
  readonly updated_at: string;
}

type DraftPipelineStatus = CandidateDraftStatus | 'approved' | 'published';
type DraftWithWorkflow = Omit<CandidateDraft, 'status'> & {
  readonly status: DraftPipelineStatus;
  readonly approvedAt?: string;
  readonly publishedAt?: string;
};

function describeCause(error: unknown): string | undefined {
  const cause = error instanceof Error ? error.cause : undefined;
  return cause instanceof Error ? `${cause.name}: ${cause.message.slice(0, 200)}` : undefined;
}

function authenticate(deps: CandidateDraftRouteDeps, request: FastifyRequest, reply: FastifyReply, mutate = false): CandidateIdentity | null {
  if (mutate && !hasSafeMutationOrigin(request, deps.config)) {
    csrfError(request, reply);
    return null;
  }
  return authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
}

function routeError(reply: FastifyReply, request: FastifyRequest, status: number, code: string, message: string) {
  return sendError(reply, request, status, code, message, false);
}

function accountContext(deps: CandidateDraftRouteDeps, request: FastifyRequest, candidate: CandidateIdentity) {
  const principal = authenticateSession(request, deps.authService, deps.config);
  const isCandidateSession = principal?.candidate?.id === candidate.id;
  const user = isCandidateSession ? deps.authService.getUser?.(principal.userId) : null;
  const subscription = isCandidateSession
    ? deps.billingRepository?.getSubscription(principal.userId, new Date().toISOString())
    : null;
  return {
    tier: subscription?.planId ?? user?.subscriptionTier ?? 'free',
    timezone: isValidTimezone(user?.timezone) ? user!.timezone! : DEFAULT_ACCOUNT_TIMEZONE,
    headline: user?.headline ?? '',
  };
}

function workflowDatabase(deps: CandidateDraftRouteDeps): DatabaseSync | null {
  const database = deps.candidateActionRepository?.getDatabase() ?? null;
  if (!database) return null;
  return database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'candidate_drafts'")
    .get()
    ? database
    : null;
}

function installWorkflowSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS candidate_draft_workflow (
      draft_id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      published_at TEXT,
      updated_at TEXT NOT NULL,
      CHECK (published_at IS NULL OR published_at >= approved_at)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS candidate_draft_workflow_candidate_published
      ON candidate_draft_workflow(candidate_id, published_at);
    CREATE TABLE IF NOT EXISTS candidate_draft_topic_decisions (
      candidate_id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('used', 'dismissed')),
      decided_at TEXT NOT NULL,
      PRIMARY KEY (candidate_id, topic_id)
    ) STRICT;
    CREATE TRIGGER IF NOT EXISTS candidate_draft_workflow_delete_draft
      AFTER DELETE ON candidate_drafts
      BEGIN DELETE FROM candidate_draft_workflow
        WHERE draft_id = OLD.id AND candidate_id = OLD.candidate_id;
      END;
  `);
  const hasCandidates = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'candidates'").get();
  if (hasCandidates)
    database.exec(`
    CREATE TRIGGER IF NOT EXISTS candidate_draft_topic_decisions_delete_candidate
      AFTER DELETE ON candidates
      BEGIN DELETE FROM candidate_draft_topic_decisions WHERE candidate_id = OLD.id; END;
  `);
}

function draftTopics(snapshot: CandidateSnapshot, candidateId: string): DraftTopic[] {
  return collectDraftFacts({ memory: snapshot.memory, resume: snapshot.resume }).map((fact) => ({
    id: createHash('sha256').update(`${candidateId}\n${fact.ref}\n${fact.statement}`).digest('hex'),
    title: fact.statement.trim().slice(0, 200),
    source: fact.ref.startsWith('resume:') ? 'Резюме' : 'Подтверждённый факт профиля',
    sourceRef: fact.ref,
  }));
}

function dismissedTopicIds(database: DatabaseSync | null, candidateId: string): Set<string> {
  if (!database) return new Set();
  const rows = database.prepare('SELECT topic_id FROM candidate_draft_topic_decisions WHERE candidate_id = ?').all(candidateId) as Array<{ topic_id: string }>;
  return new Set(rows.map((row) => row.topic_id));
}

function getCadence(database: DatabaseSync | null, candidateId: string, timezone: string) {
  const row = database?.prepare('SELECT MAX(published_at) AS last_published_at FROM candidate_draft_workflow WHERE candidate_id = ?').get(candidateId) as
    { last_published_at: string | null } | undefined;
  const lastPublishedAt = row?.last_published_at ?? null;
  const nextAllowedAt = nextPublicationAt(lastPublishedAt, new Date(), timezone);
  return {
    timezone,
    lastPublishedAt,
    nextAllowedAt,
    canPublish: nextAllowedAt === null,
  };
}

function isPublicationWindow(date: Date, timezone: string): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const weekday = parts.find((part) => part.type === 'weekday')?.value;
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  const localMinutes = hour * 60 + minute;
  return weekday !== 'Sat' && weekday !== 'Sun' && ((localMinutes >= 540 && localMinutes < 660) || (localMinutes >= 1020 && localMinutes < 1140));
}

function nextPublicationAt(lastPublishedAt: string | null, now: Date, timezone: string): string | null {
  const cadenceStart = lastPublishedAt ? new Date(lastPublishedAt).getTime() + cadenceWindowMs : now.getTime();
  const threshold = Math.max(now.getTime(), cadenceStart);
  if (threshold <= now.getTime() && isPublicationWindow(now, timezone)) return null;
  const firstCheck = Math.ceil(threshold / publicationCheckIntervalMs) * publicationCheckIntervalMs;
  const deadline = threshold + publicationLookaheadMs;
  for (let time = firstCheck; time <= deadline; time += publicationCheckIntervalMs) {
    const candidate = new Date(time);
    if (isPublicationWindow(candidate, timezone)) return candidate.toISOString();
  }
  return new Date(deadline).toISOString();
}

function workflowFor(database: DatabaseSync, candidateId: string, draftId: string): DraftWorkflowRow | undefined {
  return database
    .prepare('SELECT draft_id, candidate_id, approved_at, published_at FROM candidate_draft_workflow WHERE candidate_id = ? AND draft_id = ?')
    .get(candidateId, draftId) as DraftWorkflowRow | undefined;
}

function findOwnedDraft(database: DatabaseSync, candidateId: string, draftId: string): DraftDatabaseRow | undefined {
  return database
    .prepare(
      'SELECT id, candidate_id, kind, topic, target_post_url, text, status, local_date, created_at, updated_at FROM candidate_drafts WHERE candidate_id = ? AND id = ?',
    )
    .get(candidateId, draftId) as DraftDatabaseRow | undefined;
}

function candidateDraftFromRow(row: DraftDatabaseRow): CandidateDraft {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    kind: row.kind,
    topic: row.topic,
    targetPostUrl: row.target_post_url,
    text: row.text,
    status: row.status,
    localDate: row.local_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mergeWorkflow(database: DatabaseSync | null, candidateId: string, drafts: CandidateDraft[]): DraftWithWorkflow[] {
  if (!database || !drafts.length) return drafts;
  const placeholders = drafts.map(() => '?').join(', ');
  const rows = database
    .prepare(`SELECT draft_id, candidate_id, approved_at, published_at FROM candidate_draft_workflow WHERE candidate_id = ? AND draft_id IN (${placeholders})`)
    .all(candidateId, ...drafts.map((draft) => draft.id)) as unknown as DraftWorkflowRow[];
  const workflows = new Map(rows.map((row) => [row.draft_id, row]));
  return drafts.map((draft) => {
    const workflow = workflows.get(draft.id);
    if (draft.status === 'rejected' || !workflow) return draft;
    const status: DraftPipelineStatus = workflow.published_at ? 'published' : 'approved';
    return {
      ...draft,
      status,
      approvedAt: workflow.approved_at,
      publishedAt: workflow.published_at ?? undefined,
    };
  });
}

function topicDecisionExists(database: DatabaseSync, candidateId: string, topicId: string): boolean {
  return Boolean(database.prepare('SELECT 1 FROM candidate_draft_topic_decisions WHERE candidate_id = ? AND topic_id = ?').get(candidateId, topicId));
}

function saveTopicDecision(database: DatabaseSync, candidateId: string, topicId: string, decision: 'used' | 'dismissed'): void {
  database
    .prepare(
      `INSERT INTO candidate_draft_topic_decisions(candidate_id, topic_id, decision, decided_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(candidate_id, topic_id) DO UPDATE SET decision = excluded.decision, decided_at = excluded.decided_at`,
    )
    .run(candidateId, topicId, decision, new Date().toISOString());
}

function publicationLimit(database: DatabaseSync, candidateId: string, now: string, timezone: string): string | null {
  const row = database.prepare('SELECT MAX(published_at) AS last_published_at FROM candidate_draft_workflow WHERE candidate_id = ?').get(candidateId) as {
    last_published_at: string | null;
  };
  const last = row.last_published_at;
  return nextPublicationAt(last, new Date(now), timezone);
}

function transitionWorkflow(
  database: DatabaseSync,
  candidateId: string,
  draftId: string,
  status: 'approved' | 'published',
  timezone: string,
):
  | {
      readonly draft: DraftDatabaseRow;
      readonly status: 'approved' | 'published';
      readonly approvedAt: string;
      readonly publishedAt: string | null;
    }
  | {
      readonly error: 'not_found' | 'approval_required' | 'cadence_limit' | 'already_published';
      readonly nextAllowedAt?: string;
    } {
  const draft = findOwnedDraft(database, candidateId, draftId);
  if (!draft || draft.status === 'rejected') return { error: 'not_found' };
  const now = new Date().toISOString();
  const current = workflowFor(database, candidateId, draftId);
  if (status === 'approved') {
    if (current?.published_at) return { error: 'already_published' };
    database
      .prepare(
        `INSERT INTO candidate_draft_workflow(draft_id, candidate_id, approved_at, published_at, updated_at)
      VALUES (?, ?, ?, NULL, ?) ON CONFLICT(draft_id) DO UPDATE SET approved_at = excluded.approved_at, published_at = NULL, updated_at = excluded.updated_at`,
      )
      .run(draftId, candidateId, now, now);
    return { draft, status: 'approved', approvedAt: now, publishedAt: null };
  }
  if (!current) return { error: 'approval_required' };
  if (current.published_at) return { error: 'already_published' };
  const nextAllowedAt = publicationLimit(database, candidateId, now, timezone);
  if (nextAllowedAt) return { error: 'cadence_limit', nextAllowedAt };
  database
    .prepare(
      `UPDATE candidate_draft_workflow SET published_at = ?, updated_at = ?
    WHERE candidate_id = ? AND draft_id = ? AND published_at IS NULL`,
    )
    .run(now, now, candidateId, draftId);
  return { draft, status: 'published', approvedAt: current.approved_at, publishedAt: now };
}

function applyWorkflowTransition(database: DatabaseSync, candidateId: string, draftId: string, status: 'approved' | 'published', timezone: string) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = transitionWorkflow(database, candidateId, draftId, status, timezone);
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function updateDraftText(database: DatabaseSync, candidateId: string, draftId: string, text: string) {
  const draft = findOwnedDraft(database, candidateId, draftId);
  if (!draft || draft.status === 'rejected') return { error: 'not_found' as const };
  if (draft.kind === 'comment' && text.length > 600) return { error: 'text_too_long' as const };
  if (workflowFor(database, candidateId, draftId)?.published_at) return { error: 'already_published' as const };
  const now = new Date().toISOString();
  database
    .prepare(`UPDATE candidate_drafts SET text = ?, status = 'draft', updated_at = ? WHERE candidate_id = ? AND id = ?`)
    .run(text, now, candidateId, draftId);
  database.prepare('DELETE FROM candidate_draft_workflow WHERE candidate_id = ? AND draft_id = ?').run(candidateId, draftId);
  return {
    draft: { ...candidateDraftFromRow(draft), text, status: 'draft' as const, updatedAt: now },
  };
}

function workflowError(reply: FastifyReply, request: FastifyRequest, result: Exclude<ReturnType<typeof transitionWorkflow>, { draft: DraftDatabaseRow }>) {
  if (result.error === 'not_found') return routeError(reply, request, 404, 'draft_not_found', 'Черновик не найден.');
  if (result.error === 'approval_required') return routeError(reply, request, 409, 'draft_approval_required', 'Сначала одобрите черновик.');
  if (result.error === 'already_published') return routeError(reply, request, 409, 'draft_already_published', 'Черновик уже отмечен опубликованным.');
  return routeError(reply, request, 409, 'draft_cadence_limit', `Следующий пост можно отметить опубликованным не раньше ${result.nextAllowedAt}.`);
}

function dailyDraftLimit(tier: string, kind: z.infer<typeof createSchema>['kind']): number {
  if (tier === 'pro') return kind === 'comment' ? 3 : 0;
  if (tier === 'executive' || tier === 'enterprise' || tier === 'max')
    return kind === 'comment' ? 5 : 2;
  return 0;
}

async function writeCandidateDraft(
  deps: CandidateDraftRouteDeps,
  request: FastifyRequest,
  candidate: CandidateIdentity,
  input: z.infer<typeof createSchema>,
  headline: string,
): Promise<string | null> {
  try {
    if (!deps.linkedinDraftWriter) throw new Error('draft_writer_unavailable');
    const snapshot = deps.candidateStore.getSnapshot(candidate.id);
    const facts = collectDraftFacts({ memory: snapshot.memory, resume: snapshot.resume });
    const writerInput = {
      kind: input.kind,
      topic: input.topic,
      sourceText: input.sourceText,
      inputType: input.inputType,
      tone: input.tone,
      length: input.length,
      profileHeadline: headline,
      facts,
    };
    return (await deps.linkedinDraftWriter.writeDraft(writerInput)).text;
  } catch (error) {
    request.log.error(
      {
        code: 'draft_writer_unavailable',
        failureType: error instanceof Error ? error.name : 'UnknownError',
        cause: describeCause(error),
        candidateId: candidate.id,
      },
      'candidate-draft-writer-failed',
    );
    return null;
  }
}

async function generate(
  deps: CandidateDraftRouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  candidate: CandidateIdentity,
  input: z.infer<typeof createSchema>,
) {
  const account = accountContext(deps, request, candidate);
  const limit = dailyDraftLimit(account.tier, input.kind);
  if (!limit) return routeError(reply, request, 402, 'paywall_required', 'Для этого черновика нужен другой тариф.');
  const localDate = formatLocalDate(new Date(), account.timezone);
  if (deps.candidateDraftRepository.countForDay(candidate.id, localDate, input.kind) >= limit)
    return routeError(reply, request, 429, 'draft_daily_limit', `На сегодня черновиков больше нет: лимит ${limit} в день`);
  if (!requireTariffQuota(deps, request, reply, candidate.id, 'linkedin_drafts', randomUUID())) return reply;
  const text = await writeCandidateDraft(deps, request, candidate, input, account.headline);
  if (!text) return routeError(reply, request, 503, 'draft_writer_unavailable', 'Не получилось подготовить черновик. Попробуйте позже.');
  return persistDraft(deps, request, reply, candidate, input, text, localDate);
}

function validateTopicUse(deps: CandidateDraftRouteDeps, candidate: CandidateIdentity, topicId: string | undefined, database: DatabaseSync | null) {
  if (!topicId) return null;
  if (!database)
    return {
      status: 503,
      code: 'draft_workflow_unavailable',
      message: 'Не удалось обновить темы. Попробуйте позже.',
    };
  const snapshot = deps.candidateStore.getSnapshot(candidate.id);
  if (!draftTopics(snapshot, candidate.id).some((topic) => topic.id === topicId))
    return { status: 404, code: 'draft_topic_not_found', message: 'Тема не найдена.' };
  if (topicDecisionExists(database, candidate.id, topicId))
    return {
      status: 409,
      code: 'draft_topic_unavailable',
      message: 'Эта тема уже использована или скрыта.',
    };
  return null;
}

function persistDraft(
  deps: CandidateDraftRouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  candidate: CandidateIdentity,
  input: z.infer<typeof createSchema>,
  text: string,
  localDate: string,
) {
  const targetPostUrl = input.kind === 'comment' && /^https?:\/\/\S+$/u.test(input.sourceText ?? '') ? input.sourceText : null;
  try {
    const draft = deps.candidateDraftRepository.create({
      candidateId: candidate.id,
      kind: input.kind,
      topic: input.topic,
      targetPostUrl,
      text,
      localDate,
    });
    if (draft.kind === 'post') {
      recordNotificationFromSource(deps, request, candidate.id, {
        kind: 'post_approval',
        sourceType: 'draft',
        sourceId: draft.id,
        idempotencyKey: `post-approval:${draft.id}`,
        createdAt: draft.createdAt,
      });
    }
    const database = workflowDatabase(deps);
    if (database && input.topicId) saveTopicDecision(database, candidate.id, input.topicId, 'used');
    return reply.send({ data: draft });
  } catch (error) {
    const removed = error instanceof Error && error.message.includes('candidate_not_found');
    request.log.error({ code: removed ? 'candidate_not_found' : 'draft_save_failed', candidateId: candidate.id }, 'candidate-draft-save-failed');
    return routeError(
      reply,
      request,
      removed ? 404 : 500,
      removed ? 'candidate_not_found' : 'draft_save_failed',
      removed ? 'Профиль удалён. Черновик не сохранён.' : 'Не получилось сохранить черновик. Попробуйте позже.',
    );
  }
}

function topicsPage(
  deps: CandidateDraftRouteDeps,
  candidate: CandidateIdentity,
  database: DatabaseSync | null,
  limit: number,
  offset: number,
  timezone: string,
) {
  const all = draftTopics(deps.candidateStore.getSnapshot(candidate.id), candidate.id);
  const excluded = dismissedTopicIds(database, candidate.id);
  const available = all.filter((topic) => !excluded.has(topic.id));
  return {
    items: available.slice(offset, offset + limit),
    total: available.length,
    cadence: getCadence(database, candidate.id, timezone),
  };
}

function handleStatusUpdate(
  deps: CandidateDraftRouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  candidate: CandidateIdentity,
  draftId: string,
  status: z.infer<typeof statusSchema>['status'],
) {
  if (status === 'copied' || status === 'rejected') {
    const draft = deps.candidateDraftRepository.setStatus(candidate.id, draftId, status);
    if (!draft) return routeError(reply, request, 404, 'draft_not_found', 'Черновик не найден.');
    if (status === 'rejected')
      workflowDatabase(deps)?.prepare('DELETE FROM candidate_draft_workflow WHERE candidate_id = ? AND draft_id = ?').run(candidate.id, draftId);
    return reply.send({ data: draft });
  }
  const database = workflowDatabase(deps);
  if (!database) return routeError(reply, request, 503, 'draft_workflow_unavailable', 'Не удалось обновить черновик. Попробуйте позже.');
  const timezone = accountContext(deps, request, candidate).timezone;
  const result = applyWorkflowTransition(database, candidate.id, draftId, status, timezone);
  if ('error' in result) return workflowError(reply, request, result);
  return reply.send({
    data: {
      ...candidateDraftFromRow(result.draft),
      status: result.status,
      approvedAt: result.approvedAt,
      publishedAt: result.publishedAt,
    },
  });
}

function handleTextUpdate(
  deps: CandidateDraftRouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  candidate: CandidateIdentity,
  draftId: string,
  text: string,
) {
  const database = workflowDatabase(deps);
  if (!database) return routeError(reply, request, 503, 'draft_workflow_unavailable', 'Не удалось обновить черновик. Попробуйте позже.');
  const result = updateDraftText(database, candidate.id, draftId, text);
  if (result.error === 'not_found') return routeError(reply, request, 404, 'draft_not_found', 'Черновик не найден.');
  if (result.error === 'text_too_long') return routeError(reply, request, 400, 'invalid_draft_text', 'Комментарий не может быть длиннее 600 символов.');
  if (result.error === 'already_published') return routeError(reply, request, 409, 'draft_already_published', 'Опубликованный черновик нельзя изменить.');
  return reply.send({ data: result.draft });
}

async function handleDraftCreationRequest(
  deps: CandidateDraftRouteDeps,
  database: DatabaseSync | null,
  queues: Map<string, Promise<unknown>>,
  pendingCounts: Map<string, number>,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const candidate = authenticate(deps, request, reply, true);
  if (!candidate) return;
  const parsed = createSchema.safeParse(request.body);
  if (!parsed.success) return routeError(reply, request, 400, 'invalid_draft_payload', 'Проверьте тему и текст поста.');
  const topicError = validateTopicUse(deps, candidate, parsed.data.topicId, database);
  if (topicError) return routeError(reply, request, topicError.status, topicError.code, topicError.message);
  const count = pendingCounts.get(candidate.id) ?? 0;
  if (count >= 3) return routeError(reply, request, 429, 'draft_request_busy', 'Черновик уже готовится. Дождитесь результата.');
  pendingCounts.set(candidate.id, count + 1);
  const previous = queues.get(candidate.id) ?? Promise.resolve();
  const operation = previous.then(() => generate(deps, request, reply, candidate, parsed.data));
  const settled = operation.then(
    () => undefined,
    () => undefined,
  );
  queues.set(candidate.id, settled);
  try {
    return await operation;
  } finally {
    const remaining = (pendingCounts.get(candidate.id) ?? 1) - 1;
    if (remaining) pendingCounts.set(candidate.id, remaining);
    else pendingCounts.delete(candidate.id);
    if (queues.get(candidate.id) === settled) queues.delete(candidate.id);
  }
}

function registerDraftCreationRoute(
  app: FastifyInstance,
  deps: CandidateDraftRouteDeps,
  database: DatabaseSync | null,
  queues: Map<string, Promise<unknown>>,
  pendingCounts: Map<string, number>,
) {
  app.post('/api/v1/candidate/drafts', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, (request, reply) =>
    handleDraftCreationRequest(deps, database, queues, pendingCounts, request, reply),
  );
}

function registerDraftTopicListRoute(app: FastifyInstance, deps: CandidateDraftRouteDeps, database: DatabaseSync | null) {
  app.get('/api/v1/candidate/drafts/topics', async (request, reply) => {
    const candidate = authenticate(deps, request, reply);
    if (!candidate) return;
    const parsed = topicQuerySchema.safeParse(request.query);
    if (!parsed.success) return routeError(reply, request, 400, 'invalid_draft_topic_limit', 'Проверьте количество тем.');
    const account = accountContext(deps, request, candidate);
    return reply.send({
      data: topicsPage(deps, candidate, database, parsed.data.limit, parsed.data.offset, account.timezone),
    });
  });
}

function registerDraftTopicDismissRoute(app: FastifyInstance, deps: CandidateDraftRouteDeps, database: DatabaseSync | null) {
  app.post('/api/v1/candidate/drafts/topics/:id/dismiss', async (request, reply) => {
    const candidate = authenticate(deps, request, reply, true);
    if (!candidate) return;
    const params = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/u) }).safeParse(request.params);
    if (!params.success) return routeError(reply, request, 400, 'invalid_draft_topic_id', 'Проверьте тему.');
    if (!database) return routeError(reply, request, 503, 'draft_workflow_unavailable', 'Не удалось обновить темы. Попробуйте позже.');
    const exists = draftTopics(deps.candidateStore.getSnapshot(candidate.id), candidate.id).some((topic) => topic.id === params.data.id);
    if (!exists) return routeError(reply, request, 404, 'draft_topic_not_found', 'Тема не найдена.');
    saveTopicDecision(database, candidate.id, params.data.id, 'dismissed');
    return reply.send({ data: { id: params.data.id, decision: 'dismissed' } });
  });
}

function registerDraftListRoute(app: FastifyInstance, deps: CandidateDraftRouteDeps, database: DatabaseSync | null) {
  app.get('/api/v1/candidate/drafts', async (request, reply) => {
    const candidate = authenticate(deps, request, reply);
    if (!candidate) return;
    const parsed = limitSchema.safeParse(request.query);
    if (!parsed.success) return routeError(reply, request, 400, 'invalid_draft_limit', 'Количество черновиков — от 1 до 50.');
    const drafts = deps.candidateDraftRepository.listRecent(candidate.id, parsed.data.limit);
    return reply.send({ data: mergeWorkflow(database, candidate.id, drafts) });
  });
}

function registerDraftUpdateRoute(app: FastifyInstance, deps: CandidateDraftRouteDeps) {
  app.patch('/api/v1/candidate/drafts/:id', async (request, reply) => {
    const candidate = authenticate(deps, request, reply, true);
    if (!candidate) return;
    const parsed = updateSchema.safeParse(request.body);
    const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
    if (!parsed.success || !params.success) return routeError(reply, request, 400, 'invalid_draft_update', 'Проверьте статус или текст черновика.');
    if ('status' in parsed.data) return handleStatusUpdate(deps, request, reply, candidate, params.data.id, parsed.data.status);
    return handleTextUpdate(deps, request, reply, candidate, params.data.id, parsed.data.text);
  });
}

export function registerCandidateDraftRoutes(app: FastifyInstance, deps: CandidateDraftRouteDeps): void {
  const queues = new Map<string, Promise<unknown>>();
  const pendingCounts = new Map<string, number>();
  const database = workflowDatabase(deps);
  if (database) installWorkflowSchema(database);
  registerDraftCreationRoute(app, deps, database, queues, pendingCounts);
  registerDraftTopicListRoute(app, deps, database);
  registerDraftTopicDismissRoute(app, deps, database);
  registerDraftListRoute(app, deps, database);
  registerDraftUpdateRoute(app, deps);
}
