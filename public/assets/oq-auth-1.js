/* B574: a signed-in visitor is marked on <html> before the first paint, so the
 * public header shows «Открыть кабинет» at once instead of «Войти / Найти
 * работу» redrawn seconds later. The app keeps the flag (signedInFlag.ts): set
 * when the session check finds an account, removed on sign-out and on 401.
 * It is a hint for layout only; nothing is trusted on it. Loaded synchronously
 * from /assets/ because the CSP forbids inline scripts. */
(function () {
  try {
    if (window.localStorage.getItem('oq_signed_in') === '1') {
      document.documentElement.setAttribute('data-oq-signed-in', '');
    }
  } catch (_error) {
    /* Storage blocked: the header shows the guest pair, as before. */
  }
})();
