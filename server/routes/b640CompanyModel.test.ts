import { describe, expect, it } from 'vitest';
import type { B640CompanyItem } from '../../shared/b640Companies';
import {
  citiesOf,
  companyLookupKey,
  filterByPlace,
  findCompanyRow,
  relocationOf,
} from './b640CompanyModel';
import { circlePeople, mergePeople } from './b640CompanyPeople';

const row = (name: string, location: string | null, relocation: boolean) =>
  ({
    key: 'a'.repeat(24),
    name,
    location,
    relocation: relocation ? { sourceLabel: 'hh.ru', readAt: null } : null,
  }) as unknown as B640CompanyItem;

describe('B677: модель компаний', () => {
  it('находит компанию по хеш-ключу и по ключу названия из карточки вакансии', () => {
    const rows = [{ key: 'b'.repeat(24), name: 'ООО «Ромашка»' }];
    expect(findCompanyRow(rows, 'b'.repeat(24))?.name).toBe('ООО «Ромашка»');
    expect(findCompanyRow(rows, companyLookupKey('ооо ромашка'))?.name).toBe('ООО «Ромашка»');
    expect(findCompanyRow(rows, 'c'.repeat(24))).toBeUndefined();
    expect(findCompanyRow(rows, '«»')).toBeUndefined();
  });
  it('релокация — только подтверждённое значение с источником', () => {
    const claim = (value: unknown) =>
      ({
        attributes: [
          {
            key: 'relocation',
            value,
            provenance: { sourceLabel: ' hh.ru ', readAt: '2026-11-10' },
          },
        ],
      }) as never;
    expect(relocationOf(claim(true))).toEqual({ sourceLabel: 'hh.ru', readAt: '2026-11-10' });
    expect(relocationOf(claim(false))).toBeNull();
    expect(relocationOf(undefined)).toBeNull();
  });
  it('фильтр места и города по убыванию', () => {
    const rows = [
      row('A', 'Москва', true),
      row('B', 'Москва', false),
      row('C', 'Казань', true),
      row('D', null, true),
    ];
    expect(filterByPlace(rows, { relocation: true, city: null }).map((r) => r.name)).toEqual([
      'A',
      'C',
      'D',
    ]);
    expect(filterByPlace(rows, { relocation: true, city: 'Москва' }).map((r) => r.name)).toEqual([
      'A',
    ]);
    expect(citiesOf(rows)).toEqual([
      { name: 'Москва', count: 2 },
      { name: 'Казань', count: 1 },
    ]);
  });
});

describe('B677: люди компании', () => {
  const path = (id: string, circle: 1 | 2 | 3, fullName: string) => ({
    id,
    circle,
    recipient: { id: `contact:${id}`, fullName, roleTitle: 'CTO' },
    evidence: ['Работали вместе в X'],
    nextStep: 'write_known_contact',
  });
  it('один человек — одна строка в ближайшем круге; участники платформы без имени', () => {
    const first = circlePeople(
      [{ paths: [path('p1', 2, 'Анна Иванова')], platformMembers: { members: [{}] } }] as never,
      'v1',
    );
    const second = circlePeople(
      [{ paths: [path('p2', 1, 'анна иванова '), path('p3', 3, 'Олег')] }] as never,
      'v2',
    );
    const merged = mergePeople([...first, ...second]);
    expect(merged.map((p) => [p.id, p.circle])).toEqual([
      ['p2', 1],
      ['platform:v1:0', 2],
      ['p3', 3],
    ]);
    const member = merged.find((p) => p.platformMember);
    expect(
      circlePeople(
        [
          {
            paths: [
              {
                ...path('p4', 3, 'Ромашка'),
                recipient: { id: 'vacancy:v3', fullName: 'Ромашка', roleTitle: null },
              },
            ],
          },
        ] as never,
        'v3',
      ),
    ).toEqual([]);
    expect(member).toMatchObject({ name: null, roleTitle: null, circle: 2, vacancyId: 'v1' });
  });
});
