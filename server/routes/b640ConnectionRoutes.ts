import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { B640_CONNECTION_PAGE_LIMIT, B640_CONNECTION_SEARCH_MAX } from '../../shared/b640Connections';
import { buildB640Connections } from '../domain/b640Connections';
import { contactSources } from './b640ContactRoutes';
import { sessionCandidate } from './b640VacancyContext';
import { requireCabinetB640 } from './cabinetB640Flag';
import { companyContext } from './candidateCompanyRoutes';
import { connectionRepository } from './candidateConnectionRoutes';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';
import { withRequestScopedCandidateReads } from './requestScopedCandidateReads';

const querySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(B640_CONNECTION_PAGE_LIMIT).default(B640_CONNECTION_PAGE_LIMIT),
  search: z.string().max(B640_CONNECTION_SEARCH_MAX).default(''),
  pool: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
});

async function listConnections(background: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireCabinetB640(request, reply, background);
  if (!principal) return reply;
  const candidate = sessionCandidate(request, reply, principal.candidate);
  if (!candidate) return reply;
  const query = querySchema.safeParse(request.query ?? {});
  if (!query.success) return sendError(reply, request, 400, 'invalid_query', 'Неверные параметры списка связей.', false);
  const repository = connectionRepository(background, request, reply);
  if (!repository) return reply;
  const deps = withRequestScopedCandidateReads(background);
  const { contacts, receipt } = contactSources(repository, candidate.id);
  // Холодная подборка не держит список: связи приходят сразу, отметки — при повторном чтении.
  const context = await companyContext(deps, candidate.id, { allowPendingVacancies: true });
  const data = buildB640Connections(
    {
      contacts,
      vacancies: context.vacancies,
      recruiters: context.rows.flatMap((row) => row.recruiters),
      selectionPending: context.vacanciesPending ?? false,
      linkedinImport: receipt
        ? { state: 'imported', importedAt: receipt.importedAt, importedCount: receipt.importedCount }
        : { state: 'unknown', importedAt: null, importedCount: null },
    },
    query.data,
  );
  return { data, meta: { requestId: request.id, total: data.total, offset: data.offset, nextOffset: data.nextOffset } };
}

/** B651 p11: «Связи» по компаниям с кругом и отметкой подборки; только чтение, за флагом B640. */
export function registerB640ConnectionRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get(
    '/api/v1/candidate/b640/connections',
    { config: { rateLimit: { max: 600, timeWindow: '1 hour' } } },
    withDeps(deps, listConnections),
  );
}
