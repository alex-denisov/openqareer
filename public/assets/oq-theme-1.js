/*
 * B593: тема нового кабинета с первого кадра, до бандла. Признак нового кабинета на этом
 * устройстве — сохранённая тема (oq_b640_theme) или флаг кабинета (oq_cabinet_b640); без
 * них страница остаётся тёмной, как прежний кабинет. Цвет страницы задаёт CSS по атрибуту
 * data-oq-theme (App.css): инлайн-стили запрещены политикой страницы. Только кабинет
 * (/app) и настольное приложение (класс ставит desktop-bootstrap.js, он подключён раньше):
 * лендинг и публичные страницы остаются своими.
 */
(function () {
  var colors = { light: '#f6fafa', dark: '#060e0e' };
  var root = document.documentElement;
  var inCabinet = /^\/app(\/|$)/.test(window.location.pathname);
  if (!inCabinet && !root.classList.contains('is-desktop-companion')) return;
  var theme = null;
  var cabinet = false;
  try {
    theme = window.localStorage.getItem('oq_b640_theme');
    cabinet = window.localStorage.getItem('oq_cabinet_b640') === '1';
  } catch (_error) {
    return;
  }
  if (theme !== 'light' && theme !== 'dark' && theme !== 'system') {
    if (!cabinet) return;
    theme = 'light';
  }
  var systemDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  var resolved = theme === 'dark' || (theme === 'system' && systemDark) ? 'dark' : 'light';
  root.setAttribute('data-oq-theme', resolved);
  var bar = document.querySelector('meta[name="theme-color"]');
  if (bar) bar.setAttribute('content', colors[resolved]);
})();
