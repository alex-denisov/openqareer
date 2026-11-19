import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CandidateFootprintFinding } from '../../shared/candidateFootprint';
import type { FootprintRemoval } from '../../shared/footprintRemoval';
import { recheckFindingUrl } from '../osint/findingRecheck';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

/**
 * B382, f03b «Находка: путь удаления». «Письмо отправлено» запоминает дату
 * запроса владельцу сайта; «Проверить находку» один раз открывает адрес
 * находки и сохраняет итог. Оба адреса за флагом B640.
 */
const findingIdSchema = z.string().regex(/^[a-f0-9]{24}$/u);

interface FindingContext {
  readonly candidateId: string;
  readonly finding: CandidateFootprintFinding;
}

function loadFinding(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): FindingContext | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    void sendError(
      reply,
      request,
      401,
      'unauthorized',
      'Нужна действующая сессия кандидата.',
      false,
    );
    return null;
  }
  const findingId = findingIdSchema.safeParse((request.params as { findingId?: string }).findingId);
  const audit = deps.candidateReputationRepo?.getLatestFootprintAudit(principal.candidate.id);
  const finding = findingId.success
    ? audit?.findings.find((entry) => entry.id === findingId.data)
    : undefined;
  if (!audit || audit.state !== 'completed' || !finding) {
    void sendError(reply, request, 404, 'finding_not_found', 'Находка больше недоступна.', false);
    return null;
  }
  return { candidateId: principal.candidate.id, finding };
}

function saveRemoval(
  deps: RouteDeps,
  request: FastifyRequest,
  context: FindingContext,
  removal: FootprintRemoval,
): unknown {
  deps.candidateReputationRepo!.updateFootprintFindingChecklist(
    context.candidateId,
    context.finding.id,
    { removal },
  );
  return { data: { findingId: context.finding.id, removal }, meta: { requestId: request.id } };
}

async function handleRemovalRequest(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const context = loadFinding(deps, request, reply);
  if (!context) return reply;
  const current = context.finding.removal;
  if (current?.requestedAt) return saveRemoval(deps, request, context, current);
  return saveRemoval(deps, request, context, {
    ...current,
    requestedAt: new Date().toISOString(),
  });
}

async function handleRecheck(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const context = loadFinding(deps, request, reply);
  if (!context) return reply;
  const url = context.finding.url;
  if (!url) {
    return sendError(
      reply,
      request,
      409,
      'finding_without_url',
      'У этой находки нет адреса для проверки.',
      false,
    );
  }
  const result = await recheckFindingUrl(url);
  return saveRemoval(deps, request, context, {
    ...context.finding.removal,
    checkedAt: new Date().toISOString(),
    result,
  });
}

export function registerFootprintRemovalRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    '/api/v1/candidate/footprint/findings/:findingId/removal-request',
    { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } },
    withDeps(deps, handleRemovalRequest),
  );
  app.post(
    '/api/v1/candidate/footprint/findings/:findingId/recheck',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    withDeps(deps, handleRecheck),
  );
}
