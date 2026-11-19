/**
 * B699: one polled step of the resume raise on hh.ru («Поднять в поиске»).
 *
 * The shell evaluates this file on `https://hh.ru/resume/<id>` and reads back
 * `{code}`. It never reads views, invitations or any resume content: it only
 * classifies the page and presses the single raise button, once per run
 * (the click is remembered in sessionStorage, so a repeated poll never clicks
 * again). The signed-in selector placeholder below is replaced by the shell with a JSON string.
 *
 * Answers: ok, captcha, logged_out, foreign_page, too_early, error, and
 * `waiting` while the page is still drawing or the click is being confirmed.
 * The button is found by its text, `data-qa` is only a second hint.
 */
(function () {
  try {
    var KEY = '__oqHhRaise';
    var CLICK_TTL_MS = 120000;
    var signedSelector = __SIGNED_IN_SELECTOR__;
    var q = function (s) { return document.querySelector(s); };
    var shown = function (e) { return !!(e && e.getClientRects().length); };
    var text = ((document.body && (document.body.innerText || document.body.textContent)) || '').slice(0, 4000);

    if (!/(^|\.)hh\.ru$/i.test(location.hostname)) return { code: 'foreign_page' };

    if (
      shown(q('[data-qa="captcha"], #captcha, .captcha-container')) ||
      /(captcha|robot|робот)/i.test(document.title) ||
      /(подтвердите[^.]{0,80}(?:робот|человек)|captcha)/i.test(text)
    ) {
      return { code: 'captcha' };
    }

    var signedIn = !!q(signedSelector);
    if (!signedIn) {
      var state = document.getElementById('HH-Lux-InitialState');
      var raw = state ? (state.content && state.content.textContent) || state.textContent || '' : '';
      try { signedIn = JSON.parse(raw).userType === 'applicant'; } catch (e) { signedIn = false; }
    }
    if (location.pathname.indexOf('/account/login') === 0 || shown(q('input[type="password"]')) || !signedIn) {
      return { code: 'logged_out' };
    }

    if (!/^\/resume\/[A-Za-z0-9]+\/?$/.test(location.pathname)) return { code: 'error' };

    var countdown = /(можно будет поднять через|поднять можно через|поднять через)/i.test(text);
    var buttons = document.querySelectorAll('button, a[role="button"], [data-qa^="resume-update-button"]');
    var button = null;
    for (var i = 0; i < buttons.length && !button; i++) {
      var label = (buttons[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (/^поднять в поиске/i.test(label) || /^resume-update-button/.test(buttons[i].getAttribute('data-qa') || '')) {
        button = buttons[i];
      }
    }
    var disabled = !!button && (button.disabled || button.getAttribute('aria-disabled') === 'true');

    var mark = null;
    try { mark = sessionStorage.getItem(KEY); } catch (e) { mark = window[KEY] || null; }
    var parts = (mark || '').split('|');
    var clicked = parts[0] === location.pathname && Date.now() - Number(parts[1]) < CLICK_TTL_MS;

    if (clicked) {
      var done = /(резюме\s+(?:поднято|обновлено)|поднято в поиске)/i.test(text) || countdown || disabled;
      return { code: done ? 'ok' : 'waiting' };
    }
    if (countdown || disabled) return { code: 'too_early' };
    if (!button) return { code: 'waiting' };

    var stamp = location.pathname + '|' + Date.now();
    try { sessionStorage.setItem(KEY, stamp); } catch (e) { window[KEY] = stamp; }
    button.click();
    return { code: 'waiting' };
  } catch (e) {
    return { code: 'script_error' };
  }
})()
