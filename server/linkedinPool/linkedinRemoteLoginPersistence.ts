import type { Cookie } from 'playwright';
import type { RemoteLoginActor } from './linkedinRemoteLogin';
import { isLinkedinSessionCookieDomain, type LinkedinSessionCookie } from './sessionContract';
import type { SqliteLinkedinPoolRepository } from './sqliteLinkedinPoolRepository';

const FALLBACK_MARKER = 'server-browser-login';

/** Cookie Playwright -> формат реестра; чужие домены и непригодные значения отбрасываются. */
export function toPoolSessionCookies(cookies: readonly Cookie[]): LinkedinSessionCookie[] {
  return cookies
    .filter(
      (cookie) =>
        isLinkedinSessionCookieDomain(cookie.domain) &&
        cookie.value.length > 0 &&
        !cookie.value.includes(';') &&
        (cookie.sameSite !== 'None' || cookie.secure),
    )
    .map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expiresAt: cookie.expires > 0 ? Math.floor(cookie.expires) : null,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
    }));
}

/**
 * Вход в браузере сервера завершён: аккаунт становится готовым так же, как после
 * переноса из приложения, а cookie сохраняются для совместимости (запасной путь исполнителя).
 */
export async function persistRemoteLogin(
  repository: SqliteLinkedinPoolRepository,
  accountId: string,
  cookies: readonly Cookie[],
  actor: RemoteLoginActor,
): Promise<void> {
  const account = repository.findAccount(accountId);
  if (!account) throw new Error('linkedin_account_not_found');
  const { lease } = await repository.beginLogin(accountId, actor);
  await repository.completeLogin(accountId, lease.handle, {
    state: 'ready',
    accountMarker: account.providerAccountMarker?.trim() || FALLBACK_MARKER,
  });
  repository.storeSessionCookies(accountId, toPoolSessionCookies(cookies), actor);
}
