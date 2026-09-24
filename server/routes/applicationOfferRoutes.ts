import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from './deps';
import { authenticateCandidate, csrfError, hasSafeMutationOrigin, withDeps } from './helpers';
import { isoDateField } from './isoDateField';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const putOfferSchema = z.object({
  terms: z.object({
    baseSalary: z.number().nonnegative().optional(),
    bonus: z.number().nonnegative().optional(),
    equity: z.string().trim().max(200).optional(),
    currency: z.string().trim().max(10).optional(),
    location: z.string().trim().max(200).optional(),
    startDate: z.string().trim().max(40).optional(),
  }),
  respondBy: isoDateField.nullable().optional(),
});

const handlePutOffer: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const applicationId = (request.params as { id: string }).id;
  const body = putOfferSchema.parse(request.body);
  const offer = candidateStore.putApplicationOffer(
    candidate.id,
    applicationId,
    body.terms,
    body.respondBy ?? null,
  );
  return { data: offer, meta: { requestId: request.id } };
};

/** `PUT /applications/:id/offer` (B251, S2, architecture.md §3–4). */
export function registerApplicationOfferRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.put(
    '/api/v1/candidate/applications/:id/offer',
    { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } },
    withDeps(deps, handlePutOffer),
  );
}
