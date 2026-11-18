import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  MAX_TEXT_VARIANTS,
  TEXT_VARIANT_KINDS,
  VARIANT_WISH_CHIPS,
  VARIANT_WISH_MAX_LENGTH,
  type LetterVariantPayload,
} from '../../shared/textVariants';
import {
  SqliteTextVariantRepository,
  type TextSubject,
} from '../candidate/sqliteTextVariantRepository';
import { normalizeWish, wishInstruction } from '../domain/textVariants';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';
import { requireTariffQuota } from './tariffQuotaGuard';
import {
  pitchSourceId,
  resolvePitchVacancy,
  writeVacancyPitch,
} from './vacancyPitchRoutes';

/**
 * B682: «Другой вариант» для нового кабинета. Маршруты начинаются с `requireCabinetB640`.
 * Вариант письма собирается тем же путём, что и письмо, с пожеланием кандидата в запросе.
 * Вариант стоит на единице квоты самого письма и новых не списывает. Сохраняется не больше
 * трёх вариантов на текст; одновременно для одного текста собирается один вариант.
 */
export type TextVariantRouteDeps = RouteDeps & {
  readonly textVariantRepository?: SqliteTextVariantRepository;
};

type BoundDeps = RouteDeps & { readonly variants: SqliteTextVariantRepository };
type Handler = (deps: BoundDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const SUBJECT_ID_MAX_LENGTH = 200;
const wishSchema = z
  .object({
    chips: z.array(z.enum(VARIANT_WISH_CHIPS)).max(VARIANT_WISH_CHIPS.length).optional(),
    text: z.string().max(VARIANT_WISH_MAX_LENGTH).optional(),
  })
  .strict();
const listQuerySchema = z
  .object({
    kind: z.enum(TEXT_VARIANT_KINDS),
    subjectId: z.string().min(1).max(SUBJECT_ID_MAX_LENGTH),
  })
  .strict();
/**
 * Параметры письма для варианта. Описание вакансии из запроса не принимается: вариант
 * пишется только к вакансии, которую сервер знает сам.
 */
const letterInputSchema = z
  .object({
    tone: z.enum(['executive', 'confident', 'technical']).optional(),
    language: z.enum(['en', 'ru']).optional(),
    recipient: z
      .object({
        name: z.string().trim().min(1).max(200).optional(),
        role: z.string().trim().max(200).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const letterVariantSchema = z
  .object({ wish: wishSchema.optional(), letter: letterInputSchema.optional() })
  .strict();

function candidateOf(deps: BoundDeps, request: FastifyRequest, reply: FastifyReply): string | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  return principal.candidate.id;
}

const listVariants: Handler = async (deps, request, reply) => {
  const candidateId = candidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const parsed = listQuerySchema.safeParse(request.query ?? {});
  if (!parsed.success) {
    return sendError(reply, request, 400, 'invalid_variant_subject', 'Проверьте текст.', false);
  }
  return {
    data: deps.variants.list({ candidateId, ...parsed.data }),
    meta: { requestId: request.id },
  };
};

function limitReached(reply: FastifyReply, request: FastifyRequest) {
  return sendError(
    reply,
    request,
    409,
    'variant_limit_reached',
    `У этого текста уже ${MAX_TEXT_VARIANTS} других варианта.`,
    false,
  );
}

/**
 * Данные варианта письма. Шаблонный текст «для знакомого» сюда не кладётся: у варианта
 * один текст — тот, что написала модель с учётом адресата.
 */
function letterPayload(
  pitch: Awaited<ReturnType<typeof writeVacancyPitch>>['pitch'],
  recipientName: string | undefined,
): LetterVariantPayload {
  return {
    emailPitch: pitch.emailPitch,
    ...(recipientName ? { recipientName } : {}),
    ...(pitch.senderName ? { senderName: pitch.senderName } : {}),
    ...(pitch.senderFirstName ? { senderFirstName: pitch.senderFirstName } : {}),
    usedEvidenceIds: pitch.usedEvidenceIds,
  };
}

const createLetterVariant: Handler = async (deps, request, reply) => {
  const candidateId = candidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const vacancyId = (request.params as { id: string }).id;
  const parsed = letterVariantSchema.safeParse(request.body ?? {});
  if (!vacancyId || vacancyId.length > SUBJECT_ID_MAX_LENGTH || !parsed.success) {
    return sendError(reply, request, 400, 'invalid_variant_request', 'Проверьте пожелание.', false);
  }
  const subject = { candidateId, kind: 'letter' as const, subjectId: vacancyId };
  // Проверяем предел до вызова модели: четвёртый вариант не собирается вовсе.
  if (deps.variants.count(subject) >= MAX_TEXT_VARIANTS) return limitReached(reply, request);

  const letter = parsed.data.letter ?? {};
  // Один вариант на текст за раз: параллельные запросы не обходят предел лишними вызовами модели.
  const flight = `${candidateId}:${vacancyId}`;
  if (inFlight.has(flight)) {
    return sendError(reply, request, 409, 'variant_in_progress', 'Вариант уже собирается.', true);
  }
  inFlight.add(flight);
  try {
    return await writeLetterVariant(deps, request, reply, { subject, vacancyId, letter, wish: parsed.data.wish });
  } catch (error) {
    request.log.warn({ err: error }, 'letter_variant_failed');
    return generationFailed(reply, request);
  } finally {
    inFlight.delete(flight);
  }
};

const inFlight = new Set<string>();

function generationFailed(reply: FastifyReply, request: FastifyRequest) {
  return sendError(reply, request, 503, 'variant_generation_failed', 'Не удалось подготовить другой вариант. Попробуйте ещё раз.', true);
}

interface VariantJob {
  readonly subject: TextSubject;
  readonly vacancyId: string;
  readonly letter: z.infer<typeof letterInputSchema>;
  readonly wish: z.infer<typeof wishSchema> | undefined;
}

async function writeLetterVariant(
  deps: BoundDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  job: VariantJob,
) {
  const { subject, vacancyId, letter } = job;
  const candidateId = subject.candidateId;
  const { multiSourceEngine } = deps;
  const loaded = await multiSourceEngine.loadVacancyDescription(pitchSourceId(vacancyId));
  const cluster = multiSourceEngine.getActiveCluster(vacancyId);
  const poolVacancy = loaded.vacancy ?? multiSourceEngine.getVacancy?.(pitchSourceId(vacancyId));
  const vacancy = resolvePitchVacancy(letter, vacancyId, cluster, poolVacancy);
  if ((!cluster && !poolVacancy) || !vacancy.title) {
    return sendError(reply, request, 404, 'vacancy_not_found', 'Вакансия не найдена.', false);
  }
  // Вариант стоит на той же единице квоты, что и письмо к вакансии: повтор к ней бесплатен,
  // а без письма единица списывается, как у первого письма. При сбое единица не возвращается.
  if (!requireTariffQuota(deps, request, reply, candidateId, 'applications', vacancyId)) return reply;
  const wish = normalizeWish(job.wish);
  const result = await writeVacancyPitch(
    deps,
    request,
    candidateId,
    letter,
    { ...vacancy, title: vacancy.title },
    wishInstruction(wish),
  );
  // Другой вариант пишет только модель: шаблон дал бы тот же текст.
  if (!result.written.body) return generationFailed(reply, request);
  const payload = letterPayload(result.pitch, letter.recipient?.name);
  const variant = deps.variants.add({
    ...subject,
    text: result.pitch.emailPitch.body,
    wish,
    payload,
    createdAt: new Date().toISOString(),
  });
  if (!variant) return limitReached(reply, request);
  return reply.code(201).send({
    data: { variant, ...deps.variants.list(subject) },
    meta: { requestId: request.id },
  });
}

export function registerTextVariantRoutes(app: FastifyInstance, deps: TextVariantRouteDeps): void {
  const repository =
    deps.textVariantRepository ??
    new SqliteTextVariantRepository({
      databasePath: deps.config.databasePath,
      encryptionKey: deps.config.dataEncryptionKey,
    });
  if (!deps.textVariantRepository) app.addHook('onClose', async () => repository.close());
  const bound: BoundDeps = { ...deps, variants: repository };
  app.get('/api/v1/candidate/text-variants', withDeps(bound, listVariants));
  app.post(
    '/api/v1/candidate/vacancies/:id/pitch/variants',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    withDeps(bound, createLetterVariant),
  );
}
