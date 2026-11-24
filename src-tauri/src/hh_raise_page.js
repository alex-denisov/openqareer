/**
 * B699: one polled step of the resume raise on hh.ru («Поднять в поиске»).
 *
 * The shell evaluates this file on `https://hh.ru/resume/<id>` and, when that
 * page settles nothing, on the resume list (hh.ru redirects it to the profile);
 * there it acts only inside the card of this very resume. It reads back
 * `{code, pressed, card}` and, with `too_early`, `available` — the HH:MM of the button. It never reads views, invitations or any resume content: it only
 * classifies the page and presses the single raise button, once per run
 * (the click is remembered in sessionStorage, so a repeated poll never clicks
 * again). The placeholders below are replaced by the shell with JSON literals.
 *
 * Answers: ok, captcha, logged_out, foreign_page, too_early, error, and
 * `waiting` while the page is still drawing or the click is being confirmed.
 * The button is found by its text, `data-qa` is only a second hint.
 */
/* global __SIGNED_IN_SELECTOR__, __RESUME_ID__, __LIST_MODE__, __MAY_PRESS__ -- substituted by hh_raise.rs before evaluation */
(function () {
  try {
    var KEY = '__oqHhRaise';
    var CLICK_TTL_MS = 120000;
    var GONE = '__oqHhRaiseGone';
    var GONE_POLLS = 2;
    var LABEL_MAX = 40;
    var RAISED = /^поднять (?:(?:сегодня|завтра) )?в ?(\d{1,2}:\d{2})$/i;
    var NOTICE = /^(?:резюме (?:поднято|обновлено)(?: в поиске)?|поднято в поиске)[.!]?$/i;
    var COUNTDOWN = /(можно будет поднять через|поднять можно через|поднять через)/i;
    var signedSelector = __SIGNED_IN_SELECTOR__;
    var resumeId = __RESUME_ID__;
    var listMode = __LIST_MODE__;
    var mayPress = __MAY_PRESS__;
    var q = function (s) {
      return document.querySelector(s);
    };
    var shown = function (e) {
      return !!(e && e.getClientRects().length);
    };
    var clean = function (s) {
      return (s || '').replace(/\s+/g, ' ').trim();
    };
    var resumeIdOf = function (path) {
      var match = /^\/resume\/([A-Za-z0-9]+)\/?$/.exec(path);
      return match ? match[1] : null;
    };
    // Whole texts of short visible elements: resume prose never matches an anchored label.
    var shortLabels = function (root) {
      var found = [];
      var walker = document.createTreeWalker(root, 4);
      for (var node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!/подн|обновлено/i.test(node.nodeValue)) continue;
        for (var e = node.parentElement, depth = 0; e && depth < 4; e = e.parentElement, depth++) {
          if (e.closest('script, style, template')) break;
          var label = clean(e.textContent);
          if (label.length > LABEL_MAX) break;
          if (shown(e)) found.push(label);
          if (e === root) break;
        }
      }
      return found;
    };
    var findButton = function (root) {
      var list = root.querySelectorAll(
        'button, a' + (listMode ? '' : '[role="button"]') + ', [data-qa^="resume-update-button"]',
      );
      for (var i = 0; i < list.length; i++) {
        var byText = /^поднять в поиске/i.test(clean(list[i].textContent));
        if (byText || /^resume-update-button/.test(list[i].getAttribute('data-qa') || ''))
          return list[i];
      }
      return null;
    };
    var ownCard = function () {
      var cards = document.querySelectorAll('[data-qa="resume"]');
      for (var i = 0; i < cards.length; i++) {
        var ids = Array.prototype.map
          .call(cards[i].querySelectorAll('a[href]'), function (a) {
            return resumeIdOf(a.pathname);
          })
          .filter(Boolean);
        if (
          ids.length &&
          ids.every(function (id) {
            return id === resumeId;
          })
        )
          return cards[i];
      }
      return null;
    };
    var drawn = function () {
      return (
        document.readyState === 'complete' && shown(q('h1, h2, h3, [data-qa^="resume-block"]'))
      );
    };
    var text = (
      (document.body && (document.body.innerText || document.body.textContent)) ||
      ''
    ).slice(0, 4000);

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
      var raw = state
        ? (state.content && state.content.textContent) || state.textContent || ''
        : '';
      try {
        signedIn = JSON.parse(raw).userType === 'applicant';
      } catch (_e) {
        signedIn = false;
      }
    }
    if (
      location.pathname.indexOf('/account/login') === 0 ||
      shown(q('input[type="password"]')) ||
      !signedIn
    ) {
      return { code: 'logged_out' };
    }

    var onList = /^\/applicant\/(resumes|profile)(\/|$)/.test(location.pathname);
    if (listMode !== onList) {
      // The list was asked for, the resume page is still here: do nothing on it.
      if (listMode && resumeIdOf(location.pathname)) return { code: 'waiting' };
      return { code: 'error' };
    }
    if (!listMode && resumeIdOf(location.pathname) !== resumeId) return { code: 'error' };

    // Only the card that links to this resume, and to no other one, may be acted on.
    var scope = listMode ? ownCard() : document.body;
    if (!scope) return { code: 'waiting', pressed: !mayPress, card: false };

    var labels = shortLabels(scope);
    var raised = labels.some(function (l) {
      return RAISED.test(l) || NOTICE.test(l);
    });
    var countdown = COUNTDOWN.test(listMode ? scope.innerText || scope.textContent || '' : text);
    var button = findButton(scope);
    var disabled = !!button && (button.disabled || button.getAttribute('aria-disabled') === 'true');

    var mark = null;
    try {
      mark = sessionStorage.getItem(KEY);
    } catch (_e) {
      mark = window[KEY] || null;
    }
    var parts = (mark || '').split('|');
    var marked = parts[0] === resumeId && Date.now() - Number(parts[1]) < CLICK_TTL_MS;

    if (marked || !mayPress) {
      if (raised || countdown) return { code: 'ok', pressed: true };
      // A vanished button counts only on the page where it was pressed.
      var here = marked && parts[2] === (listMode ? 'list' : 'resume');
      var gone = here && drawn() && (!button || disabled);
      window[GONE] = gone ? (window[GONE] || 0) + 1 : 0;
      return { code: window[GONE] >= GONE_POLLS ? 'ok' : 'waiting', pressed: true };
    }
    if (raised || countdown || disabled) {
      var clocks = labels.map(function (l) {
        return (RAISED.exec(l) || [])[1];
      });
      var clock = clocks.filter(Boolean)[0];
      return clock
        ? { code: 'too_early', available: ('0' + clock).slice(-5) }
        : { code: 'too_early' };
    }
    if (!button) return { code: 'waiting' };

    var stamp = resumeId + '|' + Date.now() + '|' + (listMode ? 'list' : 'resume');
    try {
      sessionStorage.setItem(KEY, stamp);
    } catch (_e) {
      window[KEY] = stamp;
    }
    button.click();
    return { code: 'waiting', pressed: true };
  } catch (_e) {
    return { code: 'script_error' };
  }
})();
