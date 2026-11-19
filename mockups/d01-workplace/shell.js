// B640: оболочка макетов. Основа — B638/shell.js.
// Меню одно для всех статусов (решение CPO 10.11). Порядок по ходу работы,
// как railNavigation на проде (src/features/shell/desktopNavigationItems.tsx),
// без раздела «Автоматизация» (N16): рейка — шесть разделов и «Аккаунт».
// 390 — как на проде: шапка «колокольчик или Назад · раздел · консультант»,
// внизу «Сегодня · Профиль · Вакансии · Отклики · Ещё» (N17 снято 11.11).
// Знак — геометрия BrandMark.tsx, только в рейке.
// Атрибуты <body>:
//   data-active  today | profile | career | vacancies | responses | diary | settings | tariffs | bell
//   data-title   заголовок страницы в шапке
//   data-title-tip  ⓘ у заголовка (п. 97: «Виден только вам» в дневнике)
//   data-sheet   вопрос консультанту по разделу (на 390 полосы листа нет: консультант в шапке, как на проде)
//   data-bell    число новых уведомлений (0 — без отметки)
//   data-app     1 — экран приложения для компьютера (без листа 390)
//   data-update  available | downloading:NN | ready | error — значок обновления в рейке (только приложение)
//   data-update-tip  1 — подсказка значка раскрыта (для снимка состояния)
//   data-menu-open   1 — меню «Ещё» раскрыто (390)
//   data-back        1 — вложенный экран: на 390 слева «Назад» вместо колокольчика
//   data-crumbs      «подпись|слаг;…» — путь вложенного экрана (п. 33, _build/crumbs.py)
//   data-tabs        «подпись раздела^метка|слаг|1;…» — вкладки подразделов (п. 43, _build/sections.py)
//   data-coach-dot   1 — у консультанта есть предложение (точка на пузыре «диалог»)
//   data-person      marina (фото из LinkedIn) | oleg (фото скрыто — инициалы data-initials)
(function () {
  var b = document.body;
  var ico = function (n, cls) { return '<svg class="ico' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + n + '"/></svg>'; };
  var L = { today: 'Сегодня', profile: 'Профиль', career: 'Карьера', vacancies: 'Вакансии', responses: 'Отклики', diary: 'Дневник' };
  var ICON = {};
  var RAIL = ['today', 'profile', 'career', 'vacancies', 'responses', 'diary'];
  var BOTTOM = ['today', 'profile', 'vacancies', 'responses'];
  var BOTTOM_L = {};
  var active = b.dataset.active || 'today';
  var link = function (id, cls, labels) {
    var aria = id === 'diary' && !labels ? ' aria-label="Карьерный дневник"' : '';
    return '<a class="' + cls + '" href="#' + id + '"' + aria + (id === active ? ' aria-current="page"' : '') + '>' + ico(ICON[id] || id) + '<span>' + ((labels && labels[id]) || L[id]) + '</span></a>';
  };

  // Знак openqareer: кольцо с хвостом, константы и viewBox из BrandMark.tsx; цвет — currentColor (акцент темы).
  var mark = function (id) {
    return '<svg class="brand-mark" viewBox="-2.435 -0.995 68.61 68.61" fill="none" aria-hidden="true" focusable="false">' +
      '<defs><mask id="' + id + '" maskUnits="userSpaceOnUse" x="-8" y="-8" width="80" height="80">' +
      '<rect x="-8" y="-8" width="80" height="80" fill="#fff"/>' +
      '<line x1="37.34" y1="41.9" x2="57.3" y2="60.45" stroke="#000" stroke-width="17.5" stroke-linecap="round"/></mask></defs>' +
      '<circle cx="31.87" cy="32" r="25.2" stroke="currentColor" stroke-width="11.59" mask="url(#' + id + ')"/>' +
      '<line x1="37.34" y1="41.9" x2="57.3" y2="60.45" stroke="currentColor" stroke-width="10.33" stroke-linecap="round"/></svg>';
  };

  // Значок обновления в рейке (как в Codex): появляется только при новой версии.
  var upd = '';
  var st = b.dataset.update;
  if (st) {
    var pct = st.indexOf('downloading') === 0 ? +(st.split(':')[1] || 0) : 0;
    var kind = st.split(':')[0];
    var U = {
      available: { icon: 'download', label: 'Доступна новая версия. Нажмите, чтобы загрузить', tip: 'Доступна новая версия' },
      downloading: { icon: 'download', label: 'Загружается новая версия: ' + pct + ' %', tip: 'Загружается: ' + pct + ' %' },
      ready: { icon: 'refresh', label: 'Новая версия готова и применится при перезапуске. Нажмите, чтобы перезапустить сейчас', tip: 'Новая версия готова — применится при перезапуске' },
      error: { icon: 'warn', label: 'Не удалось загрузить новую версию. Нажмите, чтобы повторить', tip: 'Не загрузилось — нажмите, чтобы повторить' }
    }[kind];
    var C = 2 * Math.PI * 19;
    var ring = kind === 'downloading' ? '<svg class="upd-ring" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="19"/><circle class="on" cx="22" cy="22" r="19" stroke-dasharray="' + (C * pct / 100).toFixed(1) + ' ' + C.toFixed(1) + '"/></svg>' : '';
    var tipOpen = b.dataset.updateTip ? ' is-open' : '';
    upd = '<div class="upd-wrap"><button class="upd is-' + kind + '" type="button" aria-label="' + U.label + '" aria-describedby="upd-tip">' + ring + ico(U.icon) + (kind === 'available' || kind === 'error' ? '<span class="upd-dot" aria-hidden="true"></span>' : '') + '</button>' +
      '<span class="upd-tip' + tipOpen + '" role="tooltip" id="upd-tip">' + U.tip + '</span></div>';
  }

  var app = document.getElementById('screen');
  var hasPanel = !!app.querySelector('.panel-col');
  if (hasPanel) app.classList.add('has-panel');
  var bellN = +(b.dataset.bell || 0);
  var bellCrit = !!b.dataset.bellCrit;  // п. 83: при критическом уведомлении счётчик в цвете ошибки
  var bell = '<a class="icon-btn bell" href="#notifications" aria-label="Уведомления' + (bellN ? ', новых: ' + bellN : '') + (bellCrit ? ', есть важное' : '') + '"' + (active === 'bell' ? ' aria-current="page"' : '') + '>' + ico('bell') + (bellN ? '<span class="dot num' + (bellCrit ? ' is-crit' : '') + '" aria-hidden="true">' + bellN + '</span>' : '') + '</a>';

  // волна 16.11, правка 70: верхние разделы — в прокручиваемой обёртке .rail-top (короткое окно прокручивает только их),
  // «Обновление» и «Аккаунт» — одна обёртка .rail-bottom у нижнего края окна (margin-block-start: auto в b640.css)
  var rail = '<nav class="rail" aria-label="Разделы"><div class="rail-top"><a class="brand" href="#today" aria-label="openqareer, Сегодня">' + mark('bm-cut-rail') + '</a>' +
    RAIL.map(function (id) { return link(id, 'nav'); }).join('') + '</div><div class="rail-bottom">' + upd +
    '<a class="nav rail-end' + (upd ? ' has-upd' : '') + '" href="#settings"' + (active === 'settings' ? ' aria-current="page"' : '') + '>' + ico('settings') + '<span>Аккаунт</span></a></div></nav>';
  // 390 — как на проде (CareerShellNavigation.tsx: CareerMobileTopbar, MobileTopbarContent,
  // CareerMobileNavigation): слева колокольчик, на вложенном экране — «Назад» (CaretLeft,
  // career-mobile-back-trigger); по центру раздел; справа консультант (пузырь «диалог», точка при
  // предложениях). Внизу «Сегодня · Профиль · Вакансии · Отклики · Ещё», одно для всех статусов;
  // в «Ещё» — Карьера, Дневник, Уведомления, Тарифы, Аккаунт. Решение владельца 11.11.
  var menuOpen = !!b.dataset.menuOpen;
  var person = b.dataset.person || 'marina';
  var face = person === 'marina'
    ? '<img class="av-img" src="../photo-marina.svg" alt="" width="24" height="24">'
    : '<span class="av-ini" aria-hidden="true">' + (b.dataset.initials || 'О') + '</span>';
  var MORE = [['career', ico('career'), 'Карьера'], ['diary', ico('diary'), 'Карьерный дневник'],
    ['bell', ico('bell'), 'Уведомления'], ['tariffs', ico('wallet'), 'Тарифы'], ['settings', face, 'Аккаунт']];
  var moreActive = MORE.some(function (m) { return m[0] === active; });
  var mItem = function (m) {
    var extra = m[0] === 'bell' && bellN ? '<span class="num">' + bellN + '<span class="vh"> новых</span></span>' : '';
    return '<a role="menuitem" href="#' + (m[0] === 'bell' ? 'notifications' : m[0]) + '"' + (m[0] === active ? ' aria-current="page"' : '') + '>' + m[1] + '<span>' + m[2] + '</span>' + extra + '</a>';
  };
  var moreMenu = '<div class="more-menu" role="menu" id="more-menu" aria-label="Ещё разделы"' + (menuOpen ? '' : ' hidden') + '>' + MORE.map(mItem).join('') + '</div>';
  // п. 33: путь вложенного экрана из data-crumbs («подпись|слаг;…», последнее звено — текущий экран).
  // 1440: два и больше звеньев до текущего — крошки; одно — «‹ Назад к …». 390: крошек нет,
  // в шапке «Назад» с aria-label «Назад к <предыдущий>», как ResponsesMobilePush.tsx на проде.
  var crumbs = (b.dataset.crumbs || '').split(';').filter(Boolean).map(function (c) {
    var p = c.split('|'); return { label: p[0], href: p[1] ? p[1] + '.html' : '' };
  });
  var DATIVE = { 'Отклики': 'откликам', 'Профиль': 'профилю', 'Вакансии': 'вакансиям', 'Карьера': 'карьере',
    'Аккаунт': 'аккаунту', 'Консультант': 'консультанту', 'Цифровой след': 'цифровому следу', 'Опыт': 'опыту' };
  // Подпись «Назад» — по цели ссылки: если звено ведёт на экран раздела, называем раздел.
  var backTo = function (c) {
    var named = crumbs.filter(function (x) { return x.href === c.href; })[0] || c;
    return DATIVE[named.label] ? 'Назад к ' + DATIVE[named.label] : 'Назад: ' + named.label;
  };
  var prev = crumbs.length > 1 ? crumbs[crumbs.length - 2] : null;
  var navTrail = '';
  if (crumbs.length > 2) {
    navTrail = '<nav class="crumbs only-desk" aria-label="Путь"><ol>' + crumbs.map(function (c, i) {
      var last = i === crumbs.length - 1;
      return '<li>' + (last ? '<span aria-current="page">' + c.label + '</span>'
        : '<a href="' + c.href + '">' + c.label + '</a>' + ico('right')) + '</li>';
    }).join('') + '</ol></nav>';
  } else if (prev) {
    navTrail = '<nav class="crumbs only-desk" aria-label="Путь"><a class="crumb-back" href="' + prev.href + '">' + ico('back') + backTo(prev) + '</a></nav>';
  }
  // B643, CPO 15.11, п. 8: у N3–N6 на 1440 вместо «Назад к аккаунту» — строка вкладок раздела; «Назад» на 390 остаётся
  if (b.dataset.crumbsDesk === '0') navTrail = '';
  var back = !!b.dataset.back || !!prev;
  var backLabel = prev ? backTo(prev) : 'Назад';
  var mobLeft = '<div class="mob-left">' + (back
    ? '<a class="mob-back" href="' + (prev ? prev.href : '#back') + '" aria-label="' + backLabel + '" title="' + backLabel + '">' + ico('back') + '</a>'
    : bell.replace('class="icon-btn bell"', 'class="icon-btn bell mob-bell"')) + '</div>';
  var coachDot = b.dataset.coachDot ? '<span class="mob-coach-dot" aria-hidden="true"></span>' : '';
  var mobCoach = '<button class="mob-coach" type="button" aria-label="Консультант: открыть' + (coachDot ? '. Есть предложение' : '') + '" aria-expanded="' + hasPanel + '">' + ico('chat') + coachDot + '</button>';
  var top = '<header class="topbar">' + mobLeft + '<h1>' + (b.dataset.title || 'Сегодня') + (b.dataset.titleTip ? '<span class="tip top-tip"><button class="icon-btn info" type="button" aria-label="Кто видит">' + ico('info') + '</button><span class="tip-bubble" role="tooltip">' + b.dataset.titleTip + '</span></span>' : '') + '</h1>' +
    '<div class="top-actions">' + bell +
    (hasPanel ? '' : '<button class="btn is-quiet btn-panel" type="button" aria-expanded="false">' + ico('chat') + 'Консультант</button>') +
    '<a class="btn is-quiet is-sm" href="#tariffs"' + (active === 'tariffs' ? ' aria-current="page"' : '') + '>' + ico('wallet') + 'Тарифы</a></div>' + mobCoach + '</header>';
  var bottom = '<nav class="bottomnav" aria-label="Разделы">' + BOTTOM.map(function (id) { return link(id, '', BOTTOM_L); }).join('') +
    '<button class="more-btn" type="button" aria-haspopup="menu" aria-expanded="' + menuOpen + '" aria-controls="more-menu"' + (moreActive ? ' aria-current="page"' : '') + '>' + ico('more') + '<span>Ещё</span></button></nav>' + moreMenu;
  var sheet = '';

  app.insertAdjacentHTML('afterbegin', rail + top);
  var mainEl = app.querySelector('.main');
  // п. 43: вкладки подразделов из data-tabs («подпись раздела^метка|слаг|1;…»): под крошками на 1440, чипы на 390.
  var secTabs = '';
  if (b.dataset.tabs && !(mainEl && mainEl.querySelector('.sec-tabs'))) {
    var tp = b.dataset.tabs.split('^');
    secTabs = '<nav class="sec-tabs" aria-label="' + tp[0] + '"><div class="sec-tabs-in">' + tp[1].split(';').map(function (t) {
      var q = t.split('|');
      return '<a href="' + (q[1] ? q[1] + '.html' : '#' + encodeURIComponent(q[0])) + '"' + (q[2] ? ' aria-current="page"' : '') + '>' + q[0] + '</a>';
    }).join('') + '</div></nav>';
  }
  if (mainEl && (navTrail || secTabs)) mainEl.insertAdjacentHTML('afterbegin', navTrail + secTabs);
  var curTab = mainEl && mainEl.querySelector('.sec-tabs [aria-current="page"]');
  // п. 18: текущая вкладка — как scrollIntoView inline: nearest (без вертикальной прокрутки): видна целиком, первая — от края отступа
  if (curTab) {
    var tin = curTab.parentNode, tl = curTab.offsetLeft - tin.offsetLeft, tr = tl + curTab.offsetWidth;
    var fadeRoom = 40; // раунд 6: место под затухание у края, текущая вкладка не уходит под него
    if (tr > tin.clientWidth - fadeRoom) tin.scrollLeft = tr - tin.clientWidth + fadeRoom;
  }
  app.insertAdjacentHTML('beforeend', sheet + bottom);
  // п. 42: панель уведомлений (1440) от колокольчика: Esc и нажатие вне панели закрывают, фокус — на колокольчик.
  var npPop = document.getElementById('notif-pop');
  var npBell = app.querySelector('.top-actions .bell');
  if (npPop && npBell) {
    npBell.setAttribute('role', 'button'); npBell.setAttribute('aria-haspopup', 'dialog');
    npBell.setAttribute('aria-controls', 'notif-pop'); npBell.setAttribute('aria-expanded', 'true');
    var npSet = function (open) { npPop.hidden = !open; npBell.setAttribute('aria-expanded', String(open)); if (!open) npBell.focus(); };
    npBell.addEventListener('click', function (e) { e.preventDefault(); npSet(npPop.hidden); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !npPop.hidden) npSet(false); });
    document.addEventListener('click', function (e) { if (!npPop.hidden && !npPop.contains(e.target) && !npBell.contains(e.target)) npSet(false); });
  }
  if (b.dataset.app) app.classList.add('is-app');
  // «Ещё» (390): открывается кнопкой, закрывается повторным нажатием и Escape; фокус возвращается на кнопку.
  var moreBtn = app.querySelector('.more-btn');
  var moreEl = app.querySelector('.more-menu');
  if (moreBtn && moreEl) {
    var setMore = function (open) {
      moreEl.hidden = !open; moreBtn.setAttribute('aria-expanded', String(open));
      if (open) { var first = moreEl.querySelector('[role="menuitem"]'); if (first) first.focus(); }
    };
    moreBtn.addEventListener('click', function () { setMore(moreEl.hidden); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !moreEl.hidden) { setMore(false); moreBtn.focus(); }
    });
  }
  b.insertAdjacentHTML('afterbegin', '<a class="skip" href="#career-main">К содержанию</a>');
  // Развёрнутый лист консультанта на 390 — модальный слой: role=dialog, aria-modal,
  // всё вне листа inert. На 1440 та же панель — боковая колонка, страница доступна.
  if (hasPanel && b.dataset.dialog) {
    var coachSheet = app.querySelector('.panel-col');
    var outside = document.querySelectorAll('.skip, .rail, .topbar, .main, .bottomnav, .more-menu');
    var sheetMq = window.matchMedia('(max-width: 767px)');
    var applySheet = function () {
      var modal = sheetMq.matches;
      if (modal) { coachSheet.setAttribute('role', 'dialog'); coachSheet.setAttribute('aria-modal', 'true'); }
      else { coachSheet.removeAttribute('role'); coachSheet.removeAttribute('aria-modal'); }
      outside.forEach(function (el) { el.inert = modal; });
    };
    applySheet();
    sheetMq.addEventListener('change', applySheet);
    // раунд 6, п. 93: разговор открывается на последнем сообщении, как любой чат; так видна «Применить» у предложенной правки (k09b)
    // раунд 6, п. 93: поле ввода пустого консультанта (k08) получает фокус без прокрутки страницы — у autofocus окно уезжало на 309 px
    var af = document.querySelector('[data-autofocus]');
    if (af) af.focus({ preventScroll: true });
    var lastChat = coachSheet.querySelector('.chat');
    // п. 8 (CPO 15.11): на ≥768 панель закреплена по высоте окна — лента открывается на последнем сообщении всегда
    if (lastChat && (lastChat.querySelector('.btn.is-primary') || (!sheetMq.matches && lastChat.querySelector('.msg')))) {
      requestAnimationFrame(function () { lastChat.scrollTop = lastChat.scrollHeight; });
    }
  }

  // Лист фильтров вакансий (V8) на 390 — модальный слой: всё вне листа inert (как data-dialog у листа консультанта).
  var vtSheet = app.querySelector('.vt-sheet');
  if (vtSheet) {
    var vtOutside = document.querySelectorAll('.skip, .rail, .topbar, .main, .bottomnav, .more-menu');
    var vtMq = window.matchMedia('(max-width: 767px)');
    var vtApply = function () { vtOutside.forEach(function (el) { el.inert = vtMq.matches; }); };
    vtApply();
    vtMq.addEventListener('change', vtApply);
  }

  // fix-runall (verify_keyboard D): вкладки role=tablist — WAI-ARIA, ручная активация. В порядке Tab только выбранная
  // вкладка (roving tabindex); стрелки ←/→/↑/↓, Home, End переносят фокус между вкладками, выбор не меняют.
  Array.prototype.forEach.call(document.querySelectorAll('[role="tablist"]'), function (list) {
    var tabs = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'));
    if (tabs.length < 2) return;
    var sel = tabs.filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0] || tabs[0];
    tabs.forEach(function (t) { t.setAttribute('tabindex', t === sel ? '0' : '-1'); });
    list.addEventListener('keydown', function (e) {
      var i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      var last = tabs.length - 1;
      var next = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: last }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      tabs[next > last ? 0 : next < 0 ? last : next].focus();
    });
  });

  // Лист выбора (S8b, S9c, P8) — модальный на всех ширинах: aria-modal, всё вне листа inert, Tab остаётся в листе.
  if (app.querySelector('.pf-dialog[aria-modal="true"]')) {
    document.querySelectorAll('.skip, .rail, .topbar, .main, .bottomnav, .more-menu').forEach(function (el) { el.inert = true; });
  }

  // п. 33–34: окно действия у строки вакансии (role=dialog) — Esc и нажатие мимо закрывают, фокус возвращается на кнопку строки.
  var vaPops = document.querySelectorAll('.va-pop');
  if (vaPops.length) {
    // Пока окно открыто, Tab остаётся в нём: всё вне окна (соседи по пути до body) inert; нажатие мимо попадает в body и закрывает.
    var vaInert = [];
    var vaTrap = function (pop) {
      for (var n = pop; n && n !== document.body; n = n.parentElement) {
        Array.prototype.forEach.call(n.parentElement.children, function (s) {
          if (s !== n && !s.inert && s.tagName !== 'SCRIPT') { s.inert = true; vaInert.push(s); }
        });
      }
      var first = pop.querySelector('input, button');
      if (first) first.focus({ preventScroll: true });
    };
    var vaRelease = function () { vaInert.forEach(function (s) { s.inert = false; }); vaInert = []; };
    vaPops.forEach(function (pop) { if (!pop.hidden) vaTrap(pop); });
    var vaClose = function (pop) {
      if (pop.hidden) return;
      pop.hidden = true;
      vaRelease();
      var opener = pop.parentElement.querySelector('[aria-expanded="true"]');
      if (opener) { opener.setAttribute('aria-expanded', 'false'); return opener; }
    };
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      vaPops.forEach(function (pop) { if (!pop.hidden && pop.contains(document.activeElement)) { var b = vaClose(pop); if (b) b.focus(); } else { vaClose(pop); } });
    });
    document.addEventListener('pointerdown', function (e) {
      vaPops.forEach(function (pop) { if (!pop.contains(e.target) && !pop.parentElement.contains(e.target)) vaClose(pop); });
    });
  }

  // п. 17: категория следа, раскрытая только на широком экране (на 390 открыта одна — первая с высоким риском).
  if (window.matchMedia('(min-width: 768px)').matches) {
    document.querySelectorAll('details[data-open-desk]').forEach(function (d) { d.open = true; });
  }

  // раунд 6, П2: на ≥768 строка контекста «Должность · Компания» встаёт в путь вместо его средних звеньев —
  // над содержимым два слоя: путь с объектом и вкладки шагов.
  (function () {
    if (window.matchMedia('(max-width: 767px)').matches) return;
    var cr = document.querySelector('#career-main .crumbs'), ctx = document.querySelector('#career-main .ctx-one');
    if (!cr || !ctx) return;
    var ol = cr.querySelector('ol');
    if (ol) {
      while (ol.children.length > 1) ol.removeChild(ol.lastChild);
      var li = document.createElement('li'); li.appendChild(ctx); ol.appendChild(li);
    } else cr.appendChild(ctx);
    cr.classList.add('has-ctx');
  })();
  // CPO к п. 2 раунда 6: у прокручиваемой строки вкладок на 390 — затухание у края, за которым есть вкладки
  Array.prototype.forEach.call(document.querySelectorAll('.sec-tabs-in'), function (row) {
    var mark = function () {
      var max = row.scrollWidth - row.clientWidth;
      row.classList.toggle('r6-fade-l', max > 1 && row.scrollLeft > 1);
      row.classList.toggle('r6-fade-r', max > 1 && row.scrollLeft < max - 1);
    };
    mark(); row.addEventListener('scroll', mark, { passive: true });
  });
  // п. 93: главное действие без прокрутки. Единственная видимая залитая кнопка в #career-main ниже первого
  // экрана переезжает (с соседней контурной) в панель .act-dock.is-auto: на 390 — над нижней навигацией,
  // на ≥768 — липкая полоса у нижнего края страницы. Без главного действия панели нет; data-dock="off" — отказ.
  (function () {
    var m = document.getElementById('career-main');
    if (!m || m.querySelector('.act-dock') || b.dataset.dock === 'off') return;
    var mob = window.matchMedia('(max-width: 767px)').matches;
    if (mob && app.classList.contains('has-panel')) return;
    // открытое окно подтверждения на экране-состоянии: показываем его, панель не нужна
    var pop = m.querySelector('.va-pop:not([hidden]) .btn.is-primary');
    if (pop) { pop.closest('.va-pop').scrollIntoView({ block: 'center' }); return; }
    var shown = function (el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
    var prim = Array.prototype.filter.call(m.querySelectorAll('.btn.is-primary'), function (el) {
      return shown(el) && !el.closest('[hidden], [role="dialog"], [role="alertdialog"], .lk-menu-l, .tip-bubble, .va-pop, .va-add.is-panel');
    });
    if (prim.length !== 1) return;
    var p = prim[0], par = p.parentElement;
    var nav = document.querySelector('.bottomnav');
    var limit = window.innerHeight;
    if (nav && shown(nav)) limit = Math.min(limit, nav.getBoundingClientRect().top);
    var r = p.getBoundingClientRect();
    if (r.top >= 0 && r.bottom <= limit) return;
    // раунд 6, П5: одобрение рядом с тем, что одобряют — панель только если черновик уже на первом экране
    var draft = (par.closest('section, li, .mod, .lead') || par).querySelector('.letter, .lk-draft, textarea, .lt-body, .cv-doc');
    if (draft && draft.getBoundingClientRect().top >= limit) return;
    if (p.form && p.type === 'submit') { if (!p.form.id) p.form.id = 'dock-form'; p.setAttribute('form', p.form.id); }
    // ряд действий из одних кнопок и подсказки «почему недоступно» переезжает целиком; иначе — залитая и одна контурная
    var kids = Array.prototype.slice.call(par.children);
    var whole = kids.length <= 4 && kids.every(function (el) { return el.matches('.btn, .va-popwrap, .act-why'); });
    var mate = whole ? kids.filter(function (el) { return el !== p; }) : kids.filter(function (el) {
      return el !== p && el.matches('.btn, .va-popwrap') && !el.matches('.is-quiet, .is-danger') && shown(el);
    }).slice(0, 1);
    var host = par.closest('.page') || m.querySelector('.page') || m;
    var dock = document.createElement('div');
    dock.className = 'act-dock is-auto';
    if (whole) kids.forEach(function (el) { dock.appendChild(el); });
    else { dock.appendChild(p); mate.forEach(function (el) { dock.appendChild(el); }); }
    if (!par.children.length && !par.textContent.trim()) par.remove();
    // фаза 2 (правка 107): в сетке панель встаёт строкой после последней, а не в дыру сетки (K11: полоса посреди страницы)
    var gs = getComputedStyle(host), tracks = gs.display.indexOf('grid') >= 0 ? gs.gridTemplateRows.split(' ').filter(function (t) { return t && t.charAt(0) !== '['; }).length : 0;
    host.appendChild(dock);
    if (tracks && gs.gridTemplateRows !== 'none') dock.style.gridRow = String(tracks + 1);
    // на широком экране кнопки остаются на своей вертикали (колонка письма, формы)
    // тред c8ae1bc4: отступ меряется от левого края самой панели (внутри отступов .page), а не от рамки .page — иначе кнопка
    // уезжала вправо на ширину отступа страницы (P7: «Сохранить» на 40 px правее колонки формы)
    if (!mob) { var x = r.left - dock.getBoundingClientRect().left; if (x > 0) dock.style.paddingInlineStart = Math.round(x) + 'px'; }
  })();
  // раунд 6, П6: закреплённая панель на 390 — одна залитая и одна контурная; третье действие — текстовой ссылкой над ними
  if (window.matchMedia('(max-width: 767px)').matches) {
    Array.prototype.forEach.call(document.querySelectorAll('#career-main .act-dock, #career-main .m-commit'), function (d) {
      var outl = Array.prototype.filter.call(d.querySelectorAll('.btn'), function (el) {
        return !el.matches('.is-primary, .is-quiet, .is-danger') && !el.closest('.va-pop');
      });
      outl.slice(1).forEach(function (el) { el.classList.add('is-quiet'); });
    });
    // волна 16.11, правка 55: полоса m-commit на 390 — fixed над навигацией; отступ main под неё по её высоте
    var mc = document.querySelector('#career-main .actions.m-commit');
    if (mc) b.style.setProperty('--career-m-commit-h', Math.ceil(mc.getBoundingClientRect().height) + 'px');
  }

  document.querySelectorAll('i[data-i]').forEach(function (el) {
    var label = el.getAttribute('aria-label');
    // п. 12.1: значок со смыслом (галочка «Подтверждено кейсом») сохраняет подпись для экранного чтеца
    el.outerHTML = label
      ? ico(el.dataset.i, el.className).replace('aria-hidden="true"', 'role="img" aria-label="' + label + '"')
      : ico(el.dataset.i, el.className);
  });
})();
