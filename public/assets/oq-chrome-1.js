/* B569: section menu of the shared public header on server-rendered pages
 * (catalog, salaries, interview questions). React pages own the same menu in
 * PublicHeader; this file is never loaded there. */
(function () {
  var button = document.querySelector('[data-ps-menu]');
  var panel = button && document.getElementById(button.getAttribute('aria-controls'));
  if (!button || !panel) return;
  function set(open) {
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    panel.hidden = !open;
  }
  button.addEventListener('click', function () {
    set(button.getAttribute('aria-expanded') !== 'true');
  });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' || button.getAttribute('aria-expanded') !== 'true') return;
    set(false);
    button.focus();
  });
})();
