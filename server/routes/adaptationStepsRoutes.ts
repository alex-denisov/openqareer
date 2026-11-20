import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { expectationLines } from '../domain/adaptationSteps';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError } from './helpers';

/**
 * d01: POST …/workplaces/:workplaceId/adaptation-steps — шаги плана из «Что от вас ждут».
 * Отвечает `{ steps: null }`, если поле пустое, модели нет или ответ не прошёл проверку:
 * тогда клиент собирает план из шаблона. Какой путь сработал, кандидату не показывается.
 */
const PATH = '/api/v1/candidate/career-diary/workplaces/:workplaceId/adaptation-steps';

async function handleSteps(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return undefined;
  if (!principal.candidate) return sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
  const id = z.string().uuid().safeParse((request.params as Record<string, unknown>).workplaceId);
  const workplace = id.success ? deps.candidateStore.careerDiaryRepo.getWorkplace(principal.candidate.id, id.data) : null;
  if (!workplace) return sendError(reply, request, 404, 'career_diary_record_not_found', 'Запись дневника не найдена.', false);
  const lines = expectationLines(workplace.expectations);
  const writer = deps.adaptationStepsWriter;
  let steps = null;
  if (lines.length > 0 && writer) {
    try {
      steps = await writer.writeSteps({ company: workplace.company, title: workplace.title, lines });
    } catch (error) {
      request.log.warn({ err: error }, 'adaptation steps: model chain failed, template fallback');
    }
  }
  reply.header('Cache-Control', 'private, no-store');
  return { data: { steps }, meta: { requestId: request.id } };
}

export function registerAdaptationStepsRoutes(app: FastifyInstance, deps: RouteDeps): void {
  // Вызов модели: кандидат собирает план один раз на работу, потолок с запасом на повтор.
  const limit = { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } };
  app.post(PATH, limit, (request, reply) => handleSteps(deps, request, reply));
}
