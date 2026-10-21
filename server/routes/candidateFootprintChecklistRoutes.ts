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
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';

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
    request, reply, deps.candidateStore, deps.authService, deps.config,
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
    return sendError(reply, request, 400, 'invalid_checklist_mark', 'Выберите отметку для пункта.', false);
  }
  if (!markFits(context.finding, parsed.data.mark)) {
    return sendError(reply, request, 409, 'checklist_mark_not_applicable', 'Эта отметка не подходит к находке.', false);
  }
  const audit = deps.candidateReputationRepo!.updateFootprintFindingChecklist(
    context.candidateId, context.finding.id, { checklistMark: parsed.data.mark },
  );
  return { data: { audit }, meta: { requestId: request.id } };
}

async function handleAddToProfile(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const context = loadFinding(deps, request, reply);
  if (!context) return reply;
  const { finding } = context;
  if (finding.review !== 'confirmed_self' || !ARTIFACT_FINDING_KINDS.has(finding.kind)) {
    return sendError(reply, request, 409, 'finding_not_artifact', 'В профиль переносятся только ваши доклады, код и публикации.', false);
  }
  if (finding.checklistMark === 'added_to_profile') {
    return sendError(reply, request, 409, 'finding_already_in_profile', 'Эта находка уже в профиле.', false);
  }
  const memoryId = randomUUID();
  deps.candidateStore.importResumeEvidence(context.candidateId, {
    sourceLabel: `Цифровой след: ${finding.title}`,
    platform: 'footprint',
    entries: [{ memoryId, domain: 'role-evidence', statement: finding.title }],
  });
  const audit = deps.candidateReputationRepo!.updateFootprintFindingChecklist(
    context.candidateId, finding.id, { checklistMark: 'added_to_profile', profileFactId: memoryId },
  );
  return { data: { audit }, meta: { requestId: request.id } };
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
  app.post(
    '/api/v1/candidate/footprint/findings/:findingId/profile-fact',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    withDeps(deps, handleAddToProfile),
  );
}
