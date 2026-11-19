import { describe, expect, it } from 'vitest';
import { candidateCompanyKey } from './candidateCompanies';
import { buildB640ContactList, type B640ContactSource } from './b640Contacts';

const base = { roleTitle: '', source: 'linkedin_import' as const, relationship: 'Контакт', workplaces: [], knowsRecruiterIds: [], updatedAt: '2026-11-01T00:00:00.000Z' };
const contact = (over: Partial<B640ContactSource> & { id: string; fullName: string }): B640ContactSource =>
  ({ companyName: 'Ромашка', ...base, ...over }) as B640ContactSource;
const query = { offset: 0, limit: 20, search: '', company: [], link: [], status: [], sort: 'name' as const };
const input = (contacts: B640ContactSource[], over = {}) => ({
  contacts, candidateWorkplaces: [], statuses: new Map(), selectionKeys: new Set<string>(), ...over,
});

describe('B697: список контактов', () => {
  it('общее место работы — direct с годами, ручной контакт — direct со связью', () => {
    const list = buildB640ContactList(
      input(
        [
          contact({ id: 'a', fullName: 'Анна', workplaces: [{ companyName: 'Сфера Платежи', startDate: '2018-03', endDate: '2021-06' }] }),
          contact({ id: 'b', fullName: 'Борис', source: 'manual', relationship: 'Однокурсник' }),
          contact({ id: 'c', fullName: 'Вера' }),
        ],
        { candidateWorkplaces: [{ companyName: 'сфера платежи', startDate: '2017', endDate: '2022' }] },
      ),
      query,
    );
    const by = Object.fromEntries(list.items.map((item) => [item.id, item]));
    expect(by.a).toMatchObject({ link: 'direct', linkNote: 'работали вместе в «Сфера Платежи», 2018–2021' });
    expect(by.b).toMatchObject({ link: 'direct', linkNote: 'Однокурсник' });
    expect(by.c).toMatchObject({ link: 'none', linkNote: null });
    expect(list.facets.link).toEqual({ direct: 2, intro: 0, none: 1 });
  });

  it('intro — другой контакт знает этого человека', () => {
    const list = buildB640ContactList(
      input([
        contact({ id: 'a', fullName: 'Игорь Шаталов', knowsRecruiterIds: ['x'] }),
        contact({ id: 'x', fullName: 'Хан' }),
      ]),
      query,
    );
    expect(list.items.find((item) => item.id === 'x')).toMatchObject({ link: 'intro', linkNote: 'общий знакомый: Игорь Шаталов' });
  });

  it('поиск без регистра, фильтры, фасеты по поиску без своего фильтра', () => {
    const contacts = [
      contact({ id: 'a', fullName: 'Анна Ким', companyName: 'Альфа' }),
      contact({ id: 'b', fullName: 'Борис', companyName: 'Бета', roleTitle: 'Директор АННА' }),
      contact({ id: 'c', fullName: 'Вера', companyName: 'Бета' }),
    ];
    const found = buildB640ContactList(input(contacts), { ...query, search: 'анна' });
    expect(found.items.map((item) => item.id)).toEqual(['a', 'b']);
    const filtered = buildB640ContactList(input(contacts), { ...query, company: ['Бета'] });
    expect(filtered.total).toBe(2);
    expect(filtered.facets.companies).toEqual([{ name: 'Альфа', count: 1 }, { name: 'Бета', count: 2 }]);
  });

  it('статус, фильтр по статусу и сортировки selection / recent / name', () => {
    const statuses = new Map([['c', { state: 'replied' as const, at: '2026-11-10T00:00:00.000Z' }], ['a', { state: 'written' as const, at: '2026-11-05T00:00:00.000Z' }]]);
    const contacts = [
      contact({ id: 'a', fullName: 'Яна', companyName: 'Альфа' }),
      contact({ id: 'b', fullName: 'Борис', companyName: 'Бета', updatedAt: '2026-11-09T00:00:00.000Z' }),
      contact({ id: 'c', fullName: 'Ёж', companyName: 'Гамма' }),
    ];
    const selectionKeys = new Set([candidateCompanyKey('Бета')]);
    const ids = (sort: 'selection' | 'recent' | 'name') =>
      buildB640ContactList(input(contacts, { statuses, selectionKeys }), { ...query, sort }).items.map((item) => item.id);
    expect(ids('selection')).toEqual(['b', 'c', 'a']);
    expect(ids('recent')).toEqual(['c', 'a', 'b']);
    expect(ids('name')).toEqual(['b', 'c', 'a']);
    const replied = buildB640ContactList(input(contacts, { statuses }), { ...query, status: ['replied'] });
    expect(replied.items).toHaveLength(1);
    expect(replied.items[0]).toMatchObject({ status: { state: 'replied', at: '2026-11-10T00:00:00.000Z' }, inSelection: false });
    expect(replied.facets.status).toEqual({ none: 1, written: 1, replied: 1 });
  });

  it('страница и nextOffset', () => {
    const contacts = ['a', 'b', 'c'].map((id) => contact({ id, fullName: id }));
    const page = buildB640ContactList(input(contacts), { ...query, limit: 2 });
    expect(page).toMatchObject({ total: 3, offset: 0, nextOffset: 2 });
    expect(page.items).toHaveLength(2);
  });
});
