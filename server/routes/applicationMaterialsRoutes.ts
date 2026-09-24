import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from './deps';
import { authenticateCandidate, csrfError, hasSafeMutationOrigin, withDeps } from './helpers';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const linkMaterialSchema = z.object({ documentId: z.string().trim().min(1).max(200) });
const roleParamSchema = z.enum(['cover_letter', 'resume']);

const handleLinkMaterial: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const params = request.params as { id: string; role: string };
  const role = roleParamSchema.parse(params.role);
  const body = linkMaterialSchema.parse(request.body);
  const linked = candidateStore.linkApplicationMaterial(
    candidate.id,
    params.id,
    role,
    body.documentId,
  );
  return { data: linked, meta: { requestId: request.id } };
};

/** `PUT /applications/:id/materials/:role` (B251, S2, architecture.md §3–4). */
export function registerApplicationMaterialsRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.put(
    '/api/v1/candidate/applications/:id/materials/:role',
    { config: { rateLimit: { max: 240, timeWindow: '1 hour' } } },
    withDeps(deps, handleLinkMaterial),
  );
}
