import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from './deps';
import { authenticateCandidate, hasSafeMutationOrigin, csrfError, sendError } from './helpers';
import { readVacancyFitTarget, vacancyFitContext } from './vacancyFitContext';

export async function registerVacancyFitRoutes(app: FastifyInstance, deps: RouteDeps) {
  app.route({
    method: ['GET', 'POST'], url: '/api/v1/candidate/vacancies/:id/fit',
    handler: async (request, reply) => {
      if (request.method === 'POST' && !hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
      const candidate = authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
      if (!candidate) return undefined;
      const id = (request.params as { id: string }).id;
      if (id.length > 200) return sendError(reply, request, 400, 'invalid_vacancy_id', 'Проверьте вакансию.', false);
      const target = readVacancyFitTarget(deps, id);
      if (!target) return sendError(reply, request, 404, 'vacancy_not_found', 'Вакансия не найдена.', false);
      const runtime = deps.vacancyMechanics;
      if (!runtime) return sendError(reply, request, 503, 'fit_unavailable', 'Расчёт пока недоступен.', true);
      const input = vacancyFitContext(deps, candidate.id, target, []);
      reply.header('Cache-Control', 'private, no-store');
      if (request.method === 'POST' && !['ready', 'no_description', 'no_requirements'].includes(runtime.view(input).state)) {
        const queued = runtime.enqueue(input);
        return reply.code(202).send({ data: { ...runtime.view(input), state: queued.status === 'failed' ? 'failed' : 'processing' } });
      }
      return { data: runtime.view(input) };
    },
  });
}
