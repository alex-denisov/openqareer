/* eslint-disable no-undef -- часть hh_questionnaire_page.js, отдельно не исполняется */
// B787: подтверждённые кандидатом ответы в той же форме. Отвечает `filled`, только когда поля уже
// держат ответы; повторный вызов — проверка. Отправку не нажимает.
var ACT = __OQ_ANSWERS__;
if (!questions.length) return { code: 'waiting' };
var changed = false;
var press = function (box) {
  changed = true;
  box.click();
};
var put = function (field, value) {
  if (String(field.value).replace(/\r\n/g, '\n') === value) return;
  changed = true;
  var proto =
    field.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement
      : field.tagName === 'SELECT'
        ? HTMLSelectElement
        : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
};
var valuesOf = function (item) {
  var found = ACT.answers.filter(function (a) {
    return norm(a.text) === item.question.text;
  })[0];
  return found ? found.values : [];
};
// Сначала проверка всей анкеты: незнакомый вопрос или вариант не оставляет её заполненной наполовину.
for (var c = 0; c < asked.length; c++) {
  var item = asked[c],
    given = valuesOf(item),
    one = !item.question.multiple;
  if (item.question.required && !given.length) return { code: 'answers_missing' };
  if (
    item.question.kind === 'choice' &&
    (given.some(function (v) {
      return item.labels.indexOf(v) < 0;
    }) ||
      (one && given.length > 1))
  )
    return { code: 'answers_changed' };
  if (item.open && !given.length) {
    var owner = asked.filter(function (x) {
      return x.group.indexOf(item.open) >= 0;
    })[0];
    var label = owner && owner.labels[owner.group.indexOf(item.open)];
    if (!owner || valuesOf(owner).indexOf(label) >= 0) return { code: 'answers_missing' };
  }
}
if (
  !ACT.consent &&
  consents.some(function (t) {
    return t.kind === 'data' && !t.el.checked;
  })
)
  return { code: 'consent_required' };
asked.forEach(function (item) {
  var given = valuesOf(item),
    head = item.group[0];
  if (item.question.kind === 'text') {
    if (!item.open) put(head, given.join('\n'));
    else if (given.length && item.open.checked) put(head, given.join('\n'));
  } else if (ticked(head)) {
    item.group.forEach(function (box, index) {
      var want = given.indexOf(item.labels[index]) >= 0;
      if (box.checked !== want && (want || type(box) === 'checkbox')) press(box);
    });
  } else if (item.question.multiple) {
    var picked = false;
    [].slice.call(head.options).forEach(function (o) {
      var want = given.indexOf(norm(o.textContent)) >= 0;
      if (o.selected !== want) {
        o.selected = want;
        picked = true;
      }
    });
    if (picked) {
      changed = true;
      head.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } else {
    var option = [].slice.call(head.options).filter(function (o) {
      return o.value !== '' && norm(o.textContent) === given[0];
    })[0];
    put(head, option ? option.value : '');
  }
});
consents.forEach(function (t) {
  if (t.el.checked !== (t.kind === 'data')) press(t.el);
});
if (changed) return { code: 'waiting' };
return {
  code: 'filled',
  consents: consents
    .filter(function (t) {
      return t.kind === 'data';
    })
    .map(function (t) {
      return { text: t.text, url: t.url };
    }),
};
