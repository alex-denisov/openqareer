import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { buildSearchFocus } from '../../src/features/strategy/careerVector';
import type { StoredCareerVector } from '../data/sqliteCareerVectorRepository';
import { putCareerVectorSchema } from './careerVectorValidation';
import type { RouteDeps } from './deps';
import { authenticateCandidate, csrfError, hasSafeMutationOrigin, withDeps } from './helpers';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

/** Вектор пока не влияет на роли кампании: интеграция — отдельный срез по решению CPO. */
const AFFECTS_CAMPAIGN = false;

function present(stored: StoredCareerVector | null) {
  return {
    ...(stored ?? {
      answers: null,
      vector: null,
      rationale: null,
      status: 'hypothesis' as const,
      version: 0,
      updatedAt: null,
    }),
    affectsCampaign: AFFECTS_CAMPAIGN,
  };
}

const handleGet: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const stored = candidateStore.careerVectorRepo.get(candidate.id);
  return { data: present(stored), meta: { requestId: request.id } };
};

const handlePut: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const answers = putCareerVectorSchema.parse(request.body);
  const focus = buildSearchFocus(answers);
  const stored = candidateStore.careerVectorRepo.put(
    candidate.id,
    {
      answers,
      vector: focus.vector,
      rationale: {
        runnerUp: focus.runnerUp,
        confidence: focus.confidence,
        reasons: focus.reasons,
      },
    },
    new Date().toISOString(),
  );
  return { data: present(stored), meta: { requestId: request.id } };
};

/** `GET/PUT /candidate/career-vector` (B383): вектор перехода как гипотеза. */
export function registerCareerVectorRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const limit = { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } };
  app.get('/api/v1/candidate/career-vector', limit, withDeps(deps, handleGet));
  app.put('/api/v1/candidate/career-vector', limit, withDeps(deps, handlePut));
}
