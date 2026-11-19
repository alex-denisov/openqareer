import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CANDIDATE_STATUSES, TARGET_PROFESSION_MAX_LENGTH } from '../../shared/candidateStatus';
import { DEFAULT_ACCOUNT_TIMEZONE, isValidTimezone } from '../../shared/timezoneUtils';
import type { AutomationPausePort } from '../candidate/automationPausePort';
import {
  candidateStatusToday,
  changeCandidateStatus,
  previewCandidateStatus,
  readCandidateStatus,
  revertCandidateStatus,
  StatusRevertUnavailableError,
  StatusUnchangedError,
  type CandidateStatusDeps,
} from '../candidate/candidateStatusService';
import { SqliteCandidateStatusRepository } from '../candidate/sqliteCandidateStatusRepository';
import type { CandidateIdentity } from '../data/candidateStore';
import { normalizeTargetProfession, type StatusChoice } from '../domain/candidateStatus';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';
import { registerB640NotificationRoutes } from './b640NotificationRoutes';
import { registerGrowthGoalRoutes } from './growthGoalRoutes';
import { registerProfessionPathRoutes } from './professionPathRoutes';
import { registerRelocationPayRoutes } from './relocationPayRoutes';
import { registerRelocationPlacesRoutes } from './relocationPlacesRoutes';
import { registerStatusSignalRoutes } from './statusSignalRoutes';

/**
 * B665: статус кандидата для кабинета B640. Каждый маршрут начинается с
 * `requireCabinetB640`: без флага адреса отвечают как несуществующие.
 */
export type CandidateStatusRouteDeps = RouteDeps & {
  readonly automationPause: AutomationPausePort;
  readonly candidateStatusRepository?: SqliteCandidateStatusRepository;
  /** B691: отклики, отправленные автооткликом; сигналы «Сегодня» их не считают. */
  readonly autoAppliedApplicationIds?: (candidateId: string) => ReadonlySet<string>;
};

type BoundDeps = RouteDeps & { readonly status: CandidateStatusDeps };
type Handler = (deps: BoundDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
interface Signed {
  readonly candidate: CandidateIdentity;
  readonly userId: string;
}

const choiceSchema = z.object({
  status: z.enum(CANDIDATE_STATUSES),
  targetProfession: z
    .string()
    .max(TARGET_PROFESSION_MAX_LENGTH * 2)
    .nullish(),
});
const changeSchema = choiceSchema.extend({
  options: z.object({ pauseAutoApply: z.boolean().optional() }).strict().optional(),
});

function signedIn(deps: BoundDeps, request: FastifyRequest, reply: FastifyReply): Signed | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  return { candidate: principal.candidate, userId: principal.userId };
}

function accountTimezone(deps: BoundDeps, userId: string): string {
  const timezone = deps.authService.getUser?.(userId)?.timezone;
  return timezone && isValidTimezone(timezone) ? timezone : DEFAULT_ACCOUNT_TIMEZONE;
}

function invalidStatus(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendError(reply, request, 400, 'invalid_status', 'Выберите один из пяти статусов.', false);
}

function choiceFrom(input: z.infer<typeof choiceSchema>): StatusChoice {
  return {
    status: input.status,
    targetProfession: normalizeTargetProfession(input.status, input.targetProfession),
  };
}

const getStatus: Handler = async (deps, request, reply) => {
  const signed = signedIn(deps, request, reply);
  if (!signed) return reply;
  const state = readCandidateStatus(deps.status, signed.candidate.id, new Date());
  return { data: state, meta: { requestId: request.id } };
};

const previewStatus: Handler = async (deps, request, reply) => {
  const signed = signedIn(deps, request, reply);
  if (!signed) return reply;
  const parsed = choiceSchema.safeParse(request.body ?? {});
  if (!parsed.success) return invalidStatus(request, reply);
  const preview = previewCandidateStatus(
    deps.status,
    signed.candidate.id,
    choiceFrom(parsed.data),
    new Date(),
  );
  return { data: { preview }, meta: { requestId: request.id } };
};

const putStatus: Handler = async (deps, request, reply) => {
  const signed = signedIn(deps, request, reply);
  if (!signed) return reply;
  const parsed = changeSchema.safeParse(request.body ?? {});
  if (!parsed.success) return invalidStatus(request, reply);
  try {
    const result = changeCandidateStatus(deps.status, {
      candidateId: signed.candidate.id,
      to: choiceFrom(parsed.data),
      options: parsed.data.options ?? {},
      now: new Date(),
      timezone: accountTimezone(deps, signed.userId),
    });
    return {
      data: { ...result.state, applied: result.applied },
      meta: { requestId: request.id },
    };
  } catch (error) {
    if (error instanceof StatusUnchangedError) {
      return sendError(reply, request, 409, 'status_unchanged', error.message, false);
    }
    throw error;
  }
};

const revertStatus: Handler = async (deps, request, reply) => {
  const signed = signedIn(deps, request, reply);
  if (!signed) return reply;
  try {
    const state = revertCandidateStatus(deps.status, signed.candidate.id, new Date());
    return { data: state, meta: { requestId: request.id } };
  } catch (error) {
    if (error instanceof StatusRevertUnavailableError) {
      return sendError(reply, request, 409, 'status_revert_unavailable', error.message, false);
    }
    throw error;
  }
};

const getStatusToday: Handler = async (deps, request, reply) => {
  const signed = signedIn(deps, request, reply);
  if (!signed) return reply;
  const today = candidateStatusToday(deps.status, signed.candidate.id, new Date());
  return { data: { today }, meta: { requestId: request.id } };
};

export function registerCandidateStatusRoutes(
  app: FastifyInstance,
  deps: CandidateStatusRouteDeps,
): void {
  const repository =
    deps.candidateStatusRepository ??
    new SqliteCandidateStatusRepository({
      databasePath: deps.config.databasePath,
      encryptionKey: deps.config.dataEncryptionKey,
    });
  if (!deps.candidateStatusRepository) app.addHook('onClose', async () => repository.close());
  const bound: BoundDeps = {
    ...deps,
    status: {
      repository,
      automationPause: deps.automationPause,
      changeLog: deps.candidateStore.profileChangeLog,
    },
  };
  const write = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  app.get('/api/v1/candidate/status', withDeps(bound, getStatus));
  app.post('/api/v1/candidate/status/preview', withDeps(bound, previewStatus));
  app.put('/api/v1/candidate/status', write, withDeps(bound, putStatus));
  app.post('/api/v1/candidate/status/revert', write, withDeps(bound, revertStatus));
  app.get('/api/v1/candidate/status/today', withDeps(bound, getStatusToday));
  // B691: сигналы «Сегодня» читают тот же статус; свои маршруты закрыты тем же флагом.
  registerStatusSignalRoutes(app, { ...deps, statusRepository: repository });
  // B669: путь в новую профессию читает целевую профессию из того же статуса.
  registerProfessionPathRoutes(app, { ...deps, statusRepository: repository });
  // B670: цель роста при «Работаю».
  registerGrowthGoalRoutes(app, deps);
  // B653 C06: вилки мест для «Релокации».
  registerRelocationPayRoutes(app, deps);
  registerRelocationPlacesRoutes(app, deps);
  registerB640NotificationRoutes(app, deps);
}
