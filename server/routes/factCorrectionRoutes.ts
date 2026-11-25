import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { DatabaseSync } from 'node:sqlite';
import {
  factCorrectionRevertSchema,
  factCorrectionSchema,
  type FactCorrectionOutcome,
} from '../../shared/factCorrection';
import { SqliteResumeEditChoicesRepository } from '../candidate/sqliteResumeEditChoicesRepository';
import { SqliteTextVariantRepository } from '../candidate/sqliteTextVariantRepository';
import { FactCorrectionNotSavedError } from '../data/factCorrectionMethods';
import { SqliteContactMessageRepository } from '../data/sqliteContactMessageRepository';
import { CandidateStoreConflictError } from '../data/store/errors';
import { correctedCopy, type NumberChange } from '../domain/factCorrection';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

/**
 * B796: исправление факта кандидатом. Меняет запись и все её копии; ответ «исправлено» — только после
 * перечитывания записанного. Ещё не отправленное приводится к новому факту: правки резюме под вакансию,
 * сообщения (снова ждут одобрения), варианты текстов. Письма сверяет с профилем `letterFreshness`.
 */
const BASE = '/api/v1/candidate/fact-corrections';

interface Stores {
  readonly edits: SqliteResumeEditChoicesRepository;
  readonly variants: SqliteTextVariantRepository;
  readonly messages: SqliteContactMessageRepository;
}

function refreshEdits(stores: Stores, candidateId: string, changes: readonly NumberChange[]) {
  for (const { vacancyId, choices } of stores.edits.list(candidateId)) {
    const isStale = (text: string) => correctedCopy(text, changes) !== null;
    const texts = Object.fromEntries(
      Object.entries(choices.texts).map(([id, text]) => [id, correctedCopy(text, changes) ?? text]),
    );
    const translations = Object.fromEntries(
      Object.entries(choices.translations ?? {}).filter(
        ([key, value]) => !isStale(key) && !isStale(value),
      ),
    );
    const next = {
      ...choices,
      texts,
      ...(choices.translations ? { translations } : {}),
    };
    if (JSON.stringify(next) !== JSON.stringify(choices)) {
      stores.edits.save(candidateId, vacancyId, next, new Date().toISOString());
    }
  }
}

function refreshMessages(
  stores: Stores,
  candidateId: string,
  changes: readonly NumberChange[],
): number {
  return stores.messages.listUnsent(candidateId).filter(({ id, text }) => {
    const fixed = correctedCopy(text, changes);
    return fixed !== null && stores.messages.updateText(candidateId, id, fixed);
  }).length;
}

function refreshUnsent(stores: Stores, candidateId: string, changes: readonly NumberChange[]) {
  if (changes.length === 0) return { resetMessages: 0, droppedVariants: 0 };
  refreshEdits(stores, candidateId, changes);
  return {
    resetMessages: refreshMessages(stores, candidateId, changes),
    droppedVariants: stores.variants.removeStale(
      candidateId,
      (text) => correctedCopy(text, changes) !== null,
    ),
  };
}

function failure(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof CandidateStoreConflictError) {
    const words = 'Запись изменилась. Откройте её снова.';
    return sendError(reply, request, 409, 'fact_correction_stale', words, false);
  }
  if (error instanceof FactCorrectionNotSavedError) {
    const words = 'Исправить не получилось, запись прежняя.';
    return sendError(reply, request, 500, 'fact_correction_not_saved', words, true);
  }
  throw error;
}

function candidateOf(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply): string | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (principal.candidate) return principal.candidate.id;
  sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
  return null;
}

const invalid = (request: FastifyRequest, reply: FastifyReply) =>
  sendError(reply, request, 400, 'invalid_fact_correction', 'Правка не прошла проверку.', false);

async function handleCorrect(
  deps: RouteDeps,
  stores: Stores,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const candidateId = candidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const parsed = factCorrectionSchema.safeParse(request.body);
  if (!parsed.success) return invalid(request, reply);
  try {
    const { changes, numbers } = deps.candidateStore.correctFact(candidateId, parsed.data);
    const data: FactCorrectionOutcome = { changes, ...refreshUnsent(stores, candidateId, numbers) };
    return { data, meta: { requestId: request.id } };
  } catch (error) {
    return failure(error, request, reply);
  }
}

async function handleRevert(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidateId = candidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const parsed = factCorrectionRevertSchema.safeParse(request.body);
  if (!parsed.success) return invalid(request, reply);
  try {
    deps.candidateStore.revertFactCorrection(candidateId, parsed.data.changes);
    return { data: { reverted: true }, meta: { requestId: request.id } };
  } catch (error) {
    return failure(error, request, reply);
  }
}

export function registerFactCorrectionRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { databasePath, dataEncryptionKey } = deps.config;
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const messages = new SqliteContactMessageRepository({ databasePath });
  app.addHook('onClose', async () => {
    messages.close();
    database.close();
  });
  const stores: Stores = {
    edits: new SqliteResumeEditChoicesRepository(database, dataEncryptionKey),
    variants: new SqliteTextVariantRepository(database, dataEncryptionKey),
    messages,
  };
  const limit = { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } };
  app.post(
    BASE,
    limit,
    withDeps(deps, (d, request, reply) => handleCorrect(d, stores, request, reply)),
  );
  app.post(`${BASE}/revert`, limit, withDeps(deps, handleRevert));
}
