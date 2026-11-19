import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, activeCount, chipsOf, moveStatusFacets, statusTag, toggleValue, withoutChip } from './contactsFilters';

describe('statusTag', () => {
  it('не писали', () => expect(statusTag({ state: 'none', at: null })).toEqual({ cls: 'tag', text: 'не писали' }));
  it('писали с датой по Москве', () =>
    expect(statusTag({ state: 'written', at: '2026-11-12T12:03:00.000Z' })).toEqual({ cls: 'tag part', text: 'писали 12.11' }));
  it('писали без даты', () => expect(statusTag({ state: 'written', at: null })).toEqual({ cls: 'tag part', text: 'писали' }));
  it('ответил', () => expect(statusTag({ state: 'replied', at: 'x' })).toEqual({ cls: 'tag ok', text: 'ответил' }));
});

describe('фильтры', () => {
  const filters = { company: ['Гринкод'], link: ['intro' as const], status: ['replied' as const] };
  it('чипы по порядку, снятие чипа не трогает остальные', () => {
    const chips = chipsOf(filters);
    expect(chips.map((chip) => chip.label)).toEqual(['Гринкод', 'Через знакомого', 'Ответили']);
    expect(withoutChip(filters, chips[1]!)).toEqual({ company: ['Гринкод'], link: [], status: ['replied'] });
    expect(activeCount(filters)).toBe(3);
    expect(activeCount(EMPTY_FILTERS)).toBe(0);
  });
  it('toggleValue не мутирует', () => {
    const before = ['a'];
    expect(toggleValue(before, 'b')).toEqual(['a', 'b']);
    expect(toggleValue(before, 'a')).toEqual([]);
    expect(before).toEqual(['a']);
  });
  it('счётчики статусов двигаются при смене', () => {
    const facets = { companies: [], link: { direct: 0, intro: 0, none: 0 }, status: { none: 5, written: 1, replied: 0 } };
    expect(moveStatusFacets(facets, 'none', 'written').status).toEqual({ none: 4, written: 2, replied: 0 });
  });
});
