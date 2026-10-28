/*
 * B535: the landing, /faq and /support are complete prerendered pages; every
 * link on them works without JavaScript. The bundle starts as soon as the
 * document is parsed: the first paint is the prerender and does not wait for
 * it, and the head already modulepreloads the entry and the page chunk, so
 * the page is live in one round of parallel requests. It used to wait for an
 * interaction or 6 s, which kept the page dead for 9–12 s on prod (B574).
 * Other paths load the bundle directly and never see this file.
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
  var lastTop = 0;

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

  if (window.scrollY > 0) lastTop = window.scrollY;
  import(entry).then(restore);
})();
