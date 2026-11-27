/**
 * Раскрывает «Развернуть» в опыте и «О себе» на странице hh.ru/resume/<id> кандидата: без этого
 * страница отдаёт начало длинного текста. Кнопки правки не трогаются. Возвращает число раскрытых.
 */
(function () {
  try {
    var expand = /^(развернуть|показать полностью|ещё|expand|show more|read more|more)$/i;
    var scopes =
      '[data-qa~="profile-experience-company-card"] [data-qa~="magritte-stepper-step-content"], [data-qa~="resume-about-card"]';
    var opened = 0;
    document.querySelectorAll(scopes).forEach(function (scope) {
      scope.querySelectorAll('button, [role="button"]').forEach(function (button) {
        if (/edit/i.test(button.getAttribute('data-qa') || '')) return;
        if (!expand.test((button.textContent || '').trim())) return;
        button.click();
        opened += 1;
      });
    });
    return opened;
  } catch (_e) {
    return 0;
  }
})();
