/**
 * Reads the LinkedIn skill rows that show text right now (B591).
 *
 * The skills page virtualises its list like the connections list: after the
 * walk scrolls back up only the first ten rows are left in the DOM, so the
 * 01.11 import read ten of 44 skills. The shell calls this after every scroll
 * step and merges the batches by row key on its own side.
 *
 * The file is a complete self-invoking script: the shell evaluates it as it
 * is, with no wrapper.
 *
 * Returns a JSON string of `[key, html, lines]` per row, where `html` is the
 * minimal `<div id="com.linkedin.sdui.profile.skill(…)"><p>…</p></div>` the
 * TS skills parser reads: the skill name first, then up to five more text
 * lines (endorsement context, the assessment badge), HTML-escaped.
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
    var rows = document.querySelectorAll('[componentkey^="com.linkedin.sdui.profile.skill("]');
    for (var i = 0; i < rows.length; i++) {
      var key = rows[i].getAttribute('componentkey') || '';
      if (!/^com\.linkedin\.sdui\.profile\.skill\([^)]*\)$/.test(key)) continue;
      var paragraphs = rows[i].querySelectorAll('p');
      var lines = [];
      for (var k = 0; k < paragraphs.length && lines.length < 6; k++) {
        var text = (paragraphs[k].textContent || '').replace(/\s+/g, ' ').trim();
        if (text && lines.indexOf(text) < 0) lines.push(text.slice(0, 300));
      }
      if (!lines.length) continue;
      out.push([
        key,
        '<div id="' +
          esc(key) +
          '">' +
          lines
            .map(function (line) {
              return '<p>' + esc(line) + '</p>';
            })
            .join('') +
          '</div>',
        lines.length,
      ]);
    }
    return JSON.stringify(out);
  } catch (_error) {
    return '[]';
  }
})();
