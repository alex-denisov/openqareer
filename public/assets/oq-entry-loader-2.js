/*
 * B535: the landing, /faq and /support are complete prerendered pages; every
 * link on them works without JavaScript. The application bundle is fetched on
 * the first interaction or after a few seconds, so it never competes with the
 * first paint. Other paths load the bundle directly and never see this file.
 *
 * Mounting replaces the prerendered shell; for a frame the page is short and
 * the browser clamps the scroll to the top. The reader keeps their place: the
 * position is restored once React has drawn the real page.
 * Versioned name: files under /assets are cached as immutable.
 */
(function () {
  var script = document.currentScript;
  var entry = script && script.getAttribute('data-entry');
  if (!entry) return;
  var loaded = false;
  var lastTop = 0;
  var events = ['pointerdown', 'keydown', 'touchstart', 'scroll'];

  window.addEventListener(
    'scroll',
    function () {
      if (window.scrollY > 0 && document.querySelector('[data-bootstrap-shell]')) {
        lastTop = window.scrollY;
      }
    },
    { passive: true },
  );

  function restore() {
    var deadline = Date.now() + 5000;
    (function tick() {
      var shellGone = !document.querySelector('[data-bootstrap-shell]');
      var page = document.scrollingElement || document.documentElement;
      if (shellGone && document.querySelector('main') && page.scrollHeight >= lastTop + 1) {
        if (lastTop > 0 && window.scrollY < 4) window.scrollTo(0, lastTop);
        return;
      }
      if (Date.now() < deadline) window.requestAnimationFrame(tick);
    })();
  }

  function load() {
    if (loaded) return;
    loaded = true;
    events.forEach(function (name) {
      window.removeEventListener(name, load, { passive: true });
    });
    if (window.scrollY > 0) lastTop = window.scrollY;
    import(entry).then(restore);
  }

  events.forEach(function (name) {
    window.addEventListener(name, load, { passive: true });
  });
  setTimeout(load, 6000);
})();
