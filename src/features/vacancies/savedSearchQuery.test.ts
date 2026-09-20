import { describe, expect, it } from 'vitest';
import { seededQuery } from './savedSearchQuery';

// Владелец 2026-09-20: очистил поле «Xray Technician» через ⌘⌫ — значение
// встало обратно, а на мгновение показался placeholder. Подстановка роли
// профиля — только пока кандидат сам ничего не вводил.
describe('seededQuery', () => {
  it('seeds an untouched empty field with the profile role', () => {
    expect(seededQuery({ query: '', defaultQuery: 'Xray Technician', touched: false })).toBe(
      'Xray Technician',
    );
  });

  it('keeps an emptied field empty once the candidate has typed', () => {
    expect(seededQuery({ query: '', defaultQuery: 'Xray Technician', touched: true })).toBe('');
  });

  it('never overwrites what the candidate typed', () => {
    expect(
      seededQuery({ query: 'Менеджер продукта', defaultQuery: 'Xray Technician', touched: true }),
    ).toBe('Менеджер продукта');
    expect(
      seededQuery({ query: 'Менеджер продукта', defaultQuery: 'Xray Technician', touched: false }),
    ).toBe('Менеджер продукта');
  });
});
