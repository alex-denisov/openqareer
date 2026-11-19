import { describe, expect, it } from 'vitest';
import { makeItem } from './fixtures';
import {
  EMPTY_FILTERS,
  activeCount,
  applyFilters,
  blockersOf,
  chipsOf,
  hasChosen,
  labelOf,
  withoutChip,
} from './filterModel';
import { buildOptions, listCount, splitOptions } from './filterOptions';

const NOW = new Date('2026-11-11T10:00:00Z');
const context = { currency: 'RUB' as const, now: NOW };

describe('подписи кнопок фильтров', () => {
  it('без выбора: «Все роли», «Локации», «Деньги · ₽», «Дата»', () => {
    expect(labelOf('roles', EMPTY_FILTERS, 'RUB')).toBe('Все роли');
    expect(labelOf('locations', EMPTY_FILTERS, 'RUB')).toBe('Локации');
    expect(labelOf('money', EMPTY_FILTERS, 'RUB')).toBe('Деньги · ₽');
    expect(labelOf('money', EMPTY_FILTERS, 'ORIG')).toBe('Деньги · Как в вакансии');
    expect(labelOf('dates', EMPTY_FILTERS, 'RUB')).toBe('Дата');
  });

  it('с выбором: число, порог и дата', () => {
    const filters = { ...EMPTY_FILTERS, roles: ['A'], locations: ['Москва', 'Казань'], moneyFrom: 400, date: '7' as const };
    expect(labelOf('roles', filters, 'RUB')).toBe('Роли: выбрано 1');
    expect(labelOf('locations', filters, 'RUB')).toBe('Локации · 2');
    expect(labelOf('money', filters, 'USD')).toBe('Деньги · от 400 тыс. $');
    expect(labelOf('dates', filters, 'RUB')).toBe('Дата · 7 дней');
  });

  it('релокация считается в «Формат»', () => {
    expect(labelOf('formats', { ...EMPTY_FILTERS, reloc: true }, 'RUB')).toBe('Формат · 1');
  });
});

describe('счётчик и чипы', () => {
  it('«Фильтры · N»: значения плюс дата', () => {
    expect(activeCount(EMPTY_FILTERS)).toBe(1);
    expect(activeCount({ ...EMPTY_FILTERS, roles: ['A'], moneyFrom: 5 })).toBe(3);
  });

  it('чипы с деньгами и датой, «Сбросить всё» только при выборе', () => {
    const filters = { ...EMPTY_FILTERS, roles: ['A'], moneyFrom: 400, date: '30' as const };
    expect(chipsOf(filters, 'RUB').map((chip) => chip.label)).toEqual([
      'A',
      'от 400 тыс. ₽',
      'Дата: 30 дней',
    ]);
    expect(hasChosen(EMPTY_FILTERS)).toBe(false);
    expect(hasChosen(filters)).toBe(true);
  });

  it('«Убрать» снимает одно значение', () => {
    const filters = { ...EMPTY_FILTERS, roles: ['A', 'B'] };
    const chip = chipsOf(filters, 'RUB')[0]!;
    expect(withoutChip(filters, chip).roles).toEqual(['B']);
  });
});

describe('фильтрация по загруженным строкам', () => {
  const items = [
    makeItem({ id: 'a', location: 'Москва', salary: { from: 500_000, to: 600_000, currency: 'RUR' } }),
    makeItem({ id: 'b', location: 'Казань', remote: true, relocation: true, observedAt: '2026-10-01T09:00:00Z' }),
    makeItem({ id: 'c', location: 'Москва', observedAt: '2026-11-11T08:00:00Z' }),
  ];

  it('локации, дата, релокация, деньги', () => {
    expect(applyFilters(items, { ...EMPTY_FILTERS, locations: ['Казань'] }, context)).toHaveLength(1);
    expect(applyFilters(items, { ...EMPTY_FILTERS, locations: ['Удалённо'] }, context)).toHaveLength(1);
    expect(applyFilters(items, { ...EMPTY_FILTERS, date: 'today' }, context).map((i) => i.cluster.id)).toEqual(['c']);
    expect(applyFilters(items, { ...EMPTY_FILTERS, reloc: true }, context)).toHaveLength(1);
    expect(applyFilters(items, { ...EMPTY_FILTERS, moneyFrom: 400 }, context).map((i) => i.cluster.id)).toEqual(['a']);
  });

  it('мешающие фильтры: тот, без которого что-то нашлось бы', () => {
    const filters = { ...EMPTY_FILTERS, locations: ['Казань'], moneyFrom: 400 };
    expect(applyFilters(items, filters, context)).toHaveLength(0);
    const kinds = blockersOf(items, filters, context).map((entry) => entry.kind);
    expect(kinds).toEqual(['locations', 'money']);
    const onlyMoney = { ...EMPTY_FILTERS, locations: ['Москва'], moneyFrom: 9000 };
    expect(blockersOf(items, onlyMoney, context).map((entry) => entry.kind)).toEqual(['money']);
  });
});

describe('значения фильтров', () => {
  it('частые и остальные, поиск', () => {
    const items = Array.from({ length: 8 }, (_, i) => makeItem({ id: String(i), location: `Город ${i}` }));
    const options = buildOptions(items, undefined, NOW);
    const split = splitOptions(options.locations, '');
    expect(split.top).toHaveLength(6);
    expect(split.rest).toHaveLength(2);
    expect(splitOptions(options.locations, 'город 3').top).toHaveLength(1);
  });
});

/**
 * B728: «30 дней 169», а после выбора — 266. Счёт по дате идёт по загруженным строкам, а пул
 * дочитывается страницами: до конца чтения число меньше настоящего.
 */
describe('B728: число «Даты» — только по дочитанной подборке', () => {
  const items = [
    makeItem({ id: 'a', observedAt: '2026-11-11T08:00:00Z' }),
    makeItem({ id: 'b', observedAt: '2026-10-01T08:00:00Z' }),
  ];

  it('пул дочитан — числа есть; ещё читается — чисел нет, а не неполные', () => {
    const counts = (complete: boolean) =>
      buildOptions(items, undefined, NOW, complete).dates.map((option) => option.count);
    expect(counts(true)).toEqual([undefined, 1, 1, 1, 2]);
    expect(counts(false)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it('с «Датой» до конца чтения число списка не известно; после — равно строкам', () => {
    const partial = { narrowed: true, complete: false, serverMode: false, known: 266, filtered: 169 };
    expect(listCount(partial)).toEqual({ count: 169, countKnown: false });
    expect(listCount({ ...partial, complete: true, filtered: 266 })).toEqual({ count: 266, countKnown: true });
    expect(listCount({ ...partial, narrowed: false })).toEqual({ count: 266, countKnown: true });
  });
});

