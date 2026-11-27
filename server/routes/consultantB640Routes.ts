import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ConsultantReplyExtras } from '../../shared/consultantReply';
import { coachTurnStageSchema } from '../domain/coach';
import { factCorrectionProposals } from '../domain/factCorrectionProposals';
import { replyExtrasOf } from '../domain/consultantReplyExtras';
import { resumeEditRequest } from '../domain/resumeEditRequest';
import { confirmConsultantFact } from '../orchestration/consultantFactConfirmation';
import { requireCabinetB640 } from './cabinetB640Flag';
import { withStaleAnalysis } from './coachTurnAnalysis';
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
  const data = conversation ? { ...conversation, ...replyExtras(deps, id, conversation.id, conversation.messages) } : null;
  return { data, meta: { requestId: request.id } };
};

interface ReplyExtrasData {
  readonly replies: ConsultantReplyExtras[];
  /** Разбор эксперта и стратега ещё идёт фоном: действия под ответом придут позже. */
  readonly analysisPending: boolean;
}

/** Действия и ссылки под ответами открытого разговора; реплики без них не перечисляются. */
interface ThreadMessage {
  readonly id: string;
  readonly role: string;
  readonly content: string;
}

/** Вопрос кандидата перед этой репликой. */
function askedBefore(messages: readonly ThreadMessage[], messageId: string | undefined): string | null {
  const index = messages.findIndex(({ id }) => id === messageId);
  const asked = messages
    .slice(0, Math.max(0, index))
    .filter(({ role }) => role === 'user')
    .at(-1);
  return asked?.content ?? null;
}

/** Правки, названные кандидатом в вопросе (B796), и готовая правка резюме по его просьбе (B786). */
function cardsFor(deps: RouteDeps, candidateId: string, asked: string | null) {
  if (asked === null) return { corrections: [] };
  const snapshot = deps.candidateStore.getSnapshot(candidateId);
  const corrections = factCorrectionProposals(snapshot, asked);
  const edit = corrections.length > 0 ? null : resumeEditRequest(snapshot, asked);
  if (edit?.kind === 'fact') return { corrections, resumeFactId: edit.factId };
  if (edit?.kind === 'reword') return { corrections, resumeRewordPlace: edit.experienceId };
  return { corrections };
}

function replyExtras(
  deps: RouteDeps,
  candidateId: string,
  conversationId: string,
  messages: readonly ThreadMessage[],
): ReplyExtrasData {
  const results = deps.candidateStore.consultantReplyResults(candidateId, conversationId);
  if (results.length === 0) return { replies: [], analysisPending: false };
  const analysisPending = results.some(({ result }) => withStaleAnalysis(result).analysis === 'pending');
  const memory = deps.candidateStore.getSnapshot(candidateId).memory;
  const lastId = results.at(-1)?.messageId;
  const { corrections, ...edit } = cardsFor(deps, candidateId, askedBefore(messages, lastId));
  const replies = results
    .map(({ messageId, result }) => ({
      messageId,
      ...replyExtrasOf(result, memory),
      ...(messageId === lastId && corrections.length > 0 ? { corrections } : {}),
      ...(messageId === lastId ? edit : {}),
    }))
    .filter(
      ({ actions, memoryIds, corrections: fixes, resumeFactId, resumeRewordPlace }: ConsultantReplyExtras) =>
        actions.length > 0 ||
        memoryIds.length > 0 ||
        Boolean(fixes) ||
        Boolean(resumeFactId) ||
        Boolean(resumeRewordPlace),
    );
  return { replies, analysisPending };
}

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
