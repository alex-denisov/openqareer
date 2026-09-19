/**
 * The one definition of "what is this platform page showing the candidate".
 *
 * The desktop shell evaluates this inside the candidate's own session webview
 * (`connector_session.rs`), and the live hh.ru evidence gate evaluates the very
 * same text in Chromium (`server/connectors/hh/connectorInspectionScript.ts`).
 * A second, hand-written copy of this predicate would let the gate pass while
 * the desktop stopped recognising a completed sign-in — the failure the owner
 * reported and the one nothing could see (B157).
 *
 * Both callers substitute `__OPENQAREER_PLATFORM__` and
 * `__OPENQAREER_HH_MARKER__` with JSON-encoded values before evaluating.
 * The script must stay a single expression and must never navigate, click or
 * submit: login, MFA and CAPTCHA stay entirely under the candidate's control.
 */
(function () {
  try {
    var platform = __OPENQAREER_PLATFORM__;
    var hhMarkerSelector = __OPENQAREER_HH_MARKER__;
    var q = function (selector) {
      return Boolean(document.querySelector(selector));
    };
    var path = location.pathname;
    var text = (document.body && document.body.innerText) || '';
    var linkedinLogin =
      path.indexOf('/login') === 0 ||
      path.indexOf('/uas/login') === 0 ||
      q('input[name="session_password"],#join-form');
    var hhLogin =
      path.indexOf('/account/login') === 0 || q('[data-qa="account-login-page"]');
    var login = platform === 'linkedin' ? linkedinLogin : hhLogin;
    var otp =
      q(
        '[data-qa="otp-code-input"],input[name="otpCode"],input[autocomplete="one-time-code"]',
      ) ||
      (platform === 'linkedin' && path.indexOf('/checkpoint/challenge') === 0);
    var captcha =
      q('[data-qa="captcha"],#captcha,.captcha-container') ||
      /(captcha|robot|робот|проверка)/i.test(document.title) ||
      /(подтвердите[^.]{0,80}(?:робот|человек)|captcha)/i.test(text.slice(0, 2000));
    var hhMarker = q(hhMarkerSelector) || path === '/applicant/resumes';
    var linkedinMarker = q(
      'a[href*="/logout"],a[href*="/m/logout"],[data-view-name="navigation-profile"],[data-test-id="nav-profile"],[data-test-global-nav-me],a[href*="/in/"][aria-label],.global-nav__me-photo,button[aria-label="Me"],button[aria-label="Вы"],button[aria-label*="Me" i],button[aria-label*="Профиль" i]',
    );
    var marker = platform === 'linkedin' ? linkedinMarker : hhMarker;
    return {
      ready: document.readyState === 'complete',
      url: location.href,
      signedInApplicant: Boolean(marker) && !login && !otp && !captcha,
      login: Boolean(login),
      otp: Boolean(otp),
      captcha: Boolean(captcha),
    };
  } catch (_error) {
    return {
      ready: false,
      url: '',
      signedInApplicant: false,
      login: false,
      otp: false,
      captcha: false,
    };
  }
})()
