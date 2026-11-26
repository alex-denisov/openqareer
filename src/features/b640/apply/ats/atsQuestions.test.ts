import { describe, expect, it } from 'vitest';
import type { AtsField } from './atsFormTypes';
import {
  askedFields,
  atsFormInput,
  fieldAnswers,
  isBeyondForm,
  isOffList,
  missingAnswers,
  questionIdOf,
} from './atsQuestions';

const field = (key: string, label: string, more: Partial<AtsField> = {}): AtsField => ({
  key,
  label,
  kind: 'text',
  role: null,
  required: true,
  options: [],
  accept: null,
  link: null,
  ...more,
});
const yesNo = [
  { value: '', label: 'Select...' },
  { value: '1', label: 'Yes' },
  { value: '0', label: 'No' },
];
const name = field('id:name', 'Full name');
const resume = field('id:resume', 'Resume', { kind: 'file' });
const letter = field('id:cl', 'Cover letter', { kind: 'textarea', required: false });
const visa = field('id:question_77', 'Do you need a visa?', { kind: 'select', options: yesNo });
const news = field('id:news', 'Send me marketing newsletters', {
  kind: 'checkbox',
  required: false,
});
const gdpr = field('id:gdpr', 'I agree to the privacy policy', { kind: 'checkbox' });
const fields = [name, resume, letter, visa, news, gdpr];

describe('вопросы формы работодателя в «Анкете»', () => {
  it('ползунок — числовой вопрос с границами формы', () => {
    const limits = { min: 0, max: 50_000, step: 500, unit: '$' };
    const pay = field('id:pay', 'Salary', { kind: 'range', limits });
    expect(atsFormInput('https://a.example/', [pay], {}).questions[0]).toMatchObject({
      kind: 'text',
      singleLine: true,
      numeric: true,
      limits,
    });
    expect(missingAnswers([pay], { [questionIdOf(pay)]: 'от 5 000 $' })).toBe(1);
    expect(missingAnswers([pay], { [questionIdOf(pay)]: '5 000' })).toBe(0);
  });

  it('письмо, резюме и согласия вопросами не становятся, имя уже стоит', () => {
    const input = atsFormInput('https://a.example/', fields, { fullName: 'Марина Соколова' });
    expect(input.questions.map((item) => [item.text, item.known])).toEqual([
      ['Full name', 'Марина Соколова'],
      ['Do you need a visa?', undefined],
    ]);
    expect(input.questions[1]).toMatchObject({ kind: 'choice', options: ['Yes', 'No'] });
  });

  it('вопрос Greenhouse несёт номер открытого списка; одинаковые подписи не путаются', () => {
    expect(questionIdOf(visa)).toBe('question_77');
    expect(questionIdOf(field('id:x', 'Salary', { question: '4082600' }))).toBe(
      'teamtailor_4082600',
    );
    expect(questionIdOf(field('id:x', 'Salary', { question: 'a b' }))).toMatch(/^ats-/u);
    expect(questionIdOf(field('id:a', 'X'))).not.toBe(questionIdOf(field('id:b', 'X')));
  });

  it('ответ по варианту уходит значением варианта, дата — по форме', () => {
    const date = field('id:from', 'Start date', { kind: 'date' });
    const draft = { question_77: 'No', [questionIdOf(date)]: '05.01.2027' };
    expect(fieldAnswers([visa, date], draft)).toEqual({
      'id:question_77': '0',
      'id:from': '2027-01-05',
    });
  });

  it('пустой обязательный и ответ не из списка ждут кандидата', () => {
    expect(missingAnswers(fields, {})).toBe(2);
    expect(isOffList(visa, 'Да')).toBe(true);
    const draft = { [questionIdOf(name)]: 'Марина', question_77: 'Yes' };
    expect(missingAnswers(fields, draft)).toBe(0);
  });

  it('обязательный второй файл и обязательная рассылка — не для приложения', () => {
    expect(isBeyondForm(fields)).toBe(false);
    expect(isBeyondForm([...fields, field('id:f', 'Portfolio', { kind: 'file' })])).toBe(true);
    expect(isBeyondForm([...fields, { ...news, required: true }])).toBe(true);
    expect(askedFields([resume])).toEqual([]);
    expect(isBeyondForm([resume])).toBe(true);
  });
});
