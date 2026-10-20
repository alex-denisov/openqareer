import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { calculateRelocationScenario, relocationScenarioInputSchema } from '../../shared/relocationScenario';
import { RelocationScenarioConflict, RelocationScenarioLimit } from '../data/sqliteRelocationScenarioRepository';
import type { RouteDeps } from './deps';
import { authenticateCandidate, csrfError, hasSafeMutationOrigin, sendError } from './helpers';

const pageSchema = z.object({ limit: z.coerce.number().int().min(1).max(20).default(20), offset: z.coerce.number().int().min(0).max(50).default(0) }).strict();
const idSchema = z.object({ id: z.uuid() }).strict();

const base = '/api/v1/candidate/relocation-scenarios';
const read = { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } };
const write = { bodyLimit: 32_768, config: { rateLimit: { max: 60, timeWindow: '1 hour' } } };
export function registerRelocationScenarioRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.post(base, write, async (request, reply) => {
    const user = authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
    if (!user) return;
    if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
    const parsed = relocationScenarioInputSchema.safeParse(request.body);
    const key = z.uuid().safeParse(request.headers['idempotency-key']);
    if (!parsed.success || !key.success) return sendError(reply, request, 400, 'invalid_relocation_scenario', 'Проверьте поля расчёта и повторите сохранение.', false);
    try {
      const repo = deps.candidateStore.relocationQuestionnaireRepo;
      if (!repo.getConsent(user.id).granted) return sendError(reply, request, 403, 'relocation_consent_required', 'Включите раздел «Страны и релокация» и подтвердите согласие перед сохранением.', false);
      const profile = repo.getConsent(user.id).granted ? repo.getProfile(user.id) : null;
      // Виза использует только явно указанные параметры; профиль не перезаписывается.
      const input = parsed.data;
      const calculated = calculateRelocationScenario(input, profile);
      const hash = repo.scenarios.requestHash(user.id, JSON.stringify(input));
      const result = repo.scenarios.save(user.id, key.data, hash, {
        input, result: calculated, createdAt: new Date().toISOString(), profileRevision: profile?.revision ?? null,
      });
      reply.header('Cache-Control', 'private, no-store');
      reply.header('Location', `${base}/${result.value.id}`);
      return reply.code(result.created ? 201 : 200).send({ data: result.value, meta: { requestId: request.id } });
    } catch (error) {
      if (error instanceof RelocationScenarioConflict) return sendError(reply, request, 409, 'relocation_retry_conflict', 'Этот запрос уже сохранил другой расчёт. Создайте новую версию.', false);
      if (error instanceof RelocationScenarioLimit) return sendError(reply, request, 409, 'relocation_history_limit', 'Сохранено 50 расчётов. Удалите ненужный перед добавлением.', false);
      if (error instanceof Error && /валют|период|расход|будущ|поддерживается/.test(error.message)) return sendError(reply, request, 400, 'invalid_relocation_scenario', error.message, false);
      return sendError(reply, request, 503, 'relocation_storage_unavailable', 'Не удалось сохранить расчёт. Повторите запрос.', true);
    }
  });
  app.get(base, read, async (request, reply) => {
    const user = authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config); if (!user) return;
    const page = pageSchema.safeParse(request.query);
    if (!page.success) return sendError(reply, request, 400, 'invalid_page', 'Проверьте параметры страницы.', false);
    reply.header('Cache-Control', 'private, no-store');
    return { data: deps.candidateStore.relocationQuestionnaireRepo.scenarios.list(user.id, page.data.limit, page.data.offset) };
  });
  app.get(`${base}/:id`, read, async (request, reply) => {
    const user = authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config); if (!user) return;
    const id = idSchema.safeParse(request.params); const result = id.success ? deps.candidateStore.relocationQuestionnaireRepo.scenarios.get(user.id, id.data.id) : null;
    if (!result) return sendError(reply, request, 404, 'relocation_scenario_not_found', 'Расчёт не найден.', false);
    reply.header('Cache-Control', 'private, no-store'); return { data: result };
  });
  app.delete(`${base}/:id`, write, async (request, reply) => {
    const user = authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config); if (!user) return;
    if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
    const id = idSchema.safeParse(request.params);
    if (!id.success || !deps.candidateStore.relocationQuestionnaireRepo.scenarios.delete(user.id, id.data.id)) return sendError(reply, request, 404, 'relocation_scenario_not_found', 'Расчёт не найден.', false);
    return reply.code(204).send();
  });
}
