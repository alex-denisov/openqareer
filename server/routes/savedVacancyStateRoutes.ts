import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CandidateRegion } from '../../src/features/workspace/candidateRegions';
import { SAVED_VACANCY_STATES_LIMIT, savedVacancyStates } from '../vacancies/savedVacancyStates';
import { readCampaign } from './campaignContext';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import { readTargetLevel } from './vacancyRoleContext';

const bodySchema = z.object({
  items: z
    .array(
      z.object({
        clusterId: z.string().trim().min(1).max(120),
        url: z.string().trim().max(2000).optional(),
      }),
    )
    .max(SAVED_VACANCY_STATES_LIMIT),
});

/** Тот же контекст, что у подборки: целевой уровень и рынки кампании кандидата. */
function matchContext(deps: RouteDeps, candidateId: string) {
  const campaign = readCampaign(deps.candidateStore, candidateId);
  return {
    candidateLevel: readTargetLevel(deps.candidateStore, candidateId, [...campaign.roles.value]),
    regions: [
      ...(campaign.regions.value as CandidateRegion[]),
      ...((campaign.suggestedRegions ?? []) as CandidateRegion[]),
    ],
    getTitleParse: (titleKey: string) => deps.titleParseStore.getByKey(titleKey),
  };
}

async function handleSavedVacancyStates(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const parsed = bodySchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return sendError(reply, request, 400, 'invalid_items', 'Список вакансий не распознан.', false);
  }
  return {
    data: savedVacancyStates(
      deps.multiSourceEngine,
      parsed.data.items,
      matchContext(deps, candidate.id),
    ),
    meta: { requestId: request.id },
  };
}

/**
 * B550: деньги, закрытие, уровень и гео для вкладки «Сохранённые». POST, потому
 * что вместе с id идут URL вакансий; ничего не записывает.
 */
export function registerSavedVacancyStateRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    '/api/v1/candidate/saved-vacancy-states',
    { config: { rateLimit: { max: 240, timeWindow: '1 hour' } } },
    withDeps(deps, handleSavedVacancyStates),
  );
}
