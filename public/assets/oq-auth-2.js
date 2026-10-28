/* B574: a signed-in visitor is marked on <html> before the first paint, so the
 * public header shows «Открыть кабинет» at once instead of «Войти / Найти
 * работу» redrawn seconds later. B575: an administrator is marked too, so
 * «Администрирование» is there from the first paint. The app keeps both flags
 * (signedInFlag.ts): set when the session check answers, removed on sign-out
 * and on 401. They are hints for layout only; the server checks every access.
 * Loaded synchronously from /assets/ because the CSP forbids inline scripts. */
(function () {
  try {
    var root = document.documentElement;
    if (window.localStorage.getItem('oq_signed_in') === '1') {
      root.setAttribute('data-oq-signed-in', '');
      if (window.localStorage.getItem('oq_role') === 'admin') {
        root.setAttribute('data-oq-admin', '');
      }
    }
  } catch (_error) {
    /* Storage blocked: the header shows the guest pair, as before. */
  }
})();
