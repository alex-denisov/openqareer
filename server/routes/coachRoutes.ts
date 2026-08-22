import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { MarketObservation } from '../domain/coach';
import { selectCoachPhase } from '../orchestration/coachPhaseRouter';
import { CoachProviderError, type CoachProvider } from '../providers/coachProvider';
import type { CandidateStore } from '../data/candidateStore';
import type { HhVacancySample } from '../connectors/hhVacancySearch';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import { coachTurnRequestSchema } from './schemas';

type Handler = (
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<unknown>;

function marketObservationsFrom(sample: HhVacancySample) {
  return sample.items.map((item) => ({
    ref: `market:hh:${item.id}`,
    source: sample.source,
    title: item.title,
    company: item.company,
    location: item.location,
    sourceUrl: item.sourceUrl,
    observedAt: sample.fetchedAt,
  }));
}

function nextCoachPhase(
  snapshot: ReturnType<CandidateStore['getSnapshot']>,
  content: string,
): ReturnType<typeof selectCoachPhase> {
  const latestCompleted = [...snapshot.turns]
    .reverse()
    .find((turn) => turn.status === 'completed' && turn.result);
  return selectCoachPhase({
    content,
    previousPhase: latestCompleted?.result?.phase ?? null,
  });
}

function providerResponse(
  request: FastifyRequest,
  output: Awaited<ReturnType<CoachProvider['createTurn']>>,
) {
  return {
    data: output.result,
    meta: {
      requestId: request.id,
      provider: output.provider,
      model: output.model,
      responseId: output.responseId,
      usage: output.usage,
      routing: output.routing,
    },
  };
}

async function fetchMarketObservations(
  deps: RouteDeps,
  candidateId: string,
  idempotencyKey: string,
  marketQuery: string,
): Promise<MarketObservation[] | 'unavailable'> {
  try {
    const sample = await deps.searchVacancies({ text: marketQuery, perPage: 12 });
    return marketObservationsFrom(sample);
  } catch {
    deps.candidateStore.failTurn(candidateId, idempotencyKey, 'market_source_unavailable');
    return 'unavailable';
  }
}

async function completeTurnWithProvider(
  deps: RouteDeps,
  candidateId: string,
  key: string,
  input: Parameters<CoachProvider['createTurn']>[0],
) {
  try {
    const output = await deps.coachProvider.createTurn(input, key);
    deps.candidateStore.completeTurn(candidateId, key, output);
    return output;
  } catch (error) {
    deps.candidateStore.failTurn(
      candidateId,
      key,
      error instanceof CoachProviderError ? error.code : 'internal_error',
    );
    throw error;
  }
}

const handleCoachTurn: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;

  const parsedKey = z.string().uuid().safeParse(request.headers['idempotency-key']);
  if (!parsedKey.success) {
    return sendError(
      reply,
      request,
      400,
      'idempotency_key_required',
      'Передайте корректный Idempotency-Key.',
      false,
    );
  }
  const key = parsedKey.data;
  const body = coachTurnRequestSchema.parse(request.body);
  const phase = nextCoachPhase(candidateStore.getSnapshot(candidate.id), body.content);
  const started = candidateStore.startTurn(candidate.id, key, { ...body, phase });
  if (started.state === 'completed') {
    return providerResponse(request, started.output);
  }

  let marketObservations: MarketObservation[] = [];
  if (phase === 'market' && body.marketQuery) {
    const observations = await fetchMarketObservations(
      deps,
      candidate.id,
      key,
      body.marketQuery,
    );
    if (observations === 'unavailable') {
      return sendError(
        reply,
        request,
        502,
        'market_source_unavailable',
        'hh.ru не вернул свежую выборку. Повторите позже.',
        true,
      );
    }
    marketObservations = observations;
  }

  const output = await completeTurnWithProvider(deps, candidate.id, key, {
    ...started.input,
    marketObservations,
  });
  return providerResponse(request, output);
};

export async function registerCoachRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.post(
    '/api/v1/coach/turn',
    {
      handlerTimeout: 180_000,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    withDeps(deps, handleCoachTurn),
  );
}
