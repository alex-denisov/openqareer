import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CareerCommandPlanner,
  bindResumeRevisionTarget,
  type CareerCommandExecutionTarget,
} from '../orchestration/careerCommandPlanner';
import type { CandidateSnapshot } from '../data/candidateStore';
import { CareerCommandNotFoundError } from '../data/sqliteCareerCommandRepository';
import {
  currentTextForResumeRevision,
  ResumeRevisionConflictError,
} from '../orchestration/careerCommandDispatcher';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import { computeProposalKey, consultantProposalKey } from '../../shared/consultantProposalKey';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import { careerCommandParamsSchema, careerCommandRequestSchema } from './schemas';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const handleListCommands: Handler = async (
  { authService, candidateStore, careerCommandDispatcher, config },
  request,
  reply,
) => {
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const rawCommands =
    careerCommandDispatcher?.list(candidate.id) ??
    candidateStore.listCareerCommands(candidate.id);
  const rejections = candidateStore.getConsultantRejections(candidate.id);
  const rejectedKeys = new Set(rejections.map((r) => r.proposalKey));
  const data = rawCommands.filter((cmd) => {
    const target = cmd.executionTarget;
    if (
      target &&
      'section' in target &&
      'proposedText' in target &&
      typeof target.section === 'string' &&
      typeof target.proposedText === 'string'
    ) {
      const key = computeProposalKey(target.section, target.proposedText);
      if (rejectedKeys.has(key)) return false;
    }
    return true;
  });
  return {
    data,
    meta: { requestId: request.id },
  };
};

function findCompletedProposal(
  snapshot: CandidateSnapshot,
  body: { turnIdempotencyKey: string; proposalIndex: number },
) {
  const turn = snapshot.turns.find(
    (item) =>
      item.idempotencyKey === body.turnIdempotencyKey && item.status === 'completed' && item.result,
  );
  return { turn, proposal: turn?.result?.actionProposals[body.proposalIndex] };
}

function materializeCommand(input: Parameters<CareerCommandPlanner['materialize']>[0]) {
  const planner = new CareerCommandPlanner({
    createId: () => input.idempotencyKey,
  });
  return planner.materialize(input);
}

type StoredTurn = NonNullable<ReturnType<typeof findCompletedProposal>['turn']>;
type StoredProposal = NonNullable<ReturnType<typeof findCompletedProposal>['proposal']>;
type ExecutionTargetResolution =
  | { readonly ok: true; readonly executionTarget: CareerCommandExecutionTarget | null }
  | {
      readonly ok: false;
      readonly status: 422;
      readonly code: 'resume_revision_target_missing' | 'resume_revision_target_stale';
      readonly message: string;
    };

function resolveExecutionTarget(
  snapshot: CandidateSnapshot,
  proposal: StoredProposal,
  requestedTarget: CareerCommandExecutionTarget | null,
): ExecutionTargetResolution {
  if (proposal.kind !== 'resume.revise') {
    return { ok: true, executionTarget: requestedTarget };
  }
  if (!proposal.resumeRevision) {
    return {
      ok: false,
      status: 422,
      code: 'resume_revision_target_missing',
      message: 'В предложении нет проверяемого раздела профиля и новой формулировки.',
    };
  }
  const currentText = currentTextForResumeRevision(
    snapshot.resume?.draft ?? EMPTY_RESUME_DRAFT,
    proposal.resumeRevision,
    snapshot.memory,
  );
  if (currentText === null) {
    return {
      ok: false,
      status: 422,
      code: 'resume_revision_target_stale',
      message: 'Раздел опыта изменился. Обновите предложение консультанта.',
    };
  }
  return {
    ok: true,
    executionTarget: bindResumeRevisionTarget(proposal.resumeRevision, currentText),
  };
}

function saveCommandForProposal(input: {
  readonly candidateStore: RouteDeps['candidateStore'];
  readonly candidateId: string;
  readonly snapshot: CandidateSnapshot;
  readonly turn: StoredTurn;
  readonly proposal: StoredProposal;
  readonly idempotencyKey: string;
  readonly executionTarget: CareerCommandExecutionTarget | null;
}) {
  const { candidateStore, candidateId, snapshot, turn, proposal, idempotencyKey } = input;
  return candidateStore.saveCareerCommand(
    materializeCommand({
      principal: { candidateId },
      proposal,
      availableEvidenceRefs: new Set([
        ...snapshot.messages
          .filter((message) => message.role === 'user')
          .map((message) => message.id),
        ...snapshot.memory.map((mem) => `memory:${mem.id}`),
        ...snapshot.memory.map((mem) => mem.id),
      ]),
      strategyDecisionId: turn.idempotencyKey,
      modelInvocationIds: turn.provenance ? [turn.provenance.responseId] : [],
      idempotencyKey,
      approval: null,
      executionTarget: input.executionTarget,
    }),
  );
}

function isProposalRejected(
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
  proposal: Parameters<typeof consultantProposalKey>[0],
): boolean {
  const rejections = candidateStore.getConsultantRejections(candidateId);
  return rejections.some((r) => r.proposalKey === consultantProposalKey(proposal));
}

function validateProposal(
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
  snapshot: ReturnType<RouteDeps['candidateStore']['getSnapshot']>,
  body: z.infer<typeof careerCommandRequestSchema>,
) {
  const { turn, proposal } = findCompletedProposal(snapshot, body);
  if (!turn || !proposal) {
    return { ok: false, err: 'Такого предложения нет в сохранённом карьерном ходе.' } as const;
  }
  if (isProposalRejected(candidateStore, candidateId, proposal)) {
    return { ok: false, err: 'Предложение было отклонено.' } as const;
  }
  return { ok: true, turn, proposal } as const;
}

async function createCommand(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const { candidateStore } = deps;
  const candidate = authenticateCandidate(
    request,
    reply,
    candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const idempotencyKey = z.string().uuid().parse(request.headers['idempotency-key']);
  const body = careerCommandRequestSchema.parse(request.body);
  const snapshot = deps.candidateStore.getSnapshot(candidate.id);
  const found = validateProposal(deps.candidateStore, candidate.id, snapshot, body);
  if (!found.ok) {
    return sendError(reply, request, 404, 'career_proposal_not_found', found.err, false);
  }
  const { turn, proposal } = found;
  const target = resolveExecutionTarget(snapshot, proposal, body.executionTarget ?? null);
  if (!target.ok) {
    return sendError(reply, request, target.status, target.code, target.message, false);
  }
  const command = saveCommandForProposal({
    candidateStore,
    candidateId: candidate.id,
    snapshot,
    turn,
    proposal,
    idempotencyKey,
    executionTarget: target.executionTarget,
  });
  return reply.code(201).send({
    data: command,
    meta: { requestId: request.id },
  });
}

const handleCreateCommand: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  return createCommand(deps, request, reply);
};

const handleGetCommand: Handler = async (
  { authService, candidateStore, careerCommandDispatcher, config },
  request,
  reply,
) => {
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const { commandId } = careerCommandParamsSchema.parse(request.params);
  const command =
    careerCommandDispatcher?.get(candidate.id, commandId) ??
    candidateStore.getCareerCommand(candidate.id, commandId);
  if (!command) throw new CareerCommandNotFoundError();
  return { data: command, meta: { requestId: request.id } };
};

const handleApproveCommand: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config, careerCommandDispatcher } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const { commandId } = careerCommandParamsSchema.parse(request.params);
  const approvalId = z.string().uuid().parse(request.headers['idempotency-key']);
  const command = candidateStore.getCareerCommand(candidate.id, commandId);
  if (!command) throw new CareerCommandNotFoundError();
  if (
    command.capability === 'resume.revise' &&
    careerCommandDispatcher &&
    !careerCommandDispatcher.isResumeRevisionCurrent(candidate.id, command)
  ) {
    return sendError(
      reply,
      request,
      409,
      'resume_revision_stale',
      'Профиль изменился после подготовки. Обновите предложение перед применением.',
      false,
    );
  }
  const consumedAt = new Date();
  let approved = candidateStore.approveCareerCommand({
    candidateId: candidate.id,
    commandId,
    approval: {
      id: approvalId,
      candidateId: candidate.id,
      commandId,
      capability: command.capability,
      expiresAt: new Date(consumedAt.getTime() + 5 * 60_000).toISOString(),
    },
    consumedAt: consumedAt.toISOString(),
  });
  if (careerCommandDispatcher && approved.status === 'queued') {
    try {
      approved = await careerCommandDispatcher.dispatch(candidate.id, commandId);
    } catch (error) {
      if (error instanceof ResumeRevisionConflictError) {
        return sendError(reply, request, 409, 'resume_revision_stale', error.message, false);
      }
      throw error;
    }
  }
  return { data: approved, meta: { requestId: request.id } };
};

const handleRevertCommand: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config, careerCommandDispatcher } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const { commandId } = careerCommandParamsSchema.parse(request.params);
  if (!careerCommandDispatcher) {
    return sendError(
      reply,
      request,
      500,
      'career_command_dispatcher_not_available',
      'Диспетчер карьерных команд недоступен.',
      false,
    );
  }
  try {
    const reverted = await careerCommandDispatcher.revert(candidate.id, commandId);
    return { data: reverted, meta: { requestId: request.id } };
  } catch (error) {
    if (error instanceof ResumeRevisionConflictError) {
      return sendError(reply, request, 409, 'resume_revision_stale', error.message, false);
    }
    throw error;
  }
};

export async function registerCareerCommandRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  app.get('/api/v1/candidate/career-commands', withDeps(deps, handleListCommands));
  app.post(
    '/api/v1/candidate/career-commands',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    withDeps(deps, handleCreateCommand),
  );
  app.get('/api/v1/candidate/career-commands/:commandId', withDeps(deps, handleGetCommand));
  app.post(
    '/api/v1/candidate/career-commands/:commandId/approvals',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    withDeps(deps, handleApproveCommand),
  );
  app.post(
    '/api/v1/candidate/career-commands/:commandId/revert',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    withDeps(deps, handleRevertCommand),
  );
}
