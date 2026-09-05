import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from './deps';
import { authenticateCandidate, sendError } from './helpers';

/** Reads the durable result only; never starts or retries a provider operation. */
export function registerCoachResultRoute(app: FastifyInstance, deps: RouteDeps) {
  app.get('/api/v1/coach/turn/:key/result', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (request, reply) => {
    const candidate = authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
    if (!candidate) return;
    const { key } = z.object({ key: z.string().uuid() }).parse(request.params);
    const { offset } = z.object({ offset: z.coerce.number().int().nonnegative().optional() }).parse(request.query);
    const turn = deps.candidateStore.getCoachTurn(candidate.id, key);
    if (!turn) return sendError(reply, request, 404, 'turn_not_found', 'Ответ не найден.', false);
    if (turn.status === 'pending') return reply.code(202).send({ data: { status: 'pending' } });
    if (turn.status !== 'completed' || !turn.result) {
      return sendError(reply, request, 409, 'turn_failed', 'Не удалось завершить ответ. Повторите действие.', true);
    }
    if (offset === undefined) return { data: turn.result };
    // Base64 keeps arbitrary UTF-8 byte boundaries reversible and JSON overhead bounded.
    const bytes = Buffer.from(JSON.stringify(turn.result));
    if (offset > bytes.length) return sendError(reply, request, 416, 'invalid_offset', 'Запросите ответ заново.', true);
    const end = Math.min(offset + 8_192, bytes.length);
    return { data: {
      contentBase64: bytes.subarray(offset, end).toString('base64'),
      offset, nextOffset: end < bytes.length ? end : null,
      byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    } };
  });
}
