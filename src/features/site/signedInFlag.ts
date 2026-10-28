/**
 * B574: the hint `public/assets/oq-auth-1.js` reads before the first paint.
 * The app sets it as soon as the session check answers, so the next page
 * load draws the right header pair at once. Layout only: no secret, nothing
 * is authorised by it.
 */
export const SIGNED_IN_FLAG_KEY = 'oq_signed_in';
export const SIGNED_IN_ATTRIBUTE = 'data-oq-signed-in';

export function rememberSignedIn(signedIn: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (signedIn) window.localStorage.setItem(SIGNED_IN_FLAG_KEY, '1');
    else window.localStorage.removeItem(SIGNED_IN_FLAG_KEY);
  } catch {
    // Storage blocked: the attribute below still fixes this page.
  }
  document.documentElement.toggleAttribute(SIGNED_IN_ATTRIBUTE, signedIn);
}
