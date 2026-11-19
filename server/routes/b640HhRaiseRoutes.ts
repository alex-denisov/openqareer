import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  HH_RAISE_EVERY_HOURS,
  type B640HhRaiseClaim,
  type B640HhRaiseState,
} from '../../shared/b640HhRaise';
import { HH_RESUME_ID } from '../../shared/hhCandidateSession';
import { applyOutcome, canRaiseAt, firstRaiseAt, raiseAvailableAt } from '../candidate/hhRaiseSchedule';
import { SqliteHhRaiseRepository, type HhRaiseScheduleRow } from '../candidate/sqliteHhRaiseRepository';
import { SqliteHhSessionRepository } from '../candidate/sqliteHhSessionRepository';
import { sessionCandidate } from './b640VacancyContext';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

const resumeId = z.string().regex(HH_RESUME_ID);
const querySchema = z.object({ resumeId: resumeId.optional() }).strict();
const toggleSchema = z.object({ enabled: z.boolean(), resumeId: resumeId.optional() }).strict();
const resultSchema = z
  .object({ outcome: z.enum(['ok', 'captcha', 'logged_out', 'foreign_page', 'too_early', 'error']) })
  .strict();
const emptyBody = z.object({ resumeId: resumeId.optional() }).strict().nullish();
const taskParams = z.object({ taskId: z.string().uuid() });

interface Stores {
  readonly raise: SqliteHhRaiseRepository;
  readonly hh: SqliteHhSessionRepository;
}
type Handler = (stores: Stores, candidateId: string, request: FastifyRequest, reply: FastifyReply) => unknown;

const answer = (request: FastifyRequest, data: unknown) => ({ data, meta: { requestId: request.id } });

function viewOf(connected: boolean, id: string | null, row: HhRaiseScheduleRow | null): B640HhRaiseState {
  return {
    connected, resumeId: id,
    // Для подключённого hh расписание включено по умолчанию.
    enabled: row ? row.enabled : connected,
    everyHours: HH_RAISE_EVERY_HOURS,
    lastRaisedAt: row?.lastRaisedAt ?? null,
    nextRaiseAt: row?.enabled === false ? null : (row?.nextRaiseAt ?? null),
    lastResult: row?.lastResult && row.lastResultAt
      ? { status: row.lastResult, reason: row.lastReason, at: row.lastResultAt } : null,
    pausedUntil: row?.pausedUntil ?? null,
    pauseReason: row?.pauseReason ?? null,
  };
}

/** Резюме, о котором речь: из запроса, если оно есть в снимке, иначе первое. */
function pickResume(stores: Stores, candidateId: string, wanted?: string) {
  const listed = stores.hh.getSnapshot(candidateId)?.resumes ?? [];
  const id = wanted ? (listed.some((item) => item.id === wanted) ? wanted : null) : (listed[0]?.id ?? null);
  return { connected: listed.length > 0, id, unknown: Boolean(wanted) && id === null };
}

function withResume(handler: (s: Stores, c: string, id: string, req: FastifyRequest, rep: FastifyReply) => unknown, wanted: (r: FastifyRequest) => string | undefined): Handler {
  return (stores, candidateId, request, reply) => {
    const picked = pickResume(stores, candidateId, wanted(request));
    if (!picked.id) {
      return sendError(reply, request, picked.unknown ? 404 : 409,
        picked.unknown ? 'hh_resume_not_found' : 'hh_not_connected',
        picked.unknown ? 'Такого резюме нет.' : 'hh.ru не подключён.', false);
    }
    return handler(stores, candidateId, picked.id, request, reply);
  };
}

const getState: Handler = (stores, candidateId, request, reply) => {
  const query = querySchema.safeParse(request.query);
  if (!query.success) return sendError(reply, request, 400, 'invalid_hh_raise_query', 'Запрос заполнен неверно.', false);
  const picked = pickResume(stores, candidateId, query.data.resumeId);
  if (picked.unknown) return sendError(reply, request, 404, 'hh_resume_not_found', 'Такого резюме нет.', false);
  if (!picked.id) return answer(request, viewOf(false, null, null));
  const now = new Date();
  // Расписание заводится при первом чтении подключённого резюме: первое поднятие со сдвигом.
  const row = stores.raise.getSchedule(candidateId, picked.id) ?? stores.raise.patchSchedule(
    candidateId, picked.id, { nextRaiseAt: firstRaiseAt(now) }, now.toISOString());
  return answer(request, viewOf(true, picked.id, row));
};

const putToggle = withResume((stores, candidateId, id, request, reply) => {
  const body = toggleSchema.safeParse(request.body);
  if (!body.success) return sendError(reply, request, 400, 'invalid_hh_raise', 'Запрос заполнен неверно.', false);
  const now = new Date();
  const current = stores.raise.getSchedule(candidateId, id);
  const reconnect = body.data.enabled && current?.pauseReason === 'logged_out';
  const row = stores.raise.patchSchedule(candidateId, id, {
    enabled: body.data.enabled,
    ...(reconnect ? { pauseReason: null, pausedUntil: null } : {}),
    ...(body.data.enabled && !current?.nextRaiseAt ? { nextRaiseAt: firstRaiseAt(now) } : {}),
  }, now.toISOString());
  return answer(request, viewOf(true, id, row));
}, (request) => (request.body as { resumeId?: string } | null)?.resumeId);

const postRetry = withResume((stores, candidateId, id, request, reply) => {
  const refuse = (status: number, code: string, message: string, details?: Record<string, unknown>) =>
    sendError(reply, request, status, code, message, false, undefined, details);
  if (!emptyBody.safeParse(request.body).success) return refuse(400, 'invalid_hh_raise', 'Запрос заполнен неверно.');
  const now = new Date();
  const row = stores.raise.getSchedule(candidateId, id);
  if (row?.lastResult !== 'error') return refuse(409, 'hh_raise_nothing_to_retry', 'Повторять нечего.');
  if (row.pauseReason === 'logged_out') return refuse(409, 'hh_reconnect_required', 'Войдите в hh.ru заново.');
  if (row.pauseReason === 'captcha' && row.pausedUntil && Date.parse(row.pausedUntil) > now.getTime()) {
    return refuse(409, 'hh_raise_paused', 'Поднятие приостановлено.', { pausedUntil: row.pausedUntil });
  }
  if (!canRaiseAt(row.lastRaisedAt, now)) {
    return refuse(409, 'hh_raise_too_early', 'Резюме можно поднимать раз в 4 часа.',
      { raiseAvailableAt: raiseAvailableAt(row.lastRaisedAt as string) });
  }
  if (!stores.raise.hasOpenTask(candidateId, id)) stores.raise.enqueue(candidateId, id, now.toISOString());
  const queued = stores.raise.patchSchedule(candidateId, id, { enabled: true, pauseReason: null, pausedUntil: null, nextRaiseAt: now.toISOString() }, now.toISOString());
  return answer(request, viewOf(true, id, queued));
}, (request) => (request.body as { resumeId?: string } | null)?.resumeId);

/** Клиент берёт задание и исполняет его в окне сессии кандидата; сервер в hh не ходит. */
const postClaim: Handler = (stores, candidateId, request) => {
  const task = stores.raise.claim(candidateId, new Date().toISOString());
  const body: B640HhRaiseClaim = { task: task ? { taskId: task.id, resumeId: task.resumeId } : null };
  return answer(request, body);
};

const postResult: Handler = (stores, candidateId, request, reply) => {
  const params = taskParams.safeParse(request.params);
  const body = resultSchema.safeParse(request.body);
  if (!params.success || !body.success) {
    return sendError(reply, request, 400, 'invalid_hh_raise_result', 'Исход не записался.', false);
  }
  const now = new Date();
  const task = stores.raise.finish(candidateId, params.data.taskId, now.toISOString());
  if (!task) return sendError(reply, request, 409, 'hh_raise_task_closed', 'Это задание закрыто или чужое.', false);
  const row = stores.raise.patchSchedule(candidateId, task.resumeId, applyOutcome(body.data.outcome, now), now.toISOString());
  return answer(request, viewOf(true, task.resumeId, row));
};

function route(deps: RouteDeps, stores: Stores, handler: Handler) {
  return withDeps(deps, async (routeDeps, request, reply) => {
    const principal = requireCabinetB640(request, reply, routeDeps);
    if (!principal) return reply;
    const candidate = sessionCandidate(request, reply, principal.candidate);
    if (!candidate) return reply;
    reply.header('Cache-Control', 'no-store');
    return handler(stores, candidate.id, request, reply);
  });
}

/** B699: автоподнятие резюме hh.ru по расписанию; исполняет клиент, сервер только ведёт расписание и очередь. */
export function registerB640HhRaiseRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { databasePath, dataEncryptionKey } = deps.config;
  const stores: Stores = {
    raise: new SqliteHhRaiseRepository({ databasePath }),
    hh: new SqliteHhSessionRepository({ databasePath, encryptionKey: dataEncryptionKey }),
  };
  app.addHook('onClose', async () => { stores.raise.close(); stores.hh.close(); });
  const base = '/api/v1/candidate/b640/hh/raise';
  const write = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  app.get(base, route(deps, stores, getState));
  app.put(base, write, route(deps, stores, putToggle));
  app.post(`${base}/retry`, write, route(deps, stores, postRetry));
  app.post(`${base}/claim`, write, route(deps, stores, postClaim));
  app.post(`${base}/:taskId/result`, write, route(deps, stores, postResult));
}
