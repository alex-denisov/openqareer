import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  B640_OFFER_DECISIONS,
  B640_TAX_PERCENT_MAX,
  type B640OfferDecisionResult,
  type B640OfferView,
} from '../../shared/b640Offers';
import { SqliteCandidateStatusRepository } from '../candidate/sqliteCandidateStatusRepository';
import { SqliteB640OfferChoiceRepository } from '../data/sqliteB640OfferChoiceRepository';
import type { StoredApplicationOffer } from '../data/sqliteApplicationOfferRepository';
import { ApplicationNotFoundError } from '../data/store/errors';
import { buildOfferView, summarizeResponses } from '../domain/b640Offers';
import { sessionCandidate } from './b640VacancyContext';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

const BASE = '/api/v1/candidate/b640';
const taxSchema = z
  .object({ taxPercent: z.number().min(0).max(B640_TAX_PERCENT_MAX).nullable() })
  .strict();
const decisionSchema = z.object({ decision: z.enum(B640_OFFER_DECISIONS) }).strict();
const originSchema = z.object({ origin: z.enum(['auto', 'manual']).optional() });
const applicationIdSchema = z.string().trim().min(1).max(120);

interface Ctx {
  readonly deps: RouteDeps;
  readonly choices: SqliteB640OfferChoiceRepository;
  readonly statuses: SqliteCandidateStatusRepository;
}
type Handler = (ctx: Ctx, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

function candidateOf(ctx: Ctx, request: FastifyRequest, reply: FastifyReply): string | null {
  const principal = requireCabinetB640(request, reply, ctx.deps);
  if (!principal) return null;
  return sessionCandidate(request, reply, principal.candidate)?.id ?? null;
}

/** Чужой или несуществующий отклик хранилище отвечает ошибкой; для маршрута это то же «оффера нет». */
function ownOffer(
  store: RouteDeps['candidateStore'],
  candidateId: string,
  applicationId: string,
): StoredApplicationOffer | null {
  try {
    return store.getApplicationOffer(candidateId, applicationId);
  } catch (error) {
    if (error instanceof ApplicationNotFoundError) return null;
    throw error;
  }
}

function offerView(ctx: Ctx, candidateId: string, applicationId: string): B640OfferView | null {
  const { candidateStore } = ctx.deps;
  const offer = ownOffer(candidateStore, candidateId, applicationId);
  if (!offer) return null;
  return buildOfferView({
    applicationId,
    terms: offer.terms,
    respondBy: offer.respondBy,
    choice: ctx.choices.get(candidateId, applicationId),
    now: new Date(),
  });
}

function offerNotFound(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendError(reply, request, 404, 'offer_not_found', 'Оффер по этому отклику не найден.', false);
}

function invalidBody(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendError(reply, request, 400, 'invalid_body', 'Проверьте введённые значения.', false);
}

const getSummary: Handler = async (ctx, request, reply) => {
  const candidateId = candidateOf(ctx, request, reply);
  if (!candidateId) return reply;
  const query = originSchema.safeParse(request.query ?? {});
  if (!query.success) return sendError(reply, request, 400, 'invalid_query', 'Неверный параметр origin.', false);
  const applications = ctx.deps.candidateStore.listApplications(candidateId);
  const summary = summarizeResponses(applications, ctx.choices.autoApplicationIds(candidateId));
  const data =
    query.data.origin === 'manual' ? { ...summary, autoApplicationIds: [] } : summary;
  reply.header('Cache-Control', 'no-store');
  return { data, meta: { requestId: request.id } };
};

const getOffers: Handler = async (ctx, request, reply) => {
  const candidateId = candidateOf(ctx, request, reply);
  if (!candidateId) return reply;
  const choices = ctx.choices.listFor(candidateId);
  const now = new Date();
  const data = ctx.deps.candidateStore.listApplicationOffers(candidateId).map((offer) =>
    buildOfferView({
      applicationId: offer.applicationId,
      terms: offer.terms,
      respondBy: offer.respondBy,
      choice: choices.get(offer.applicationId) ?? null,
      now,
    }),
  );
  reply.header('Cache-Control', 'no-store');
  return { data, meta: { requestId: request.id } };
};

const putTax: Handler = async (ctx, request, reply) => {
  const candidateId = candidateOf(ctx, request, reply);
  if (!candidateId) return reply;
  const id = applicationIdSchema.safeParse((request.params as { applicationId: string }).applicationId);
  const body = taxSchema.safeParse(request.body);
  if (!id.success || !body.success) return invalidBody(request, reply);
  if (!offerView(ctx, candidateId, id.data)) return offerNotFound(request, reply);
  ctx.choices.setTax(candidateId, id.data, body.data.taxPercent, new Date().toISOString());
  return { data: offerView(ctx, candidateId, id.data), meta: { requestId: request.id } };
};

const putDecision: Handler = async (ctx, request, reply) => {
  const candidateId = candidateOf(ctx, request, reply);
  if (!candidateId) return reply;
  const id = applicationIdSchema.safeParse((request.params as { applicationId: string }).applicationId);
  const body = decisionSchema.safeParse(request.body);
  if (!id.success || !body.success) return invalidBody(request, reply);
  if (!offerView(ctx, candidateId, id.data)) return offerNotFound(request, reply);
  ctx.choices.setDecision(candidateId, id.data, body.data.decision, new Date().toISOString());
  const alreadyWorking = ctx.statuses.current(candidateId)?.status === 'working';
  const data: B640OfferDecisionResult = {
    offer: offerView(ctx, candidateId, id.data) as B640OfferView,
    proposeStatus: body.data.decision === 'accepted' && !alreadyWorking ? 'working' : null,
  };
  return { data, meta: { requestId: request.id } };
};

/** B680: отклики (авто и ручные отдельно) и офферы кабинета B640; все маршруты за флагом. */
export function registerB640OfferRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const choices = new SqliteB640OfferChoiceRepository({ databasePath: deps.config.databasePath });
  const statuses = new SqliteCandidateStatusRepository({
    databasePath: deps.config.databasePath,
    encryptionKey: deps.config.dataEncryptionKey,
  });
  app.addHook('onClose', async () => {
    choices.close();
    statuses.close();
  });
  const ctx: Ctx = { deps, choices, statuses };
  const bind = (handler: Handler) =>
    withDeps(deps, (_deps, request, reply) => handler(ctx, request, reply));
  const write = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  app.get(`${BASE}/responses/summary`, bind(getSummary));
  app.get(`${BASE}/offers`, bind(getOffers));
  app.put(`${BASE}/offers/:applicationId/tax`, write, bind(putTax));
  app.put(`${BASE}/offers/:applicationId/decision`, write, bind(putDecision));
}
