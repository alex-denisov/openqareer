import type { FootprintRemovalResult } from '../../shared/footprintRemoval';
import { createPinnedFetch, type PinnedFetch } from '../vacancies/pinnedFetch';

/**
 * B382: «Проверить находку» — один GET по адресу находки после запроса на удаление.
 * Запрос идёт через закреплённый fetch: только публичные адреса, таймаут и предел тела,
 * перенаправления не открываются. Страницу не разбираем — смотрим только код ответа.
 */
const RECHECK_TIMEOUT_MS = 10_000;
const RECHECK_MAX_BODY_BYTES = 256 * 1024;

const defaultFetch: PinnedFetch = createPinnedFetch({
  timeoutMs: RECHECK_TIMEOUT_MS,
  maxBodyBytes: RECHECK_MAX_BODY_BYTES,
});

/** 404 и 410 — страницы нет; 200 — на месте; перенаправление, запрет и сбой сайта — неясно. */
export function classifyRecheck(status: number): FootprintRemovalResult {
  if (status === 404 || status === 410) return 'removed';
  if (status >= 200 && status < 300) return 'still_there';
  return 'unclear';
}

function httpUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function recheckFindingUrl(
  raw: string,
  fetch: PinnedFetch = defaultFetch,
): Promise<FootprintRemovalResult> {
  const url = httpUrl(raw);
  if (!url) return 'unclear';
  try {
    const response = await fetch({ url, method: 'GET', headers: { accept: 'text/html' } });
    return classifyRecheck(response.status);
  } catch {
    // Закрытый адрес, таймаут или обрыв: итог неизвестен, кандидат повторит позже.
    return 'unclear';
  }
}
