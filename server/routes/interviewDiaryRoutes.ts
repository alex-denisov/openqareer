import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from './deps';
import { authenticateCandidate, csrfError, hasSafeMutationOrigin, sendError } from './helpers';
import { InvalidCareerDiaryCursorError } from '../data/careerDiaryRepositoryHelpers';

const base = '/api/v1/candidate/career-diary/interview-practices';
const idSchema = z.string().trim().min(1).max(160);
const pageSchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), cursor: z.string().min(1).max(2048).optional() }).strict();

export function registerInterviewDiaryRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const options = { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } };
  app.get(base, options, async (request, reply) => {
    const candidate = authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
    if (!candidate) return;
    const parsed = pageSchema.safeParse(request.query);
    if (!parsed.success) return sendError(reply, request, 400, 'invalid_diary_page', 'Проверьте параметры списка.', false);
    try { return { data: deps.candidateStore.careerDiaryRepo.listInterviewPractices(candidate.id, parsed.data.limit, parsed.data.cursor), meta: { requestId: request.id } }; }
    catch (error) {
      if (error instanceof InvalidCareerDiaryCursorError) return sendError(reply, request, 400, 'invalid_diary_cursor', 'Обновите список записей.', false);
      throw error;
    }
  });
  app.get(`${base}/:id`, options, async (request, reply) => {
    const candidate = authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
    if (!candidate) return;
    const parsed = idSchema.safeParse((request.params as { id?: unknown }).id);
    if (!parsed.success) return sendError(reply, request, 400, 'invalid_diary_id', 'Проверьте запись.', false);
    const record = deps.candidateStore.careerDiaryRepo.getInterviewPractice(candidate.id, parsed.data);
    if (!record) return sendError(reply, request, 404, 'diary_practice_not_found', 'Запись не найдена.', false);
    return { data: record, meta: { requestId: request.id } };
  });
  app.put(`${base}/:id`, options, async (request, reply) => {
    if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
    const candidate = authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
    if (!candidate) return;
    const parsed = idSchema.safeParse((request.params as { id?: unknown }).id);
    if (!parsed.success || request.body !== undefined) return sendError(reply, request, 400, 'invalid_diary_practice', 'Проверьте тренировку.', false);
    const session = deps.candidateStore.interviewSimulatorRepo.get(candidate.id, parsed.data);
    const existing = deps.candidateStore.careerDiaryRepo.getInterviewPractice(candidate.id, parsed.data);
    if (!session && !existing) return sendError(reply, request, 404, 'interview_session_not_found', 'Тренировка не найдена.', false);
    const record = session ? deps.candidateStore.careerDiaryRepo.saveInterviewPractice(candidate.id, session) : existing!;
    return reply.header('Location', `${base}/${encodeURIComponent(record.id)}`).code(201).send({ data: record, meta: { requestId: request.id } });
  });
  app.delete(`${base}/:id`, options, async (request, reply) => {
    if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
    const candidate = authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
    if (!candidate) return;
    const parsed = idSchema.safeParse((request.params as { id?: unknown }).id);
    if (!parsed.success) return sendError(reply, request, 400, 'invalid_diary_id', 'Проверьте запись.', false);
    if (!deps.candidateStore.careerDiaryRepo.deleteInterviewPractice(candidate.id, parsed.data)) return sendError(reply, request, 404, 'diary_practice_not_found', 'Запись не найдена.', false);
    return { data: { deleted: true }, meta: { requestId: request.id } };
  });
}
