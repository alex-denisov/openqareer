import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DECISION_WORK_FORMATS, type CandidateDecisionProfile } from '../../shared/workPreferences';
import type { RouteDeps } from './deps';
import { authenticateCandidate, csrfError, hasSafeMutationOrigin, withDeps } from './helpers';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const formatIds = DECISION_WORK_FORMATS.map((format) => format.id) as [string, ...string[]];

export const putDecisionProfileSchema = z
  .object({
    citizenship: z.array(z.string().max(80)).max(10).default([]),
    taxStatus: z.string().max(120).optional(),
    languages: z
      .array(
        z.object({
          language: z.string().max(60),
          level: z.string().max(30),
          certified: z.boolean().optional(),
          context: z.string().max(200).optional(),
        }),
      )
      .max(20)
      .default([]),
    workFormats: z.array(z.enum(formatIds)).max(10).default([]),
    salaryFloor: z.number().finite().min(0).max(1_000_000_000).optional(),
    salaryCurrency: z.string().max(8).optional(),
    cushionMonths: z.number().finite().min(0).max(240).optional(),
    hasFamily: z.boolean().optional(),
  })
  .strict();

const handleGet: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const data = candidateStore.decisionProfileRepo.get(candidate.id);
  return { data, meta: { requestId: request.id } };
};

const handlePut: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const parsed = putDecisionProfileSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: {
        code: 'invalid_decision_profile',
        message: 'Профиль ограничений заполнен неверно',
        requestId: request.id,
        retryable: false,
      },
    });
  }
  const data = candidateStore.decisionProfileRepo.put(
    candidate.id,
    parsed.data as CandidateDecisionProfile,
    new Date().toISOString(),
  );
  return { data, meta: { requestId: request.id } };
};

/** `GET/PUT /candidate/decision-profile` (B384): жёсткие ограничения подборки. */
export function registerDecisionProfileRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const limit = { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } };
  app.get('/api/v1/candidate/decision-profile', limit, withDeps(deps, handleGet));
  app.put('/api/v1/candidate/decision-profile', limit, withDeps(deps, handlePut));
}
