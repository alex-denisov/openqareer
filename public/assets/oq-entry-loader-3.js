/*
 * B535: the landing, /faq and /support are complete prerendered pages; every
 * link on them works without JavaScript. The bundle starts right after the
 * first frame: the page chunk preloads from #oq-page-hints go out together
 * with the entry, so the page is live in one round of parallel requests, and
 * nothing shares the line with the first paint's styles and fonts. It used
 * to wait for an interaction or 6 s, which kept the page dead for 9–12 s on
 * prod (B574).
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

  var started = false;
  function start() {
    if (started) return;
    started = true;
    var hints = document.getElementById('oq-page-hints');
    if (hints && hints.content) document.head.appendChild(hints.content.cloneNode(true));
    if (window.scrollY > 0) lastTop = window.scrollY;
    import(entry).then(restore);
  }

  // A background tab draws no frames; it must not wait for one.
  if (document.visibilityState === 'hidden') start();
  else
    window.requestAnimationFrame(function () {
      setTimeout(start, 0);
    });
})();
