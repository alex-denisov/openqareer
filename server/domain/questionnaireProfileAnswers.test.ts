import { describe, expect, it } from 'vitest';
import type { QuestionnaireQuestion } from '../../shared/applicationQuestionnaire';
import { profileAnswers, type QuestionnaireProfileFacts } from './questionnaireProfileAnswers';

const FACTS: QuestionnaireProfileFacts = {
  fullName: 'Марина Соколова',
  email: 'm.sokolova@example.com',
  phone: '+7 916 245-18-07',
  linkedinUrl: 'https://www.linkedin.com/in/msokolova',
  links: ['https://github.com/msokolova', 'https://sokolova.dev'],
  location: 'Москва, Россия',
  citizenship: ['Россия'],
};

const text = (id: string, label: string): QuestionnaireQuestion => ({ id, text: label, required: true, kind: 'text' });
const answer = (label: string, facts: QuestionnaireProfileFacts | null = FACTS) =>
  profileAnswers([text('q', label)], facts)[0]?.text;

describe('B641: ответы анкеты из профиля', () => {
  it('подставляет контакты как есть', () => {
    expect(answer('LinkedIn Profile')).toBe('https://www.linkedin.com/in/msokolova');
    expect(answer('GitHub URL')).toBe('https://github.com/msokolova');
    expect(answer('Website or portfolio')).toBe('https://sokolova.dev');
    expect(answer('Email address')).toBe('m.sokolova@example.com');
    expect(answer('Номер телефона')).toBe('+7 916 245-18-07');
    expect(answer('Full name')).toBe('Марина Соколова');
    expect(answer('Ваше гражданство')).toBe('Россия');
    expect(answer('ФИО')).toBe('Марина Соколова');
    expect(answer('Страна')).toBe('Россия');
  });

  it('B641: ссылка LinkedIn без https и с пометкой берётся из контактов полной ссылкой', () => {
    const link = (value: string) => answer('LinkedIn Profile', { links: [value] });
    const full = 'https://www.linkedin.com/in/msokolova';
    expect(link('linkedin.com/in/msokolova')).toBe('https://linkedin.com/in/msokolova');
    expect(link('www.linkedin.com/in/msokolova/')).toBe(`${full}/`);
    expect(link('LinkedIn: ru.linkedin.com/in/msokolova')).toBe('https://ru.linkedin.com/in/msokolova');
    expect(link('http://www.linkedin.com/in/msokolova')).toBe(full);
    expect(link('https://www.linkedin.com/company/acme')).toBeUndefined();
    expect(link('https://evil.example/linkedin.com/in/msokolova')).toBeUndefined();
    expect(link('notlinkedin.com/in/msokolova')).toBeUndefined();
  });

  it('город и страну берёт из места жительства', () => {
    expect(answer('Country of residence')).toBe('Россия');
    expect(answer('В каком городе вы живёте?')).toBe('Москва');
    expect(answer('Where are you currently based?')).toBe('Москва, Россия');
  });

  it('называет источник ответа', () => {
    expect(profileAnswers([text('q1', 'LinkedIn')], FACTS)).toEqual([
      {
        questionId: 'q1',
        text: 'https://www.linkedin.com/in/msokolova',
        source: 'Из контактов вашего профиля',
      },
    ]);
  });

  it('готовность к переезду — только когда релокация отмечена в условиях поиска', () => {
    const open = { openToRelocation: true };
    expect(answer('Are you willing to relocate?', open)).toBe('Yes');
    expect(answer('Готовы ли вы к переезду?', open)).toBe('Да');
    expect(answer('Are you willing to relocate?', {})).toBeUndefined();
    expect(answer('Do you require relocation assistance?', open)).toBeUndefined();
    expect(answer('Are you willing to relocate to Berlin?', open)).toBeUndefined();
    expect(answer('Готовы ли вы к переезду в Казань?', open)).toBeUndefined();
    const choice: QuestionnaireQuestion = {
      id: 'c', text: 'Are you open to relocation?', required: true, kind: 'choice', options: ['yes', 'No'],
    };
    expect(profileAnswers([choice], open)[0]?.text).toBe('yes');
    expect(profileAnswers([{ ...choice, options: ['Maybe', 'No'] }], open)).toEqual([]);
  });

  it('чего нет в профиле — того нет и в ответе', () => {
    expect(profileAnswers([text('q', 'LinkedIn Profile')], {})).toEqual([]);
    expect(profileAnswers([text('q', 'LinkedIn Profile')], null)).toEqual([]);
    expect(answer('Country of residence', { location: 'Москва' })).toBeUndefined();
    expect(answer('Website', { links: ['https://www.linkedin.com/in/x'] })).toBeUndefined();
    expect(answer('Phone', { phone: '   ' })).toBeUndefined();
  });

  it('не отвечает на похожие по словам вопросы о другом', () => {
    for (const label of [
      'Current company name',
      'Country code',
      'Are you legally authorized to work in Germany?',
      'Do you require visa sponsorship?',
      'Why do you want to work with us?',
      'How many people were on your team?',
      'Which countries have you worked in?',
      'Reference email',
      'Emergency contact phone',
      'Name of your manager',
      'How did you find our website?',
      'Откуда вы узнали о вакансии: LinkedIn, сайт?',
      'Which city is the office you prefer?',
    ]) {
      expect(answer(label), label).toBeUndefined();
    }
  });

  it('у вопроса с выбором подставляет только совпавший вариант', () => {
    const choice = (options: readonly string[]): QuestionnaireQuestion => ({
      id: 'c', text: 'Country of residence', required: true, kind: 'choice', options,
    });
    expect(profileAnswers([choice(['Germany', 'россия', 'Other'])], FACTS)[0]?.text).toBe('россия');
    expect(profileAnswers([choice(['Germany', 'Other'])], FACTS)).toEqual([]);
  });
});
