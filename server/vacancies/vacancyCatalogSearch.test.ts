import { describe, expect, it } from 'vitest';
import { buildSearchIndex, russianRoleLabel } from './vacancyCatalogSearch';

const listing = (place: string, placeLabel: string, count: number, role?: string, roleLabel?: string) => ({
  place,
  placeLabel,
  path: `/vacancies/${place}${role ? `/${role}` : ''}`,
  count,
  ...(role ? { role, roleLabel } : {}),
});

describe('catalog search index', () => {
  it('lists real cities alphabetically and roles by total count', () => {
    const index = buildSearchIndex([
      listing('moscow', 'Москва', 10),
      listing('almaty', 'Алматы', 4),
      listing('moscow', 'Москва', 6, 'accountant', 'Accountant'),
      listing('almaty', 'Алматы', 3, 'accountant', 'Accountant'),
      listing('moscow', 'Москва', 5, 'lawyer', 'Юрист'),
    ]);
    expect(index.cities.map((city) => city[1])).toEqual(['Алматы', 'Москва']);
    expect(index.roles).toEqual([
      ['accountant', 'Бухгалтер', 9, 'moscow'],
      ['lawyer', 'Юрист', 5, 'moscow'],
    ]);
  });

  it('keeps an unknown English role as published', () => {
    expect(russianRoleLabel('rust-developer', 'Rust Developer')).toBe('Rust Developer');
    expect(russianRoleLabel('x', 'Юрист')).toBe('Юрист');
  });
});
