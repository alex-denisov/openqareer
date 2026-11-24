import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { MAX_TEXT_VARIANTS } from '../../shared/textVariants';
import {
  SqliteTextVariantRepository,
  type TextSubject,
} from '../candidate/sqliteTextVariantRepository';
import {
  SqliteContactMessageRepository,
  type StoredContactMessage,
} from '../data/sqliteContactMessageRepository';
import { normalizeWish, wishInstruction } from '../domain/textVariants';
import {
  CONTACT_MESSAGE_BASE,
  findRecipient,
  idSchema,
  messageUnit,
  notFound,
  session,
  vacancyIdSchema,
} from './b640ContactMessageRoutes';
import { writeContactMessageVariant, type MessageRecipient } from './b640ContactMessageText';
import type { RouteDeps } from './deps';
import { sendError } from './helpers';
import { requireTariffQuota } from './tariffQuotaGuard';
import { generationFailed, limitReached, wishSchema } from './textVariantRoutes';

const VARIANT_LIMIT = { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } };
const bodySchema = z
  .object({ wish: wishSchema.optional(), alsoVacancyId: vacancyIdSchema.optional() })
  .strict();

interface Stores {
  readonly messages: SqliteContactMessageRepository;
  readonly variants: SqliteTextVariantRepository;
}

interface Job {
  readonly subject: TextSubject;
  readonly message: StoredContactMessage;
  readonly recipient: MessageRecipient;
  readonly body: z.infer<typeof bodySchema>;
}

/** Проверки до вызова модели; `null` — ответ об отказе уже отправлен. */
function prepareJob(
  deps: RouteDeps,
  stores: Stores,
  request: FastifyRequest,
  reply: FastifyReply,
): Job | null {
  const candidate = session(deps, request, reply);
  if (!candidate) return null;
  const refuse = (status: number, code: string, text: string) => {
    sendError(reply, request, status, code, text, false);
    return null;
  };
  const body = bodySchema.safeParse(request.body ?? {});
  if (!body.success) return refuse(400, 'invalid_variant_request', 'Проверьте пожелание.');
  const id = idSchema.safeParse((request.params as { id?: string }).id);
  const message = id.success ? stores.messages.get(candidate.id, id.data) : null;
  if (!message) {
    notFound(request, reply);
    return null;
  }
  if (message.state === 'sent') {
    return refuse(409, 'message_already_sent', 'Сообщение уже отмечено отправленным.');
  }
  const subject = { candidateId: candidate.id, kind: 'message' as const, subjectId: message.id };
  if (stores.variants.count(subject) >= MAX_TEXT_VARIANTS) {
    limitReached(reply, request);
    return null;
  }
  const recipient = findRecipient(deps, request, reply, candidate.id, {
    contactId: message.contactId ?? undefined,
    recruiterId: message.recruiterId ?? undefined,
    vacancyId: message.vacancyId ?? undefined,
  });
  return recipient ? { subject, message, recipient, body: body.data } : null;
}

/** Черновик правит кандидат: кавычки и служебные символы не должны разрывать цитату в запросе. */
const quotable = (text: string) => text.replace(/[\p{Cc}\p{Cf}"«»“”]/gu, ' ').trim();

async function writeVariant(
  deps: RouteDeps,
  variants: SqliteTextVariantRepository,
  request: FastifyRequest,
  reply: FastifyReply,
  job: Job,
) {
  const { subject, message, recipient } = job;
  const { candidateId } = subject;
  // Единица квоты та же, что у самого сообщения: вариант новой не списывает.
  const unit = messageUnit(message);
  if (!requireTariffQuota(deps, request, reply, candidateId, 'applications', unit)) return reply;
  const wish = normalizeWish(job.body.wish);
  const text = await writeContactMessageVariant(deps, request, {
    candidateId,
    kind: message.kind,
    recipient,
    vacancyId: message.vacancyId,
    alsoVacancyId: job.body.alsoVacancyId ?? null,
    variantWish: `${wishInstruction(wish)}\nПрежний текст: «${quotable(message.text)}»`,
  });
  if (!text) return generationFailed(reply, request);
  const createdAt = new Date().toISOString();
  const variant = variants.add({ ...subject, text, wish, payload: null, createdAt });
  if (!variant) return limitReached(reply, request);
  return reply
    .code(201)
    .send({ data: { variant, ...variants.list(subject) }, meta: { requestId: request.id } });
}

/** B753: «Не отправлять» убирает черновик вместе с вариантами; отправленный остаётся. */
function discardDraft(deps: RouteDeps, stores: Stores, request: FastifyRequest, reply: FastifyReply) {
  const candidate = session(deps, request, reply);
  if (!candidate) return reply;
  const id = idSchema.safeParse((request.params as { id?: string }).id);
  const message = id.success ? stores.messages.get(candidate.id, id.data) : null;
  if (!message) return notFound(request, reply);
  if (!stores.messages.discard(candidate.id, message.id)) {
    return sendError(reply, request, 409, 'message_already_sent', 'Сообщение уже отмечено отправленным.', false);
  }
  stores.variants.removeAll({ candidateId: candidate.id, kind: 'message', subjectId: message.id });
  return reply.code(204).send();
}

function register(app: FastifyInstance, deps: RouteDeps, stores: Stores): void {
  // Один вариант на черновик за раз: параллельные запросы не обходят предел лишними вызовами модели.
  const inFlight = new Set<string>();
  app.delete(`${CONTACT_MESSAGE_BASE}/:id`, { config: { rateLimit: { max: 600, timeWindow: '1 hour' } } }, async (request, reply) =>
    discardDraft(deps, stores, request, reply),
  );
  app.post(`${CONTACT_MESSAGE_BASE}/:id/variants`, VARIANT_LIMIT, async (request, reply) => {
    const job = prepareJob(deps, stores, request, reply);
    if (!job) return reply;
    const flight = `${job.subject.candidateId}:${job.message.id}`;
    if (inFlight.has(flight)) {
      return sendError(reply, request, 409, 'variant_in_progress', 'Вариант уже собирается.', true);
    }
    inFlight.add(flight);
    try {
      return await writeVariant(deps, stores.variants, request, reply, job);
    } catch (error) {
      const failureType = error instanceof Error ? error.name : 'UnknownError';
      request.log.warn(
        { code: 'message_variant_failed', failureType },
        'b640-message-variant-failed',
      );
      return generationFailed(reply, request);
    } finally {
      inFlight.delete(flight);
    }
  });
}

/**
 * B682 (a02d, a02e): «Другой вариант» сообщения за флагом `cabinetB640`. Вариант хранится в общих
 * `text_variants` у черновика (до трёх); получателю ничего не уходит — текст одобряет кандидат.
 */
export function registerB640ContactMessageVariantRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): void {
  const { databasePath, dataEncryptionKey } = deps.config;
  const stores: Stores = {
    messages: new SqliteContactMessageRepository({ databasePath }),
    variants: new SqliteTextVariantRepository({ databasePath, encryptionKey: dataEncryptionKey }),
  };
  app.addHook('onClose', async () => {
    stores.messages.close();
    stores.variants.close();
  });
  register(app, deps, stores);
}
