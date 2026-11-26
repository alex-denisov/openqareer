import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAdmin } from './adminAuth';
import { sendError, withDeps } from './helpers';
import type { RouteDeps } from './deps';
import { adminCoverageQuerySchema } from './schemas';

/**
 * B643-10: company directory coverage by best placement. Reads run in a worker
 * thread inside CoverageReport; totals are cached for ten minutes.
 */
async function handleTotals(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!requireAdmin(deps, request, reply)) return;
  if (!deps.companyDirectoryRepo) {
    return sendError(reply, request, 503, 'directory_unavailable', 'Справочник компаний недоступен.', true);
  }
  const totals = await deps.companyDirectoryRepo.coverageReport().totals();
  return { data: totals, meta: { requestId: request.id } };
}

async function handleCompanies(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!requireAdmin(deps, request, reply)) return;
  if (!deps.companyDirectoryRepo) {
    return sendError(reply, request, 503, 'directory_unavailable', 'Справочник компаний недоступен.', true);
  }
  const query = adminCoverageQuerySchema.parse(request.query ?? {});
  try {
    const page = await deps.companyDirectoryRepo
      .coverageReport()
      .list({ limit: query.limit, cls: query.class, cursor: query.cursor });
    return { data: page, meta: { requestId: request.id } };
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid_cursor') {
      return sendError(reply, request, 400, 'bad_request', 'Некорректный курсор.', false);
    }
    throw error;
  }
}

export function registerAdminCoverageRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const config = { rateLimit: { max: 30, timeWindow: '1 minute' } };
  app.get('/api/v1/admin/directory/coverage', { config }, withDeps(deps, handleTotals));
  app.get('/api/v1/admin/directory/coverage/companies', { config }, withDeps(deps, handleCompanies));
}
