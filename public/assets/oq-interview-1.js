/* B568: interview questions. Hub search, question filters and the 5-question quiz.
 * Nothing leaves the page: the quiz score is counted locally and leads to sign-up. */
export function scoreQuiz(items, answers) {
  return items.reduce((score, item, index) => score + (answers[index] === item.correct ? 1 : 0), 0);
}

function text(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}

function bindSearch(root) {
  const input = root.querySelector('[data-iq-search]');
  const list = root.querySelector('#iq-list');
  const empty = root.querySelector('[data-iq-empty]');
  if (!input || !list) return;
  input.addEventListener('input', () => {
    const query = input.value.trim().toLocaleLowerCase('ru-RU');
    let visible = 0;
    for (const item of list.querySelectorAll('li')) {
      const match = !query || item.textContent.toLocaleLowerCase('ru-RU').includes(query);
      item.hidden = !match;
      if (match) visible += 1;
    }
    if (empty) empty.hidden = visible > 0;
  });
}

function bindFilters(root) {
  const buttons = [...root.querySelectorAll('[data-iq-filter]')];
  const questions = [...root.querySelectorAll('.iq-q[data-kind]')];
  for (const button of buttons)
    button.addEventListener('click', () => {
      const kinds = button.dataset.iqFilter.split(' ');
      for (const other of buttons) other.setAttribute('aria-pressed', String(other === button));
      for (const question of questions)
        question.hidden = !(kinds.includes('all') || kinds.includes(question.dataset.kind));
    });
}

function renderResult(box, data, score) {
  box.replaceChildren(text('b', `Верно ${score} из ${data.items.length}`));
  box.append(
    text(
      'p',
      data.locked > 0
        ? `Ещё ${data.lockedLabel} с разбором — после бесплатной регистрации. Тренажёр с ИИ под конкретную вакансию — в Basic.`
        : 'Тренажёр с ИИ разберёт ваши ответы под конкретную вакансию — в Basic.',
      'ps-soft',
    ),
  );
  const link = text(
    'a',
    data.locked > 0 ? 'Открыть остальные вопросы' : 'Перейти к тренажёру',
    'ps-btn is-primary',
  );
  link.href = data.signup;
  box.append(link);
}

function bindQuiz(root) {
  const quiz = root.querySelector('[data-iq-quiz]');
  const raw = quiz?.querySelector('[data-iq-quiz-data]');
  if (!quiz || !raw) return;
  let data;
  try {
    data = JSON.parse(raw.textContent);
  } catch {
    quiz.hidden = true;
    return;
  }
  const box = quiz.querySelector('[data-iq-box]');
  const next = quiz.querySelector('[data-iq-next]');
  const step = quiz.querySelector('[data-iq-step]');
  const bar = quiz.querySelector('[data-iq-bar]');
  const answers = [];
  let index = 0;

  function show() {
    const item = data.items[index];
    step.textContent = `${index + 1} из ${data.items.length}`;
    bar.style.width = `${(index / data.items.length) * 100}%`;
    next.disabled = true;
    next.textContent = index === data.items.length - 1 ? 'Итог' : 'Дальше';
    box.replaceChildren(text('b', item.question));
    item.options.forEach((option, k) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'iq-opt';
      button.dataset.k = String(k);
      button.setAttribute('aria-pressed', 'false');
      button.append(text('span', '', 'iq-mk'), text('span', option));
      box.append(button);
    });
    box.append(Object.assign(text('p', '', 'iq-expl'), { hidden: true }));
    bindOptions();
  }

  function bindOptions() {
    const item = data.items[index];
    const options = [...box.querySelectorAll('.iq-opt')];
    const explain = box.querySelector('.iq-expl');
    for (const option of options)
      option.addEventListener('click', () => {
        if (answers[index] !== undefined) return;
        const chosen = Number(option.dataset.k);
        answers[index] = chosen;
        const right = chosen === item.correct;
        for (const other of options) other.setAttribute('aria-pressed', String(other === option));
        option.classList.add(right ? 'is-right' : 'is-wrong');
        explain.replaceChildren(
          text('b', right ? 'Верно. ' : `Сильнее вариант ${item.correct + 1}. `),
          document.createTextNode(item.explain),
        );
        explain.hidden = false;
        next.disabled = false;
        bar.style.width = `${((index + 1) / data.items.length) * 100}%`;
      });
  }

  next.addEventListener('click', () => {
    if (index < data.items.length - 1) {
      index += 1;
      show();
      return;
    }
    step.textContent = 'Итог';
    next.hidden = true;
    renderResult(box, data, scoreQuiz(data.items, answers));
  });
  bindOptions();
}

if (typeof document !== 'undefined') {
  bindSearch(document);
  bindFilters(document);
  bindQuiz(document);
}
