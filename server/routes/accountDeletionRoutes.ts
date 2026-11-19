import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  AccountDeletionRequest,
  SqliteAccountDeletionStore,
} from '../auth/accountDeletionStore';
import type { AutomationPausePort } from '../candidate/automationPausePort';
import { requireCabinetB640 } from './cabinetB640Flag';
import { purgeCandidateAccount } from './candidateRoutes';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

/**
 * B689: «Удалить аккаунт» с отсрочкой. Запрос сразу ставит паузу автооткликов
 * и выключатель действий (LinkedIn по расписанию тоже), данные стираются через
 * 30 дней, до этого «Вернуть аккаунт» снимает запрос и паузу.
 */
export type AccountDeletionRouteDeps = RouteDeps & {
  readonly automationPause: AutomationPausePort;
};
type Bound = RouteDeps & {
  readonly automationPause: AutomationPausePort;
  readonly deletions: SqliteAccountDeletionStore;
};
type Handler = (deps: Bound, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const PATH = '/api/v1/candidate/account/deletion';
const SWEEP_EVERY_MS = 60 * 60 * 1_000;
const SWEEP_BATCH = 50;

function view(request: AccountDeletionRequest | null) {
  return request ? { requestedAt: request.requestedAt, purgeAfter: request.purgeAfter } : null;
}

function candidateOf(deps: Bound, request: FastifyRequest, reply: FastifyReply): string | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  return principal.candidate.id;
}

const getDeletion: Handler = async (deps, request, reply) => {
  const candidateId = candidateOf(deps, request, reply);
  if (!candidateId) return reply;
  return { data: view(deps.deletions.get(candidateId)), meta: { requestId: request.id } };
};

const requestDeletion: Handler = async (deps, request, reply) => {
  const candidateId = candidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const now = new Date();
  const existing = deps.deletions.get(candidateId);
  const scheduled =
    existing ??
    deps.deletions.schedule(candidateId, now, deps.automationPause.pause(candidateId, now));
  request.log.info({ purgeAfter: scheduled.purgeAfter }, 'account-deletion-requested');
  return { data: view(scheduled), meta: { requestId: request.id } };
};

const restoreAccount: Handler = async (deps, request, reply) => {
  const candidateId = candidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const cancelled = deps.deletions.cancel(candidateId);
  if (cancelled?.pause) deps.automationPause.restore(candidateId, cancelled.pause);
  if (cancelled) request.log.info('account-deletion-cancelled');
  return reply.code(204).send();
};

export interface SweepInput {
  readonly store: Pick<SqliteAccountDeletionStore, 'listDue' | 'get' | 'remove' | 'postpone'>;
  readonly purge: (candidateId: string) => void;
  readonly now: Date;
  readonly onError?: (candidateId: string, error: unknown) => void;
}

const RETRY_AFTER_MS = 60 * 60 * 1_000;

/**
 * Стирает аккаунты с истёкшим сроком. Перед стиранием запрос перечитывается:
 * «Вернуть аккаунт» мог успеть между выборкой и стиранием (два процесса при
 * выкате). Неудачный откладывается на час и не держит остальных.
 */
export function sweepAccountDeletions({ store, purge, now, onError }: SweepInput): number {
  let purged = 0;
  for (const due of store.listDue(now, SWEEP_BATCH)) {
    const current = store.get(due.candidateId);
    if (!current || new Date(current.purgeAfter).getTime() > now.getTime()) continue;
    try {
      purge(due.candidateId);
      store.remove(due.candidateId);
      purged += 1;
    } catch (error) {
      store.postpone(due.candidateId, new Date(now.getTime() + RETRY_AFTER_MS));
      onError?.(due.candidateId, error);
    }
  }
  return purged;
}

function startSweep(app: FastifyInstance, deps: Bound): void {
  let timer: NodeJS.Timeout | undefined;
  const run = () => {
    const purged = sweepAccountDeletions({
      store: deps.deletions,
      purge: (candidateId) => purgeCandidateAccount(deps, candidateId, app.log),
      now: new Date(),
      onError: (_candidateId, error) =>
        app.log.error(
          { errorName: error instanceof Error ? error.name : 'UnknownError' },
          'account-deletion-purge-failed',
        ),
    });
    if (purged > 0) app.log.info({ purged }, 'account-deletion-purge-completed');
  };
  app.addHook('onReady', async () => {
    run();
    timer = setInterval(run, SWEEP_EVERY_MS);
    timer.unref();
  });
  app.addHook('onClose', async () => {
    if (timer) clearInterval(timer);
  });
}

export function registerAccountDeletionRoutes(
  app: FastifyInstance,
  deps: AccountDeletionRouteDeps,
): void {
  const deletions = deps.accountDeletionStore;
  if (!deletions) return;
  const bound: Bound = { ...deps, deletions };
  const write = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
  app.get(PATH, withDeps(bound, getDeletion));
  app.post(PATH, write, withDeps(bound, requestDeletion));
  app.delete(PATH, write, withDeps(bound, restoreAccount));
  startSweep(app, bound);
}
