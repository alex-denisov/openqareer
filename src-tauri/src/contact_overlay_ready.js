/**
 * Has LinkedIn finished drawing the contact-info overlay (B561)?
 *
 * A direct navigation to `/in/<slug>/overlay/contact-info/` renders the
 * profile first and opens the dialog a beat later; the 30.10 import read the
 * page in 2 s and captured the profile behind it, so email and phone never
 * arrived. The shell polls this script until it answers true before it
 * sanitizes the page.
 *
 * Ready means: a dialog holds a link to a profile root (`/in/<slug>/`), the
 * "Your profile" row every contact overlay has. Labels are not used, they
 * change with the interface language.
 *
 * The file is a complete self-invoking script, evaluated as it is; it returns
 * a boolean.
 */
(function () {
  try {
    var profileRoot = /^\/in\/[^/]+\/?$/;
    var dialogs = Array.prototype.slice.call(document.querySelectorAll('[role=dialog],dialog'));
    return dialogs.some(function (dialog) {
      return Array.prototype.slice.call(dialog.querySelectorAll('a[href]')).some(function (link) {
        try {
          return profileRoot.test(
            new URL(link.getAttribute('href'), 'https://www.linkedin.com').pathname,
          );
        } catch (_e) {
          return false;
        }
      });
    });
  } catch (_e) {
    return false;
  }
})();
