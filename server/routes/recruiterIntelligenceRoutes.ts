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
  bodyVacancy: Partial<UnifiedVacancyInput> | undefined,
  deps: RouteDeps,
): UnifiedVacancyInput {
  const cluster = deps.multiSourceEngine?.getActiveClusters?.()?.find((c) => c.id === vacancyId);
  const poolVacancy = !cluster ? deps.multiSourceEngine?.getVacancy?.(vacancyId) : undefined;

  return {
    id: vacancyId,
    title: bodyVacancy?.title ?? cluster?.canonicalTitle ?? poolVacancy?.title,
    company: bodyVacancy?.company ?? cluster?.canonicalCompany ?? poolVacancy?.company,
    url: bodyVacancy?.url ?? cluster?.primaryUrl ?? poolVacancy?.url,
    description: bodyVacancy?.description ?? cluster?.descriptionSummary ?? poolVacancy?.description,
    fullDescription: bodyVacancy?.fullDescription ?? poolVacancy?.fullDescription,
    contactInfo: bodyVacancy?.contactInfo ?? poolVacancy?.contactInfo,
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
  const bodyVacancy = parsed.success ? parsed.data?.vacancy : undefined;
  const vacancyInput = buildVacancyInput(vacancyId, bodyVacancy, deps);

  const contacts = await discoverRecruiterContacts(vacancyInput);
  if (recruiterContactsRepo) {
    recruiterContactsRepo.saveContacts(vacancyId, contacts);
  }

  return {
    data: { contacts },
    meta: { requestId: request.id },
  };
}

async function handleGetContacts(
  deps: RouteDeps,
  request: FastifyRequest,
): Promise<unknown> {
  const vacancyId = (request.params as { id: string }).id;
  const contacts = deps.recruiterContactsRepo?.getContactsByVacancyId(vacancyId) ?? [];

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
