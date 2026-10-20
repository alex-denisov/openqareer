import { describe, expect, it } from 'vitest';
import { roleLabelFromTitle } from './vacancyCatalogFacets';

describe('roleLabelFromTitle', () => {
  it('drops brackets and shouting, keeps acronyms', () => {
    expect(roleLabelFromTitle('ГЛАВНЫЙ БУХГАЛТЕР')).toBe('Главный бухгалтер');
    expect(roleLabelFromTitle('1C Программист (Честный Знак)')).toBe('1C Программист');
    expect(roleLabelFromTitle('Senior QA Engineer')).toBe('QA Engineer');
    expect(roleLabelFromTitle('SMM-менеджер')).toBe('SMM-менеджер');
  });
});
