/**
 * Пауза между страницами обхода, которую прерывает остановка процесса (B759):
 * SIGTERM не должен ждать полной паузы, чтобы обход сохранил курсор и вышел.
 */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });
}
