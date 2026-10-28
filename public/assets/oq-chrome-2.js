/* B569, B574: the shared public header on server-rendered pages (catalog,
 * salaries, interview questions): the phone section menu and the «Инструменты»
 * list. Without this file «Инструменты» stays a link to /#tools. React pages
 * own the same behaviour in PublicHeader; this file is never loaded there. */
(function () {
  // Same list as PUBLIC_TOOLS in shared/publicSiteChrome.ts (a test keeps them equal).
  var TOOLS = [
    ['/vacancies', 'Каталог вакансий'],
    ['/tools/salary-calculator', 'Калькулятор зарплаты на руки'],
    ['/salaries', 'Зарплаты по профессиям'],
    ['/tools/resume', 'Конструктор резюме'],
    ['/tools/interview-questions', 'Вопросы на собеседовании'],
    ['/tools/relocation', 'В какую страну переехать'],
  ];
  // The server prints the section links once; the phone menu gets a copy.
  var nav = document.querySelector('.ps-nav');
  var menu = document.getElementById('ps-menu');
  if (nav && menu && !menu.querySelector('.ps-tooldrop')) {
    menu.insertAdjacentHTML('afterbegin', nav.innerHTML.replace('is-nav', 'is-menu'));
  }
  document.querySelectorAll('.ps-tooldrop').forEach(function (box) {
    var trigger = box.querySelector('[data-ps-disclosure]');
    if (!trigger || box.querySelector('.ps-tooldrop-menu')) return;
    var panel = document.createElement('div');
    panel.className = 'ps-tooldrop-menu';
    panel.id = box.classList.contains('is-menu') ? 'ps-menu-tools' : 'ps-tooldrop-menu';
    panel.hidden = true;
    TOOLS.forEach(function (tool) {
      var link = document.createElement('a');
      link.href = tool[0];
      link.textContent = tool[1];
      panel.appendChild(link);
    });
    box.appendChild(panel);
    trigger.setAttribute('aria-controls', panel.id);
  });
  // Open lists are noted on <html>: when the app bundle replaces this markup,
  // the header it draws opens the same lists (PublicToolsMenu.openInShell).
  function note(id, open) {
    var root = document.documentElement;
    var ids = (root.getAttribute('data-ps-open') || '').split(' ').filter(function (item) {
      return item && item !== id;
    });
    if (open) ids.push(id);
    root.setAttribute('data-ps-open', ids.join(' '));
  }
  function setOpen(trigger, panel, open) {
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    panel.hidden = !open;
    note(panel.id, open);
  }
  var pairs = [];
  document.querySelectorAll('[data-ps-menu],[data-ps-disclosure]').forEach(function (trigger) {
    var panel = document.getElementById(trigger.getAttribute('aria-controls'));
    if (!panel) return;
    var disclosure = trigger.hasAttribute('data-ps-disclosure');
    if (disclosure) trigger.setAttribute('role', 'button');
    var pair = { trigger: trigger, panel: panel, disclosure: disclosure };
    pairs.push(pair);
    function toggle(event) {
      event.preventDefault();
      setOpen(trigger, panel, trigger.getAttribute('aria-expanded') !== 'true');
    }
    trigger.addEventListener('click', toggle);
    if (disclosure) {
      trigger.addEventListener('keydown', function (event) {
        if (event.key === ' ') toggle(event);
      });
    }
  });
  function isOpen(pair) {
    return pair.trigger.getAttribute('aria-expanded') === 'true';
  }
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    // The innermost open list closes first: a tools list before the phone menu.
    var open = pairs.filter(isOpen).sort(function (a, b) {
      return Number(b.disclosure) - Number(a.disclosure);
    })[0];
    if (!open) return;
    setOpen(open.trigger, open.panel, false);
    open.trigger.focus();
  });
  document.addEventListener('click', function (event) {
    pairs.forEach(function (pair) {
      if (!pair.disclosure || !isOpen(pair)) return;
      if (!pair.trigger.parentNode.contains(event.target)) setOpen(pair.trigger, pair.panel, false);
    });
  });
})();
