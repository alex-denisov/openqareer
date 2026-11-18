import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { OWN_VACANCY_LINK_MAX, OWN_VACANCY_TEXT_MAX, OWN_VACANCY_TEXT_MIN } from '../../shared/b640OwnVacancy';
import { SqliteOwnVacancyStore } from '../data/sqliteOwnVacancyStore';
import { createOwnVacancy } from '../vacancies/ownVacancy/createOwnVacancy';
import { forgetOwnVacancyComparison, ownVacancyDetail, ownVacancySummary } from '../vacancies/ownVacancy/ownVacancyComparison';
import { sessionCandidate } from './b640VacancyContext';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

/** B676: «Своя вакансия» — создать по ссылке или тексту, список, карточка, удаление. Все за флагом. */
const BASE = '/api/v1/candidate/b640/own-vacancies';
const BODY_LIMIT = 64 * 1024;
const ID = /^own-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const linkSchema = z.string().trim().max(OWN_VACANCY_LINK_MAX).refine((value) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
});
const bodySchema = z.union([
  z.object({ link: linkSchema }).strict(),
  z.object({ text: z.string().trim().min(OWN_VACANCY_TEXT_MIN).max(OWN_VACANCY_TEXT_MAX) }).strict(),
]);

const stores = new WeakMap<object, SqliteOwnVacancyStore>();
function storeOf(deps: RouteDeps): SqliteOwnVacancyStore | null {
  const runtime = deps.vacancyMechanics;
  if (!runtime) return null;
  const known = stores.get(runtime);
  if (known) return known;
  const store = new SqliteOwnVacancyStore(runtime.database, deps.config.dataEncryptionKey);
  stores.set(runtime, store);
  return store;
}

type Gate = { readonly candidateId: string; readonly store: SqliteOwnVacancyStore } | null;
function gate(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply): Gate {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  const candidate = sessionCandidate(request, reply, principal.candidate);
  if (!candidate) return null;
  const store = storeOf(deps);
  if (!store) {
    sendError(reply, request, 503, 'own_vacancy_unavailable', 'Проверка вакансии сейчас недоступна.', true);
    return null;
  }
  reply.header('Cache-Control', 'private, no-store');
  return { candidateId: candidate.id, store };
}

function meta(request: FastifyRequest) {
  return { requestId: request.id };
}

async function postOwnVacancy(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const context = gate(deps, request, reply);
  if (!context) return reply;
  const body = bodySchema.safeParse(request.body);
  if (!body.success) return sendError(reply, request, 400, 'invalid_own_vacancy', 'Вставьте ссылку или текст вакансии.', false);
  const data = await createOwnVacancy(deps, context.store, context.candidateId, body.data);
  return { data, meta: meta(request) };
}

function listOwnVacancies(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const context = gate(deps, request, reply);
  if (!context) return reply;
  const data = context.store.list(context.candidateId).map((record) => ownVacancySummary(deps, context.candidateId, record));
  return { data, meta: meta(request) };
}

function recordOf(context: NonNullable<Gate>, request: FastifyRequest) {
  const id = (request.params as { id?: string }).id ?? '';
  return ID.test(id) ? context.store.get(context.candidateId, id) : undefined;
}

function notFound(request: FastifyRequest, reply: FastifyReply) {
  return sendError(reply, request, 404, 'own_vacancy_not_found', 'Вакансия не найдена.', false);
}

function getOwnVacancy(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const context = gate(deps, request, reply);
  if (!context) return reply;
  const record = recordOf(context, request);
  if (!record) return notFound(request, reply);
  return { data: ownVacancyDetail(deps, context.candidateId, record), meta: meta(request) };
}

function deleteOwnVacancy(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const context = gate(deps, request, reply);
  if (!context) return reply;
  const record = recordOf(context, request);
  if (!record || !context.store.delete(context.candidateId, record.id)) return notFound(request, reply);
  forgetOwnVacancyComparison(deps, context.candidateId, record);
  return reply.code(204).send();
}

export function registerB640OwnVacancyRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post(BASE, { bodyLimit: BODY_LIMIT }, withDeps(deps, postOwnVacancy));
  app.get(BASE, withDeps(deps, listOwnVacancies));
  app.get(`${BASE}/:id`, withDeps(deps, getOwnVacancy));
  app.delete(`${BASE}/:id`, withDeps(deps, deleteOwnVacancy));
}
