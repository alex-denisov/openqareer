/**
 * B792: чтения первого экрана, начатые рядом с вопросом о сессии, до отрисовки оболочки.
 * Экран забирает начатое вместо своего запроса; ключ — сама функция чтения.
 */
type Reader<T> = (signal: AbortSignal) => Promise<T>;

interface Early {
  readonly promise: Promise<unknown>;
  readonly startedAt: number;
}

/** Дольше начатое не ждёт: экран, открытый позже, читает свежее. */
const EARLY_MAX_AGE_MS = 30_000;
const started = new Map<unknown, Early>();

export function startEarlyRead<T>(reader: Reader<T>): void {
  const promise = reader(new AbortController().signal);
  // Ошибку увидит тот, кто возьмёт чтение; здесь она не должна стать «необработанной».
  promise.catch(() => undefined);
  started.set(reader, { promise, startedAt: Date.now() });
}

/** Начатое чтение — один раз; нет, устарело или сорвалось (ушло раньше сессии) — читаем заново. */
export function readEarlyOr<T>(reader: Reader<T>, signal: AbortSignal): Promise<T> {
  const early = started.get(reader);
  started.delete(reader);
  if (!early || Date.now() - early.startedAt >= EARLY_MAX_AGE_MS) return reader(signal);
  return (early.promise as Promise<T>).catch(() => reader(signal));
}

/** Дольше общее чтение не служит: блоки одного экрана приходят раньше. */
const SHARED_MAX_AGE_MS = 10_000;
const shared = new Map<unknown, Early>();

/** Одно чтение на блоки одного экрана: второй блок берёт начатое первым. */
export function shareRead<T>(reader: Reader<T>): Promise<T> {
  const current = shared.get(reader);
  if (current && Date.now() - current.startedAt < SHARED_MAX_AGE_MS) {
    return current.promise as Promise<T>;
  }
  const promise = reader(new AbortController().signal);
  const entry = { promise, startedAt: Date.now() };
  shared.set(reader, entry);
  promise.catch(() => {
    if (shared.get(reader) === entry) shared.delete(reader);
  });
  return promise;
}

export function clearEarlyReads(): void {
  shared.clear();
  started.clear();
}
