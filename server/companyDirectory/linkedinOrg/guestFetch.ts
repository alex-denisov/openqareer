/**
 * B621: сетевой доступ резолвера — обычный гостевой GET без входа и cookie.
 * Сайт компании: переходы по redirect, тайм-аут, потолок размера ответа.
 */
import type { FetchPage, PageResponse } from './linkedinOrgResolver';

const HEADERS = {
  accept: 'text/html,application/xhtml+xml',
  'accept-language': 'en-US,en;q=0.9',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
} as const;

const TIMEOUT_MS = 15_000;
const MAX_BODY_CHARS = 2_000_000;

export function createGuestFetch(customFetch: typeof fetch = fetch): FetchPage {
  return async (url): Promise<PageResponse> => {
    const response = await customFetch(url, {
      headers: HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await response.text()).slice(0, MAX_BODY_CHARS);
    return { status: response.status, body, finalUrl: response.url || url };
  };
}
