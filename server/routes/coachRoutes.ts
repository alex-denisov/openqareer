import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { STAGE_TO_PHASE, type MarketObservation } from '../domain/coach';
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
import { registerCoachResultRoute } from './coachResultRoute';
import { coachTurnRequestSchema, coachProposalRejectRequestSchema } from './schemas';
import { buildCoachSubjectContext } from './coachSubjectContext';

const activeTurns = new WeakMap<RouteDeps, Set<string>>();

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
  if ((request.query as { delivery?: string }).delivery === 'receipt') {
    return { data: { status: 'completed', idempotencyKey: request.headers['idempotency-key'] } };
  }
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

async function deliverTurn(
  deps: RouteDeps, request: FastifyRequest, reply: FastifyReply,
  candidateId: string, key: string,
  input: Omit<Parameters<CoachProvider['createTurn']>[0], 'marketObservations'>,
  marketQuery?: string,
) {
  const active = activeTurns.get(deps) ?? new Set<string>();
  activeTurns.set(deps, active);
  const operation = `${candidateId}:${key}`;
  const pending = () => reply.code(202).send({ data: { status: 'pending', idempotencyKey: key } });
  if (active.has(operation)) return pending();
  active.add(operation);
  const work = generateTurn(deps, candidateId, key, input, marketQuery)
    .finally(() => active.delete(operation));
  if ((request.query as { delivery?: string }).delivery === 'receipt') {
    // Failure is persisted by the worker; polling does not restart generation.
    void work.catch(() => undefined);
    return pending();
  }
  const output = await work;
  if (!output) return sendError(reply, request, 502, 'market_source_unavailable', 'hh.ru не вернул свежую выборку. Повторите позже.', true);
  return providerResponse(request, output);
}

async function generateTurn(
  deps: RouteDeps, candidateId: string, key: string,
  input: Omit<Parameters<CoachProvider['createTurn']>[0], 'marketObservations'>,
  marketQuery?: string,
) {
  let marketObservations: MarketObservation[] = [];
  if (input.phase === 'market' && marketQuery) {
    const fetched = await fetchMarketObservations(deps, candidateId, key, marketQuery);
    if (fetched === 'unavailable') return null;
    marketObservations = fetched;
  }
  return completeTurnWithProvider(deps, candidateId, key, { ...input, marketObservations });
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
  const phase = body.stage
    ? STAGE_TO_PHASE[body.stage]
    : nextCoachPhase(candidateStore.getSnapshot(candidate.id), body.content);

  let stageContext: string | undefined;
  if (body.subject) {
    const context = await buildCoachSubjectContext(deps, candidate.id, body.subject);
    if (context === null) {
      return sendError(
        reply,
        request,
        404,
        'subject_not_found',
        'Объект не найден.',
        false,
      );
    }
    stageContext = context;
  }

  const started = candidateStore.startTurn(candidate.id, key, { ...body, phase, stageContext });
  if (started.state === 'completed') {
    return providerResponse(request, started.output);
  }

  return deliverTurn(deps, request, reply, candidate.id, key, started.input, body.marketQuery);
};

const handleRejectProposal: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;

  const body = coachProposalRejectRequestSchema.parse(request.body);
  candidateStore.rejectConsultantProposal(candidate.id, body.proposalKey, body.reason);
  return reply.code(200).send({ data: { ok: true, proposalKey: body.proposalKey } });
};

export async function registerCoachRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  registerCoachResultRoute(app, deps);
  app.post(
    '/api/v1/coach/turn',
    {
      handlerTimeout: 180_000,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    withDeps(deps, handleCoachTurn),
  );
  app.post(
    '/api/v1/coach/proposals/reject',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    withDeps(deps, handleRejectProposal),
  );
}
