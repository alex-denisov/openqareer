import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  discoverRecruiterContacts,
  type UnifiedVacancyInput,
} from '../outreach/recruiterIntelligenceService';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  sendError,
  hasSafeMutationOrigin,
  withDeps,
} from './helpers';

const enrichBodySchema = z
  .object({
    vacancy: z
      .object({
        id: z.string().optional(),
        title: z.string().optional(),
        company: z.string().optional(),
        url: z.string().optional(),
        description: z.string().optional(),
        fullDescription: z.string().optional(),
        contactInfo: z.string().optional(),
      })
      .optional(),
  })
  .optional();

function buildVacancyInput(
  vacancyId: string,
  deps: RouteDeps,
): UnifiedVacancyInput {
  const cluster = deps.multiSourceEngine?.getActiveCluster?.(vacancyId);
  const poolVacancy = !cluster ? deps.multiSourceEngine?.getVacancy?.(vacancyId) : undefined;

  return {
    id: vacancyId,
    title: cluster?.canonicalTitle ?? poolVacancy?.title,
    company: cluster?.canonicalCompany ?? poolVacancy?.company,
    url: cluster?.primaryUrl ?? poolVacancy?.url,
    description: cluster?.descriptionSummary ?? poolVacancy?.description,
    fullDescription: poolVacancy?.fullDescription,
    contactInfo: poolVacancy?.contactInfo,
  };
}

async function handleEnrichContacts(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const { authService, candidateStore, config, recruiterContactsRepo } = deps;
  if (!hasSafeMutationOrigin(request, config)) {
    return csrfError(request, reply);
  }
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) {
    return undefined;
  }

  const vacancyId = (request.params as { id: string }).id;
  const parsed = enrichBodySchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return sendError(reply, request, 400, 'invalid_request', 'Данные вакансии должны поступать из серверного пула.', false);
  }
  const vacancyInput = buildVacancyInput(vacancyId, deps);
  if (!vacancyInput.title) {
    return sendError(reply, request, 404, 'vacancy_not_found', 'Вакансия не найдена в серверном пуле.', false);
  }

  const contacts = await discoverRecruiterContacts(vacancyInput);
  if (recruiterContactsRepo) {
    recruiterContactsRepo.saveContacts(candidate.id, vacancyId, contacts);
  }

  return {
    data: { contacts },
    meta: { requestId: request.id },
  };
}

async function handleGetContacts(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const { authService, candidateStore, config } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const vacancyId = (request.params as { id: string }).id;
  const contacts = deps.recruiterContactsRepo?.getContactsByVacancyId(candidate.id, vacancyId) ?? [];

  return {
    data: { contacts },
    meta: { requestId: request.id },
  };
}

export function registerRecruiterIntelligenceRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): void {
  app.post(
    '/api/v1/vacancies/:id/enrich-contacts',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    withDeps(deps, handleEnrichContacts),
  );

  app.get(
    '/api/v1/vacancies/:id/contacts',
    withDeps(deps, handleGetContacts),
  );
}
