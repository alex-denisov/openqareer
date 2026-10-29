import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from './deps';
import { authenticateCandidate, sendError } from './helpers';
import { withStaleAnalysis } from './coachTurnAnalysis';
import { turnStreamHub, turnStreamId, type TurnStreamEvent } from './coachTurnStreamHub';

/** Proxies drop an idle connection; a comment line every 15 s keeps it open. */
const HEARTBEAT_MS = 15_000;
/** The client waits 240 s for a turn; the stream never outlives that. */
const STREAM_LIFETIME_MS = 240_000;

/**
 * 29.10 (owner): `GET /api/v1/coach/turn/:key/stream` — the consultant's reply
 * as Server-Sent Events while it is written. Read-only: it never starts or
 * retries generation, the POST stays a receipt and `/result` stays the record.
 *
 * Events: `delta` {text} appends, `reset` clears (the next stage starts over),
 * `done` {data} carries the stored result exactly as `/result` returns it,
 * `failed` and `fallback` tell the client to read `/result` itself.
 */
export function registerCoachTurnStreamRoute(app: FastifyInstance, deps: RouteDeps): void {
  // `close()` waits for open connections: a hijacked stream would hold a deploy for up to 240 s.
  const open = new Set<() => void>();
  app.addHook('preClose', async () => {
    for (const close of [...open]) close();
  });
  app.get(
    '/api/v1/coach/turn/:key/stream',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const candidate = authenticateCandidate(
        request,
        reply,
        deps.candidateStore,
        deps.authService,
        deps.config,
      );
      if (!candidate) return reply;
      const { key } = z.object({ key: z.string().uuid() }).parse(request.params);
      if (!deps.candidateStore.getCoachTurn(candidate.id, key)) {
        return sendError(reply, request, 404, 'turn_not_found', 'Ответ не найден.', false);
      }
      const sse = openStream(reply, open);
      const finish = (): void => {
        const turn = deps.candidateStore.getCoachTurn(candidate.id, key);
        if (turn?.status === 'completed' && turn.result) {
          sse.send('done', { data: withStaleAnalysis(turn.result) });
        } else {
          sse.send(turn?.status === 'pending' ? 'fallback' : 'failed', {});
        }
        sse.close();
      };
      // Subscribe before reading the status: a turn that ends in between still reaches `finish`.
      const subscription = turnStreamHub(deps).subscribe(
        turnStreamId(candidate.id, key),
        (event: TurnStreamEvent) => {
          if (event.type === 'end') finish();
          else if (event.type === 'reset') sse.send('reset', {});
          else sse.send('delta', { text: event.text });
        },
      );
      sse.onClose(() => subscription?.unsubscribe());
      if (!subscription) finish();
      else if (subscription.text) sse.send('delta', { text: subscription.text });
      return reply;
    },
  );
}

function openStream(reply: FastifyReply, open: Set<() => void>) {
  reply.hijack();
  const raw = reply.raw;
  // Headers the hooks already set (CORS) travel with the hijacked response.
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (value !== undefined) raw.setHeader(name, value);
  }
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    // `no-transform` and `X-Accel-Buffering` keep proxies from compressing or holding the events.
    'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no',
  });
  raw.write(': open\n\n');
  let closed = false;
  const closers: Array<() => void> = [];
  const heartbeat = setInterval(() => raw.write(': ping\n\n'), HEARTBEAT_MS);
  const lifetime = setTimeout(() => close(), STREAM_LIFETIME_MS);
  function close(): void {
    if (closed) return;
    closed = true;
    open.delete(close);
    clearInterval(heartbeat);
    clearTimeout(lifetime);
    for (const closer of closers) closer();
    raw.end();
  }
  raw.on('close', close);
  open.add(close);
  return {
    send(event: string, data: unknown): void {
      if (!closed) raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    onClose(closer: () => void): void {
      closers.push(closer);
    },
    close,
  };
}
