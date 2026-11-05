import { readFileSync } from 'node:fs';

export const SLOW_ORDER_SETUP_MS = 500;

interface CandidateReads<Snapshot, Workspace> {
  getSnapshot(candidateId: string): Snapshot;
  getCandidateWorkspace(candidateId: string): Workspace;
}

type OrderSetupStep = 'snapshotMs' | 'workspaceMs' | 'planMs' | 'orderMs';

function readDiskPressure(): string {
  return readFileSync('/proc/pressure/io', 'utf8').trim();
}

/**
 * Куда уходит время до списка (PRB-041): 3,5–4,8 с на синхронном чтении, причина
 * не установлена. В журнал идёт только медленный случай, без данных кандидата.
 */
export function startOrderSetupTiming<Snapshot, Workspace>(
  store: CandidateReads<Snapshot, Workspace>,
  pressure: () => string = readDiskPressure,
) {
  const startedAt = performance.now();
  const spent: Record<OrderSetupStep, number> = {
    snapshotMs: 0,
    workspaceMs: 0,
    planMs: 0,
    orderMs: 0,
  };
  const step = <T>(name: OrderSetupStep, run: () => T): T => {
    const stepStartedAt = performance.now();
    const result = run();
    spent[name] += performance.now() - stepStartedAt;
    return result;
  };
  let lastSnapshot: Snapshot | undefined;
  const timedStore: CandidateReads<Snapshot, Workspace> = {
    getSnapshot: (candidateId) => {
      const snapshot = step('snapshotMs', () => store.getSnapshot(candidateId));
      lastSnapshot = snapshot;
      return snapshot;
    },
    getCandidateWorkspace: (candidateId) =>
      step('workspaceMs', () => store.getCandidateWorkspace(candidateId)),
  };
  const finish = (log: {
    warn(details: Record<string, unknown>, message: string): void;
  }): number => {
    const totalMs = spent.snapshotMs + spent.workspaceMs + spent.planMs + spent.orderMs;
    const elapsedMs = Math.max(totalMs, performance.now() - startedAt);
    if (elapsedMs < SLOW_ORDER_SETUP_MS) return elapsedMs;
    log.warn(
      {
        ...spent,
        totalMs: elapsedMs,
        snapshotBytes: orNull(() => Buffer.byteLength(JSON.stringify(lastSnapshot) ?? '')),
        pressureIo: orNull(pressure),
      },
      'order-setup-slow',
    );
    return elapsedMs;
  };
  return { store: timedStore, step, finish };
}

/** Журнал не вправе сломать запрос. */
function orNull<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}
