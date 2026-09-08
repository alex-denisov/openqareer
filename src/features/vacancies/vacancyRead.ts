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

/**
 * Сколько страниц подбора читается одновременно.
 *
 * Пять — это компромисс между кругами по каналу и залпом. Залп по всем
 * шестидесяти страницам продукт уже пробовал в другом месте: ручной опрос
 * поднял 195 источников разом и сам себе забил канал, после чего записал живым
 * площадкам отказ, которого не было (B202). Пять запросов в полёте сокращают
 * шестьдесят кругов до двенадцати и не создают той же давки.
 */
export const MATCHED_POOL_READ_WIDTH = 5;

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
  /** Смещения всех страниц пула — приходят только с первой (B211). */
  readonly pageOffsets?: readonly number[];
}

/**
 * Подбор приходит страницами: целиком тело не доезжает до браузера (INC-029).
 *
 * Первая страница — это и есть ответ: если она не пришла, читать нечего и
 * отказ уходит наверх. Оборвавшееся продолжение не отменяет прочитанного —
 * экран показывает то, что дошло, и честно говорит, что это не весь пул.
 *
 * Каждая страница отдаётся вызвавшему сразу: пул из пятисот записей читается
 * полусотней ответов, и экран, ждущий последний, дольше десяти секунд стоит на
 * «Читаем пул…» вместо вакансий.
 */
export async function collectMatchedPool<T>(
  loadPage: (offset: number) => Promise<PoolPage<T>>,
  pageLimit: number = MATCHED_POOL_PAGE_LIMIT,
  onPage?: (items: readonly T[], total: number) => void,
): Promise<MatchedPoolRead<T>> {
  const first = await loadPage(0);
  const items = [...first.items];
  onPage?.(first.items, first.total);

  const planned = first.pageOffsets;
  if (planned && planned.length > 1) {
    return readPlannedPages(loadPage, first, items, planned, pageLimit, onPage);
  }

  return readChainedPages(loadPage, first, items, pageLimit, onPage);
}

/**
 * Сервер назвал смещения всех страниц — читать их можно, не ожидая друг друга.
 *
 * Порядок записей задаёт смещение, а не порядок ответов: волна раскладывается
 * в пул по возрастанию смещения, поэтому подбор остаётся отсортированным даже
 * если пятая страница ответила раньше первой.
 */
async function readPlannedPages<T>(
  loadPage: (offset: number) => Promise<PoolPage<T>>,
  first: PoolPage<T>,
  items: T[],
  planned: readonly number[],
  pageLimit: number,
  onPage?: (items: readonly T[], total: number) => void,
): Promise<MatchedPoolRead<T>> {
  const rest = planned.slice(1, Math.max(1, pageLimit));
  let missed = rest.length < planned.length - 1;

  for (let start = 0; start < rest.length; start += MATCHED_POOL_READ_WIDTH) {
    const wave = rest.slice(start, start + MATCHED_POOL_READ_WIDTH);
    const answers = await Promise.all(
      // Непришедшая страница не отменяет остальных: пул уходит в чтение
      // целиком, а провалившееся место остаётся честной дырой в счётчике.
      wave.map((offset) => loadPage(offset).then((page) => page.items).catch(() => null)),
    );
    for (const answer of answers) {
      if (answer === null) {
        missed = true;
        continue;
      }
      items.push(...answer);
      onPage?.(answer, first.total);
    }
  }

  return { items, total: first.total, complete: !missed };
}

/**
 * Сервер смещений не назвал — читаем прежней цепочкой по `nextOffset`.
 *
 * Это не запасной путь на всякий случай: во время выката браузер уже держит
 * новый код, а отвечает ещё старый прод. Цепочка медленная, но она доезжает.
 */
async function readChainedPages<T>(
  loadPage: (offset: number) => Promise<PoolPage<T>>,
  first: PoolPage<T>,
  items: T[],
  pageLimit: number,
  onPage?: (items: readonly T[], total: number) => void,
): Promise<MatchedPoolRead<T>> {
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
    onPage?.(next.items, first.total);
    offset = next.nextOffset;
    pages += 1;
    if (next.items.length === 0) break;
  }

  return { items, total: first.total, complete: offset === null };
}
