/**
 * B787: маскированный набросок текущей страницы hh.ru для локальной диагностики.
 * Теги и data-qa как есть; в тексте буквы → x, месяцы → MON_NN; адрес без id резюме.
 * Плюс признаки входа, которыми пользуются скрипты. Только ASCII, не длиннее 16 000 знаков.
 */
(function () {
  try {
    var MAX = 16000;
    var months = [
      ['январь', 'января', 'янв', 'january', 'jan'],
      ['февраль', 'февраля', 'фев', 'февр', 'february', 'feb'],
      ['март', 'марта', 'мар', 'march', 'mar'],
      ['апрель', 'апреля', 'апр', 'april', 'apr'],
      ['май', 'мая', 'may'],
      ['июнь', 'июня', 'июн', 'june', 'jun'],
      ['июль', 'июля', 'июл', 'july', 'jul'],
      ['август', 'августа', 'авг', 'august', 'aug'],
      ['сентябрь', 'сентября', 'сен', 'сент', 'september', 'sep', 'sept'],
      ['октябрь', 'октября', 'окт', 'october', 'oct'],
      ['ноябрь', 'ноября', 'ноя', 'нояб', 'november', 'nov'],
      ['декабрь', 'декабря', 'дек', 'december', 'dec'],
    ];
    var token = {};
    months.forEach(function (names, i) {
      names.forEach(function (n) {
        token[n] = 'MON_' + (i < 9 ? '0' : '') + (i + 1);
      });
    });
    var mask = function (t) {
      return t
        .replace(/[\p{L}]+/gu, function (w) {
          return token[w.toLowerCase()] || w.replace(/./gu, 'x');
        })
        .replace(/[^\x20-\x7e]/g, '?');
    };
    var safe = function (v) {
      return String(v || '')
        .replace(/[^A-Za-z0-9_ .-]/g, '?')
        .slice(0, 120);
    };
    var idMask = function (href) {
      return String(href)
        .split('?')[0]
        .replace(/[0-9a-f]{20,64}/gi, 'ID')
        .replace(/[A-Za-z0-9]{30,}/g, 'ID')
        .replace(/[^A-Za-z0-9_./-]/g, '?')
        .slice(0, 120);
    };
    var state = document.getElementById('HH-Lux-InitialState');
    var userType = '';
    try {
      userType = state
        ? JSON.parse((state.content && state.content.textContent) || state.textContent || '')
            .userType
        : '';
    } catch (_e) {
      userType = 'unparsed';
    }
    var out = [
      'path ' + location.pathname.replace(/[0-9a-f]{20,64}/g, 'ID').replace(/[^\x20-\x7e]/g, '?'),
      'width ' + (window.innerWidth || 0),
      'initial_state ' + (state ? 1 : 0) + ' user_type ' + safe(userType),
      'profile_menu ' +
        (document.querySelector(
          '[data-qa^="mainmenu_applicantProfile"], [data-qa^="mainmenu_profileAndResumes"], [data-qa^="profile-activator"]',
        )
          ? 1
          : 0),
      'resume_cards ' + document.querySelectorAll('[data-qa="resume"]').length,
      'menu_buttons ' + document.querySelectorAll('[data-qa="resume-list-action-more"]').length,
      'menu_buttons_shown ' +
        Array.prototype.filter.call(
          document.querySelectorAll('[data-qa="resume-list-action-more"]'),
          function (b) {
            return b.getClientRects().length > 0;
          },
        ).length,
      'menu_items ' + document.querySelectorAll('[data-qa^="operations-list-"]').length,
      '--- markup',
    ];
    var size = out.join('\n').length;
    var walk = function (node, depth) {
      if (size > MAX || depth > 60) return;
      if (node.nodeType === 3) {
        var text = node.textContent.replace(/\s+/g, ' ').trim();
        if (text) push(depth, '"' + mask(text).slice(0, 80) + '"');
        return;
      }
      if (node.nodeType !== 1) return;
      var tag = node.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'svg' || tag === 'noscript') return;
      var qa = node.getAttribute('data-qa');
      var hidden = typeof node.getClientRects === 'function' && node.getClientRects().length === 0;
      var href =
        tag === 'a' && node.getAttribute('href')
          ? ' href=' + idMask(node.getAttribute('href'))
          : '';
      // B787: в списке резюме обёртки без data-qa не печатаются — иначе лимит кончается на первой карточке.
      var bare = compact && !qa && !href && (tag === 'div' || tag === 'span');
      if (!bare || hidden)
        push(depth, tag + (qa ? '[' + safe(qa) + ']' : '') + href + (hidden ? ' shown=0' : ''));
      var next = bare && !hidden ? depth : depth + 1;
      for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i], next);
    };
    var push = function (depth, line) {
      var row = new Array(depth + 1).join(' ') + line;
      size += row.length + 1;
      if (size <= MAX) out.push(row);
    };
    // B787: на списке резюме набросок начинается с карточки источника копии, затем весь список.
    var list = document.querySelector('[data-qa="compact-resume-list"]');
    var compact = false;
    if (list) {
      compact = true;
      var source = (window.__oqCopy && window.__oqCopy.source) || '';
      var cards = Array.prototype.slice.call(list.querySelectorAll('[data-qa="resume"]'));
      var mine = cards.filter(function (c) {
        return (
          source &&
          c.querySelector('a[href*="' + source + '"], [data-qa="resume-card-link-' + source + '"]')
        );
      });
      push(0, 'source_card ' + (mine.length ? cards.indexOf(mine[0]) : -1) + ' of ' + cards.length);
      if (mine.length) walk(mine[0], 0);
      push(0, '--- list');
      walk(list, 0);
    } else {
      walk(document.querySelector('main') || document.body || document.documentElement, 0);
    }
    return out.join('\n').slice(0, MAX);
  } catch (_e) {
    return 'sketch_failed';
  }
})();
