import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
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
import {
  evaluateSkillQuiz,
  buildSkillVerificationFact,
  createSkillVerificationProposal,
} from '../../src/services/hhSkillQuizzes';

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
  summaryTasks: NonNullable<Extract<ReturnType<CandidateStore['startTurn']>, { state: 'ready' }>['closedConversations']> = [],
) {
  const active = activeTurns.get(deps) ?? new Set<string>();
  activeTurns.set(deps, active);
  const operation = `${candidateId}:${key}`;
  const pending = () => reply.code(202).send({ data: { status: 'pending', idempotencyKey: key } });
  if (active.has(operation)) return pending();
  active.add(operation);
  const work = generateClosedConversationSummaries(deps, request, candidateId, summaryTasks)
    .then((attempted) => generateTurn(deps, request, candidateId, key, input, marketQuery, attempted))
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
  deps: RouteDeps, request: FastifyRequest, candidateId: string, key: string,
  input: Omit<Parameters<CoachProvider['createTurn']>[0], 'marketObservations'>,
  marketQuery?: string,
  attemptedSummaries: ReadonlySet<string> = new Set(),
) {
  let marketObservations: MarketObservation[] = [];
  if (input.phase === 'market' && marketQuery) {
    const fetched = await fetchMarketObservations(deps, candidateId, key, marketQuery);
    if (fetched === 'unavailable') {
      await generatePendingConversationSummaries(deps, request, candidateId, attemptedSummaries);
      return null;
    }
    marketObservations = fetched;
  }
  try {
    const output = await completeTurnWithProvider(deps, candidateId, key, { ...input, marketObservations });
    await generatePendingConversationSummaries(deps, request, candidateId, attemptedSummaries);
    return output;
  } catch (error) {
    await generatePendingConversationSummaries(deps, request, candidateId, attemptedSummaries);
    throw error;
  }
}

async function generateClosedConversationSummaries(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  tasks: NonNullable<Extract<ReturnType<CandidateStore['startTurn']>, { state: 'ready' }>['closedConversations']>,
): Promise<ReadonlySet<string>> {
  const attempted = new Set<string>();
  for (const task of tasks) {
    if (!deps.candidateStore.claimConsultantSummary(candidateId, task)) continue;
    attempted.add(task.conversationId);
    const summaryInput = deps.candidateStore.getConsultantSummaryInput(candidateId, task);
    if (!summaryInput) {
      deps.candidateStore.releaseConsultantSummaryClaim(candidateId, task);
      continue;
    }
    const summaryKey = createHash('sha256')
      .update(`consultant-summary:${candidateId}:${task.conversationId}:${task.messageCount}`)
      .digest('hex');
    try {
      const result = await deps.coachProvider.createTurn(summaryInput, summaryKey);
      deps.candidateStore.saveConsultantSummary(candidateId, task, result);
    } catch (error) {
      deps.candidateStore.releaseConsultantSummaryClaim(candidateId, task);
      request.log.warn(
        { errorCode: error instanceof CoachProviderError ? error.code : 'internal_error' },
        'consultant summary generation failed',
      );
    }
  }
  return attempted;
}

async function generatePendingConversationSummaries(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  attempted: ReadonlySet<string>,
): Promise<void> {
  try {
    const tasks = deps.candidateStore.listPendingConsultantSummaries(candidateId)
      .filter((task) => !attempted.has(task.conversationId));
    await generateClosedConversationSummaries(deps, request, candidateId, tasks);
  } catch {
    request.log.warn({ errorCode: 'internal_error' }, 'consultant summary queue failed');
  }
}

function continueStartedTurn(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  candidateId: string,
  key: string,
  started: ReturnType<CandidateStore['startTurn']>,
  marketQuery?: string,
) {
  if (started.state === 'completed') return providerResponse(request, started.output);
  return deliverTurn(deps, request, reply, candidateId, key, started.input, marketQuery, started.closedConversations);
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
  return continueStartedTurn(deps, request, reply, candidate.id, key, started, body.marketQuery);
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

const handleVerifySkillQuiz: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;

  const schema = z.object({
    quizId: z.string().min(1).max(80),
    skillName: z.string().min(1).max(120),
    answers: z.record(z.string(), z.number()),
  });
  const body = schema.parse(request.body);
  const result = evaluateSkillQuiz(body.quizId, body.answers);
  const fact = buildSkillVerificationFact(body.skillName, result);
  const proposal = createSkillVerificationProposal(body.skillName, result);

  return reply.code(200).send({
    data: {
      result,
      fact,
      proposal,
    },
  });
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
  app.post(
    '/api/v1/coach/skill-quiz/verify',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    withDeps(deps, handleVerifySkillQuiz),
  );
}
