/*
 * B535: Яндекс Метрика 113691129 и Google Analytics G-WHV17PST41.
 * Отдельный файл, потому что CSP прода запрещает встроенные скрипты.
 * Грузится только на публичных страницах (лендинг, /faq, /support, /legal),
 * после загрузки и в простое браузера: на скорость первого экрана не влияет.
 * В кабинете (/app) счётчиков и вебвизора нет: там личные данные кандидатов.
 */
(function () {
  var path = location.pathname.replace(/\/$/, '') || '/';
  var publicPage =
    path === '/' || path === '/faq' || path === '/support' || path.indexOf('/legal/') === 0;
  if (!publicPage) return;

  function load(src) {
    var script = document.createElement('script');
    script.async = true;
    script.src = src;
    document.head.appendChild(script);
  }

  function start() {
    // Яндекс Метрика: очередь вызовов до загрузки tag.js, как в официальном коде.
    window.ym =
      window.ym ||
      function () {
        (window.ym.a = window.ym.a || []).push(arguments);
      };
    window.ym.l = 1 * new Date();
    window.ym(113691129, 'init', {
      ssr: true,
      webvisor: true,
      clickmap: true,
      ecommerce: 'dataLayer',
      referrer: document.referrer,
      url: location.href,
      accurateTrackBounce: true,
      trackLinks: true,
    });
    load('https://mc.yandex.ru/metrika/tag.js?id=113691129');

    // Google Analytics 4.
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer.push(arguments);
    };
    window.gtag('js', new Date());
    window.gtag('config', 'G-WHV17PST41');
    load('https://www.googletagmanager.com/gtag/js?id=G-WHV17PST41');
  }

  function whenIdle() {
    if ('requestIdleCallback' in window) window.requestIdleCallback(start, { timeout: 3000 });
    else setTimeout(start, 1500);
  }

  if (document.readyState === 'complete') whenIdle();
  else window.addEventListener('load', whenIdle, { once: true });
})();
