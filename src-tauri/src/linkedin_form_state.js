/** Read only: is this a page to keep, or LinkedIn refusing requests (999, 429, an error page). */
(function (wantsForm) {
  var nav = performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null;
  if (nav && nav.responseStatus >= 400) return 'request_blocked';
  var text =
    document.title +
    ' ' +
    (document.body ? document.body.innerText || document.body.textContent : '').slice(0, 20000);
  if (
    /request denied|too many requests|access denied|unusual activity|security verification|\b(error|http)\s*(999|429)\b/i.test(
      text,
    )
  ) {
    return 'request_blocked';
  }
  if (!wantsForm) return 'ok';
  var roots = [document];
  for (var i = 0; i < roots.length; i += 1) {
    var fields = roots[i].querySelectorAll(
      'textarea,[contenteditable="true"],[role="textbox"],input[type="text"]',
    );
    for (var j = 0; j < fields.length; j += 1) {
      var box = fields[j].closest('form,dialog,[role="dialog"]');
      if (box && fields[j].getClientRects().length > 0) return 'ok';
    }
    var all = roots[i].querySelectorAll('*');
    for (var k = 0; k < all.length; k += 1) if (all[k].shadowRoot) roots.push(all[k].shadowRoot);
  }
  return 'form_missing';
})(__WANTS_FORM__);
