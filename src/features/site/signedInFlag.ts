/**
 * B574: the hint `public/assets/oq-auth-2.js` reads before the first paint.
 * The app sets it as soon as the session check answers, so the next page
 * load draws the right header pair at once. B575 adds the role, so the
 * administrator's console link is drawn at once too. Layout only: no secret,
 * nothing is authorised by it; the server checks every request.
 */
export const SIGNED_IN_FLAG_KEY = 'oq_signed_in';
export const SIGNED_IN_ATTRIBUTE = 'data-oq-signed-in';
export const ROLE_FLAG_KEY = 'oq_role';
export const ADMIN_ATTRIBUTE = 'data-oq-admin';
/**
 * B649: the account saw the new cabinet on this device. Read before the
 * session check answers, so the first frame is the neutral placeholder and the
 * old shell is neither drawn nor preloaded. Layout only, like the keys above.
 */
export const CABINET_B640_FLAG_KEY = 'oq_cabinet_b640';

export function readRememberedCabinetB640(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(CABINET_B640_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberSignedIn(signedIn: boolean, role?: string, cabinetB640 = false): void {
  if (typeof window === 'undefined') return;
  const isAdmin = signedIn && role === 'admin';
  try {
    const storage = window.localStorage;
    if (signedIn) storage.setItem(SIGNED_IN_FLAG_KEY, '1');
    else storage.removeItem(SIGNED_IN_FLAG_KEY);
    if (isAdmin) storage.setItem(ROLE_FLAG_KEY, 'admin');
    else storage.removeItem(ROLE_FLAG_KEY);
    if (signedIn && cabinetB640) storage.setItem(CABINET_B640_FLAG_KEY, '1');
    else storage.removeItem(CABINET_B640_FLAG_KEY);
  } catch {
    // Storage blocked: the attributes below still fix this page.
  }
  const root = document.documentElement;
  root.toggleAttribute(SIGNED_IN_ATTRIBUTE, signedIn);
  root.toggleAttribute(ADMIN_ATTRIBUTE, isAdmin);
}
