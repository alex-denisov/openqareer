import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isResumeEvidenceEligible } from '../domain/resumeEvidenceEligibility';
import type { StoredMemory } from '../data/candidateStore';
import type { StoredStarStory } from '../data/sqliteStarStoriesRepository';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import {
  MAX_STAR_STORIES_PER_CANDIDATE,
  missingStarResultNumbers,
  starResultHasNumbers,
  starStoryEvidenceStatus,
  type StarStoryFactSummary,
} from '../../shared/starStories';
import {
  starStoryIdSchema,
  starStoryWriteSchema,
  updateStarStorySchema,
} from './starStoryValidation';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

interface StarStoryFactView extends StarStoryFactSummary {
  readonly domain: StoredMemory['domain'];
  readonly createdAt: string;
  readonly unavailable?: boolean;
}

function eligibleFacts(memory: readonly StoredMemory[]): readonly StarStoryFactView[] {
  return memory.filter(isResumeEvidenceEligible).map((fact) => ({
    id: fact.id,
    statement: fact.statement,
    domain: fact.domain,
    createdAt: fact.createdAt,
  }));
}

function storyView(story: StoredStarStory, factById: ReadonlyMap<string, StarStoryFactView>) {
  const sourceFacts = story.sourceFactIds.map(
    (id) =>
      factById.get(id) ?? {
        id,
        statement: 'Факт больше недоступен',
        domain: 'other' as const,
        createdAt: '',
        unavailable: true,
      },
  );
  return {
    ...story,
    confidence: starStoryEvidenceStatus(story.fields.result, story.sourceFactIds, sourceFacts),
    sourceFacts,
  };
}

function loadFacts(deps: RouteDeps, candidateId: string): readonly StarStoryFactView[] {
  // Candidate snapshot only; this does not read or join the vacancy pool.
  return eligibleFacts(deps.candidateStore.getSnapshot(candidateId).memory);
}

function validateSources(
  story: { fields: { result: string }; sourceFactIds: readonly string[] },
  facts: readonly StarStoryFactView[],
): string | null {
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const selected = story.sourceFactIds.map((id) => byId.get(id));
  if (selected.some((fact) => !fact)) return 'star_story_source_fact_not_available';
  if (starResultHasNumbers(story.fields.result)) {
    const missing = missingStarResultNumbers(story.fields.result, selected as StarStoryFactView[]);
    if (missing.length) return 'star_story_result_needs_source';
  }
  return null;
}

const handleListStarStories: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const facts = loadFacts(deps, candidate.id);
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  return {
    data: {
      stories: candidateStore.starStoriesRepo
        .list(candidate.id)
        .map((story) => storyView(story, factById)),
      facts,
    },
    meta: { requestId: request.id },
  };
};

const handleCreateStarStory: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const input = starStoryWriteSchema.parse(request.body);
  const facts = loadFacts(deps, candidate.id);
  const sourceError = validateSources(input, facts);
  if (sourceError)
    return sendError(reply, request, 422, sourceError, userFacingSourceError(sourceError), false);
  const now = new Date().toISOString();
  const story = deps.candidateStore.starStoriesRepo.create(candidate.id, randomUUID(), input, now);
  if (!story) {
    return sendError(
      reply,
      request,
      409,
      'star_story_limit_reached',
      `Достигнут предел в ${MAX_STAR_STORIES_PER_CANDIDATE} STAR-историй. Измените уже сохранённую историю.`,
      false,
    );
  }
  reply.code(201);
  return {
    data: storyView(story, new Map(facts.map((fact) => [fact.id, fact]))),
    meta: { requestId: request.id },
  };
};

const handleUpdateStarStory: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const params = request.params as { id: string };
  const id = starStoryIdSchema.parse(params.id);
  const input = updateStarStorySchema.parse(request.body);
  const current = deps.candidateStore.starStoriesRepo.get(candidate.id, id);
  if (!current)
    return sendError(
      reply,
      request,
      404,
      'star_story_not_found',
      'STAR-история не найдена.',
      false,
    );
  const facts = loadFacts(deps, candidate.id);
  const sourceError = validateSources(input, facts);
  if (sourceError)
    return sendError(reply, request, 422, sourceError, userFacingSourceError(sourceError), false);
  const updated = deps.candidateStore.starStoriesRepo.update(
    candidate.id,
    id,
    input.expectedVersion,
    input,
    new Date().toISOString(),
  );
  if (!updated)
    return sendError(
      reply,
      request,
      409,
      'star_story_version_conflict',
      'История уже изменилась. Обновите список.',
      false,
    );
  return {
    data: storyView(updated, new Map(facts.map((fact) => [fact.id, fact]))),
    meta: { requestId: request.id },
  };
};

function userFacingSourceError(code: string): string {
  return code === 'star_story_result_needs_source'
    ? 'Числа в результате должны совпадать с выбранным подтверждённым фактом.'
    : 'Выберите подтверждённый факт из своего профиля.';
}

/** Candidate-owned STAR stories and their confirmed profile fact references (B466). */
export function registerStarStoryRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get(
    '/api/v1/candidate/star-stories',
    { config: { rateLimit: { max: 240, timeWindow: '1 hour' } } },
    withDeps(deps, handleListStarStories),
  );
  app.post(
    '/api/v1/candidate/star-stories',
    { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } },
    withDeps(deps, handleCreateStarStory),
  );
  app.patch(
    '/api/v1/candidate/star-stories/:id',
    { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } },
    withDeps(deps, handleUpdateStarStory),
  );
}
