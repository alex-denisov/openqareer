// B641: читает вопросы анкеты в открытой форме отклика hh.ru. Только чтение: ни кликов, ни ввода,
// ни перехода. Опора — блоки `task-body` страницы отклика (сборка hh.ru `VacancyResponse-route`, 25.11.2026),
// иначе обычные элементы формы и их подписи. Поле без понятного вопроса — `unreadable`: неполная анкета
// хуже, чем никакой. На метке `OQ_ACT` приложение подставляет заполнение (hh_questionnaire_fill.js).
(function () {
  try {
    var MAX_QUESTIONS = 40, MAX_OPTIONS = 200, MAX_TEXT = 500, MAX_OPTION_TEXT = 200;
    var unreadable = { code: 'unreadable', questions: [] };
    var waiting = { code: 'waiting', questions: [] };
    var host = location.hostname, path = location.pathname.replace(/\/$/, '');
    if (host !== 'hh.ru' && host.slice(-6) !== '.hh.ru') return unreadable;
    if (path.indexOf('/applicant/vacancy_response') !== 0 && !/^\/vacancy\/\d+$/.test(path)) return unreadable;

    var list = function (root, selector) { return [].slice.call(root.querySelectorAll(selector)); };
    var norm = function (text) { return String(text || '').replace(/\s+/g, ' ').trim(); };
    var type = function (el) { return el.tagName === 'INPUT' ? el.type : el.tagName.toLowerCase(); };
    var ticked = function (el) { return type(el) === 'radio' || type(el) === 'checkbox'; };
    var labels = function (el) { return [].slice.call(el.labels || []); };
    var shown = function (el) {
      return el.getClientRects().length > 0 || (ticked(el) && labels(el).some(function (l) { return l.getClientRects().length > 0; }));
    };
    var SERVICE = { hidden: 1, submit: 1, button: 1, reset: 1, image: 1, search: 1 };
    var TEXT = { textarea: 1, text: 1, number: 1, tel: 1, url: 1, email: 1 };
    var TASK = '[data-qa="task-body"]';
    // «Свой вариант»: поле ответа свёрнуто, пока вариант не выбран.
    var openOf = function (el) {
      var body = el.tagName === 'TEXTAREA' && /_text$/.test(el.name) && el.closest(TASK);
      return (body && list(body, 'input').filter(function (x) {
        return ticked(x) && x.value === 'open' && x.name === el.name.replace(/_text$/, '');
      })[0]) || null;
    };
    var controlsOf = function (root) {
      return list(root, 'textarea, select, input').filter(function (el) { return !SERVICE[type(el)] && (shown(el) || !!openOf(el)); });
    };
    var isLetter = function (el) {
      return !!el.closest('[data-qa="vacancy-response-popup-form-letter-input"]');
    };
    var isResume = function (el) { return el.name === 'resumeId'; };
    var isQuestion = function (el) { return !isLetter(el) && !isResume(el); };

    var modal = document.querySelector('#RESPONSE_MODAL_FORM_ID');
    var task = document.querySelector(TASK), taskForm = task && task.closest('form');
    var forms = (taskForm ? [taskForm] : modal ? [modal] : list(document, 'form')).filter(function (form) {
      return !form.closest('header, footer, nav, [role="search"]') &&
        controlsOf(form).some(function (el) { return isQuestion(el) && (ticked(el) || !/^INPUT$/.test(el.tagName)); });
    });
    if (forms.length === 0) return waiting;
    if (forms.length > 1) return unreadable;
    var form = forms[0];
    var custom = '[contenteditable="true"], [role="textbox"], [role="radio"], [role="checkbox"], [role="combobox"], [role="listbox"]';
    var odd = list(form, custom).some(function (el) {
      return !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.getClientRects().length > 0 &&
        (!taskForm || el.closest(TASK)) && !el.querySelector('input, textarea, select, [data-qa="resume-title"]');
    });
    if (odd) return unreadable;

    var all = controlsOf(form), groups = [], byName = {};
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!isQuestion(el) || (taskForm && !el.closest(TASK) && type(el) !== 'checkbox')) continue;
      if (!ticked(el)) { groups.push([el]); continue; }
      if (!el.name) return unreadable;
      var key = type(el) + ':' + el.name;
      if (byName[key]) byName[key].push(el);
      else { byName[key] = [el]; groups.push(byName[key]); }
    }

    var byIds = function (value) {
      return norm(String(value || '').split(/\s+/).map(function (id) {
        var ref = id && document.getElementById(id);
        return ref ? ref.textContent : '';
      }).join(' '));
    };
    var labelText = function (label) {
      var copy = label.cloneNode(true);
      list(copy, 'input, textarea, select, script, style').forEach(function (x) { x.remove(); });
      return norm(copy.textContent);
    };
    var ownLabel = function (el) {
      return byIds(el.getAttribute('aria-labelledby')) || norm(labels(el).map(labelText).join(' ')) || norm(el.getAttribute('aria-label'));
    };
    // Вариант без своей подписи: текст строки, где других полей нет.
    var optionText = function (el) {
      var own = ownLabel(el), body = el.closest(TASK);
      if (own || !body) return own;
      var row = el;
      for (var up = el.parentElement; up && up !== body; up = up.parentElement) {
        if (all.some(function (x) { return x !== el && up.contains(x); }) || up.querySelector('[data-qa="task-question"]')) break;
        row = up;
      }
      return labelText(row);
    };
    var GENERIC = /^(ваш ответ|ответ|введите ответ|напишите ответ|напишите тут|свой вариант|другое|комментарий)[:.…]*$/i;

    // Текст рядом с полями группы, без самих полей, их подписей и кнопок.
    var restText = function (box, group) {
      var copy = box.cloneNode(true);
      var skip = [];
      group.forEach(function (el) { if (ticked(el)) skip = skip.concat(labels(el)); });
      var from = list(box, '*'), to = list(copy, '*');
      to.forEach(function (node, index) {
        var source = from[index];
        if (skip.indexOf(source) >= 0 || group.indexOf(source) >= 0 || /^(BUTTON|SCRIPT|STYLE|TEMPLATE)$/.test(source.tagName)) {
          node.setAttribute('data-oq-skip', '1');
        }
      });
      list(copy, '[data-oq-skip]').forEach(function (node) { node.remove(); });
      return norm(copy.textContent);
    };
    var questionText = function (group) {
      var first = group[0], body = first.closest(TASK), title = body && body.querySelector('[data-qa="task-question"]');
      if (title) return norm(title.textContent) && norm(title.textContent) + (openOf(first) ? ' — свой вариант' : '');
      var own = ticked(first) ? '' : ownLabel(first);
      if (own && !GENERIC.test(own)) return own;
      var fieldset = first.closest('fieldset');
      var legend = fieldset && form.contains(fieldset) && fieldset.querySelector('legend');
      if (legend && group.every(function (el) { return fieldset.contains(el); }) &&
        controlsOf(fieldset).every(function (el) { return group.indexOf(el) >= 0; })) return norm(legend.textContent);
      var holder = first.closest('[role="radiogroup"], [role="group"]');
      if (holder && controlsOf(holder).every(function (el) { return group.indexOf(el) >= 0; })) {
        var named = byIds(holder.getAttribute('aria-labelledby')) || norm(holder.getAttribute('aria-label'));
        if (named) return named;
      }
      for (var box = first.parentElement; box && box !== form.parentElement; box = box.parentElement) {
        // Дальше — чужие поля: текст оттуда может относиться к другому вопросу.
        if (all.some(function (el) { return box.contains(el) && group.indexOf(el) < 0; })) return '';
        if (!group.every(function (el) { return box.contains(el); })) continue;
        var text = restText(box, group);
        if (text && !GENERIC.test(text)) return text;
      }
      return '';
    };

    // Галочка вне вопросов: согласие на обработку данных, рассылка или что-то другое — тогда это вопрос.
    var lone = function (group) {
      var el = group[0];
      if (group.length !== 1 || type(el) !== 'checkbox' || el.closest(TASK)) return null;
      var text = ownLabel(el);
      if (!text || text.length > MAX_TEXT) return null;
      var extra = /рассыл|реклам|новост|маркетинг|акци[ия]|предложени|будущ|кадров[а-я]* резерв|хранени|третьим|партн[её]р|newsletter|marketing/i.test(text);
      var data = /соглас|принимаю|даю|agree|consent/i.test(text) && /обработк[а-я]*[^.]{0,60}персональн|персональн[а-я]* данн|personal data/i.test(text);
      var link = labels(el).map(function (l) { return l.querySelector('a[href^="https://"], a[href^="/"]'); }).filter(Boolean)[0];
      return { el: el, text: text, url: link ? link.href : null, kind: data ? (extra ? 'other' : 'data') : (/рассыл|реклам|новост|маркетинг|newsletter|marketing/i.test(text) ? 'news' : 'other') };
    };
    var questions = [], texts = {}, asked = [], consents = [];
    for (var g = 0; g < groups.length; g++) {
      var group = groups[g], head = group[0], kind = type(head);
      var tick = lone(group);
      if (tick && tick.kind !== 'other') { consents.push(tick); continue; }
      var text = questionText(group) || (tick ? tick.text : '');
      if (/сопроводительн/i.test(text)) continue;
      if (!text || text.length > MAX_TEXT || texts['q' + text]) return unreadable;
      texts['q' + text] = 1;
      var optional = /необязательн|по желанию|\(optional\)/i.test(text) || head.getAttribute('aria-required') === 'false';
      if (openOf(head)) optional = true;
      if (tick) optional = !(head.required || head.getAttribute('aria-required') === 'true');
      var question = { text: text, required: !optional, kind: 'text' }, labelsOf = null;
      if (ticked(head) || kind === 'select-one' || kind === 'select') {
        labelsOf = ticked(head)
          ? group.map(optionText)
          : [].slice.call(head.options).filter(function (o) { return o.value !== '' && !o.disabled; }).map(function (o) { return norm(o.textContent); });
        var bad = labelsOf.some(function (label, index) {
          return !label || label.length > MAX_OPTION_TEXT || labelsOf.indexOf(label) !== index;
        });
        var least = kind === 'checkbox' || head.closest(TASK) ? 1 : 2;
        if (bad || labelsOf.length < least || labelsOf.length > MAX_OPTIONS) return unreadable;
        question.kind = 'choice';
        question.options = labelsOf;
        if (kind === 'checkbox' || head.multiple === true) question.multiple = true;
      } else if (!TEXT[kind]) return unreadable;
      questions.push(question);
      asked.push({ question: question, group: group, labels: labelsOf || [], open: openOf(head) });
    }
    if (questions.length > MAX_QUESTIONS) return unreadable;
    /* OQ_ACT */
    return questions.length ? { code: 'read', questions: questions } : waiting;
  } catch {
    return { code: 'unreadable', questions: [] };
  }
})()
