import type { SelectionLivenessReport } from '../vacancies/selectionLiveness';

const SELECTION_LIVENESS_MS = 60_000;

/** Движок без очереди сверки (тестовые заглушки) таймер не заводит. */
export interface SelectionLivenessEngine {
  runSelectionLivenessStep?(stopped: () => boolean): Promise<SelectionLivenessReport>;
}

interface StepLog {
  info(fields: object, message: string): void;
  error(fields: object, message: string): void;
}

/** B797: такт сверки живости верха подборок; пока идёт один, второй не начинается. */
export function createSelectionLivenessStep(
  engine: SelectionLivenessEngine,
  log: StepLog,
  stopped: () => boolean,
): () => Promise<void> {
  let running = false;
  return async function runSelectionLivenessStep(): Promise<void> {
    if (running || stopped() || !engine.runSelectionLivenessStep) return;
    running = true;
    try {
      const report = await engine.runSelectionLivenessStep(stopped);
      if (report.checked > 0 || report.blocked) log.info({ ...report }, 'selection-liveness-tick');
    } catch (error: unknown) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      log.error({ errorName }, 'selection-liveness-failed');
    } finally {
      running = false;
    }
  };
}

/** Таймер такта; гасится вместе с остальными таймерами воркера. */
export function startSelectionLiveness(
  engine: SelectionLivenessEngine,
  log: StepLog,
  stopped: () => boolean,
): NodeJS.Timeout[] {
  if (!engine.runSelectionLivenessStep) return [];
  const step = createSelectionLivenessStep(engine, log, stopped);
  return [setInterval(() => void step(), SELECTION_LIVENESS_MS)];
}
