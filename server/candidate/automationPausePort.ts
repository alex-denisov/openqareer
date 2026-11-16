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
 * Возврат снимает только то, что поставила сама смена статуса: аварийную
 * паузу и выключатель, поставленные кем-то ещё, он не трогает.
 */
export interface AutomationPausePort {
  isPaused(candidateId: string, now: Date): boolean;
  pause(candidateId: string, now: Date): AutoApplyPauseSnapshot;
  /** `false`, если кандидат с тех пор сам поменял паузу — её не трогаем. */
  restore(candidateId: string, snapshot: AutoApplyPauseSnapshot): boolean;
}

type KillSwitches = Pick<SqliteCandidateActionRepository, 'setKillSwitch' | 'getKillSwitch'>;

function inFuture(value: string | null | undefined, now: Date): boolean {
  return Boolean(value && new Date(value).getTime() > now.getTime());
}

interface PauseContext {
  readonly automation: SqliteCandidateAutomationRepository;
  readonly killSwitches?: KillSwitches;
}

const scope = (candidateId: string): string => `candidate:${candidateId}`;

/** Ставит выключатель, только если он не стоял; возвращает его метку. */
function raiseKillSwitch(killSwitches: KillSwitches | undefined, candidateId: string): string | null {
  if (!killSwitches || killSwitches.getKillSwitch(scope(candidateId))?.active) return null;
  killSwitches.setKillSwitch(scope(candidateId), true, PAUSE_REASON);
  return killSwitches.getKillSwitch(scope(candidateId))?.updatedAt ?? null;
}

/** Снимает выключатель, только если он наш и его никто не переставлял. */
function lowerKillSwitch(
  killSwitches: KillSwitches | undefined,
  candidateId: string,
  setAt: string | null,
): void {
  if (!killSwitches || !setAt) return;
  const current = killSwitches.getKillSwitch(scope(candidateId));
  if (current?.active && current.updatedAt === setAt) {
    killSwitches.setKillSwitch(scope(candidateId), false, PAUSE_REASON);
  }
}

function pause(context: PauseContext, candidateId: string, now: Date): AutoApplyPauseSnapshot {
  const scheduler = context.automation.schedulerRepository;
  const settings = context.automation.getSettings(candidateId);
  const runtime = scheduler.getRuntime(candidateId);
  const appliedUntil = new Date(now.getTime() + STATUS_PAUSE_DAYS * DAY_MS).toISOString();
  const killSwitchSetAt = raiseKillSwitch(context.killSwitches, candidateId);
  context.automation.setPause(candidateId, appliedUntil);
  const runtimeTouched = !runtime.emergencyPaused;
  if (runtimeTouched) {
    scheduler.setRuntime(candidateId, {
      status: 'paused',
      pauseUntil: appliedUntil,
      nextSendAt: appliedUntil,
    });
  }
  return {
    appliedUntil,
    previousPausedUntil: settings.pausedUntil ?? null,
    previousRuntime: {
      status: runtime.status,
      pauseUntil: runtime.pauseUntil ?? null,
      nextSendAt: runtime.nextSendAt ?? null,
    },
    wasPaused: inFuture(settings.pausedUntil, now),
    runtimeTouched,
    killSwitchSetAt,
  };
}

function restore(
  context: PauseContext,
  candidateId: string,
  snapshot: AutoApplyPauseSnapshot,
): boolean {
  const scheduler = context.automation.schedulerRepository;
  if (context.automation.getSettings(candidateId).pausedUntil !== snapshot.appliedUntil) {
    return false;
  }
  context.automation.setPause(candidateId, snapshot.previousPausedUntil);
  // Аварийная пауза, включённая до или после смены статуса, остаётся как есть.
  if (scheduler.getRuntime(candidateId).emergencyPaused) return true;
  if (snapshot.runtimeTouched) {
    scheduler.setRuntime(candidateId, {
      status: snapshot.previousRuntime.status as ReturnType<typeof scheduler.getRuntime>['status'],
      pauseUntil: snapshot.previousRuntime.pauseUntil,
      nextSendAt: snapshot.previousRuntime.nextSendAt,
    });
  }
  lowerKillSwitch(context.killSwitches, candidateId, snapshot.killSwitchSetAt);
  return true;
}

export function createAutomationPausePort(
  automation: SqliteCandidateAutomationRepository,
  killSwitches?: KillSwitches,
): AutomationPausePort {
  const context: PauseContext = { automation, killSwitches };
  return {
    isPaused: (candidateId, now) => inFuture(automation.getSettings(candidateId).pausedUntil, now),
    pause: (candidateId, now) => pause(context, candidateId, now),
    restore: (candidateId, snapshot) => restore(context, candidateId, snapshot),
  };
}
