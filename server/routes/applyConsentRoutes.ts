import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { APPLY_CONSENT_RESULTS } from '../../shared/applyConsent';
import {
  APPLY_MANDATE_REQUIRED,
  APPLY_MANDATE_VERSION,
  hasApplyMandate,
} from '../candidate/applyMandate';
import { SqliteApplyConsentJournal } from '../candidate/sqliteApplyConsentJournal';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';
import type { RouteDeps } from './deps';
import { hhCandidateOf } from './hhSessionRoutes';
import { sendError, withDeps } from './helpers';

/** B787: журнал согласий по отклику — запись по поручению, результат и чтение кандидатом. */
type BoundDeps = RouteDeps & { readonly journal: SqliteApplyConsentJournal };
type Handler = (deps: BoundDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/u;

function isWebUrl(value: string): boolean {
  try {
    return ['https:', 'http:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const entrySchema = z
  .object({
    id: z.string().uuid(),
    applicationId: z.string().min(1).max(100).nullable(),
    host: z.string().regex(HOSTNAME),
    employer: z.string().trim().min(1).max(300),
    // Текст галочки хранится дословно: пробелы по краям не срезаются.
    checkboxText: z
      .string()
      .max(20_000)
      .refine((text) => text.trim().length > 0),
    policyUrl: z.string().max(2_000).refine(isWebUrl).nullable(),
    policySha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .nullable(),
    checkboxLabel: z.string().min(1).max(2_000).nullable(),
    command: z.string().trim().min(1).max(300),
  })
  .strict()
  .refine((entry) => entry.policyUrl !== null || entry.policySha256 === null);

const resultSchema = z.object({ result: z.enum(APPLY_CONSENT_RESULTS) }).strict();

const listSchema = z.object({
  applicationId: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const REFUSAL = {
  conflict: ['apply_consent_conflict', 'Такая запись уже есть.'],
  full: ['apply_consent_limit', 'Согласие по отклику не записалось.'],
} as const;

const postEntry: Handler = async (deps, request, reply) => {
  const candidateId = hhCandidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const parsed = entrySchema.safeParse(request.body ?? {});
  const ownApplication =
    parsed.success &&
    (parsed.data.applicationId === null ||
      deps.journal.ownsApplication(candidateId, parsed.data.applicationId));
  if (!parsed.success || !ownApplication) {
    return sendError(
      reply,
      request,
      400,
      'invalid_apply_consent',
      'Согласие по отклику не записалось.',
      false,
    );
  }
  if (!hasApplyMandate(deps.capabilityConsentStore, candidateId)) {
    return sendError(
      reply,
      request,
      403,
      APPLY_MANDATE_REQUIRED,
      'Для отклика от вашего имени нужно ваше согласие.',
      false,
    );
  }
  const outcome = deps.journal.append(candidateId, parsed.data, {
    mandateVersion: APPLY_MANDATE_VERSION,
    now: new Date(),
  });
  if (outcome === 'conflict' || outcome === 'full') {
    const [code, message] = REFUSAL[outcome];
    return sendError(reply, request, 409, code, message, false);
  }
  return reply
    .status(outcome === 'created' ? 201 : 200)
    .send({ data: { id: parsed.data.id }, meta: { requestId: request.id } });
};

/** Результат уже начатого отклика записывается и после отзыва поручения. */
const postResult: Handler = async (deps, request, reply) => {
  const candidateId = hhCandidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const parsed = resultSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return sendError(
      reply,
      request,
      400,
      'invalid_apply_consent_result',
      'Результат отклика не записался.',
      false,
    );
  }
  const { id } = request.params as { id: string };
  if (!deps.journal.appendResult(candidateId, id, parsed.data.result, new Date())) {
    return sendError(reply, request, 404, 'apply_consent_not_found', 'Такой записи нет.', false);
  }
  return { data: { id, result: parsed.data.result }, meta: { requestId: request.id } };
};

const getEntries: Handler = async (deps, request, reply) => {
  const candidateId = hhCandidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const parsed = listSchema.safeParse(request.query ?? {});
  if (!parsed.success) {
    return sendError(reply, request, 400, 'invalid_request', 'Некорректный запрос.', false);
  }
  reply.header('Cache-Control', 'no-store');
  return { data: deps.journal.list(candidateId, parsed.data), meta: { requestId: request.id } };
};

export function registerApplyConsentRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const database = new DatabaseSync(deps.config.databasePath);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  applySqliteBusyTimeout(database);
  app.addHook('onClose', async () => database.close());
  const bound: BoundDeps = {
    ...deps,
    journal: new SqliteApplyConsentJournal(database, deps.config.dataEncryptionKey),
  };
  const base = '/api/v1/candidate/apply-consents';
  app.get(base, withDeps(bound, getEntries));
  app.post(base, withDeps(bound, postEntry));
  app.post(`${base}/:id/result`, withDeps(bound, postResult));
}
