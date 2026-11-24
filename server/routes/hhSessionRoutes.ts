import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  HH_APPLY_OUTCOMES,
  HH_RESUME_ID,
  HH_RESUME_TEXT_MAX_LENGTH,
  HH_RESUME_TITLE_MAX_LENGTH,
  HH_RESUMES_MAX,
  HH_SECTION_PLACES_MAX,
  HH_SECTION_SKILLS_MAX,
  HH_SECTION_TEXT_MAX_LENGTH,
  HH_REVIEW_RESUMES_MAX,
  HH_REVIEW_TEXT_MAX_LENGTH,
  HH_VACANCY_ID,
  type HhResumeEdit,
  type HhResumeSnapshot,
} from '../../shared/hhCandidateSession';
import { SqliteHhSessionRepository } from '../candidate/sqliteHhSessionRepository';
import { hhApplyGate, type HhApplyRefusal } from '../domain/hhApplyGate';
import { draftHhResumeEdits, hhResumeLanguage } from '../domain/hhResumeEdits';
import { localizeHhResumeEdits } from '../domain/hhResumeEditTranslation';
import { hasVariants, hhResumeVariantSubject } from '../domain/hhResumeVariant';
import { reviewHhResumes } from '../domain/hhResumeReview';
import { cachedEdits, editsCacheKey, hhEditsInput, rememberEdits, readWithSections, selectedWithSections, type SelectedWithSections } from './hhResumeEditsInput';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import { resolvePoolVacancyCluster } from '../vacancies/poolVacancyCluster';
import { resolveHhLoginNotice } from './b640HhSessionState';
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

const sectionText = z.string().trim().max(HH_SECTION_TEXT_MAX_LENGTH);
const sectionsSchema = z
  .object({
    title: z.string().trim().max(HH_RESUME_TITLE_MAX_LENGTH),
    about: sectionText,
    skills: z.array(z.string().trim().min(1).max(200)).max(HH_SECTION_SKILLS_MAX),
    places: z
      .array(
        z
          .object({ employer: z.string().trim().max(300), title: z.string().trim().max(300), period: z.string().trim().max(120), text: sectionText })
          .strict(),
      )
      .max(HH_SECTION_PLACES_MAX),
  })
  .strict();

const contentSchema = z
  .object({ id: resumeId, title, text: z.string().trim().min(1).max(HH_RESUME_TEXT_MAX_LENGTH), sections: sectionsSchema.optional() })
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
    /** B704: `false` — выбор из прочитанного раньше, hh.ru не читали. */
    contentRead: z.literal(false).optional(),
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

/** `edits=1` — лист выбора резюме: счёт правок может звать переводчика, карточке вакансии он не нужен. */
const reviewCountsSchema = reviewQuerySchema.extend({ edits: z.literal('1').optional() });

const attemptSchema = z
  .object({ vacancyId: z.string().regex(HH_VACANCY_ID), resumeId, confirmed: z.literal(true) })
  .strict();

const resultSchema = z
  .object({
    outcome: z.enum(HH_APPLY_OUTCOMES),
    failureCode: z.string().regex(/^[a-z0-9_]{1,64}$/u).optional(),
    /** B708: вакансия, на странице которой виден отклик, завершённый кандидатом в окне hh.ru. */
    vacancyId: z.string().regex(HH_VACANCY_ID).optional(),
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

export function hhCandidateOf(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply): string | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  return principal.candidate.id;
}

const getResumes: Handler = async (deps, request, reply) => {
  const candidateId = hhCandidateOf(deps, request, reply);
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
  const candidateId = hhCandidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const parsed = snapshotSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return sendError(reply, request, 400, 'invalid_hh_resumes', 'Резюме hh.ru не прочитались. Повторите.', false);
  }
  const { contents, contentRead, ...rest } = parsed.data;
  const previous = deps.hh.getSnapshot(candidateId);
  // B704: дата чтения меняется, только когда прочитано содержимое, а не выбор и не список.
  const read = contentRead !== false && contents?.length !== 0;
  const listed = new Set(rest.resumes.map((item) => item.id));
  const snapshot: HhResumeSnapshot = {
    ...rest,
    ...(contents ? { contents } : keptContents(previous, listed)),
    readAt: (read ? null : previous?.readAt) ?? new Date().toISOString(),
  };
  deps.hh.saveSnapshot(candidateId, snapshot);
  // B690: резюме прочитаны в окне hh.ru — вход жив, уведомление «вход истёк» больше не нужно.
  resolveHhLoginNotice(deps, request, candidateId);
  const { contents: _contents, ...visible } = snapshot;
  return { data: visible, meta: { requestId: request.id } };
};

/** B678: какое из прочитанных резюме hh.ru подходит вакансии платформы и чего в каждом не хватает. */
const getReview: Handler = async (deps, request, reply) => {
  const candidateId = hhCandidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const query = reviewCountsSchema.safeParse(request.query ?? {});
  if (!query.success) {
    return sendError(reply, request, 400, 'invalid_hh_review', 'Не указана вакансия.', false);
  }
  const snapshot = deps.hh.getSnapshot(candidateId);
  if (!snapshot) {
    const [status, message] = REFUSAL_REPLY.hh_resumes_not_read;
    return sendError(reply, request, status, 'hh_resumes_not_read', message, false);
  }
  const { vacancyId, edits } = query.data;
  const cluster = resolvePoolVacancyCluster(deps.multiSourceEngine, vacancyId);
  if (!cluster) return sendError(reply, request, 404, 'vacancy_not_found', 'Вакансия не найдена.', false);
  const review = reviewHhResumes(snapshot, cluster.skills);
  if (!edits) return { data: { vacancyId, ...review }, meta: { requestId: request.id } };
  const counts = await editCounts(deps, candidateId, snapshot, cluster, vacancyId);
  const resumes = review.resumes.map((fit) => {
    const editCount = counts.get(fit.resumeId);
    return editCount === undefined ? fit : { ...fit, editCount };
  });
  return { data: { vacancyId, ...review, resumes }, meta: { requestId: request.id } };
};

/** На перевод «станет» на язык резюме — не дольше, чем кандидат ждёт открытия разбора. */
const EDITS_TRANSLATION_BUDGET_MS = 8_000;
const RESUMES_BODY_LIMIT = 1_048_576;

async function freshEdits(
  deps: RouteDeps,
  candidateId: string,
  snapshot: HhResumeSnapshot,
  selected: SelectedWithSections,
  cluster: VacancyCluster,
): Promise<HhResumeEdit[]> {
  const drafts = draftHhResumeEdits(hhEditsInput(deps, candidateId, snapshot, selected, cluster));
  const language = hhResumeLanguage(selected.sections);
  return localizeHhResumeEdits(drafts, language, deps.experienceFactRewriter, EDITS_TRANSLATION_BUDGET_MS);
}

export async function hhResumeEditsOf(
  deps: RouteDeps,
  candidateId: string,
  snapshot: HhResumeSnapshot,
  resume: SelectedWithSections,
  cluster: VacancyCluster,
  vacancyId: string,
): Promise<readonly HhResumeEdit[]> {
  const key = editsCacheKey(candidateId, snapshot, resume, vacancyId);
  const edits = cachedEdits(key) ?? (await freshEdits(deps, candidateId, snapshot, resume, cluster));
  rememberEdits(key, edits);
  return edits;
}

/** B682: ключ вариантов у правок с «Другим вариантом»; считается по правке до перевода. */
export function withVariantSubjects(
  deps: RouteDeps,
  candidateId: string,
  snapshot: HhResumeSnapshot,
  resume: SelectedWithSections,
  cluster: VacancyCluster,
  vacancyId: string,
  edits: readonly HhResumeEdit[],
): HhResumeEdit[] {
  const drafts = draftHhResumeEdits(hhEditsInput(deps, candidateId, snapshot, resume, cluster));
  const subjects = new Map(drafts.filter(hasVariants).map((draft) => [draft.id, hhResumeVariantSubject(vacancyId, resume.id, draft)]));
  return edits.map((edit) => {
    const subjectId = subjects.get(edit.id);
    return subjectId ? { ...edit, variantOf: { vacancyId, subjectId } } : edit;
  });
}

/** Число правок у каждого прочитанного резюме — то же, что откроет разбор; сбой одного сверку не роняет. */
async function editCounts(
  deps: BoundDeps,
  candidateId: string,
  snapshot: HhResumeSnapshot,
  cluster: VacancyCluster,
  vacancyId: string,
): Promise<ReadonlyMap<string, number>> {
  const counted = await Promise.allSettled(
    readWithSections(snapshot).map(async (resume) => {
      const edits = await hhResumeEditsOf(deps, candidateId, snapshot, resume, cluster, vacancyId);
      return [resume.id, edits.length] as const;
    }),
  );
  return new Map(counted.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])));
}

/** B678: правки выбранного резюме hh.ru «было → станет» по подтверждённому профилю платформы. */
const getEdits: Handler = async (deps, request, reply) => {
  const candidateId = hhCandidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const query = reviewQuerySchema.safeParse(request.query ?? {});
  if (!query.success) return sendError(reply, request, 400, 'invalid_hh_review', 'Не указана вакансия.', false);
  const snapshot = deps.hh.getSnapshot(candidateId);
  const selected = selectedWithSections(snapshot);
  if (!snapshot || !selected) {
    return sendError(reply, request, 409, 'hh_resume_sections_missing', 'Выберите резюме hh.ru ещё раз: его разделы не прочитаны.', false);
  }
  const cluster = resolvePoolVacancyCluster(deps.multiSourceEngine, query.data.vacancyId);
  if (!cluster) return sendError(reply, request, 404, 'vacancy_not_found', 'Вакансия не найдена.', false);
  const { vacancyId } = query.data;
  const found = await hhResumeEditsOf(deps, candidateId, snapshot, selected, cluster, vacancyId);
  const edits = withVariantSubjects(deps, candidateId, snapshot, selected, cluster, vacancyId, found);
  return { data: { resumeId: selected.id, vacancyId, edits }, meta: { requestId: request.id } };
};

const postAttempt: Handler = async (deps, request, reply) => {
  const candidateId = hhCandidateOf(deps, request, reply);
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
  const candidateId = hhCandidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const { attemptId } = request.params as { attemptId: string };
  const parsed = resultSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return sendError(reply, request, 400, 'invalid_hh_apply_result', 'Исход отклика не записался.', false);
  }
  const stored = deps.hh.getAttempt(candidateId, attemptId);
  if (!stored) {
    return sendError(reply, request, 404, 'hh_apply_not_found', 'Такого отклика нет.', false);
  }
  const { outcome, failureCode, vacancyId } = parsed.data;
  const now = new Date();
  const otherVacancy = vacancyId !== undefined && vacancyId !== stored.vacancyId;
  const written =
    !otherVacancy &&
    (deps.hh.finishAttempt(candidateId, attemptId, { outcome, failureCode: failureCode ?? null, now }) ||
      (outcome === 'sent' &&
        vacancyId !== undefined &&
        deps.hh.markSentLater(candidateId, attemptId, { vacancyId, now })));
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
  // Снимок с разделами и текстами до 5 резюме кириллицей (2 байта на символ) больше общего предела 256 КБ.
  app.put(`${base}/resumes`, { ...write, bodyLimit: RESUMES_BODY_LIMIT }, withDeps(bound, putResumes));
  app.get(`${base}/resumes/review`, withDeps(bound, getReview));
  app.get(`${base}/resumes/edits`, withDeps(bound, getEdits));
  app.post(`${base}/applications`, write, withDeps(bound, postAttempt));
  app.post(`${base}/applications/:attemptId/result`, write, withDeps(bound, postResult));
}
