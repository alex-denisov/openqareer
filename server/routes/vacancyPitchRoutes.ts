import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  filterUsablePitchFacts,
  generateVacancyPitch,
  type PitchLanguage,
  type PitchTone,
  type VacancyPitchInputFact,
} from '../domain/vacancyPitchService';
import { COVER_LETTER_BUDGET_MS, withinTimeBudget } from '../providers/coverLetterWriter';
import type { PitchFactRankingContext } from '../domain/pitchFactRanking';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import { pitchRankingContext } from './pitchRankingContext';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const vacancyPitchInputSchema = z
  .object({
    tone: z.enum(['executive', 'confident', 'technical']).optional(),
    /** Overrides language auto-detected from the vacancy's own text (B266). */
    language: z.enum(['en', 'ru']).optional(),
    /** Saved, candidate-owned cover letter for an application card (B251). */
    applicationId: z.string().trim().min(1).max(200).optional(),
    recipient: z
      .object({
        name: z.string().trim().min(1).max(200).optional(),
        role: z.string().trim().max(200).optional(),
      })
      .optional(),
    vacancy: z
      .object({
        title: z.string().trim().min(1).optional(),
        company: z.string().trim().optional(),
        description: z.string().optional(),
        requiredSkills: z.array(z.string()).optional(),
        responsibilities: z.array(z.string()).optional(),
        location: z.string().optional(),
        isRemote: z.boolean().optional(),
      })
      .optional(),
  })
  .optional();

/**
 * Раскладка времени письма на составляющие: сборка контекста (снимок
 * кандидата + разбор роли кампании) отдельно от ожидания провайдера. Только
 * числа и имя ступени — ни текста письма, ни фактов кандидата (C46).
 */
function logPitchTiming(entry: {
  readonly contextMs: number;
  readonly providerMs: number;
  readonly totalMs: number;
  readonly stage?: string;
}): void {
  console.info(JSON.stringify({ event: 'vacancy-pitch-timing', ...entry }));
}

function toUsableCoverLetterFacts(facts: readonly VacancyPitchInputFact[]) {
  return filterUsablePitchFacts(facts).map((fact) => ({
    ref: fact.id,
    statement: fact.statement,
    domain: fact.domain,
    createdAt: fact.createdAt,
    updatedAt: fact.updatedAt,
    status: fact.status,
  }));
}

/** Model writing is bounded; the deterministic template remains the fallback. */
async function writeCoverLetterBody(
  deps: RouteDeps,
  request: FastifyRequest,
  vacancy: {
    title: string;
    company?: string;
    description?: string;
    requiredSkills: readonly string[];
    recipient?: { name?: string; role?: string };
  },
  facts: readonly VacancyPitchInputFact[],
  language: PitchLanguage,
  tone: PitchTone,
  rankingContext: PitchFactRankingContext | undefined,
  contextMs: number,
): Promise<{ body?: string; stage?: string }> {
  const { coverLetterWriter } = deps;
  if (!coverLetterWriter) return {};
  const writing = coverLetterWriter.writeCoverLetter({
    facts: toUsableCoverLetterFacts(facts),
    vacancy: {
      title: vacancy.title,
      ...(vacancy.company ? { company: vacancy.company } : {}),
      ...(vacancy.description ? { description: vacancy.description } : {}),
      requirements: vacancy.requiredSkills,
      ...(rankingContext ? { rankingContext } : {}),
      ...(vacancy.recipient ? { recipient: vacancy.recipient } : {}),
    },
    language,
    tone,
  });
  const providerStart = Date.now();
  const outcome = await withinTimeBudget(writing, COVER_LETTER_BUDGET_MS);
  const providerMs = Date.now() - providerStart;
  if (outcome.failure) request.log.warn(outcome.failure, 'cover-letter-stage-failed');
  const stage = outcome.stage ?? outcome.failure?.stage;
  logPitchTiming({
    contextMs,
    providerMs,
    totalMs: contextMs + providerMs,
    ...(stage ? { stage } : {}),
  });
  return outcome.body ? { body: outcome.body, stage: outcome.stage } : {};
}

function resolvePitchVacancy(
  body: z.infer<typeof vacancyPitchInputSchema>,
  vacancyId: string,
  cluster: ReturnType<RouteDeps['multiSourceEngine']['getActiveCluster']>,
  poolVacancy: ReturnType<NonNullable<RouteDeps['multiSourceEngine']['getVacancy']>> | undefined,
) {
  return {
    id: vacancyId,
    title: body?.vacancy?.title ?? cluster?.canonicalTitle ?? poolVacancy?.title,
    company: body?.vacancy?.company ?? cluster?.canonicalCompany ?? poolVacancy?.company,
    description:
      body?.vacancy?.description ?? cluster?.descriptionSummary ?? poolVacancy?.description,
    requiredSkills:
      body?.vacancy?.requiredSkills ?? cluster?.skills ?? poolVacancy?.requiredSkills ?? [],
    responsibilities: body?.vacancy?.responsibilities ?? poolVacancy?.responsibilities ?? [],
    location: body?.vacancy?.location ?? cluster?.canonicalLocation ?? poolVacancy?.location,
    isRemote: body?.vacancy?.isRemote ?? cluster?.isRemote ?? poolVacancy?.isRemote ?? false,
    recipient: body?.recipient,
  };
}

function vacancyNotFoundResponse(
  reply: FastifyReply,
  request: FastifyRequest,
  multiSourceEngine: RouteDeps['multiSourceEngine'],
  vacancyId: string,
) {
  if (multiSourceEngine.isKnownVacancyGone(vacancyId)) {
    return sendError(
      reply,
      request,
      410,
      'vacancy_gone',
      'Вакансия снята или обновилась — обновите список.',
      false,
    );
  }
  return sendError(reply, request, 404, 'vacancy_not_found', 'Вакансия не найдена.', false);
}

async function writeVacancyPitch(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  body: z.infer<typeof vacancyPitchInputSchema>,
  vacancy: ReturnType<typeof resolvePitchVacancy> & { title: string },
) {
  const contextStart = Date.now();
  const rankingContext = pitchRankingContext(
    deps.candidateStore,
    deps.titleParseStore,
    candidateId,
    vacancy.title,
  );
  const snapshot = deps.candidateStore.getSnapshot(candidateId);
  const facts = snapshot?.memory ?? [];
  const tone = body?.tone ?? 'executive';
  const pitch = generateVacancyPitch({
    vacancy,
    candidateName: snapshot?.resume?.draft?.candidate?.fullName,
    facts,
    tone,
    ...(rankingContext ? { rankingContext } : {}),
    ...(body?.language ? { language: body.language } : {}),
    ...(body?.recipient ? { recipient: body.recipient } : {}),
  });
  const contextMs = Date.now() - contextStart;
  const written = await writeCoverLetterBody(
    deps,
    request,
    vacancy,
    facts,
    pitch.language,
    tone,
    rankingContext,
    contextMs,
  );
  return { pitch, written, atsCoverLetter: written.body ?? pitch.atsCoverLetter };
}

function saveGeneratedCoverLetter(
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
  applicationId: string,
  content: string,
): void {
  candidateStore.saveDocumentAndLinkApplicationMaterial(
    candidateId,
    applicationId,
    'cover_letter',
    {
      kind: 'cover_letter',
      source: 'generated',
      fileName: 'cover-letter.txt',
      mimeType: 'text/plain',
      contentBase64: Buffer.from(content, 'utf8').toString('base64'),
      parseStatus: 'not_applicable',
    },
  );
}

const handleGenerateVacancyPitch: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config, multiSourceEngine } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const vacancyId = (request.params as { id: string }).id;
  const body = vacancyPitchInputSchema.parse(request.body ?? {});
  if (body?.applicationId && !candidateStore.getApplication(candidate.id, body.applicationId)) {
    return sendError(reply, request, 404, 'application_not_found', 'Отклик не найден.', false);
  }

  const cluster = multiSourceEngine.getActiveCluster(vacancyId);
  const sourceId = vacancyId.startsWith('cluster-')
    ? vacancyId.slice('cluster-'.length)
    : vacancyId;
  const loaded = await multiSourceEngine.loadVacancyDescription(sourceId);
  const poolVacancy = loaded.vacancy ?? multiSourceEngine.getVacancy?.(sourceId);
  const vacancy = resolvePitchVacancy(body, vacancyId, cluster, poolVacancy);
  if (!vacancy.title) {
    return vacancyNotFoundResponse(reply, request, multiSourceEngine, vacancyId);
  }
  const result = await writeVacancyPitch(deps, request, candidate.id, body, {
    ...vacancy,
    title: vacancy.title,
  });
  if (body?.applicationId) {
    saveGeneratedCoverLetter(
      candidateStore,
      candidate.id,
      body.applicationId,
      result.atsCoverLetter,
    );
  }
  return {
    data: {
      ...result.pitch,
      atsCoverLetter: result.atsCoverLetter,
      bodySource: result.written.body ? ('model' as const) : ('template' as const),
      ...(result.written.body && result.written.stage ? { stage: result.written.stage } : {}),
    },
    meta: { requestId: request.id },
  };
};

export function registerVacancyPitchRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    '/api/v1/candidate/vacancies/:id/pitch',
    { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } },
    withDeps(deps, handleGenerateVacancyPitch),
  );
}
