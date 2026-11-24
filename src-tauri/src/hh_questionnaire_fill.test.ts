import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const source = (name: string) => readFileSync(join(__dirname, name), 'utf8');
const PAGE = source('hh_questionnaire_page.js');
const FILL = source('hh_questionnaire_fill.js');
const URL = 'https://hh.ru/applicant/vacancy_response?vacancyId=77';

interface Answer {
  readonly text: string;
  readonly values: readonly string[];
}

function page(html: string) {
  const { window } = new JSDOM(`<body>${html}</body>`, { url: URL, runScripts: 'outside-only' });
  window.Element.prototype.getClientRects = function (this: Element) {
    return (this.closest('[hidden]') ? [] : [{}]) as unknown as DOMRectList;
  };
  const submits: string[] = [];
  window.document.addEventListener('submit', () => submits.push('submit'), true);
  const read = () =>
    JSON.parse(JSON.stringify(window.eval(PAGE))) as { code: string; questions: unknown[] };
  const fill = (answers: readonly Answer[], consent = false) => {
    const act = FILL.replace('__OQ_ANSWERS__', () => JSON.stringify({ answers, consent }));
    const script = PAGE.replace('/* OQ_ACT */', () => act);
    const once = () =>
      JSON.parse(JSON.stringify(window.eval(script))) as { code: string; consents?: unknown[] };
    const first = once();
    return first.code === 'waiting' ? once() : first;
  };
  const value = (name: string) =>
    window.document.querySelector<HTMLTextAreaElement>(`[name="${name}"]`)!.value;
  const ticked = () =>
    [...window.document.querySelectorAll<HTMLInputElement>('input:checked')].map(
      (box) => `${box.name}=${box.value}`,
    );
  return { read, fill, value, ticked, submits };
}

/** Разметка блока `task-body` из сборки hh.ru VacancyResponse-route (25.11.2026), без классов. */
const option = (name: string, type: string, value: string, text: string) =>
  `<div><div><input type="${type}" name="${name}" value="${value}"></div><div><div>${text}</div></div></div>`;
const taskBody = (question: string, body: string) =>
  `<div data-qa="task-body"><div><div data-qa="task-question"><p>${question}</p></div></div><div>${body}</div></div>`;
const LETTER =
  '<div data-qa="vacancy-response-popup-form-letter-input"><textarea name="text"></textarea></div>';
const form = (inner: string, outside = '') =>
  `<form><input type="hidden" name="uidPk" value="x"><div data-qa="resume-title">Директор</div>${inner}${LETTER}${outside}<button type="submit" data-qa="vacancy-response-submit-popup">Откликнуться</button></form>`;

const TEST = form(
  taskBody('Почему мы?', '<textarea name="task_1_text"></textarea>') +
    taskBody(
      'Командировки?',
      option('task_2', 'radio', '21', 'Да') + option('task_2', 'radio', '22', 'Нет'),
    ) +
    taskBody(
      'Языки',
      option('task_3', 'checkbox', '31', 'Английский') +
        `<div>${option('task_3', 'checkbox', 'open', 'Свой вариант')}<div class="task-option-text_hidden" hidden><textarea name="task_3_text"></textarea></div></div>`,
    ),
);

const ANSWERS: readonly Answer[] = [
  { text: 'Почему мы?', values: ['Первая строка\nвторая </script> "кавычки"'] },
  { text: 'Командировки?', values: ['Нет'] },
  { text: 'Языки', values: ['Английский', 'Свой вариант'] },
  { text: 'Языки — свой вариант', values: ['Чешский'] },
];

describe('B787: анкета hh.ru заполняется в окне кандидата', () => {
  it('страница отклика hh.ru читается: текст, один вариант, несколько и «свой вариант»', () => {
    expect(page(TEST).read()).toEqual({
      code: 'read',
      questions: [
        { text: 'Почему мы?', required: true, kind: 'text' },
        { text: 'Командировки?', required: true, kind: 'choice', options: ['Да', 'Нет'] },
        {
          text: 'Языки',
          required: true,
          kind: 'choice',
          options: ['Английский', 'Свой вариант'],
          multiple: true,
        },
        { text: 'Языки — свой вариант', required: false, kind: 'text' },
      ],
    });
  });

  it('ставит все ответы, повтор только проверяет, отправку не нажимает', () => {
    const view = page(TEST);
    let result = view.fill(ANSWERS);
    if (result.code === 'waiting') result = view.fill(ANSWERS);
    expect(result).toEqual({ code: 'filled', consents: [] });
    expect(view.value('task_1_text')).toBe('Первая строка\nвторая </script> "кавычки"');
    expect(view.ticked()).toEqual(['task_2=22', 'task_3=31', 'task_3=open']);
    expect(view.value('task_3_text')).toBe('Чешский');
    expect(view.submits).toEqual([]);
  });

  it.each([
    ['нет обязательного ответа', ANSWERS.slice(1), 'answers_missing'],
    ['«свой вариант» без текста', ANSWERS.slice(0, 3), 'answers_missing'],
    [
      'варианта больше нет',
      [ANSWERS[0]!, { text: 'Командировки?', values: ['Иногда'] }, ...ANSWERS.slice(2)],
      'answers_changed',
    ],
    [
      'два ответа на один выбор',
      [ANSWERS[0]!, { text: 'Командировки?', values: ['Да', 'Нет'] }, ...ANSWERS.slice(2)],
      'answers_changed',
    ],
  ])('%s — форма не тронута', (_name, answers, code) => {
    const view = page(TEST);
    expect(view.fill(answers)).toEqual({ code });
    expect(view.ticked()).toEqual([]);
    expect(view.value('task_1_text')).toBe('');
  });

  const CONSENT =
    '<label><input type="checkbox" name="pd">Согласен на обработку <a href="https://hh.ru/policy">персональных данных</a></label><label><input type="checkbox" name="news" checked>Хочу получать рассылку</label>';
  const WITH_CONSENT = form(
    taskBody('Почему мы?', '<textarea name="task_1_text"></textarea>'),
    CONSENT,
  );

  it('согласие — только по поручению; рассылка не ставится и снимается', () => {
    expect(page(WITH_CONSENT).read().questions).toHaveLength(1);
    const refused = page(WITH_CONSENT);
    expect(refused.fill(ANSWERS)).toEqual({ code: 'consent_required' });
    expect(refused.ticked()).toEqual(['news=on']);
    const given = page(WITH_CONSENT);
    expect(given.fill(ANSWERS, true)).toEqual({
      code: 'filled',
      consents: [
        { text: 'Согласен на обработку персональных данных', url: 'https://hh.ru/policy' },
      ],
    });
    expect(given.ticked()).toEqual(['pd=on']);
  });

  it.each([
    'Подтверждаю, что не имею судимости',
    'Согласен на обработку персональных данных и рассылку вакансий',
    'Согласен на хранение персональных данных для будущих вакансий',
  ])('другая галочка — вопрос кандидату: %s', (text) => {
    const view = page(
      form(
        taskBody('А?', '<textarea name="task_1_text"></textarea>'),
        `<label><input type="checkbox" name="x" required>${text}</label>`,
      ),
    );
    expect(view.read().questions).toContainEqual({
      text,
      required: true,
      kind: 'choice',
      options: [text],
      multiple: true,
    });
  });
});
