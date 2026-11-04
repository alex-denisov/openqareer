/** `SQLITE_BUSY` (errcode 5) из node:sqlite после истечения busy_timeout. */
export function isSqliteBusy(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const details = error as Error & { code?: string; errcode?: number; errstr?: string };
  return (
    details.code === 'ERR_SQLITE_ERROR' &&
    (details.errcode === 5 || /database is locked/iu.test(details.errstr ?? error.message))
  );
}

/**
 * Прод 03.11: `POST /pitch` получил 503 `storage_busy` за 231 мс, это не ожидание busy_timeout, а
 * короткая занятость записи. Такую занятость запрос переживает сам: кандидат не должен нажимать
 * «повторить». Повторяется только работа без внешних вызовов, она не дублирует вызов модели.
 */
const BUSY_RETRY_DELAYS_MS: readonly number[] = [150, 400, 1_000, 2_000];

export async function retryOnSqliteBusy<T>(
  work: () => T | Promise<T>,
  options: { readonly delaysMs?: readonly number[] } = {},
): Promise<T> {
  const [delay, ...rest] = options.delaysMs ?? BUSY_RETRY_DELAYS_MS;
  try {
    return await work();
  } catch (error) {
    if (delay === undefined || !isSqliteBusy(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return retryOnSqliteBusy(work, { delaysMs: rest });
  }
}
