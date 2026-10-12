import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from './deps';
import { authenticateCandidate, sendError, withDeps } from './helpers';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

function wantsJson(accept: string | undefined): boolean {
  return (accept ?? '').split(',').some((part) => part.trim().startsWith('application/json'));
}

const handleGetCandidateMedia: Handler = async (deps, request, reply) => {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const mediaId = z.string().trim().min(1).max(80).parse(
    (request.params as { mediaId: string }).mediaId,
  );
  const media = deps.candidateStore.getCandidateMedia(candidate.id, mediaId);
  if (!media) return sendError(reply, request, 404, 'media_not_found', 'Файл не найден.', false);
  reply.header('Cache-Control', 'private, max-age=86400');
  reply.header('ETag', mediaId);
  reply.header('X-Content-Type-Options', 'nosniff');
  if (wantsJson(request.headers.accept)) {
    return { data: { mime: media.mime, base64: Buffer.from(media.bytes).toString('base64') } };
  }
  return reply.type(media.mime).send(media.bytes);
};

export function registerCandidateMediaRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/media/:mediaId', withDeps(deps, handleGetCandidateMedia));
}
