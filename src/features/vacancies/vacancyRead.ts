/**
 * Чтение пула не ждёт бесконечно.
 *
 * На проде `GET /api/v1/candidate/matched-vacancies` отдаёт заголовки `200` и
 * не отдаёт тело: соединение остаётся открытым минутами. Экран, который просто
 * ждёт промис, показывает «Читаем собранный пул вакансий…» вечно, и кандидат
 * не может отличить долгий ответ от мёртвого. Ожидание ограничено, а истёкшее
 * ожидание — такой же честный отказ, как ошибка сети.
 */
export const VACANCY_READ_TIMEOUT_MS = 20_000;

export async function withDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = VACANCY_READ_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Сколько страниц подбора экран готов прочитать за один заход. */
export const MATCHED_POOL_PAGE_LIMIT = 60;

export interface MatchedPoolRead<T> {
  readonly items: T[];
  readonly total: number;
  /** `false` — часть пула осталась непрочитанной; счётчик не врёт об этом. */
  readonly complete: boolean;
}

interface PoolPage<T> {
  readonly items: T[];
  readonly total: number;
  readonly nextOffset: number | null;
}

/**
 * Подбор приходит страницами: целиком тело не доезжает до браузера (INC-029).
 *
 * Первая страница — это и есть ответ: если она не пришла, читать нечего и
 * отказ уходит наверх. Оборвавшееся продолжение не отменяет прочитанного —
 * экран показывает то, что дошло, и честно говорит, что это не весь пул.
 */
export async function collectMatchedPool<T>(
  loadPage: (offset: number) => Promise<PoolPage<T>>,
  pageLimit: number = MATCHED_POOL_PAGE_LIMIT,
): Promise<MatchedPoolRead<T>> {
  const first = await loadPage(0);
  const items = [...first.items];
  let offset = first.nextOffset;
  let pages = 1;

  while (offset !== null && pages < pageLimit) {
    let next: PoolPage<T>;
    try {
      next = await loadPage(offset);
    } catch {
      return { items, total: first.total, complete: false };
    }
    items.push(...next.items);
    offset = next.nextOffset;
    pages += 1;
    if (next.items.length === 0) break;
  }

  return { items, total: first.total, complete: offset === null };
}
