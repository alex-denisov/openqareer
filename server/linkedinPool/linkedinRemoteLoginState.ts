export type RemoteLoginState = 'login' | 'checkpoint' | 'signed_in' | 'closed';

export const REMOTE_LOGIN_KEYS = [
  'Enter',
  'Tab',
  'Backspace',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
] as const;

export type RemoteLoginKey = (typeof REMOTE_LOGIN_KEYS)[number];

export type RemoteLoginInput =
  | { readonly type: 'click'; readonly x: number; readonly y: number }
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'key'; readonly key: RemoteLoginKey };

/** Адрес без query и фрагмента: в токенах и ссылках возврата бывают секреты. */
export function stripUrlQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '';
  }
}

/**
 * Состояние входа по адресу страницы. Неизвестный путь не меняет состояния:
 * LinkedIn ведёт через промежуточные страницы, а `signed_in` ставит только /feed.
 */
export function detectRemoteLoginState(
  url: string,
  previous: Exclude<RemoteLoginState, 'closed'> = 'login',
): Exclude<RemoteLoginState, 'closed'> {
  let pathname: string;
  let host: string;
  try {
    const parsed = new URL(url);
    pathname = parsed.pathname;
    host = parsed.hostname;
  } catch {
    return previous;
  }
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return previous;
  if (pathname === '/feed' || pathname.startsWith('/feed/')) return 'signed_in';
  if (pathname.startsWith('/checkpoint') || pathname.startsWith('/challenge')) return 'checkpoint';
  if (pathname.startsWith('/login') || pathname.startsWith('/uas/') || pathname.startsWith('/authwall')) {
    return 'login';
  }
  return previous;
}
