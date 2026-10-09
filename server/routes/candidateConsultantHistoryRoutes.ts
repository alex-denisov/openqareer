import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from './deps';
import { authenticateCandidate, csrfError, hasSafeMutationOrigin, sendError, withDeps } from './helpers';

const listQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

const idParamsSchema = z.object({ conversationId: z.string().uuid() }).strict();

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const handleList: Handler = async ({ authService, candidateStore, config }, request, reply) => {
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const parsed = listQuerySchema.safeParse(request.query);
  if (!parsed.success) return sendError(reply, request, 400, 'invalid_history_query', 'Проверьте параметры истории.', false);
  try {
    const page = candidateStore.listConsultantConversations(candidate.id, parsed.data);
    return { data: page.items, meta: { requestId: request.id, nextCursor: page.nextCursor } };
  } catch {
    return sendError(reply, request, 400, 'invalid_history_cursor', 'Не удалось прочитать эту страницу истории.', false);
  }
};

const handleRead: Handler = async ({ authService, candidateStore, config }, request, reply) => {
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const params = idParamsSchema.safeParse(request.params);
  if (!params.success) return sendError(reply, request, 400, 'invalid_conversation_id', 'Проверьте идентификатор беседы.', false);
  const conversation = candidateStore.getConsultantConversation(candidate.id, params.data.conversationId);
  if (!conversation) return sendError(reply, request, 404, 'conversation_not_found', 'Беседа не найдена.', false);
  return { data: conversation, meta: { requestId: request.id } };
};

const handleAppend: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
  if (!candidate) return undefined;
  const params = idParamsSchema.safeParse(request.params);
  if (!params.success) return sendError(reply, request, 400, 'invalid_conversation_id', 'Проверьте идентификатор беседы.', false);
  if (!deps.candidateStore.getConsultantConversation(candidate.id, params.data.conversationId)) {
    return sendError(reply, request, 404, 'conversation_not_found', 'Беседа не найдена.', false);
  }
  return sendError(reply, request, 409, 'conversation_read_only', 'Продолжить беседу из истории нельзя.', false);
};

const handleDelete: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
  if (!candidate) return undefined;
  const params = idParamsSchema.safeParse(request.params);
  if (!params.success) return sendError(reply, request, 400, 'invalid_conversation_id', 'Проверьте идентификатор беседы.', false);
  const removed = deps.candidateStore.deleteConsultantConversation(candidate.id, params.data.conversationId);
  if (!removed) return sendError(reply, request, 404, 'conversation_not_found', 'Беседа не найдена.', false);
  return reply.code(204).send();
};

export async function registerCandidateConsultantHistoryRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  const base = '/api/v1/candidate/consultant-history';
  app.get(base, withDeps(deps, handleList));
  app.get(`${base}/:conversationId`, withDeps(deps, handleRead));
  app.post(`${base}/:conversationId/messages`, withDeps(deps, handleAppend));
  app.delete(`${base}/:conversationId`, withDeps(deps, handleDelete));
}
