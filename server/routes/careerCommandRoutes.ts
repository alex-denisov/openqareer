import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CareerCommandPlanner } from '../orchestration/careerCommandPlanner';
import type { CandidateSnapshot } from '../data/candidateStore';
import { CareerCommandNotFoundError } from '../data/sqliteCareerCommandRepository';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import { careerCommandParamsSchema, careerCommandRequestSchema } from './schemas';

type Handler = (
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<unknown>;

const handleListCommands: Handler = async (
  { authService, candidateStore, config },
  request,
  reply,
) => {
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  return {
    data: candidateStore.listCareerCommands(candidate.id),
    meta: { requestId: request.id },
  };
};

function findCompletedProposal(
  snapshot: CandidateSnapshot,
  body: { turnIdempotencyKey: string; proposalIndex: number },
) {
  const turn = snapshot.turns.find(
    (item) =>
      item.idempotencyKey === body.turnIdempotencyKey &&
      item.status === 'completed' &&
      item.result,
  );
  return { turn, proposal: turn?.result?.actionProposals[body.proposalIndex] };
}

function materializeCommand(input: Parameters<CareerCommandPlanner['materialize']>[0]) {
  const planner = new CareerCommandPlanner({
    createId: () => input.idempotencyKey,
  });
  return planner.materialize(input);
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
  const { turn, proposal } = findCompletedProposal(snapshot, body);
  if (!turn || !proposal) {
    return sendError(
      reply,
      request,
      404,
      'career_proposal_not_found',
      'Такого предложения нет в сохранённом карьерном ходе.',
      false,
    );
  }
  const command = candidateStore.saveCareerCommand(
    materializeCommand({
      principal: { candidateId: candidate.id },
      proposal,
      availableEvidenceRefs: new Set(
        snapshot.messages
          .filter((message) => message.role === 'user')
          .map((message) => message.id),
      ),
      strategyDecisionId: turn.idempotencyKey,
      modelInvocationIds: turn.provenance ? [turn.provenance.responseId] : [],
      idempotencyKey,
      approval: null,
      executionTarget: body.executionTarget ?? null,
    }),
  );
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
  { authService, candidateStore, config },
  request,
  reply,
) => {
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const { commandId } = careerCommandParamsSchema.parse(request.params);
  const command = candidateStore.getCareerCommand(candidate.id, commandId);
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
    approved = await careerCommandDispatcher.dispatch(candidate.id, commandId);
  }
  return { data: approved, meta: { requestId: request.id } };
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
}
