import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { buildRecruiterVacancyInput } from '../outreach/recruiterIntelligenceInput';
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
  const vacancyInput = buildRecruiterVacancyInput(vacancyId, deps);
  if (!vacancyInput.title) {
    return sendError(reply, request, 404, 'vacancy_not_found', 'Вакансия не найдена в серверном пуле.', false);
  }

  if (!recruiterContactsRepo) {
    return sendError(
      reply,
      request,
      503,
      'recruiter_intelligence_unavailable',
      'Поиск контактов временно недоступен. Попробуйте ещё раз позже.',
      true,
    );
  }
  const job = recruiterContactsRepo.enqueueJob(candidate.id, vacancyId);

  return reply.code(202).send({
    data: { job },
    meta: { requestId: request.id },
  });
}

async function handleGetContacts(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const { authService, candidateStore, config, recruiterContactsRepo } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const vacancyId = (request.params as { id: string }).id;
  const contacts = recruiterContactsRepo?.getContactsByVacancyId(candidate.id, vacancyId) ?? [];
  const job = recruiterContactsRepo?.getJob(candidate.id, vacancyId) ?? null;

  return {
    data: { contacts, job },
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
