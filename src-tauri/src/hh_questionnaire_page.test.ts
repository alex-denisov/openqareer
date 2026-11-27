import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const script = readFileSync(join(__dirname, 'hh_questionnaire_page.js'), 'utf8');
const URL = 'https://hh.ru/applicant/vacancy_response?vacancyId=77';

/** Формы собраны по смыслу (form/textarea/radio/label), это не снимок hh.ru. */
function read(html: string, url = URL) {
  const { window } = new JSDOM(`<body>${html}</body>`, { url, runScripts: 'outside-only' });
  window.Element.prototype.getClientRects = function (this: Element) {
    return (this.closest('[hidden]') ? [] : [{}]) as unknown as DOMRectList;
  };
  const before = window.document.body.innerHTML;
  const events: string[] = [];
  for (const name of ['click', 'input', 'change', 'submit', 'focusin']) {
    window.document.addEventListener(name, () => events.push(name), true);
  }
  const result = window.eval(script) as { code: string; questions: unknown[] };
  expect(window.document.body.innerHTML).toBe(before);
  expect(events).toEqual([]);
  return JSON.parse(JSON.stringify(result)) as typeof result;
}

const letter =
  '<div data-qa="vacancy-response-popup-form-letter-input"><textarea></textarea></div>';

describe('B641: вопросы анкеты hh.ru', () => {
  it('читает свободный ответ, выбор и несколько вариантов; письмо и резюме — не вопросы', () => {
    const result = read(`<form>
      <label><input type="radio" name="resumeId" value="a">Резюме</label>
      <div><div>Сколько человек было в команде?</div><div><textarea name="a"></textarea></div></div>
      <div><p>Готовы к командировкам?</p>
        <label><input type="radio" name="b" value="1"> Да</label><label><input type="radio" name="b" value="2"> Нет</label></div>
      <fieldset><legend>Языки (необязательно)</legend>
        <label><input type="checkbox" name="c">Английский</label><label><input type="checkbox" name="c">Немецкий</label></fieldset>
      <label for="d">Грейд</label><select id="d"><option value="">Выберите</option><option value="1">Senior</option><option value="2">Lead</option></select>
      ${letter}<button>Откликнуться</button></form>`);
    expect(result).toEqual({
      code: 'read',
      questions: [
        { text: 'Сколько человек было в команде?', required: true, kind: 'text' },
        { text: 'Готовы к командировкам?', required: true, kind: 'choice', options: ['Да', 'Нет'] },
        {
          text: 'Языки (необязательно)',
          required: false,
          kind: 'choice',
          options: ['Английский', 'Немецкий'],
          multiple: true,
        },
        { text: 'Грейд', required: true, kind: 'choice', options: ['Senior', 'Lead'] },
      ],
    });
  });

  it('общая подпись «Ваш ответ» — не вопрос: берётся текст рядом', () => {
    const result = read(
      '<form><div><p>Почему мы?</p><textarea aria-label="Ваш ответ"></textarea></div></form>',
    );
    expect(result.questions).toEqual([{ text: 'Почему мы?', required: true, kind: 'text' }]);
  });

  it('письмо без пометки hh.ru узнаётся по подписи', () => {
    const result = read(
      '<form><div><p>Почему мы?</p><textarea></textarea></div><div><label for="l">Сопроводительное письмо</label><textarea id="l"></textarea></div></form>',
    );
    expect(result.questions).toHaveLength(1);
  });

  it.each([
    [
      'поле без вопроса',
      '<form><div><p>Вопрос?</p><textarea></textarea></div><textarea></textarea></form>',
    ],
    [
      'вариант без подписи',
      '<form><div><p>Вопрос?</p><input type="radio" name="a"><input type="radio" name="a"></div></form>',
    ],
    [
      'один вопрос дважды',
      '<form><div><p>Вопрос?</p><textarea></textarea></div><div><p>Вопрос?</p><textarea></textarea></div></form>',
    ],
    [
      'файл',
      '<form><div><p>Вопрос?</p><textarea></textarea></div><div><p>Файл</p><input type="file"></div></form>',
    ],
    [
      'поле не из обычных элементов',
      '<form><div><p>Вопрос?</p><textarea></textarea></div><div role="combobox">Выберите</div></form>',
    ],
    [
      'две формы',
      '<form><p>А?</p><textarea></textarea></form><form><p>Б?</p><textarea></textarea></form>',
    ],
  ])('не читается: %s', (_name, html) => {
    expect(read(html)).toEqual({ code: 'unreadable', questions: [] });
  });

  it('нет формы с вопросами — ждёт; чужая страница не читается', () => {
    expect(read('<form role="search"><textarea></textarea></form>').code).toBe('waiting');
    expect(read(`<form>${letter}</form>`).code).toBe('waiting');
    const form = '<form><p>А?</p><textarea></textarea></form>';
    expect(read(form, 'https://hh.ru/resume/1').code).toBe('unreadable');
    expect(read(form, 'https://evilhh.ru/applicant/vacancy_response').code).toBe('unreadable');
    expect(read(form, 'https://spb.hh.ru/vacancy/77').code).toBe('read');
  });
});
