/**
 * Reads the LinkedIn connection cards that show text right now (B448).
 *
 * The list virtualises long runs of rows, and over a walk of several minutes
 * the page itself can reload or go blank (run 7), so nothing is kept in the
 * page: the shell calls this after every scroll step and merges the batches
 * by profile path on its own side.
 *
 * Returns `[path, html, lines]` per card, where `html` is the minimal
 * `<div><a href="/in/…"><p>name</p><p>headline</p></a></div>`: only the
 * profile path and the first two text lines of the profile link leave the
 * page, HTML-escaped. A card without text is left out.
 */
(function () {
  try {
    var esc = function (text) {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    };
    var out = [];
    var cards = document.querySelectorAll('[componentkey^="ConnectionCard_"]');
    for (var i = 0; i < cards.length; i++) {
      var links = cards[i].querySelectorAll('a[href]');
      for (var j = 0; j < links.length; j++) {
        var url;
        try {
          url = new URL(links[j].getAttribute('href'), location.origin);
        } catch (e) {
          continue;
        }
        if (!/^\/in\/[^\/]+\/?$/.test(url.pathname)) continue;
        var paragraphs = links[j].querySelectorAll('p');
        var lines = [];
        for (var k = 0; k < paragraphs.length && lines.length < 2; k++) {
          var text = (paragraphs[k].textContent || '').replace(/\s+/g, ' ').trim();
          if (text) lines.push(text.slice(0, 300));
        }
        if (!lines.length) continue;
        out.push([
          url.pathname,
          '<div><a href="' +
            esc(url.pathname) +
            '">' +
            lines
              .map(function (line) {
                return '<p>' + esc(line) + '</p>';
              })
              .join('') +
            '</a></div>',
          lines.length,
        ]);
        break;
      }
    }
    return out;
  } catch (e) {
    return [];
  }
});
