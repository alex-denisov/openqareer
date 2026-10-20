/*
 * B535: Яндекс Метрика 113691129 и Google Analytics G-WHV17PST41 — после согласия
 * посетителя. Баннер внизу: «Принять» и мелкая ссылка «Другие варианты» с
 * отдельными переключателями счётчиков (решение владельца 20.10: собирать
 * статистику максимально, баннер спокойный). До выбора счётчики не загружаются.
 * Отдельный файл, потому что CSP прода запрещает встроенные скрипты и стили:
 * вид баннера — классы .oq-consent в src/features/site/publicSite.css.
 * Работает только на публичных страницах openqareer.com (лендинг, /faq, /support,
 * /legal/*). В кабинете (/app), в приложении для компьютера и в тестах на
 * localhost счётчиков и баннера нет. Проверка на localhost:
 * localStorage['oq-analytics-dev'] = '1'.
 * Ссылка «Настройки cookie» в подвале — любой элемент с data-oq-consent-open.
 */
(function () {
  var STORAGE_KEY = 'oq-consent-analytics';
  var MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
  var GA_ID = 'G-WHV17PST41';
  var YM_ID = 113691129;

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (_error) {
      return null;
    }
  }
  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (_error) {
      // Хранилище недоступно (приватный режим): выбор действует до перезагрузки.
    }
  }

  var host = location.hostname;
  var production = host === 'openqareer.com' || host === 'www.openqareer.com';
  if (!production && storageGet('oq-analytics-dev') !== '1') return;

  var path = location.pathname.replace(/\/$/, '') || '/';
  var publicPage =
    path === '/' || path === '/faq' || path === '/support' || path.indexOf('/legal/') === 0;
  if (!publicPage) return;

  // Выбор: { ym: boolean, ga: boolean } или null, если посетитель ещё не выбирал.
  // GDPR: для посетителей из ЕС/ЕЭЗ, Великобритании и Швейцарии отказ стоит рядом
  // с «Принять» и выглядит так же, переключатели выключены (EDPB 03/2022,
  // Planet49). Регион — по часовому поясу браузера, без запроса к серверу.
  var GDPR_ZONES =
    'Amsterdam Andorra Athens Berlin Bratislava Brussels Bucharest Budapest Busingen ' +
    'Copenhagen Dublin Gibraltar Guernsey Helsinki Isle_of_Man Jersey Lisbon Ljubljana ' +
    'London Luxembourg Madrid Malta Mariehamn Monaco Nicosia Oslo Paris Prague Riga Rome ' +
    'San_Marino Sofia Stockholm Tallinn Vaduz Vatican Vienna Vilnius Warsaw Zagreb Zurich ' +
    'Canary Madeira Azores Reykjavik Faroe Famagusta Ceuta';
  function gdprVisitor() {
    try {
      var zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      var city = zone.split('/').pop();
      return (
        /^(Europe|Atlantic|Asia|Africa)\//.test(zone) && GDPR_ZONES.split(' ').indexOf(city) !== -1
      );
    } catch (_error) {
      return false;
    }
  }
  var strict = gdprVisitor();
  var DEFAULT_CHOICE = { ym: !strict, ga: !strict };

  function readChoice() {
    var raw = storageGet(STORAGE_KEY);
    if (!raw) return null;
    try {
      var saved = JSON.parse(raw);
      var fresh = Date.now() - Date.parse(saved.at) < MAX_AGE_MS;
      if (fresh && typeof saved.ym === 'boolean' && typeof saved.ga === 'boolean') {
        return { ym: saved.ym, ga: saved.ga };
      }
    } catch (_error) {
      return null;
    }
    return null;
  }
  function saveChoice(choice) {
    storageSet(
      STORAGE_KEY,
      JSON.stringify({ ym: choice.ym, ga: choice.ga, at: new Date().toISOString() }),
    );
  }

  function load(src) {
    var script = document.createElement('script');
    script.async = true;
    script.src = src;
    document.head.appendChild(script);
  }

  var started = { ym: false, ga: false };
  function startYandex() {
    if (started.ym) return;
    started.ym = true;
    // Яндекс Метрика: очередь вызовов до загрузки tag.js, как в официальном коде.
    window.ym =
      window.ym ||
      function () {
        (window.ym.a = window.ym.a || []).push(arguments);
      };
    window.ym.l = 1 * new Date();
    window.ym(YM_ID, 'init', {
      ssr: true,
      webvisor: true,
      clickmap: true,
      ecommerce: 'dataLayer',
      referrer: document.referrer,
      url: location.href,
      accurateTrackBounce: true,
      trackLinks: true,
    });
    load('https://mc.yandex.ru/metrika/tag.js?id=' + YM_ID);
  }
  function startGoogle() {
    if (started.ga) return;
    started.ga = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer.push(arguments);
    };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
    load('https://www.googletagmanager.com/gtag/js?id=' + GA_ID);
  }
  function start(choice) {
    if (choice.ym) startYandex();
    if (choice.ga) startGoogle();
  }

  // При сохранённом согласии счётчики ждут первого действия или 12 секунд:
  // ни первая отрисовка, ни отклик страницы их не ждут.
  function startDeferred(choice) {
    var events = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    function once() {
      events.forEach(function (name) {
        window.removeEventListener(name, once, { passive: true });
      });
      start(choice);
    }
    events.forEach(function (name) {
      window.addEventListener(name, once, { passive: true });
    });
    setTimeout(once, 12000);
  }

  // Отзыв согласия: стираем cookie счётчиков на домене и перезагружаем страницу,
  // чтобы уже загруженные скрипты перестали работать.
  function clearCounterCookies() {
    var domains = ['', '; domain=' + host, '; domain=.' + host.replace(/^www\./, '')];
    document.cookie.split(';').forEach(function (pair) {
      var name = pair.split('=')[0].trim();
      if (!/^(_ym|_ga|yandexuid|yabs-sid|_gid)/.test(name)) return;
      domains.forEach(function (domain) {
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + domain;
      });
    });
  }

  var banner = null;
  function closeBanner() {
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
  }
  function decide(choice) {
    var revoked = (started.ym && !choice.ym) || (started.ga && !choice.ga);
    saveChoice(choice);
    closeBanner();
    if (revoked) {
      clearCounterCookies();
      location.reload();
      return;
    }
    start(choice);
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function toggle(label, hint, checked) {
    var row = element('label', 'oq-consent-option');
    var input = element('input');
    input.type = 'checkbox';
    input.checked = checked;
    var copy = element('span', 'oq-consent-option-copy');
    copy.appendChild(element('b', '', label));
    copy.appendChild(element('span', '', hint));
    row.appendChild(input);
    row.appendChild(copy);
    return { row: row, input: input };
  }

  // «Другие варианты»: отдельные переключатели, по умолчанию включены.
  function showOptions(current) {
    var body = banner.querySelector('.oq-consent-body');
    body.textContent = '';
    body.appendChild(element('p', 'oq-consent-text', 'Какие счётчики можно включить:'));
    var yandex = toggle('Яндекс Метрика', 'посещения, клики, запись сессии', current.ym);
    var google = toggle('Google Analytics', 'посещения и источники переходов', current.ga);
    body.appendChild(yandex.row);
    body.appendChild(google.row);
    var actions = element('div', 'oq-consent-actions');
    var save = element('button', 'oq-consent-accept', 'Сохранить');
    save.type = 'button';
    save.addEventListener('click', function () {
      decide({ ym: yandex.input.checked, ga: google.input.checked });
    });
    var policy = element('a', 'oq-consent-more', 'Политика конфиденциальности');
    policy.href = '/legal/privacy';
    actions.appendChild(save);
    actions.appendChild(policy);
    body.appendChild(actions);
    yandex.input.focus();
  }

  function showBanner(current) {
    if (banner) return;
    banner = element('section', 'oq-consent');
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Cookie и статистика');
    var body = element('div', 'oq-consent-body');
    body.appendChild(
      element('p', 'oq-consent-text', 'Мы используем cookie, чтобы сайт работал лучше.'),
    );
    var actions = element('div', 'oq-consent-actions');
    var accept = element('button', 'oq-consent-accept', 'Принять');
    accept.type = 'button';
    accept.addEventListener('click', function () {
      decide({ ym: true, ga: true });
    });
    var more = element('button', 'oq-consent-more', 'Другие варианты');
    more.type = 'button';
    more.addEventListener('click', function () {
      showOptions(current || DEFAULT_CHOICE);
    });
    actions.appendChild(accept);
    if (strict) {
      var refuse = element('button', 'oq-consent-refuse', 'Отказаться');
      refuse.type = 'button';
      refuse.addEventListener('click', function () {
        decide({ ym: false, ga: false });
      });
      actions.appendChild(refuse);
    }
    actions.appendChild(more);
    body.appendChild(actions);
    banner.appendChild(body);
    document.body.appendChild(banner);
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    var opener = target && target.closest ? target.closest('[data-oq-consent-open]') : null;
    if (!opener) return;
    event.preventDefault();
    var current = readChoice() || DEFAULT_CHOICE;
    showBanner(current);
    showOptions(current);
  });

  var choice = readChoice();
  if (choice) {
    startDeferred(choice);
  } else if (document.body) {
    showBanner(null);
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      showBanner(null);
    });
  }
})();
