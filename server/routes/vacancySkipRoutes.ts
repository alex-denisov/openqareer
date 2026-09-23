import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SKIP_REASONS } from '../../shared/skipReasons';
import type { RouteDeps } from './deps';
import { authenticateCandidate, csrfError, hasSafeMutationOrigin, withDeps } from './helpers';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const reasonIdSchema = z.enum(SKIP_REASONS.map((reason) => reason.id) as [string, ...string[]]);

const createSkipSchema = z.object({
  clusterId: z.string().trim().min(1).max(200),
  reasonId: reasonIdSchema,
  origin: z.enum(['vacancy_card', 'kanban']),
});

const handleListSkips: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  return { data: candidateStore.listVacancySkips(candidate.id), meta: { requestId: request.id } };
};

const handleCreateSkip: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const body = createSkipSchema.parse(request.body);
  const created = candidateStore.createVacancySkip(candidate.id, body);
  return { data: created, meta: { requestId: request.id } };
};

const handleDeleteSkip: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const clusterId = (request.params as { clusterId: string }).clusterId;
  candidateStore.deleteVacancySkip(candidate.id, clusterId);
  return reply.code(204).send();
};

/**
 * `GET|POST|DELETE /vacancy-skips` (B251, S2, architecture.md §4). Posting
 * a skip archives the `saved` card for that cluster in the same transaction
 * (see `SqliteVacancySkipRepository.create`). A skip hides only this
 * vacancy — no lowering of similar roles in v1 (owner decision).
 */
export function registerVacancySkipRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/vacancy-skips', withDeps(deps, handleListSkips));
  app.post(
    '/api/v1/candidate/vacancy-skips',
    { config: { rateLimit: { max: 240, timeWindow: '1 hour' } } },
    withDeps(deps, handleCreateSkip),
  );
  app.delete(
    '/api/v1/candidate/vacancy-skips/:clusterId',
    { config: { rateLimit: { max: 240, timeWindow: '1 hour' } } },
    withDeps(deps, handleDeleteSkip),
  );
}
