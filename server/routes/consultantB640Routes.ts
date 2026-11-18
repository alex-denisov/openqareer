import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { coachTurnStageSchema } from '../domain/coach';
import { confirmConsultantFact } from '../orchestration/consultantFactConfirmation';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

/**
 * B688: консультант нового кабинета. «Новый разговор», продолжение закрытого
 * разговора, лента открытого разговора и «Верно» у записи из разговора через
 * историю профиля. Каждый маршрут начинается с `requireCabinetB640`: без флага
 * адреса отвечают как несуществующие. Прежние маршруты истории не меняются.
 */
type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const BASE = '/api/v1/candidate/consultant';
const conversationParams = z.object({ conversationId: z.string().uuid() }).strict();
const factParams = z.object({ memoryId: z.string().min(1).max(200) }).strict();
const currentQuery = z.object({ stage: coachTurnStageSchema }).strict();

function candidateId(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply): string | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  return principal.candidate.id;
}

const handleCurrent: Handler = async (deps, request, reply) => {
  const id = candidateId(deps, request, reply);
  if (!id) return reply;
  const query = currentQuery.safeParse(request.query);
  if (!query.success) return sendError(reply, request, 400, 'invalid_stage', 'Проверьте раздел.', false);
  const conversation = deps.candidateStore.currentConsultantConversation(id, query.data.stage);
  return { data: conversation, meta: { requestId: request.id } };
};

const handleClose: Handler = async (deps, request, reply) => {
  const id = candidateId(deps, request, reply);
  if (!id) return reply;
  const closedId = deps.candidateStore.closeConsultantConversation(id);
  return { data: { closedId }, meta: { requestId: request.id } };
};

const handleResume: Handler = async (deps, request, reply) => {
  const id = candidateId(deps, request, reply);
  if (!id) return reply;
  const params = conversationParams.safeParse(request.params);
  if (!params.success) return sendError(reply, request, 400, 'invalid_conversation_id', 'Проверьте идентификатор беседы.', false);
  const conversation = deps.candidateStore.resumeConsultantConversation(id, params.data.conversationId);
  if (!conversation) return sendError(reply, request, 404, 'conversation_not_found', 'Беседа не найдена.', false);
  return { data: conversation, meta: { requestId: request.id } };
};

const handleConfirmFact: Handler = async (deps, request, reply) => {
  const id = candidateId(deps, request, reply);
  if (!id) return reply;
  const params = factParams.safeParse(request.params);
  if (!params.success) return sendError(reply, request, 400, 'invalid_memory_id', 'Проверьте запись.', false);
  const result = confirmConsultantFact(deps.candidateStore, id, params.data.memoryId);
  if (result.state === 'not_found') return sendError(reply, request, 404, 'memory_not_found', 'Запись не найдена.', false);
  if (result.state === 'not_proposed') return sendError(reply, request, 409, 'memory_already_decided', 'По этой записи уже есть решение.', false);
  return { data: { changeId: result.changeId }, meta: { requestId: request.id } };
};

export function registerConsultantB640Routes(app: FastifyInstance, deps: RouteDeps): void {
  app.get(`${BASE}/current`, withDeps(deps, handleCurrent));
  app.post(`${BASE}/current/close`, withDeps(deps, handleClose));
  app.post(`${BASE}/conversations/:conversationId/resume`, withDeps(deps, handleResume));
  app.post(`${BASE}/facts/:memoryId/confirm`, withDeps(deps, handleConfirmFact));
}
