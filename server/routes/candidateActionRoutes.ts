import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  DEFAULT_CANDIDATE_ACTION_LIMITS,
  getCandidateActionResetAt,
  MAX_CANDIDATE_ACTIONS_PER_BATCH,
} from '../../shared/candidateActionPolicy';
import {
  DEFAULT_ACCOUNT_TIMEZONE,
  formatLocalDate,
} from '../../shared/timezoneUtils';
import {
  CandidateConfirmationRequiredError,
  CandidateConsentRequiredError,
  CandidateActionLimitError,
  CandidateActionTargetError,
  CandidateRunnerNotConnectedError,
} from '../candidate/candidateActionExecutor';
import { SqliteCandidateActionRepository } from '../candidate/sqliteCandidateActionRepository';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';

const executeBatchBodySchema = z.object({
  batchId: z.string().uuid().optional(),
  confirmedByCandidate: z.boolean(),
  actions: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        platform: z.enum(['hh', 'linkedin']),
        actionKind: z.enum(['hh_apply', 'hh_resume_boost', 'linkedin_easy_apply']),
        applicationId: z.string().max(100).optional(),
        targetUrl: z.string().url().max(2_048),
        letterVersion: z.string().max(100).optional(),
        letterText: z.string().max(5_000).optional(),
        resumeVersion: z.string().max(100).optional(),
        resumeId: z.string().max(200).optional(),
      }).strict(),
    )
    .min(1)
    .max(MAX_CANDIDATE_ACTIONS_PER_BATCH),
}).strict();

const killSwitchBodySchema = z.object({
  active: z.boolean(),
  reason: z.string().trim().max(500).optional(),
  platform: z.enum(['hh', 'linkedin']).optional(),
});

const listReceiptsQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  batchId: z.string().uuid().optional(),
});

function getOrCreateRepo(deps: RouteDeps): SqliteCandidateActionRepository {
  return (
    deps.candidateActionRepository ??
    new SqliteCandidateActionRepository({ databasePath: deps.config.databasePath })
  );
}

async function handleExecuteBatch(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  if (!hasSafeMutationOrigin(request, deps.config)) {
    return csrfError(request, reply);
  }
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return;

  const body = validateBatchRequest(deps, request, reply, candidate.id);
  if (!body) return;
  const executor = deps.candidateActionExecutor;
  if (!executor) {
    return sendError(
      reply,
      request,
      503,
      'runner_not_connected',
      'Исполнитель действий не подключён к сессии на этом устройстве. Действия не запускались.',
      false,
    );
  }
  return executeCandidateActionBatch(executor, candidate.id, body, request, reply);
}

function validateBatchRequest(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  candidateId: string,
): z.infer<typeof executeBatchBodySchema> | null {
  const parsed = executeBatchBodySchema.safeParse(request.body);
  if (!parsed.success) {
    sendError(reply, request, 400, 'invalid_batch_payload', 'Некорректный формат пакета действий.', false);
    return null;
  }
  if (!parsed.data.confirmedByCandidate) {
    sendError(
      reply,
      request,
      400,
      'candidate_confirmation_required',
      'Подтвердите, что вы проверили действия и тексты писем.',
      false,
    );
    return null;
  }
  if (!deps.capabilityConsentStore?.getActiveConsent(candidateId, 'actions_on_behalf')) {
    sendError(
      reply,
      request,
      403,
      'consent_required',
      'Для действий от вашего имени требуется действующее согласие.',
      false,
    );
    return null;
  }
  return parsed.data;
}

async function executeCandidateActionBatch(
  executor: NonNullable<RouteDeps['candidateActionExecutor']>,
  candidateId: string,
  body: z.infer<typeof executeBatchBodySchema>,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  try {
    // Время и пояс задаёт сервер: клиент не может сдвинуть дневной лимит.
    const result = await executor.executeBatch({
      candidateId,
      batchId: body.batchId,
      confirmedByCandidate: body.confirmedByCandidate,
      actions: body.actions,
    });
    return reply.send({ data: result });
  } catch (err) {
    return handleCandidateActionError(err, request, reply);
  }
}

function handleCandidateActionError(
  err: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): unknown {
  if (err instanceof CandidateConfirmationRequiredError) {
    return sendError(reply, request, 400, 'candidate_confirmation_required', err.message, false);
  }
  if (err instanceof CandidateConsentRequiredError) {
    return sendError(reply, request, 403, 'consent_required', err.message, false);
  }
  if (err instanceof CandidateRunnerNotConnectedError) {
    return sendError(reply, request, 503, 'runner_not_connected', err.message, false);
  }
  if (err instanceof CandidateActionTargetError) {
    return sendError(reply, request, 400, err.code, err.message, false);
  }
  if (err instanceof CandidateActionLimitError) {
    return sendError(reply, request, 429, err.code, err.message, false);
  }
  request.log.error({ errorClass: err instanceof Error ? err.name : 'unknown' }, 'candidate-action-batch-failed');
  return sendError(reply, request, 500, 'action_execution_failed', 'Не удалось выполнить действия. Попробуйте позже.', false);
}

async function handleListReceipts(
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
  if (!candidate) return;

  const parsed = listReceiptsQuerySchema.safeParse(request.query);
  const limit = parsed.success ? parsed.data.limit : 50;

  const repo = getOrCreateRepo(deps);
  const receipts = repo.listReceipts(candidate.id, limit, parsed.success ? parsed.data.batchId : undefined);
  return reply.send({ data: { receipts } });
}

async function handleToggleKillSwitch(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  if (!hasSafeMutationOrigin(request, deps.config)) {
    return csrfError(request, reply);
  }
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return;

  const parsed = killSwitchBodySchema.safeParse(request.body);
  if (!parsed.success) {
    return sendError(reply, request, 400, 'invalid_kill_switch_payload', 'Некорректные параметры kill-switch.', false);
  }

  const repo = getOrCreateRepo(deps);
  const scope = parsed.data.platform
    ? `candidate:${candidate.id}:${parsed.data.platform}`
    : `candidate:${candidate.id}`;
  repo.setKillSwitch(scope, parsed.data.active, parsed.data.reason);

  return reply.send({
    data: {
      ok: true,
      active: parsed.data.active,
      scope,
      linkedinSafetyStop: repo.getLinkedinSafetyStopStatus(candidate.id),
    },
  });
}

async function handleGetUsage(
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
  if (!candidate) return;

  // Тот же пояс и та же дата, что у исполнителя пакета, — задаёт сервер.
  const timezone = DEFAULT_ACCOUNT_TIMEZONE;
  const now = new Date();
  const localDate = formatLocalDate(now, timezone);

  const repo = getOrCreateRepo(deps);
  const usage = repo.getDailyUsage(candidate.id, localDate);

  return reply.send({
    data: {
      usage,
      timezone,
      resetAt: getCandidateActionResetAt(now, timezone),
      killSwitchActive:
        repo.isKillSwitchActive('hh', candidate.id) || repo.isKillSwitchActive('linkedin', candidate.id),
      limits: DEFAULT_CANDIDATE_ACTION_LIMITS,
      linkedinSafetyStop: repo.getLinkedinSafetyStopStatus(candidate.id),
    },
  });
}

export function registerCandidateActionRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post('/api/v1/candidate/actions/batch', withDeps(deps, handleExecuteBatch));
  app.get('/api/v1/candidate/actions/receipts', withDeps(deps, handleListReceipts));
  app.post('/api/v1/candidate/actions/kill-switch', withDeps(deps, handleToggleKillSwitch));
  app.get('/api/v1/candidate/actions/usage', withDeps(deps, handleGetUsage));
}
