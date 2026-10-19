/**
 * Один шаг воркера соответствия (B523/B524). Обслуживатель пула держит
 * write-lock дольше busy_timeout (PRB-043); занятая база — повод подождать,
 * а не уронить процесс.
 */
export type VacancyMechanicsStepResult = 'processed' | 'idle' | 'busy';

const IDLE_MS = 1_000;
const BUSY_BACKOFF_MS = 5_000;

function isDatabaseBusy(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const details = error as Error & { code?: string; errcode?: number };
  return (
    details.code === 'ERR_SQLITE_ERROR' &&
    (details.errcode === 5 || /database is locked/iu.test(error.message))
  );
}

export async function runVacancyMechanicsStep(
  runNext: () => Promise<boolean>,
  sleep: (ms: number) => Promise<void>,
): Promise<VacancyMechanicsStepResult> {
  try {
    if (await runNext()) return 'processed';
  } catch (error) {
    if (!isDatabaseBusy(error)) throw error;
    await sleep(BUSY_BACKOFF_MS);
    return 'busy';
  }
  await sleep(IDLE_MS);
  return 'idle';
}
