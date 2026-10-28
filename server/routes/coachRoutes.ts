import { withSalaryFloorProposal } from '../domain/careerConditionClaim';
import { buildCoachCareerContext } from './coachCareerContext';
import { adaptationContextFromInput, decorateAdaptationResult, labelAdaptationMessage, scopeAdaptationKnowledge, registerAdaptationCoachRoutes } from './adaptationCoach';
import { extractCandidateFacts, type ExtractedFacts } from '../coach/candidateFactExtractor';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { STAGE_TO_PHASE, type MarketObservation } from '../domain/coach';
import { checkGeneratedTextFacts } from '../domain/generatedTextFactGate';
import { selectCoachPhase } from '../orchestration/coachPhaseRouter';
import { CoachProviderError, type CoachProvider } from '../providers/coachProvider';
import type { CandidateStore } from '../data/candidateStore';
import type { HhVacancySample } from '../connectors/hhVacancySearch';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  requireCandidateLlmAccess,
  sendError,
  withDeps,
} from './helpers';
import { registerCoachResultRoute } from './coachResultRoute';
import { recordNotificationFromSource } from './notificationRepositoryAccess';
import { registerRoleSkillAssessmentRoutes } from './roleSkillAssessmentRoutes';
import { coachTurnRequestSchema, coachProposalRejectRequestSchema } from './schemas';
import { buildCoachSubjectContext } from './coachSubjectContext';
import {
  evaluateSkillQuiz,
  buildSkillVerificationFact,
  createSkillVerificationProposal,
} from '../../src/services/hhSkillQuizzes';
import { runTurnAnalysis } from './coachTurnAnalysis';
import { turnHasAnalysis } from '../orchestration/careerOrchestrator';

const activeTurns = new WeakMap<RouteDeps, Set<string>>();

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

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
  const factsPending = listCandidateFacts(deps, candidateId, key, input);
  // 28.10: in a three-role section the consultant answers first; the analysis follows.
  const split = Boolean(deps.candidateStore.updateCoachTurnResult) && turnHasAnalysis(input);
  try {
    const turn = await deps.coachProvider.createTurn(input, key, split ? { split: 'reply' } : {});
    const replied = split ? { ...turn, result: { ...turn.result, analysis: 'pending' as const } } : turn;
    const raw = decorateAdaptationResult(replied, input);
    // Названный кандидатом порог зарплаты меняется только подтверждаемой карточкой (28.10).
    const generated = { ...raw, result: withSalaryFloorProposal(raw.result, input) };
    // Quick replies are proposed candidate answers, unlike the consultant's
    // general advice. Check them before persistence so replay cannot restore
    // an invented achievement that was suppressed in the initial response.
    const facts = deps.candidateStore.getSnapshot(candidateId).memory;
    const output = generated.result.quickReplies ? {
      ...generated,
      result: {
        ...generated.result,
        quickReplies: generated.result.quickReplies.filter((answer) =>
          checkGeneratedTextFacts(answer, facts).status === 'checked'),
      },
    } : generated;
    deps.candidateStore.completeTurn(candidateId, key, output);
    await proposeListedFacts(deps, candidateId, factsPending);
    return output;
  } catch (error) {
    // A failed reply does not undo what the candidate told us.
    await proposeListedFacts(deps, candidateId, factsPending);
    deps.candidateStore.failTurn(
      candidateId,
      key,
      error instanceof CoachProviderError ? error.code : 'internal_error',
    );
    throw error;
  }
}

/** The bulk extractor reads the candidate's answer while the consultant writes the reply (26.10). */
function listCandidateFacts(
  deps: RouteDeps,
  candidateId: string,
  key: string,
  input: Parameters<CoachProvider['createTurn']>[0],
): Promise<ExtractedFacts> | null {
  const bulk = deps.bulkLlmRuntime?.client;
  const latest = input.messages.at(-1);
  if (!bulk || input.internalPurpose || latest?.role !== 'user') return null;
  const known = deps.candidateStore.getSnapshot(candidateId).memory.map((item) => item.statement);
  return extractCandidateFacts({ bulk, messageId: latest.id, answer: latest.content, runId: `candidate-facts:${key}`, known });
}

async function proposeListedFacts(
  deps: RouteDeps,
  candidateId: string,
  pending: Promise<ExtractedFacts> | null,
): Promise<void> {
  if (!pending) return;
  const listed = await pending;
  if (listed.facts.length > 0) deps.candidateStore.proposeCandidateFacts(candidateId, listed.facts);
  console.warn(JSON.stringify({ event: 'candidate-facts-listed', facts: listed.facts.length, cost: listed.cost, failures: listed.failures }));
}

async function deliverTurn(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  candidateId: string,
  key: string,
  input: Omit<Parameters<CoachProvider['createTurn']>[0], 'marketObservations'>,
  marketQuery?: string,
) {
  const active = activeTurns.get(deps) ?? new Set<string>();
  activeTurns.set(deps, active);
  const operation = `${candidateId}:${key}`;
  const pending = () => reply.code(202).send({ data: { status: 'pending', idempotencyKey: key } });
  if (active.has(operation)) return pending();
  active.add(operation);
  // 28.10: a closed conversation is summarized after the reply, never before it —
  // this turn's context is built at start and does not read the new summary.
  const work = generateTurn(deps, request, candidateId, key, input, marketQuery).finally(() =>
    active.delete(operation),
  );
  if ((request.query as { delivery?: string }).delivery === 'receipt') {
    // Failure is persisted by the worker; polling does not restart generation.
    void work.catch((error: unknown) => {
      request.log.error(
        { err: error, code: error instanceof CoachProviderError ? error.code : 'internal_error' },
        'coach-turn-failed',
      );
    });
    return pending();
  }
  const output = await work;
  if (!output)
    return sendError(
      reply,
      request,
      502,
      'market_source_unavailable',
      'hh.ru не вернул свежую выборку. Повторите позже.',
      true,
    );
  return providerResponse(request, output);
}

async function generateTurn(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  key: string,
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
    const output = await completeTurnWithProvider(deps, candidateId, key, {
      ...input,
      marketObservations,
    });
    if (output.result.analysis === 'pending') {
      void runTurnAnalysis(deps, request, candidateId, key, { ...input, marketObservations });
    }
    if (
      input.internalPurpose !== 'consultant-summary' &&
      output.result.actionProposals.length > 0
    ) {
      recordNotificationFromSource(deps, request, candidateId, {
        kind: 'consultant_edits',
        sourceType: 'coach_turn',
        sourceId: key,
        idempotencyKey: `consultant-edits:${key}`,
      });
    }
    void generatePendingConversationSummaries(deps, request, candidateId, attemptedSummaries);
    return output;
  } catch (error) {
    void generatePendingConversationSummaries(deps, request, candidateId, attemptedSummaries);
    throw error;
  }
}

async function generateClosedConversationSummaries(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  tasks: NonNullable<
    Extract<ReturnType<CandidateStore['startTurn']>, { state: 'ready' }>['closedConversations']
  >,
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
    const tasks = deps.candidateStore
      .listPendingConsultantSummaries(candidateId)
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
  return deliverTurn(
    deps,
    request,
    reply,
    candidateId,
    key,
    started.input,
    marketQuery,
  );
}

const handleCoachTurn: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  if (!requireCandidateLlmAccess(deps, request, reply, candidate.id)) return undefined;

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
  if (body.subject?.kind === 'adaptation' && body.content.length > 7000) return sendError(reply, request, 400, 'adaptation_message_too_long', 'Сократите вопрос до 7000 символов.', false);
  if (body.subject?.kind === 'adaptation' && body.stage !== 'diary') {
    return sendError(reply, request, 400, 'adaptation_stage_required', 'Откройте обсуждение из карьерного дневника.', false);
  }
  const phase = body.stage
    ? STAGE_TO_PHASE[body.stage]
    : nextCoachPhase(candidateStore.getSnapshot(candidate.id), body.content);

  let stageContext: string | undefined;
  if (body.subject) {
    const context = await buildCoachSubjectContext(deps, candidate.id, body.subject);
    if (context === null) {
      return sendError(reply, request, 404, 'subject_not_found', 'Объект не найден.', false);
    }
    stageContext = context;
  }

  const adaptationContext = adaptationContextFromInput({ stageContext });
  if (adaptationContext) body.content = labelAdaptationMessage(deps, candidate.id, key, adaptationContext, body.content);
  const started = candidateStore.startTurn(candidate.id, key, { ...body, phase, stageContext });
  if (body.stage === 'diary' && started.state === 'ready') started.input.knowledgeContext = scopeAdaptationKnowledge(started.input.knowledgeContext, stageContext ?? '');
  if (started.state === 'ready' && !body.subject) started.input.careerContext = readCareerContext(deps, request, candidate.id);
  // A chosen vacancy is the topic itself: its turn needs no live market sample (block C R5).
  const marketQuery = body.subject?.kind === 'vacancy' ? undefined : body.marketQuery;
  return continueStartedTurn(deps, request, reply, candidate.id, key, started, marketQuery);
};

/** Контекст «Карьеры» — подсказка консультанту; его сбой не роняет ход. */
function readCareerContext(deps: RouteDeps, request: FastifyRequest, candidateId: string) {
  try {
    return buildCoachCareerContext(deps, candidateId);
  } catch (error) {
    request.log.warn({ error }, 'coach_career_context_failed');
    return undefined;
  }
}

const handleRejectProposal: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;

  const body = coachProposalRejectRequestSchema.parse(request.body);
  candidateStore.rejectConsultantProposal(candidate.id, body.proposalKey, body.reason);
  return reply.code(200).send({ data: { ok: true, proposalKey: body.proposalKey } });
};

const CAREER_CHANGE_KEY_PREFIX = 'career.';

/** Отказы от изменений «Карьеры» (`career.*`): панель прячет такие предложения после перезагрузки (26.10). */
const handleListCareerChangeRejections: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const keys = candidateStore
    .getConsultantRejections(candidate.id)
    .map((rejection) => rejection.proposalKey)
    .filter((key) => key.startsWith(CAREER_CHANGE_KEY_PREFIX));
  return { data: keys, meta: { requestId: request.id } };
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
  registerAdaptationCoachRoutes(app, deps);
  registerRoleSkillAssessmentRoutes(app, deps);
  app.post(
    '/api/v1/coach/turn',
    {
      handlerTimeout: 180_000,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    withDeps(deps, handleCoachTurn),
  );
  app.get('/api/v1/coach/proposals/career-rejections', withDeps(deps, handleListCareerChangeRejections));
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
