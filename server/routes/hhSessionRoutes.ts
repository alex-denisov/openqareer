import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  HH_APPLY_OUTCOMES,
  HH_RESUME_ID,
  HH_RESUME_TEXT_MAX_LENGTH,
  HH_RESUME_TITLE_MAX_LENGTH,
  HH_RESUMES_MAX,
  HH_REVIEW_RESUMES_MAX,
  HH_REVIEW_TEXT_MAX_LENGTH,
  HH_VACANCY_ID,
  type HhResumeSnapshot,
} from '../../shared/hhCandidateSession';
import { SqliteHhSessionRepository } from '../candidate/sqliteHhSessionRepository';
import { hhApplyGate, type HhApplyRefusal } from '../domain/hhApplyGate';
import { reviewHhResumes } from '../domain/hhResumeReview';
import { resolvePoolVacancyCluster } from '../vacancies/poolVacancyCluster';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

/**
 * B704: сессия кандидата hh.ru в приложении. Резюме читаются в окне hh.ru на машине
 * кандидата и сохраняются здесь запечатанными; отклик от его имени начинается только с его
 * подтверждения и в пределах суточного лимита, исход записывается один раз.
 */
type BoundDeps = RouteDeps & { readonly hh: SqliteHhSessionRepository };
type Handler = (deps: BoundDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const resumeId = z.string().regex(HH_RESUME_ID);
const title = z.string().trim().min(1).max(HH_RESUME_TITLE_MAX_LENGTH);

const contentSchema = z
  .object({ id: resumeId, title, text: z.string().trim().min(1).max(HH_RESUME_TEXT_MAX_LENGTH) })
  .strict();

const snapshotSchema = z
  .object({
    resumes: z
      .array(
        z.object({ id: resumeId, title, updatedLabel: z.string().trim().max(120).optional() }).strict(),
      )
      .min(1)
      .max(HH_RESUMES_MAX),
    selected: contentSchema.nullable(),
    /** B678: содержимое остальных резюме списка для сверки с вакансией. */
    contents: z
      .array(contentSchema.extend({ text: z.string().trim().min(1).max(HH_REVIEW_TEXT_MAX_LENGTH) }))
      .max(HH_REVIEW_RESUMES_MAX)
      .optional(),
  })
  .strict()
  .refine((value) => !value.selected || value.resumes.some((item) => item.id === value.selected?.id), {
    message: 'selected_not_listed',
  })
  .refine(
    (value) => (value.contents ?? []).every((content) => value.resumes.some((item) => item.id === content.id)),
    { message: 'content_not_listed' },
  );

const reviewQuerySchema = z.object({ vacancyId: z.string().trim().min(1).max(512) });

const attemptSchema = z
  .object({ vacancyId: z.string().regex(HH_VACANCY_ID), resumeId, confirmed: z.literal(true) })
  .strict();

const resultSchema = z
  .object({
    outcome: z.enum(HH_APPLY_OUTCOMES),
    failureCode: z.string().regex(/^[a-z0-9_]{1,64}$/u).optional(),
  })
  .strict();

const REFUSAL_REPLY: Readonly<Record<HhApplyRefusal, readonly [number, string]>> = {
  hh_resumes_not_read: [409, 'Сначала выберите резюме hh.ru.'],
  hh_resume_not_in_session: [409, 'Этого резюме нет среди ваших резюме на hh.ru. Выберите его заново.'],
  hh_apply_in_progress: [409, 'Отклик на эту вакансию уже отправляется.'],
  hh_already_applied: [409, 'Вы уже откликнулись на эту вакансию через hh.ru.'],
  hh_daily_limit_reached: [429, 'На сегодня отклики через hh.ru закончились. Завтра можно продолжить.'],
  hh_cooldown: [429, 'hh.ru просил проверку. Следующий отклик через hh.ru — через час.'],
};

function candidateOf(deps: BoundDeps, request: FastifyRequest, reply: FastifyReply): string | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  return principal.candidate.id;
}

const getResumes: Handler = async (deps, request, reply) => {
  const candidateId = candidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const snapshot = deps.hh.getSnapshot(candidateId);
  // B678: тексты остальных резюме нужны только сверке на сервере, в интерфейс они не уходят.
  const { contents: _contents, ...visible } = snapshot ?? { contents: undefined };
  return { data: snapshot ? visible : null, meta: { requestId: request.id } };
};

/** PUT без `contents` (выбор резюме) сохраняет прочитанное раньше для резюме, что остались в списке. */
function keptContents(previous: HhResumeSnapshot | null, listed: ReadonlySet<string>) {
  const kept = (previous?.contents ?? []).filter((content) => listed.has(content.id));
  return kept.length > 0 ? { contents: kept } : {};
}

const putResumes: Handler = async (deps, request, reply) => {
  const candidateId = candidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const parsed = snapshotSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return sendError(reply, request, 400, 'invalid_hh_resumes', 'Резюме hh.ru не прочитались. Повторите.', false);
  }
  const { contents, ...rest } = parsed.data;
  const listed = new Set(rest.resumes.map((item) => item.id));
  const snapshot: HhResumeSnapshot = {
    ...rest,
    ...(contents ? { contents } : keptContents(deps.hh.getSnapshot(candidateId), listed)),
    readAt: new Date().toISOString(),
  };
  deps.hh.saveSnapshot(candidateId, snapshot);
  const { contents: _contents, ...visible } = snapshot;
  return { data: visible, meta: { requestId: request.id } };
};

/** B678: какое из прочитанных резюме hh.ru подходит вакансии платформы и чего в каждом не хватает. */
const getReview: Handler = async (deps, request, reply) => {
  const candidateId = candidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const query = reviewQuerySchema.safeParse(request.query ?? {});
  if (!query.success) {
    return sendError(reply, request, 400, 'invalid_hh_review', 'Не указана вакансия.', false);
  }
  const snapshot = deps.hh.getSnapshot(candidateId);
  if (!snapshot) {
    const [status, message] = REFUSAL_REPLY.hh_resumes_not_read;
    return sendError(reply, request, status, 'hh_resumes_not_read', message, false);
  }
  const { vacancyId } = query.data;
  const cluster = resolvePoolVacancyCluster(deps.multiSourceEngine, vacancyId);
  if (!cluster) return sendError(reply, request, 404, 'vacancy_not_found', 'Вакансия не найдена.', false);
  const review = reviewHhResumes(snapshot, cluster.skills);
  return { data: { vacancyId, ...review }, meta: { requestId: request.id } };
};

const postAttempt: Handler = async (deps, request, reply) => {
  const candidateId = candidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const parsed = attemptSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return sendError(reply, request, 400, 'invalid_hh_apply', 'Подтвердите отклик и выберите резюме.', false);
  }
  const now = new Date();
  const { vacancyId, resumeId: chosen } = parsed.data;
  const gate = hhApplyGate({
    snapshot: deps.hh.getSnapshot(candidateId),
    resumeId: chosen,
    recent: deps.hh.recentAttempts(candidateId, now),
    forVacancy: deps.hh.attemptsFor(candidateId, vacancyId),
    now,
  });
  if (!gate.ok) {
    const [status, message] = REFUSAL_REPLY[gate.refusal];
    return sendError(reply, request, status, gate.refusal, message, false);
  }
  const attemptId = deps.hh.startAttempt(candidateId, { vacancyId, resumeId: chosen, now });
  return reply.status(201).send({
    data: { attemptId, remainingToday: gate.remainingToday },
    meta: { requestId: request.id },
  });
};

const postResult: Handler = async (deps, request, reply) => {
  const candidateId = candidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const { attemptId } = request.params as { attemptId: string };
  const parsed = resultSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return sendError(reply, request, 400, 'invalid_hh_apply_result', 'Исход отклика не записался.', false);
  }
  if (!deps.hh.getAttempt(candidateId, attemptId)) {
    return sendError(reply, request, 404, 'hh_apply_not_found', 'Такого отклика нет.', false);
  }
  const written = deps.hh.finishAttempt(candidateId, attemptId, {
    outcome: parsed.data.outcome,
    failureCode: parsed.data.failureCode ?? null,
    now: new Date(),
  });
  if (!written) {
    return sendError(reply, request, 409, 'hh_apply_finished', 'Исход этого отклика уже записан.', false);
  }
  return { data: { attemptId, outcome: parsed.data.outcome }, meta: { requestId: request.id } };
};

export function registerHhSessionRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const repository = new SqliteHhSessionRepository({
    databasePath: deps.config.databasePath,
    encryptionKey: deps.config.dataEncryptionKey,
  });
  app.addHook('onClose', async () => repository.close());
  const bound: BoundDeps = { ...deps, hh: repository };
  const write = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  const base = '/api/v1/candidate/hh';
  app.get(`${base}/resumes`, withDeps(bound, getResumes));
  app.put(`${base}/resumes`, write, withDeps(bound, putResumes));
  app.get(`${base}/resumes/review`, withDeps(bound, getReview));
  app.post(`${base}/applications`, write, withDeps(bound, postAttempt));
  app.post(`${base}/applications/:attemptId/result`, write, withDeps(bound, postResult));
}
