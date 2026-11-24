import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  GOAL_TRANSFER_LINE_MAX,
  type CareerDiaryGoalCard,
  type CareerDiaryGoalTransfer,
} from '../../shared/careerDiaryCards';
import { hasEmployerFigures } from '../../shared/employerFigures';
import type { CandidateStore } from '../data/candidateStore';
import { CandidateStoreConflictError } from '../data/sqliteCandidateStore';
import { sendError, withDeps } from './helpers';

const BASE = '/api/v1/candidate/career-diary';

const transferSchema = z
  .object({
    experienceId: z.string().trim().min(1).max(80),
    line: z.string().trim().min(1).max(GOAL_TRANSFER_LINE_MAX),
  })
  .strict();

export interface GoalTransferDeps {
  readonly candidateStore: Pick<
    CandidateStore,
    'addManualExperienceFact' | 'getSnapshot' | 'profileChangeLog'
  >;
  readonly candidateId: (request: FastifyRequest, reply: FastifyReply) => string | null;
  readonly goalId: (request: FastifyRequest, reply: FastifyReply) => string | null;
  readonly cardOf: (candidate: string, goalId: string) => CareerDiaryGoalCard | null;
  readonly saveTransfer: (
    candidate: string,
    goalId: string,
    transfer: CareerDiaryGoalTransfer,
  ) => CareerDiaryGoalCard | null;
  readonly rateLimit: object;
}

/**
 * Номер факта профиля из номера цели: одна цель — один факт. Два одновременных
 * переноса пишут один и тот же факт, второй строки под местом работы не бывает.
 */
function factIdOf(candidate: string, goalId: string): string {
  const hex = createHash('sha256').update(`goal-transfer:${candidate}:${goalId}`).digest('hex');
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const EMPLOYER_FIGURES_TEXT = 'Уберите из строки внутренние цифры работодателя.';

const ok = (request: FastifyRequest, card: CareerDiaryGoalCard | null) => ({
  data: card,
  meta: { requestId: request.id },
});

function refuse(
  reply: FastifyReply,
  request: FastifyRequest,
  status: number,
  code: string,
  text: string,
) {
  return sendError(reply, request, status, code, text, false);
}

/** Строка под местом работы и запись в журнале правок профиля: одна запись на одну строку. */
function writeLine(
  deps: GoalTransferDeps,
  candidate: string,
  memoryId: string,
  input: z.infer<typeof transferSchema>,
): void {
  const { candidateStore } = deps;
  const before = candidateStore.getSnapshot(candidate).resume?.draft;
  candidateStore.addManualExperienceFact(candidate, memoryId, input.line, input.experienceId);
  const after = candidateStore.getSnapshot(candidate).resume?.draft;
  if (after)
    candidateStore.profileChangeLog.recordDraftChanges(candidate, before, after, 'candidate');
}

async function transfer(deps: GoalTransferDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = deps.candidateId(request, reply);
  if (!candidate) return undefined;
  const goalId = deps.goalId(request, reply);
  if (!goalId) return undefined;
  const parsed = transferSchema.safeParse(request.body);
  if (!parsed.success) {
    return refuse(reply, request, 400, 'invalid_request', 'Проверьте строку для профиля.');
  }
  // Внутренние цифры работодателя в профиль не идут: строку кандидат правит сам.
  if (hasEmployerFigures(parsed.data.line)) {
    return refuse(reply, request, 422, 'employer_figures', EMPLOYER_FIGURES_TEXT);
  }
  const card = deps.cardOf(candidate, goalId);
  if (!card)
    return refuse(reply, request, 404, 'career_diary_record_not_found', 'Цель не найдена.');
  // Повтор ничего не добавляет: в профиле уже стоит строка этой цели.
  if (card.details.transfer) return ok(request, card);
  if (card.risk.status !== 'achieved') {
    return refuse(reply, request, 409, 'career_diary_goal_not_achieved', 'Цель ещё не достигнута.');
  }
  const memoryId = factIdOf(candidate, goalId);
  try {
    writeLine(deps, candidate, memoryId, parsed.data);
  } catch (error) {
    if (!(error instanceof CandidateStoreConflictError)) throw error;
    return refuse(
      reply,
      request,
      409,
      'career_diary_experience_missing',
      'Место работы в профиле изменилось. Обновите страницу и выберите его снова.',
    );
  }
  const saved = deps.saveTransfer(candidate, goalId, {
    experienceId: parsed.data.experienceId,
    memoryId,
    transferredAt: new Date().toISOString(),
  });
  return ok(request, saved);
}

/** B742: «Перенести» — строка результата достигнутой цели под местом работы в «Опыте». */
export function registerCareerDiaryGoalTransferRoutes(
  app: FastifyInstance,
  deps: GoalTransferDeps,
): void {
  app.post(`${BASE}/goal-cards/:goalId/transfer`, deps.rateLimit, withDeps(deps, transfer));
}
