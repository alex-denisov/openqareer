/**
 * B759: остановка обслуживания не ждёт чужую площадку. Прод 25.11: после SIGTERM волна
 * опроса брала следующие площадки, и все семь остановок за ночь упёрлись в срок 60 с.
 * Начатое чтение получает короткий срок после отмены: обход hh за него отдаёт прочитанное.
 */
export const STOP_READING_GRACE_MS = 20_000;

/** Чтение, которое остановка не дождалась: площадка не виновата, её состояние не меняется. */
export class ReadingStopped extends Error {
  constructor() {
    super('vacancy_source_reading_stopped');
    this.name = 'ReadingStopped';
  }
}

export async function untilStopped<T>(
  reading: Promise<T>,
  signal: AbortSignal | undefined,
  graceMs: number,
): Promise<T> {
  if (!signal) return reading;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const stopped = new Promise<never>((_, reject) => {
    onAbort = () => {
      timer = setTimeout(() => reject(new ReadingStopped()), graceMs);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([reading, stopped]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}
