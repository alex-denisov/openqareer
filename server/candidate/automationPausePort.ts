import type { SqliteCandidateActionRepository } from './sqliteCandidateActionRepository';
import type { SqliteCandidateAutomationRepository } from './sqliteCandidateAutomationRepository';
import type { AutoApplyPauseSnapshot } from './sqliteCandidateStatusRepository';

const DAY_MS = 86_400_000;
/** Самая долгая пауза, которую принимает и прежний маршрут паузы. */
const STATUS_PAUSE_DAYS = 365;
const PAUSE_REASON = 'manual_pause';

/**
 * B665: пауза автооткликов при смене статуса. Ставит ту же паузу, что и
 * `POST /candidate/automation/pause`, и умеет вернуть прежнее положение.
 */
export interface AutomationPausePort {
  isPaused(candidateId: string, now: Date): boolean;
  pause(candidateId: string, now: Date): AutoApplyPauseSnapshot;
  /** `false`, если кандидат с тех пор сам поменял паузу — её не трогаем. */
  restore(candidateId: string, snapshot: AutoApplyPauseSnapshot): boolean;
}

function inFuture(value: string | null | undefined, now: Date): boolean {
  return Boolean(value && new Date(value).getTime() > now.getTime());
}

export function createAutomationPausePort(
  automationRepository: SqliteCandidateAutomationRepository,
  actionRepository?: Pick<SqliteCandidateActionRepository, 'setKillSwitch'>,
): AutomationPausePort {
  const scheduler = automationRepository.schedulerRepository;
  const scope = (candidateId: string): string => `candidate:${candidateId}`;
  return {
    isPaused: (candidateId, now) =>
      inFuture(automationRepository.getSettings(candidateId).pausedUntil, now),

    pause(candidateId, now) {
      const settings = automationRepository.getSettings(candidateId);
      const runtime = scheduler.getRuntime(candidateId);
      const appliedUntil = new Date(now.getTime() + STATUS_PAUSE_DAYS * DAY_MS).toISOString();
      actionRepository?.setKillSwitch(scope(candidateId), true, PAUSE_REASON);
      automationRepository.setPause(candidateId, appliedUntil);
      scheduler.setRuntime(candidateId, {
        status: 'paused',
        pauseUntil: appliedUntil,
        nextSendAt: appliedUntil,
      });
      return {
        appliedUntil,
        previousPausedUntil: settings.pausedUntil ?? null,
        previousRuntime: {
          status: runtime.status,
          pauseUntil: runtime.pauseUntil ?? null,
          nextSendAt: runtime.nextSendAt ?? null,
        },
        wasPaused: inFuture(settings.pausedUntil, now),
      };
    },

    restore(candidateId, snapshot) {
      const settings = automationRepository.getSettings(candidateId);
      if (settings.pausedUntil !== snapshot.appliedUntil) return false;
      automationRepository.setPause(candidateId, snapshot.previousPausedUntil);
      scheduler.setRuntime(candidateId, {
        status: snapshot.previousRuntime.status as ReturnType<typeof scheduler.getRuntime>['status'],
        pauseUntil: snapshot.previousRuntime.pauseUntil,
        nextSendAt: snapshot.previousRuntime.nextSendAt,
      });
      if (!snapshot.wasPaused) {
        actionRepository?.setKillSwitch(scope(candidateId), false, PAUSE_REASON);
      }
      return true;
    },
  };
}
