import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SAVED_VACANCY_STATES_LIMIT, savedVacancyStates } from '../vacancies/savedVacancyStates';
import type { RouteDeps } from './deps';
import { authenticateCandidate, sendError, withDeps } from './helpers';

const querySchema = z.object({
  ids: z
    .string()
    .max(SAVED_VACANCY_STATES_LIMIT * 120)
    .transform((value) =>
      value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().max(120)).max(SAVED_VACANCY_STATES_LIMIT)),
});

async function handleSavedVacancyStates(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const parsed = querySchema.safeParse(request.query ?? {});
  if (!parsed.success) {
    return sendError(reply, request, 400, 'invalid_ids', 'Список вакансий не распознан.', false);
  }
  return {
    data: savedVacancyStates(deps.multiSourceEngine, parsed.data.ids),
    meta: { requestId: request.id },
  };
}

/** B550: деньги и закрытие на площадке для вкладки «Сохранённые». */
export function registerSavedVacancyStateRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/saved-vacancy-states', withDeps(deps, handleSavedVacancyStates));
}
