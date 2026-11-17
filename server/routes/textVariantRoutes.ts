import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  MAX_TEXT_VARIANTS,
  TEXT_VARIANT_KINDS,
  VARIANT_WISH_CHIPS,
  VARIANT_WISH_MAX_LENGTH,
  type LetterVariantPayload,
} from '../../shared/textVariants';
import { SqliteTextVariantRepository } from '../candidate/sqliteTextVariantRepository';
import { normalizeWish, wishInstruction } from '../domain/textVariants';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';
import {
  pitchSourceId,
  resolvePitchVacancy,
  vacancyPitchInputSchema,
  writeVacancyPitch,
} from './vacancyPitchRoutes';

/**
 * B682: «Другой вариант» для нового кабинета. Маршруты начинаются с `requireCabinetB640`.
 * Вариант письма собирается тем же путём, что и письмо, с пожеланием кандидата в запросе.
 * Квоту откликов маршрут не трогает: предел — три варианта на текст — держит хранилище.
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
const letterVariantSchema = z
  .object({ wish: wishSchema.optional(), letter: vacancyPitchInputSchema })
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

/** Данные варианта письма: из них экран собирает текст для выбранного адресата. */
function letterPayload(pitch: Awaited<ReturnType<typeof writeVacancyPitch>>['pitch']): LetterVariantPayload {
  return {
    emailPitch: pitch.emailPitch,
    ...(pitch.contactMessage ? { contactMessage: pitch.contactMessage } : {}),
    ...(pitch.senderName ? { senderName: pitch.senderName } : {}),
    ...(pitch.senderFirstName ? { senderFirstName: pitch.senderFirstName } : {}),
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

  const { multiSourceEngine } = deps;
  const loaded = await multiSourceEngine.loadVacancyDescription(pitchSourceId(vacancyId));
  const vacancy = resolvePitchVacancy(
    parsed.data.letter,
    vacancyId,
    multiSourceEngine.getActiveCluster(vacancyId),
    loaded.vacancy ?? multiSourceEngine.getVacancy?.(pitchSourceId(vacancyId)),
  );
  if (!vacancy.title) {
    return sendError(reply, request, 404, 'vacancy_not_found', 'Вакансия не найдена.', false);
  }
  const wish = normalizeWish(parsed.data.wish);
  const result = await writeVacancyPitch(
    deps,
    request,
    candidateId,
    parsed.data.letter,
    { ...vacancy, title: vacancy.title },
    wishInstruction(wish),
  );
  // Другой вариант пишет только модель: шаблон дал бы тот же текст.
  if (!result.written.body) {
    return sendError(reply, request, 503, 'variant_generation_failed', 'Не удалось подготовить другой вариант. Попробуйте ещё раз.', true);
  }
  const payload = letterPayload(result.pitch);
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
};

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
