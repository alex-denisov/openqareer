import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createSkillVerificationProposal } from '../../src/services/hhSkillQuizzes';
import type { QuizEvaluationResult } from '../../src/services/hhSkillQuizzes';
import type { SkillQuizAttempt } from '../data/sqliteSkillQuizAttemptRepository';
import {
  GENERATED_QUIZ_PASSING_PERCENT,
  SKILL_QUIZ_BURST_GUARD_MS,
  SKILL_QUIZ_LEVELS,
  clientQuestions,
  evaluateGeneratedQuiz,
} from '../domain/generatedSkillQuiz';
import { EMPTY_RESUME_DRAFT, type ResumeDraft } from '../domain/resumeDraft';
import { repairLegacyQuizSkills } from '../domain/legacyQuizSkillRepair';
import { conversationCoverage, isQuizCheckable } from '../domain/skillConfirmation';
import { ResumeRevisionConflictError } from '../orchestration/careerCommandDispatcher';
import { skillKey } from '../orchestration/skillRevision';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import { approveSkillVerdictCommand, planSkillVerdictCommand } from './skillVerdictCommand';

/**
 * «Подтвердить навык» (блок A, пакет 3, `BLOCK-A-p3-decision.md`): квиз по
 * навыку профиля с вопросами на сервере и статус «Разобрано в беседе» по
 * подтверждённым фактам беседы.
 */

const CONFIRMED = 'подтверждён';

const generateSchema = z
  .object({ skillName: z.string().trim().min(1).max(120), level: z.enum(SKILL_QUIZ_LEVELS) })
  .strict();
const submitSchema = z
  .object({ answers: z.record(z.string().max(8), z.number().int().min(-1).max(3)) })
  .strict();
const attemptParamsSchema = z.object({ attemptId: z.string().uuid() });

type Candidate = NonNullable<ReturnType<typeof authenticateCandidate>>;

function readDraft(deps: RouteDeps, candidateId: string): ResumeDraft {
  return deps.candidateStore.getSnapshot(candidateId).resume?.draft ?? EMPTY_RESUME_DRAFT;
}

function findProfileSkill(draft: ResumeDraft, name: string) {
  return (draft.skills ?? []).find((skill) => skillKey(skill.name) === skillKey(name));
}

/** Генерация уже идёт у этого кандидата: последняя попытка моложе 10 с. */
function generationInFlight(deps: RouteDeps, candidateId: string, now: Date): boolean {
  const since = new Date(now.getTime() - SKILL_QUIZ_BURST_GUARD_MS).toISOString();
  return (deps.candidateStore.skillQuizAttempts?.countSince(candidateId, since) ?? 0) > 0;
}

function authenticate(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  return authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
}

function authenticateMutation(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Candidate | null {
  if (!hasSafeMutationOrigin(request, deps.config)) {
    csrfError(request, reply);
    return null;
  }
  return authenticate(deps, request, reply) ?? null;
}

async function handleConfirmations(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = authenticate(deps, request, reply);
  if (!candidate) return undefined;
  const snapshot = deps.candidateStore.getSnapshot(candidate.id);
  const skills = snapshot.resume?.draft.skills ?? [];
  const coverage = conversationCoverage(
    skills.map((skill) => skill.name),
    snapshot.memory ?? [],
  );
  const attempts = deps.candidateStore.skillQuizAttempts?.list(candidate.id) ?? [];
  return reply.send({
    data: {
      passingScorePercent: GENERATED_QUIZ_PASSING_PERCENT,
      skills: skills.map((skill, index) => {
        const key = skillKey(skill.name);
        const last = attempts.find((attempt) => attempt.skillKey === key && attempt.result);
        return {
          id: skill.id,
          name: skill.name,
          status: skill.status ?? null,
          source: skill.source ?? null,
          verifiedAt: skill.verifiedAt ?? null,
          quizCheckable: isQuizCheckable(skill.name),
          lastAttempt: last?.result
            ? {
                at: last.submittedAt,
                scorePercent: last.result.scorePercent,
                passed: last.result.passed,
              }
            : null,
          conversation: coverage[index],
        };
      }),
    },
  });
}

interface Refusal {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

const REFUSALS = {
  unavailable: {
    status: 503,
    code: 'skill_quiz_unavailable',
    message: 'Тест сейчас не собрать. Попробуйте позже.',
    retryable: true,
  },
  notInProfile: {
    status: 404,
    code: 'skill_not_in_profile',
    message: 'Такого навыка нет в профиле.',
    retryable: false,
  },
  notCheckable: {
    status: 422,
    code: 'skill_quiz_not_checkable',
    message: 'Этот навык тестом не проверить. Разберите его в беседе с консультантом.',
    retryable: false,
  },
  busy: {
    status: 429,
    code: 'skill_quiz_busy',
    message: 'Тест уже собирается. Подождите несколько секунд.',
    retryable: true,
  },
  attemptNotFound: {
    status: 404,
    code: 'skill_quiz_attempt_not_found',
    message: 'Попытка не найдена.',
    retryable: false,
  },
  submitted: {
    status: 409,
    code: 'skill_quiz_attempt_submitted',
    message: 'Эта попытка уже сдана.',
    retryable: false,
  },
  notApplicable: {
    status: 409,
    code: 'skill_quiz_attempt_not_applicable',
    message: 'Результат этой попытки уже записан или ещё не получен.',
    retryable: false,
  },
  alreadyConfirmed: {
    status: 409,
    code: 'skill_already_confirmed',
    message: 'Навык уже подтверждён, неудачная попытка его не меняет.',
    retryable: false,
  },
  noDispatcher: {
    status: 500,
    code: 'career_command_dispatcher_not_available',
    message: 'Диспетчер карьерных команд недоступен.',
    retryable: false,
  },
} as const satisfies Record<string, Refusal>;

function refuse(reply: FastifyReply, request: FastifyRequest, refusal: Refusal) {
  return sendError(
    reply,
    request,
    refusal.status,
    refusal.code,
    refusal.message,
    refusal.retryable,
  );
}

/** Навык профиля, по которому можно собрать тест сейчас, или причина отказа. */
function quizTarget(
  deps: RouteDeps,
  candidateId: string,
  skillName: string,
): { readonly name: string; readonly key: string } | Refusal {
  if (!deps.skillQuizModel || !deps.candidateStore.skillQuizAttempts) return REFUSALS.unavailable;
  const skill = findProfileSkill(readDraft(deps, candidateId), skillName);
  if (!skill) return REFUSALS.notInProfile;
  if (!isQuizCheckable(skill.name)) return REFUSALS.notCheckable;
  if (generationInFlight(deps, candidateId, new Date())) return REFUSALS.busy;
  return { name: skill.name, key: skillKey(skill.name) };
}

async function handleGenerate(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = authenticateMutation(deps, request, reply);
  if (!candidate) return undefined;
  const body = generateSchema.parse(request.body);
  const target = quizTarget(deps, candidate.id, body.skillName);
  if ('status' in target) return refuse(reply, request, target);
  let questions;
  try {
    questions = await deps.skillQuizModel!.generate({ skill: target.name, level: body.level });
  } catch (error) {
    request.log.warn({ err: error }, 'skill quiz generation failed');
    return refuse(reply, request, REFUSALS.unavailable);
  }
  const attempt: SkillQuizAttempt = {
    id: randomUUID(),
    skillName: target.name,
    skillKey: target.key,
    level: body.level,
    questions,
    createdAt: new Date().toISOString(),
    submittedAt: null,
    result: null,
    appliedCommandId: null,
  };
  deps.candidateStore.skillQuizAttempts!.create(candidate.id, attempt);
  return reply.code(201).send({
    data: {
      attemptId: attempt.id,
      skillName: attempt.skillName,
      level: attempt.level,
      passingScorePercent: GENERATED_QUIZ_PASSING_PERCENT,
      questions: clientQuestions(questions),
    },
  });
}

function readAttempt(deps: RouteDeps, request: FastifyRequest, candidate: Candidate) {
  const { attemptId } = attemptParamsSchema.parse(request.params);
  return deps.candidateStore.skillQuizAttempts?.get(candidate.id, attemptId) ?? null;
}

async function handleSubmit(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = authenticateMutation(deps, request, reply);
  if (!candidate) return undefined;
  const { answers } = submitSchema.parse(request.body);
  const attempt = readAttempt(deps, request, candidate);
  if (!attempt) return refuse(reply, request, REFUSALS.attemptNotFound);
  const submittedAt = new Date().toISOString();
  const result = evaluateGeneratedQuiz(attempt.questions, answers, submittedAt.slice(0, 10));
  const saved = deps.candidateStore.skillQuizAttempts!.submit(candidate.id, {
    ...attempt,
    submittedAt,
    result,
  });
  if (!saved) return refuse(reply, request, REFUSALS.submitted);
  return reply.send({ data: { attemptId: attempt.id, skillName: attempt.skillName, result } });
}

function legacyResult(attempt: SkillQuizAttempt): QuizEvaluationResult {
  const result = attempt.result!;
  return {
    ...result,
    quizId: attempt.id,
    statusLabel: result.passed ? 'подтверждён' : 'не подтверждено',
    verifiedBadgeAwarded: false,
    review: [...result.review],
  };
}

/** Почему результат попытки нельзя записать в профиль; `null` — можно. */
function applyRefusal(deps: RouteDeps, attempt: SkillQuizAttempt, draft: ResumeDraft) {
  if (!attempt.result || attempt.appliedCommandId) return REFUSALS.notApplicable;
  const status = findProfileSkill(draft, attempt.skillName)?.status;
  if (!attempt.result.passed && status === CONFIRMED) return REFUSALS.alreadyConfirmed;
  if (!deps.careerCommandDispatcher) return REFUSALS.noDispatcher;
  return null;
}

async function handleApply(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = authenticateMutation(deps, request, reply);
  if (!candidate) return undefined;
  const commandId = z.string().uuid().parse(request.headers['idempotency-key']);
  const attempt = readAttempt(deps, request, candidate);
  if (!attempt) return refuse(reply, request, REFUSALS.attemptNotFound);
  const draft = readDraft(deps, candidate.id);
  const refusal = applyRefusal(deps, attempt, draft);
  if (refusal) return refuse(reply, request, refusal);
  const result = legacyResult(attempt);
  const command = planSkillVerdictCommand(deps, candidate.id, commandId, draft, {
    skillName: attempt.skillName,
    status: result.status,
    source: result.source,
    date: result.verifiedAt,
    evidenceRef: `quiz:${attempt.id}`,
    proposal: createSkillVerificationProposal(attempt.skillName, result),
  });
  approveSkillVerdictCommand(deps.candidateStore, candidate.id, command);
  try {
    const applied = await deps.careerCommandDispatcher!.dispatch(candidate.id, command.commandId);
    deps.candidateStore.skillQuizAttempts!.markApplied(candidate.id, {
      ...attempt,
      appliedCommandId: applied.commandId,
    });
    return reply.code(201).send({ data: { commandId: applied.commandId, result: attempt.result } });
  } catch (error) {
    if (error instanceof ResumeRevisionConflictError) {
      return sendError(reply, request, 409, 'resume_revision_stale', error.message, false);
    }
    throw error;
  }
}

const repairSchema = z.object({ apply: z.boolean().default(false) }).strict();

/**
 * Ремонт навыков старого банка квизов: без `apply` только показывает правки.
 * Идемпотентен — повторный вызов ничего не меняет.
 */
async function handleRepairLegacy(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = authenticateMutation(deps, request, reply);
  if (!candidate) return undefined;
  const { apply } = repairSchema.parse(request.body ?? {});
  const stored = deps.candidateStore.getSnapshot(candidate.id).resume;
  if (!stored) return reply.send({ data: { applied: false, changes: [] } });
  const repair = repairLegacyQuizSkills(stored.draft);
  const applied = apply && repair.changes.length > 0;
  if (applied) {
    deps.candidateStore.saveResumeDraft(candidate.id, repair.draft, stored.evidenceSnapshot);
    request.log.info({ changes: repair.changes.length }, 'legacy_quiz_skills_repaired');
  }
  return reply.send({ data: { applied, changes: repair.changes } });
}

export function registerSkillConfirmationRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get(
    '/api/v1/candidate/skill-confirmations',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    withDeps(deps, handleConfirmations),
  );
  app.post(
    '/api/v1/candidate/skill-quiz/repair-legacy',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    withDeps(deps, handleRepairLegacy),
  );
  app.post(
    '/api/v1/candidate/skill-quiz/generate',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    withDeps(deps, handleGenerate),
  );
  app.post(
    '/api/v1/candidate/skill-quiz/attempts/:attemptId/submit',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    withDeps(deps, handleSubmit),
  );
  app.post(
    '/api/v1/candidate/skill-quiz/attempts/:attemptId/apply',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    withDeps(deps, handleApply),
  );
}
