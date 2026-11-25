import { describe, expect, it } from 'vitest';
import { reviewLetterBody } from './letterModelGate';

const numberRules = (
  sentence: string,
  candidate: readonly string[],
  vacancy: readonly string[] = [],
) =>
  reviewLetterBody(`${sentence}\nРезюме приложено.`, { candidate, vacancy, language: 'ru' }).filter(
    (item) => item.rule === 'number',
  );

const resume = [
  'Выручка направления выросла с 230 млн до 920 млн рублей.',
  'P&L до $50M+.',
  'SLA 99,5–100%.',
];

describe('суммы письма против фактов кандидата', () => {
  it.each([
    'выручка направления выросла с 230 млн до порядка 2 млрд рублей',
    'Выручка достигла порядка 2 млрд рублей.',
    'Выручка достигла двух миллиардов рублей.',
    'Выручка достигла 2 миллиардов рублей.',
    'Выручка 920 миллиардов рублей.',
    'Revenue reached two billion rubles.',
    'Вёл бюджет до $60M+.',
    'Выручка 930 млн рублей.',
    'SLA 98,5–100%.',
  ])('без подтверждения не остаётся: %s', (sentence) => {
    expect(numberRules(sentence, resume)).not.toEqual([]);
  });

  it.each([
    'Выручка выросла с 230 млн до порядка 920 млн рублей.',
    'Вёл P&L до $50M+.',
    'Держал SLA 99,5–100%.',
    'Выручка 920 миллионов рублей.',
  ])('подтверждённое проходит: %s', (sentence) => {
    expect(numberRules(sentence, resume)).toEqual([]);
  });

  it('фрагмент вакансии не вырезает число из суммы', () => {
    expect(numberRules('Выручка достигла 2 млрд рублей.', resume, ['2'])).not.toEqual([]);
  });

  it('подтверждённый кандидатом факт с 2 млрд разрешает сумму', () => {
    const fact =
      'Grouped services into 3 packages with combined annual revenue of about 2 billion rubles; at the start about 230 million rubles.';
    expect(numberRules('Выручка выросла с 230 млн до порядка 2 млрд рублей.', [fact])).toEqual([]);
  });

  it('сумма словами в факте подтверждает её цифрой в письме', () => {
    const fact = 'Три пакета давали порядка двух миллиардов рублей выручки в год.';
    expect(numberRules('Выручка порядка 2 млрд рублей.', [fact])).toEqual([]);
  });
});
