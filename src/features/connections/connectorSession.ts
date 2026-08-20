import { desktopNativeFetch } from '../../services/desktop/desktopBridge';

/** Where the connector flow currently stands, for both platforms. */
export type ConnectorSessionStep = 'idle' | 'session_open' | 'checking';

const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/**
 * Opens the platform's own sign-in window. The candidate authenticates on the
 * platform, in their own session — credentials never pass through OpenQareer,
 * which is the whole reason the desktop companion exists.
 */
export function openPlatformSession(url: string, windowName: string): void {
  if (typeof window === 'undefined') return;
  window.open(
    url,
    windowName,
    'width=860,height=760,menubar=no,toolbar=no,location=yes,status=no',
  );
}

export interface SessionPageResult {
  readonly ok: boolean;
  readonly body?: string;
}

/** Reads a page inside the candidate's own desktop session. */
export async function readSessionPage(url: string): Promise<SessionPageResult> {
  const response = await desktopNativeFetch({
    url,
    method: 'GET',
    headers: {
      'User-Agent': DESKTOP_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });
  return { ok: Boolean(response?.ok), body: response?.body };
}

export function looksLikeLinkedInLoginPage(body: string): boolean {
  return (
    body.includes('linkedin.com/checkpoint') ||
    body.includes('session_password') ||
    body.includes('join-form')
  );
}

export function looksLikeHhLoginPage(body: string): boolean {
  return (
    body.includes('account/login') || body.includes('data-qa="account-login-page"')
  );
}

export function looksLikeHhVpnBlock(body: string): boolean {
  return body.includes('VPN мешает работе сайта') || body.includes('vpn-cheeck');
}
