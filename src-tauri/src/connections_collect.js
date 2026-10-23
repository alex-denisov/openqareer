/**
 * Collects the candidate's LinkedIn connections while the list is walked
 * (B448). The list virtualises long runs of rows: a card scrolled far away
 * keeps its frame but loses its text, so one read at the end saw text on a
 * few cards out of 1 519. Each scroll step runs `collect`, which keeps every
 * card seen with text in a page-local map keyed by profile path; `emit`
 * returns them as minimal HTML: one
 * `<div><a href="/in/…"><p>name</p><p>headline</p></a></div>` per person.
 * Only the profile path and the first two text lines of the profile link
 * leave the page, HTML-escaped.
 */
(function (mode) {
  try {
    var KEY = '__openqareerConnections';
    if (mode === 'reset' || !window[KEY]) window[KEY] = new Map();
    var seen = window[KEY];
    if (mode === 'reset') return 0;
    var esc = function (text) {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    };
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
        var known = seen.get(url.pathname);
        if (!known || known.lines < lines.length) {
          seen.set(url.pathname, {
            lines: lines.length,
            html:
              '<div><a href="' +
              esc(url.pathname) +
              '">' +
              lines
                .map(function (line) {
                  return '<p>' + esc(line) + '</p>';
                })
                .join('') +
              '</a></div>',
          });
        }
        break;
      }
    }
    if (mode !== 'emit') return seen.size;
    if (!seen.size) return '';
    var out = [];
    seen.forEach(function (entry) {
      out.push(entry.html);
    });
    return '<main>' + out.join('') + '</main>';
  } catch (e) {
    return mode === 'emit' ? '' : -1;
  }
});
