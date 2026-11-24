import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { candidateFlagLookup } from '../candidate/hhRaiseQueue';
import type { SqliteCandidateStatusRepository } from '../candidate/sqliteCandidateStatusRepository';
import { runWeeklySelection, type WeeklySelectionJobDeps } from '../candidate/weeklySelectionJob';
import { readTodayMatchedVacancies } from './applicationRoutes';
import type { RouteDeps } from './deps';
import { notificationRepositoryFor } from './notificationRepositoryAccess';

const HOUR_MS = 60 * 60_000;
/** Первый проход — не в окне здоровья выката. */
const FIRST_RUN_MS = 5 * 60_000;

/** B649: без флага нового кабинета фоновая задача кандидата не берёт. */
export function flaggedCandidates(
  candidates: readonly string[],
  isFlagged: (candidateId: string) => boolean,
): readonly string[] {
  return candidates.filter(isFlagged);
}

function readCandidates(
  deps: RouteDeps,
  repository: SqliteCandidateStatusRepository,
): readonly string[] {
  const enabled = repository.weeklySelectionCandidates();
  if (enabled.length === 0) return [];
  const users = new DatabaseSync(deps.config.databasePath, { readOnly: true });
  try {
    return flaggedCandidates(enabled, candidateFlagLookup(users, deps.config));
  } finally {
    users.close();
  }
}

function jobDeps(
  app: FastifyInstance,
  deps: RouteDeps,
  repository: SqliteCandidateStatusRepository,
): WeeklySelectionJobDeps {
  return {
    candidates: () => readCandidates(deps, repository),
    freshVacancies: async (candidateId, since) => {
      const { matched } = await readTodayMatchedVacancies(deps, candidateId);
      const from = since.toISOString();
      return matched
        .filter(
          (item) => item.explanation.roleMatch !== 'none' && item.cluster.firstObservedAt > from,
        )
        .map((item) => item.cluster.id);
    },
    record: (candidateId, input) => notificationRepositoryFor(deps).recordEvent(candidateId, input),
    logError: (candidateId, error) =>
      app.log.error(
        {
          code: 'weekly_selection_candidate_failed',
          candidateId,
          failureType: error instanceof Error ? error.name : 'UnknownError',
        },
        'weekly-selection-candidate-failed',
      ),
  };
}

/**
 * B779: раз в час проверяем, не пора ли разослать недельную подборку. Повтор в ту же неделю
 * не создаёт второго уведомления (ключ недели), поэтому частый проход безопасен.
 */
export function startWeeklySelectionJob(
  app: FastifyInstance,
  deps: RouteDeps,
  repository: SqliteCandidateStatusRepository,
): void {
  const job = jobDeps(app, deps, repository);
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runWeeklySelection(job, new Date());
      if (result.sent > 0 || result.failed > 0) app.log.info(result, 'weekly-selection-run');
    } catch (error) {
      app.log.error(
        {
          code: 'weekly_selection_failed',
          failureType: error instanceof Error ? error.name : 'UnknownError',
        },
        'weekly-selection-failed',
      );
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void run(), FIRST_RUN_MS);
  first.unref();
  const timer = setInterval(() => void run(), HOUR_MS);
  timer.unref();
  app.addHook('onClose', async () => {
    clearTimeout(first);
    clearInterval(timer);
  });
}
