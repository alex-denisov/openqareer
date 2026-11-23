/**
 * B544, «Цифровой след» → «Чек-лист санации»: the candidate's marks on findings
 * («пароль сменён», «закрыл», «оставить») and «Добавить в профиль», which
 * writes a profile fact whose origin reads «из цифрового следа».
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CandidateFootprintFinding } from '../../shared/candidateFootprint';
import { ARTIFACT_FINDING_KINDS } from '../../shared/footprintChecklist';
import { checkResumeFileMetadata } from '../osint/resumeMetadataCheck';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import { toPublicFootprint } from './footprintPublicView';

const findingIdSchema = z.string().regex(/^[a-f0-9]{24}$/u);
const markSchema = z
  .object({ mark: z.enum(['password_changed', 'account_closed', 'account_kept']) })
  .strict();
type ManualMark = z.infer<typeof markSchema>['mark'];

function markFits(finding: CandidateFootprintFinding, mark: ManualMark): boolean {
  if (finding.review !== 'confirmed_self') return false;
  if (mark === 'password_changed') return finding.kind === 'breach';
  return Boolean(finding.staleAccount);
}

interface FindingContext {
  readonly candidateId: string;
  readonly finding: CandidateFootprintFinding;
}

function loadFinding(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): FindingContext | undefined {
  if (!hasSafeMutationOrigin(request, deps.config)) {
    void csrfError(request, reply);
    return undefined;
  }
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const findingId = findingIdSchema.safeParse((request.params as { findingId?: string }).findingId);
  const audit = deps.candidateReputationRepo?.getLatestFootprintAudit(candidate.id);
  const finding = findingId.success
    ? audit?.findings.find((entry) => entry.id === findingId.data)
    : undefined;
  if (!audit || audit.state !== 'completed' || !finding) {
    void sendError(reply, request, 404, 'finding_not_found', 'Находка больше недоступна.', false);
    return undefined;
  }
  return { candidateId: candidate.id, finding };
}

async function handleMarkFinding(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const context = loadFinding(deps, request, reply);
  if (!context) return reply;
  const parsed = markSchema.safeParse(request.body);
  if (!parsed.success) {
    return sendError(
      reply,
      request,
      400,
      'invalid_checklist_mark',
      'Выберите отметку для пункта.',
      false,
    );
  }
  if (!markFits(context.finding, parsed.data.mark)) {
    return sendError(
      reply,
      request,
      409,
      'checklist_mark_not_applicable',
      'Эта отметка не подходит к находке.',
      false,
    );
  }
  const audit = deps.candidateReputationRepo!.updateFootprintFindingChecklist(
    context.candidateId,
    context.finding.id,
    { checklistMark: parsed.data.mark },
  );
  return { data: toPublicFootprint({ audit }), meta: { requestId: request.id } };
}

/** Почему находку нельзя перенести в профиль; `null` — можно. */
function addRefusal(
  finding: CandidateFootprintFinding,
): { readonly code: string; readonly message: string } | null {
  if (finding.review !== 'confirmed_self' || !ARTIFACT_FINDING_KINDS.has(finding.kind)) {
    return {
      code: 'finding_not_artifact',
      message: 'В профиль переносятся только ваши доклады, код и публикации.',
    };
  }
  if (finding.checklistMark === 'added_to_profile') {
    return { code: 'finding_already_in_profile', message: 'Эта находка уже в профиле.' };
  }
  return null;
}

async function handleAddToProfile(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const context = loadFinding(deps, request, reply);
  if (!context) return reply;
  const { finding } = context;
  const refused = addRefusal(finding);
  if (refused) return sendError(reply, request, 409, refused.code, refused.message, false);
  const existing = factAlreadyInProfile(deps, context.candidateId, finding.title);
  if (existing) {
    // B382 (B378): тот же факт уже в профиле — второй не пишем, находку отмечаем без своей ссылки.
    const audit = deps.candidateReputationRepo!.updateFootprintFindingChecklist(
      context.candidateId,
      finding.id,
      { checklistMark: 'added_to_profile' },
    );
    return {
      data: { ...toPublicFootprint({ audit }), alreadyInProfile: true },
      meta: { requestId: request.id },
    };
  }
  const memoryId = randomUUID();
  deps.candidateStore.importResumeEvidence(context.candidateId, {
    sourceLabel: `Цифровой след: ${finding.title}`,
    platform: 'footprint',
    entries: [{ memoryId, domain: 'role-evidence', statement: finding.title }],
  });
  const audit = deps.candidateReputationRepo!.updateFootprintFindingChecklist(
    context.candidateId,
    finding.id,
    { checklistMark: 'added_to_profile', profileFactId: memoryId },
  );
  return { data: toPublicFootprint({ audit }), meta: { requestId: request.id } };
}

/** Текст факта без регистра, знаков и лишних пробелов: «Доклад, 2023» и «доклад 2023.» — один факт. */
function factKey(statement: string): string {
  return statement
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/gu, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function factAlreadyInProfile(deps: RouteDeps, candidateId: string, statement: string): boolean {
  const key = factKey(statement);
  return deps.candidateStore
    .getSnapshot(candidateId)
    .memory.some((entry) => factKey(entry.statement) === key);
}

/**
 * B382: «Отменить» после «В профиль». Факт, созданный из этой находки, удаляется; факт, который уже
 * был в профиле (дубликат), остаётся. Факт, удалённый кандидатом раньше, — не ошибка.
 */
async function handleRemoveFromProfile(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const context = loadFinding(deps, request, reply);
  if (!context) return reply;
  const { finding } = context;
  if (finding.checklistMark !== 'added_to_profile') {
    return sendError(
      reply,
      request,
      409,
      'finding_not_in_profile',
      'Эта находка не в профиле.',
      false,
    );
  }
  if (finding.profileFactId) {
    deps.candidateStore.reviewMemories(context.candidateId, [finding.profileFactId], 'delete');
  }
  const audit = deps.candidateReputationRepo!.clearFootprintProfileFact(
    context.candidateId,
    finding.id,
  );
  return { data: toPublicFootprint({ audit }), meta: { requestId: request.id } };
}

async function handleMetadataCheck(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const documents = deps.candidateStore.getSnapshot(candidate.id).documents;
  const check = await checkResumeFileMetadata(
    documents,
    (documentId) =>
      deps.candidateStore.getDocument(candidate.id, documentId)?.contentBase64 ?? null,
  );
  return { data: { check }, meta: { requestId: request.id } };
}

export function registerCandidateFootprintChecklistRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): void {
  app.patch(
    '/api/v1/candidate/footprint/findings/:findingId/checklist',
    { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } },
    withDeps(deps, handleMarkFinding),
  );
  app.get(
    '/api/v1/candidate/footprint/metadata',
    { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } },
    withDeps(deps, handleMetadataCheck),
  );
  app.post(
    '/api/v1/candidate/footprint/findings/:findingId/profile-fact',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    withDeps(deps, handleAddToProfile),
  );
  app.delete(
    '/api/v1/candidate/footprint/findings/:findingId/profile-fact',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    withDeps(deps, handleRemoveFromProfile),
  );
}
