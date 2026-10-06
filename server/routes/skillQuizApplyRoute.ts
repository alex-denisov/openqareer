import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  buildSkillVerificationFact,
  createSkillVerificationProposal,
  evaluateSkillQuiz,
  getSkillQuizById,
} from '../../src/services/hhSkillQuizzes';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import type { CareerActionProposal } from '../domain/coach';
import { ResumeRevisionConflictError } from '../orchestration/careerCommandDispatcher';
import {
  CareerCommandPlanner,
  bindResumeRevisionTarget,
} from '../orchestration/careerCommandPlanner';
import {
  currentSkillText,
  serializeSkillState,
  skillKey,
  skillStateAfterQuiz,
} from '../orchestration/skillRevision';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';

const applyBodySchema = z.object({
  quizId: z.string().min(1).max(80),
  skillName: z.string().min(1).max(120),
  answers: z.record(z.string(), z.number()),
});

function prepareCommand(
  deps: RouteDeps,
  candidateId: string,
  commandId: string,
  body: z.infer<typeof applyBodySchema>,
) {
  const { candidateStore } = deps;
  const result = evaluateSkillQuiz(body.quizId, body.answers);
  const fact = buildSkillVerificationFact(body.skillName, result);
  const draft = candidateStore.getSnapshot(candidateId).resume?.draft ?? EMPTY_RESUME_DRAFT;
  const key = skillKey(body.skillName);
  const proposal = {
    ...createSkillVerificationProposal(body.skillName, result),
    evidenceRefs: [`quiz:${body.quizId}`],
  };
  const revision = {
    ...proposal.resumeRevision,
    experienceId: key,
    memoryId: null,
    proposedText: serializeSkillState(skillStateAfterQuiz(draft, body.skillName, fact)),
  };
  const executionTarget = bindResumeRevisionTarget(revision, currentSkillText(draft, key));
  const planner = new CareerCommandPlanner({ createId: () => commandId });
  const command = candidateStore.saveCareerCommand(
    planner.materialize({
      principal: { candidateId: candidateId },
      proposal: { ...proposal, resumeRevision: revision } as CareerActionProposal,
      availableEvidenceRefs: new Set([`quiz:${body.quizId}`]),
      strategyDecisionId: `skill-quiz:${body.quizId}`,
      modelInvocationIds: [],
      idempotencyKey: commandId,
      approval: null,
      executionTarget,
    }),
  );
  return { result, fact, command };
}

function approveCommand(
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
  command: { readonly commandId: string; readonly capability: CareerActionProposal['kind'] },
): void {
  const consumedAt = new Date();
  candidateStore.approveCareerCommand({
    candidateId: candidateId,
    commandId: command.commandId,
    approval: {
      id: randomUUID(),
      candidateId: candidateId,
      commandId: command.commandId,
      capability: command.capability,
      expiresAt: new Date(consumedAt.getTime() + 5 * 60_000).toISOString(),
    },
    consumedAt: consumedAt.toISOString(),
  });
}

/**
 * Accepting a quiz result is the candidate's approval: the server re-scores the
 * answers itself, writes the skill status through the shared career-command
 * dispatcher and returns the command id that /revert can undo.
 */
async function handleApplySkillQuiz(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const { authService, candidateStore, careerCommandDispatcher, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const commandId = z.string().uuid().parse(request.headers['idempotency-key']);
  const body = applyBodySchema.parse(request.body);
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
  if (!getSkillQuizById(body.quizId)) {
    return sendError(reply, request, 404, 'skill_quiz_not_found', 'Квиз не найден.', false);
  }
  const { result, fact, command } = prepareCommand(deps, candidate.id, commandId, body);
  approveCommand(candidateStore, candidate.id, command);
  try {
    const applied = await careerCommandDispatcher.dispatch(candidate.id, command.commandId);
    return reply.code(201).send({
      data: { commandId: applied.commandId, command: applied, result, fact },
      meta: { requestId: request.id },
    });
  } catch (error) {
    if (error instanceof ResumeRevisionConflictError) {
      return sendError(reply, request, 409, 'resume_revision_stale', error.message, false);
    }
    throw error;
  }
}

export function registerSkillQuizApplyRoute(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    '/api/v1/candidate/skill-quiz/apply',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    withDeps(deps, handleApplySkillQuiz),
  );
}
