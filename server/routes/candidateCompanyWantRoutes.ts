import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { candidateCompanyKey } from '../domain/candidateCompanies';
import {
  countWantStages,
  filterWantRows,
  toWantSelectionItem,
  wantIndustries,
  wantedCompanyRows,
} from '../domain/candidateCompanyWantList';
import {
  canSearchRecruiters,
  companyContext,
  enqueueCompanyRecruiterJobs,
  wantRepository,
} from './candidateCompanyRoutes';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';

/** Bulk actions over «Хочу» handle up to this many companies at once (B451). */
export const COMPANY_WANT_BULK_LIMIT = 500;

const wantQuerySchema = z.object({
  stage: z.enum(['all', 'new', 'want', 'path', 'waiting']).default('all'),
  search: z.string().trim().max(120).default(''),
  industry: z.string().trim().max(120).default(''),
  contacts: z.enum(['any', 'with', 'without']).default('any'),
  sort: z.enum(['vacancies', 'alphabetical', 'added']).default('vacancies'),
});
const wantPageSchema = wantQuerySchema.extend({
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(20).default(20),
});
const recruiterSearchBulkSchema = z.object({
  companyKeys: z
    .array(z.string().regex(/^[a-f0-9]{24}$/u))
    .min(1)
    .max(COMPANY_WANT_BULK_LIMIT),
});

function invalidQuery(reply: FastifyReply, request: FastifyRequest) {
  return sendError(
    reply,
    request,
    400,
    'invalid_company_query',
    'Проверьте параметры списка компаний.',
    false,
  );
}

async function wantedRows(deps: RouteDeps, candidateId: string) {
  const context = await companyContext(deps, candidateId);
  return { context, rows: wantedCompanyRows(context.rows) };
}

function signedInCandidate(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  return authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
}

async function handleWantPage(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = signedInCandidate(deps, request, reply);
  if (!candidate || !wantRepository(deps, request, reply)) return undefined;
  const parsed = wantPageSchema.safeParse(request.query);
  if (!parsed.success) return invalidQuery(reply, request);
  const query = parsed.data;
  const { rows } = await wantedRows(deps, candidate.id);
  const filtered = filterWantRows(rows, query);
  return {
    data: {
      items: filtered.slice(query.offset, query.offset + query.limit),
      total: filtered.length,
      offset: query.offset,
      limit: query.limit,
      counts: countWantStages(rows),
      industries: wantIndustries(rows),
    },
    meta: { requestId: request.id, total: filtered.length, offset: query.offset },
  };
}

async function handleWantSelection(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = signedInCandidate(deps, request, reply);
  if (!candidate || !wantRepository(deps, request, reply)) return undefined;
  const parsed = wantQuerySchema.safeParse(request.query);
  if (!parsed.success) return invalidQuery(reply, request);
  const { rows } = await wantedRows(deps, candidate.id);
  const filtered = filterWantRows(rows, parsed.data);
  return {
    data: {
      items: filtered.slice(0, COMPANY_WANT_BULK_LIMIT).map(toWantSelectionItem),
      total: filtered.length,
    },
    meta: { requestId: request.id },
  };
}

async function handleBulkRecruiterSearch(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = signedInCandidate(deps, request, reply);
  if (!candidate) return undefined;
  const parsed = recruiterSearchBulkSchema.safeParse(request.body);
  if (!parsed.success) return invalidQuery(reply, request);
  if (!canSearchRecruiters(deps, request, reply, candidate.id)) return undefined;
  const wanted = new Set(parsed.data.companyKeys);
  const { context } = await wantedRows(deps, candidate.id);
  const vacancyIdsByCompany = new Map<string, string[]>();
  for (const vacancy of context.vacancies) {
    const key = candidateCompanyKey(vacancy.companyName);
    if (!wanted.has(key)) continue;
    const ids = vacancyIdsByCompany.get(key) ?? [];
    if (ids.length < 3) vacancyIdsByCompany.set(key, [...ids, vacancy.id]);
  }
  const vacancyIds = [...vacancyIdsByCompany.values()].flat();
  enqueueCompanyRecruiterJobs(deps.recruiterContactsRepo!, candidate.id, vacancyIds);
  request.log.info(
    { event: 'company-recruiter-search-bulk', companyCount: vacancyIdsByCompany.size },
    'candidate-company-recruiter-search',
  );
  return reply.code(202).send({
    data: {
      queuedCount: vacancyIdsByCompany.size,
      skippedCount: wanted.size - vacancyIdsByCompany.size,
    },
    meta: { requestId: request.id },
  });
}

export function registerCandidateCompanyWantRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/companies/wants', withDeps(deps, handleWantPage));
  app.get('/api/v1/candidate/companies/wants/selection', withDeps(deps, handleWantSelection));
  app.post(
    '/api/v1/candidate/companies/wants/recruiter-search',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    withDeps(deps, handleBulkRecruiterSearch),
  );
}
