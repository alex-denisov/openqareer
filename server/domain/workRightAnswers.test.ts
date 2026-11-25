import { describe, expect, it } from 'vitest';
import type { QuestionnaireQuestion } from '../../shared/applicationQuestionnaire';
import { learnedWorkRights, mergeWorkRights, workRightAnswers } from './workRightAnswers';

const ask = (text: string, options?: readonly string[]): QuestionnaireQuestion =>
  options
    ? { id: 'q', text, required: true, kind: 'choice', options }
    : { id: 'q', text, required: true, kind: 'text' };
const OWNER = [
  { country: 'US', status: 'needs_visa' },
  { country: 'PL', status: 'needs_visa' },
  { country: 'EU', status: 'needs_visa' },
  { country: 'RU', status: 'authorized' },
] as const;
const answer = (text: string, country?: string, options?: readonly string[]) =>
  workRightAnswers([ask(text, options)], OWNER, country)[0]?.text;

describe('B788: право на работу', () => {
  it.each([
    ['Are you legally authorized to work in the United States?', 'No'],
    ['Do you require visa sponsorship to work in the US?', 'Yes'],
    ['Are you authorized to work in Poland?', 'No'],
    ['Are you eligible to work in Germany?', 'No'],
    ['Are you authorized to work in the EU without sponsorship?', 'No'],
    ['Есть ли у вас право на работу в Польше?', 'Нет'],
    ['Есть ли у вас право на работу в России?', 'Да'],
    ['Нужна ли вам виза для работы в США?', 'Да'],
  ])('%s → %s', (text, expected) => expect(answer(text)).toBe(expected));

  it('без страны в вопросе берёт страну вакансии', () => {
    expect(answer('Do you require visa sponsorship?')).toBeUndefined();
    expect(answer('Do you require visa sponsorship?', 'US')).toBe('Yes');
  });

  it.each([
    'Are you authorized to work in Canada?',
    'Are you authorized to work in Ruritania?',
    'Are you authorized to work in the US or Canada?',
    'Are you authorized to work in the US and do you require sponsorship?',
    'Why do you want to work in the United States?',
  ])('не отвечает: %s', (text) => expect(answer(text, 'US')).toBeUndefined());

  it('у выбора берёт только точный вариант; право сегодня не решает о визе в будущем', () => {
    expect(answer('Authorized to work in the US?', undefined, ['yes', 'no'])).toBe('no');
    expect(
      answer('Authorized to work in the US?', undefined, ['Citizen', 'Other']),
    ).toBeUndefined();
    expect(answer('Will you in the future require sponsorship?', 'RU')).toBeUndefined();
    expect(answer('Do you require sponsorship?', 'RU')).toBe('No');
  });

  it('запоминает только однозначный ответ, новый заменяет прежний', () => {
    const learn = (text: string, value: string) =>
      learnedWorkRights([ask(text)], new Map([['q', value]]), undefined);
    expect(learn('Authorized to work in the US?', 'No')).toEqual([
      { country: 'US', status: 'needs_visa' },
    ]);
    expect(learn('Authorized to work in the US?', 'Maybe')).toEqual([]);
    expect(learn('Do you require sponsorship in the US?', 'No')).toEqual([]);
    const next = [{ country: 'US', status: 'authorized' }] as const;
    expect(mergeWorkRights([OWNER[0]], next)).toEqual(next);
  });
});
