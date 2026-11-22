/**
 * Остановка процесса обслуживания (B759). Порядок: таймеры, отмена обхода
 * (обход hh сохраняет курсор по прочитанному и выходит), остановка волн, и
 * только потом ожидание стартового прохода и закрытие баз.
 *
 * Код выхода всегда 0: SIGTERM — штатная остановка. Если волна не уложилась
 * в срок, базы не закрываются (её запись ещё может вернуться), процесс просто
 * выходит — SQLite откатит незавершённую транзакцию сам.
 */
export interface MaintenanceShutdownDeps {
  readonly stopTimers: () => void;
  readonly abortCollection: () => void;
  readonly stopWorker: () => Promise<{ waveFinished: boolean }>;
  /** Стартовый проход (чтение пула), если он ещё идёт. */
  readonly startup: Promise<unknown> | undefined;
  readonly closeStores: () => void;
  readonly log: {
    info(payload: Record<string, unknown>, message: string): void;
    error(payload: Record<string, unknown>, message: string): void;
  };
  readonly exit: (code: number) => void;
}

export async function shutdownMaintenance(
  signal: string,
  deps: MaintenanceShutdownDeps,
): Promise<void> {
  deps.stopTimers();
  deps.log.info({ signal }, 'maintenance-shutdown-started');
  deps.abortCollection();
  const stopping = deps.stopWorker();
  await deps.startup?.catch(() => undefined);
  const { waveFinished } = await stopping;
  if (!waveFinished) {
    deps.log.error({ signal }, 'maintenance-shutdown-wave-abandoned');
    deps.exit(0);
    return;
  }
  deps.closeStores();
  deps.log.info({ signal, waveFinished }, 'maintenance-shutdown-finished');
  deps.exit(0);
}
