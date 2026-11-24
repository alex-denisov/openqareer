import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { SqliteLetterDraftRepository } from '../candidate/sqliteLetterDraftRepository';
import { retryOnSqliteBusy } from '../data/sqliteBusyRetry';
import { letterFactMark, letterFactSource } from '../domain/letterFreshness';
import { resolveRowVacancyCluster } from '../vacancies/poolVacancyCluster';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';

export type LetterDraftDeps = RouteDeps & { readonly letterDrafts: SqliteLetterDraftRepository };

const draftSchema = z
  .object({
    body: z.string().trim().min(1).max(12_000),
    variantId: z.string().trim().min(1).max(200).optional(),
    /** Профиль, по которому собран показанный текст. */
    profileHash: z.string().max(64).optional(),
  })
  .strict();

/** Тексты вакансии: её числа в письме — не слова кандидата о себе. */
export function letterVacancyTexts(deps: RouteDeps, vacancyId: string): string[] {
  const cluster = resolveRowVacancyCluster(deps.multiSourceEngine, vacancyId);
  if (!cluster) return [];
  return [
    cluster.canonicalTitle,
    cluster.canonicalCompany,
    cluster.canonicalLocation,
    ...cluster.skills,
  ].filter((text): text is string => Boolean(text));
}

async function handleSaveDraft(
  deps: LetterDraftDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const vacancyId = (request.params as { id: string }).id;
  const parsed = draftSchema.safeParse(request.body);
  if (!parsed.success) {
    return sendError(reply, request, 400, 'invalid_letter_draft', 'Проверьте текст письма.', false);
  }
  if (!resolveRowVacancyCluster(deps.multiSourceEngine, vacancyId)) {
    return sendError(reply, request, 404, 'vacancy_not_found', 'Вакансия не найдена.', false);
  }
  const { body, variantId, profileHash } = parsed.data;
  const savedAt = new Date().toISOString();
  await retryOnSqliteBusy(() => {
    const source = letterFactSource(deps.candidateStore.getSnapshot(candidate.id));
    deps.letterDrafts.save(candidate.id, vacancyId, {
      body,
      variantId: variantId ?? null,
      savedAt,
      mark: letterFactMark(source, body, letterVacancyTexts(deps, vacancyId), profileHash),
    });
  });
  return { data: { savedAt }, meta: { requestId: request.id } };
}

async function handleRemoveDraft(
  deps: LetterDraftDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const vacancyId = (request.params as { id: string }).id;
  await retryOnSqliteBusy(() => deps.letterDrafts.remove(candidate.id, vacancyId));
  return { data: { removed: true }, meta: { requestId: request.id } };
}

/** Правка письма до одобрения переживает перезагрузку; одобренное письмо при этом не меняется. */
export function registerLetterDraftRoutes(app: FastifyInstance, deps: LetterDraftDeps): void {
  app.put('/api/v1/candidate/vacancies/:id/letter-draft', withDeps(deps, handleSaveDraft));
  app.delete('/api/v1/candidate/vacancies/:id/letter-draft', withDeps(deps, handleRemoveDraft));
}
