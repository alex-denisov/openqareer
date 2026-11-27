/**
 * Готовность страницы hh.ru/resume/<id>: блоки ниже первого экрана рисуются при прокрутке, поэтому
 * каждый вызов прокручивает ещё на экран. Отдаёт строкой только счётчики, текста резюме в ней нет:
 * c — карточки опыта, s — ступени должностей, a — есть «О себе», l — прежняя разметка,
 * w — ширина окна, e — страница прокручена до конца.
 */
(function () {
  try {
    var count = function (selector) {
      return document.querySelectorAll(selector).length;
    };
    var page = document.scrollingElement || document.documentElement;
    var view = window.innerHeight || 600;
    window.scrollTo(0, page.scrollTop + view);
    var end = page.scrollTop + view >= page.scrollHeight - 2;
    return [
      'c' + count('[data-qa~="profile-experience-company-card"]'),
      's' +
        count(
          '[data-qa~="profile-experience-company-card"] [data-qa~="magritte-stepper-step"]'
        ),
      'a' + (count('[data-qa~="resume-about-card"]') ? 1 : 0),
      'l' + (count('[data-qa^="resume-block-experience"], .resume-block-item-gap') ? 1 : 0),
      'w' + (window.innerWidth || 0),
      'e' + (end ? 1 : 0),
    ].join('_');
  } catch (_e) {
    return 'failed';
  }
})();
