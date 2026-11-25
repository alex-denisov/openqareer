import { describe, expect, it } from 'vitest';
import { selectionClaimsHold, withoutBrokenClaims } from './selectionClaims';
import { selectionSummary, type SelectionContext, type SelectionRow } from './selectionSummary';

const row = (n: number, company: string, place: Partial<SelectionRow>): SelectionRow => ({
  title: `Роль ${n}`,
  company,
  location: null,
  country: null,
  format: null,
  salary: null,
  fitPercent: null,
  ...place,
});
const rows = [
  row(1, 'Free Martlet', { location: 'Москва', country: 'Россия', format: 'офис' }),
  row(2, 'Первый проектный офис', {
    location: 'Тверь',
    country: 'Россия',
    format: 'Удалённо, только Россия',
  }),
  row(3, 'Q-Tech', {}),
  row(4, 'IT Director Group', { location: 'Шарджа', country: 'ОАЭ', format: 'офис' }),
  row(5, 'Ромашка', { location: 'Москва', country: 'Россия', format: 'гибрид' }),
];
const selection: SelectionContext = { total: 34, rows, summary: selectionSummary(rows) };

describe('B735: утверждения о подборке против строк', () => {
  it.each([
    'Первые строки — зарубежные COO с местом Remote.',
    'Q-Tech — зарубежная компания.',
    'Q-Tech находится в Германии.',
    'В Москве — шесть.',
    'Из списка 3 из 20 в Москве.',
    'Удалёнку из РФ в списке не видно.',
    'В Москве Free Martlet и Ромашка, остальные идут как Remote.',
    'В Москве две вакансии — строки 1 и 5.',
    'Из первых строк в Москве: 1, 7, 14, 16.',
  ])('опровергается: %s', (message) => {
    expect(selectionClaimsHold(message, selection)).toBe(false);
  });

  it.each([
    'Начните с Free Martlet: Москва, офис.',
    'В Москве — две вакансии: Free Martlet и Ромашка.',
    '2 из 5 в Москве.',
    'Это первые 5 строк списка из 34.',
    'Совпадение 96, 94, 92 %: начните с Free Martlet.',
    'IT Director Group — зарубежная вакансия, Шарджа.',
    'У Q-Tech страна неизвестна, зарубежная она или нет, по данным не сказать: не указана.',
    'Первый проектный офис — Тверь, удалённо по России.',
    'Среди первых строк есть зарубежные.',
    'Первые строки не зарубежные.',
    'Q-Tech: спросите, можно ли работать из Германии.',
    'В Москве один офис и один гибрид.',
  ])('остаётся: %s', (message) => {
    expect(selectionClaimsHold(message, selection)).toBe(true);
  });

  it('без подборки не проверяется', () => {
    expect(selectionClaimsHold('Первые строки — зарубежные.', undefined)).toBe(true);
  });

  it('опровергнутое предложение убирается, остальной текст прежний', () => {
    const text = 'Начните с Free Martlet, 100 %.\nВ Москве — шесть. Посмотрите ASP.NET роли.';
    expect(withoutBrokenClaims(text, selection)).toBe(
      'Начните с Free Martlet, 100 %.\nПосмотрите ASP.NET роли.',
    );
    expect(withoutBrokenClaims('Всё верно. Да!', selection)).toBe('Всё верно. Да!');
  });
});
