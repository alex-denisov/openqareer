/**
 * B756 22.11: такт обслуживания — синхронный бросок или отказ обещания — не роняет процесс
 * (два exit 1 за вечер от «database is locked»): строка журнала, следующий такт по расписанию.
 */
export function guardStep(
  log: { error(details: Record<string, unknown>, message: string): void },
  name: string,
  tick: () => unknown,
): void {
  const failed = (error: unknown): void =>
    log.error(
      { step: name, errorName: error instanceof Error ? error.name : 'UnknownError' },
      'maintenance-step-failed',
    );
  try {
    const result = tick();
    if (result instanceof Promise) result.catch(failed);
  } catch (error: unknown) {
    failed(error);
  }
}
