import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { MAX_TEXT_VARIANTS } from '../../shared/textVariants';
import { linkedinDraftsPerDay } from '../billing/linkedinDraftTariff';
import { collectDraftFacts } from '../candidate/draftFacts';
import type { CandidateDraft } from '../candidate/sqliteCandidateDraftRepository';
import {
  SqliteTextVariantRepository,
  type TextSubject,
} from '../candidate/sqliteTextVariantRepository';
import type { CandidateIdentity } from '../data/candidateStore';
import { normalizeWish, wishInstruction } from '../domain/textVariants';
import { requireCabinetB640 } from './cabinetB640Flag';
import { accountContext, type CandidateDraftRouteDeps } from './candidateDraftRoutes';
import { sendError } from './helpers';
import { generationFailed, limitReached, wishSchema } from './textVariantRoutes';

const ROUTE = '/api/v1/candidate/b640/linkedin/drafts/:id/variants';
const VARIANT_LIMIT = { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } };
const bodySchema = z.object({ wish: wishSchema.optional() }).strict();
const paramsSchema = z.object({ id: z.string().min(1).max(100) });

interface Job {
  readonly candidate: CandidateIdentity;
  readonly draft: CandidateDraft;
  readonly subject: TextSubject;
  readonly wish: z.infer<typeof wishSchema> | undefined;
}

function candidateOf(
  deps: CandidateDraftRouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): CandidateIdentity | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  return principal.candidate;
}

/**
 * Тариф для варианта: действующий план из биллинга (подписка, срок, пробный Pro), а не
 * `users.subscription_tier` — вариант не списывает квоту, и другой преграды у него нет.
 */
function effectiveTier(
  deps: CandidateDraftRouteDeps,
  request: FastifyRequest,
  candidate: CandidateIdentity,
): string {
  return (
    deps.billingRepository?.getEffectivePlanForCandidate(candidate.id, new Date().toISOString()) ??
    accountContext(deps, request, candidate).tier
  );
}

/** Текст варианта пишет та же цепочка моделей, что и черновик, с пожеланием кандидата. */
async function writeVariant(
  deps: CandidateDraftRouteDeps,
  variants: SqliteTextVariantRepository,
  request: FastifyRequest,
  reply: FastifyReply,
  job: Job,
) {
  if (!deps.linkedinDraftWriter) return generationFailed(reply, request);
  const { candidate, draft, subject } = job;
  const snapshot = deps.candidateStore.getSnapshot(candidate.id);
  const wish = normalizeWish(job.wish);
  const written = await deps.linkedinDraftWriter.writeDraft({
    kind: draft.kind,
    topic: draft.topic,
    profileHeadline: accountContext(deps, request, candidate).headline,
    facts: collectDraftFacts({ memory: snapshot.memory, resume: snapshot.resume }),
    variant: { instruction: wishInstruction(wish), previousText: draft.text },
  });
  const variant = variants.add({
    ...subject,
    text: written.text,
    wish,
    payload: null,
    createdAt: new Date().toISOString(),
  });
  if (!variant) return limitReached(reply, request);
  return reply
    .code(201)
    .send({ data: { variant, ...variants.list(subject) }, meta: { requestId: request.id } });
}

/** Проверки до вызова модели; `null` — ответ об отказе уже отправлен. */
function prepareJob(
  deps: CandidateDraftRouteDeps,
  variants: SqliteTextVariantRepository,
  request: FastifyRequest,
  reply: FastifyReply,
): Job | null {
  const refuse = (status: number, code: string, message: string) => {
    sendError(reply, request, status, code, message, false);
    return null;
  };
  const candidate = candidateOf(deps, request, reply);
  if (!candidate) return null;
  const params = paramsSchema.safeParse(request.params);
  const body = bodySchema.safeParse(request.body ?? {});
  if (!params.success || !body.success) {
    return refuse(400, 'invalid_variant_request', 'Проверьте пожелание.');
  }
  const draft = deps.candidateDraftRepository.find(candidate.id, params.data.id);
  if (!draft) return refuse(404, 'draft_not_found', 'Черновик не найден.');
  // Тариф тот же, что у черновика (B778, tariffQuotas.ts: Free/Basic — 0); месячную квоту вариант не расходует — предел три на текст.
  if (!linkedinDraftsPerDay(effectiveTier(deps, request, candidate), draft.kind)) {
    return refuse(402, 'paywall_required', 'Для этого черновика нужен другой тариф.');
  }
  const subject = { candidateId: candidate.id, kind: draft.kind, subjectId: draft.id };
  if (variants.count(subject) >= MAX_TEXT_VARIANTS) {
    limitReached(reply, request);
    return null;
  }
  return { candidate, draft, subject, wish: body.data.wish };
}

function register(
  app: FastifyInstance,
  deps: CandidateDraftRouteDeps,
  variants: SqliteTextVariantRepository,
): void {
  // Один вариант на черновик за раз: параллельные запросы не обходят предел лишними вызовами модели.
  const inFlight = new Set<string>();
  app.post(ROUTE, VARIANT_LIMIT, async (request, reply) => {
    const job = prepareJob(deps, variants, request, reply);
    if (!job) return reply;
    const flight = `${job.candidate.id}:${job.draft.id}`;
    if (inFlight.has(flight)) {
      return sendError(reply, request, 409, 'variant_in_progress', 'Вариант уже собирается.', true);
    }
    inFlight.add(flight);
    try {
      return await writeVariant(deps, variants, request, reply, job);
    } catch (error) {
      request.log.warn(
        {
          code: 'draft_variant_failed',
          failureType: error instanceof Error ? error.name : 'UnknownError',
          candidateId: job.candidate.id,
        },
        'b640-draft-variant-failed',
      );
      return generationFailed(reply, request);
    } finally {
      inFlight.delete(flight);
    }
  });
}

/**
 * B694 (a03b): «Другой вариант» поста за флагом `cabinetB640`. Вариант хранится в общих
 * `text_variants` у черновика (до трёх), список читает `GET /api/v1/candidate/text-variants`.
 * В LinkedIn ничего не уходит: выбранный текст кандидат одобряет и публикует сам.
 */
export function registerB640LinkedinDraftVariantRoutes(
  app: FastifyInstance,
  deps: CandidateDraftRouteDeps,
): void {
  const variants = new SqliteTextVariantRepository({
    databasePath: deps.config.databasePath,
    encryptionKey: deps.config.dataEncryptionKey,
  });
  app.addHook('onClose', async () => variants.close());
  register(app, deps, variants);
}
