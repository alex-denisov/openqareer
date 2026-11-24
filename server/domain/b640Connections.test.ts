import { describe, expect, it } from 'vitest';
import { buildB640Connections, type B640ConnectionInput } from './b640Connections';
import type { B640ContactSource } from './b640Contacts';

const contact = (
  id: string,
  fullName: string,
  companyName: string,
  knowsRecruiterIds: string[] = [],
): B640ContactSource => ({
  id,
  fullName,
  companyName,
  knowsRecruiterIds,
  roleTitle: 'инженер',
  source: 'linkedin_import',
  relationship: '',
  workplaces: [],
  updatedAt: '2026-11-10T09:00:00.000Z',
});
const input: B640ConnectionInput = {
  contacts: [
    contact('c1', 'Роман Ефимов', 'Ладога Банк', ['r1']),
    contact('c2', 'Анна Ким', 'Альфа'),
    contact('c3', 'Без Компании', ''),
  ],
  vacancies: [
    { id: 'v1', companyName: 'ЛАДОГА БАНК' },
    { id: 'v2', companyName: 'Ладога Банк' },
    { id: 'v3', companyName: 'Гринкод' },
  ],
  recruiters: [
    { id: 'r1', vacancyId: 'v3', fullName: 'Анна Ветрова', roleTitle: 'руководитель найма' },
    { id: 'r2', vacancyId: 'v3', fullName: 'Незнакомый', roleTitle: 'рекрутер' },
  ],
  selectionPending: false,
  linkedinImport: { state: 'unknown', importedAt: null, importedCount: null },
};
const query = { offset: 0, limit: 20, search: '', pool: false };
const names = (list: { items: readonly { fullName: string }[] }) =>
  list.items.map((row) => row.fullName);

describe('B651 p11: связи по компаниям', () => {
  it('сначала компании подборки, без компании — в конце; круг и адресат по пути', () => {
    const list = buildB640Connections(input, query);
    expect(names(list)).toEqual(['Анна Ветрова', 'Роман Ефимов', 'Анна Ким', 'Без Компании']);
    expect(list.items[0]).toMatchObject({
      circle: 2,
      via: 'Роман Ефимов',
      vacancyId: 'v3',
      inSelection: true,
      message: { kind: 'ask_introduction', target: { contactId: 'c1', vacancyId: 'v3' } },
    });
    expect(list.items[1]).toMatchObject({
      circle: 1,
      via: null,
      vacancyId: 'v1',
      message: {
        kind: 'known_contact',
        target: { contactId: 'c1', vacancyId: 'v1', alsoVacancyId: 'v2' },
      },
    });
    expect(list.items[2]).toMatchObject({ inSelection: false, vacancyId: null });
    expect(list.items[2]?.message.target).toEqual({ contactId: 'c2' });
    expect(list).toMatchObject({ total: 4, connections: 3, selectionCompanies: 2 });
  });

  it('«Только компании из подборки» и поиск меняют найденное, а счёт компаний — нет', () => {
    const pool = buildB640Connections(input, { ...query, pool: true });
    expect(pool).toMatchObject({ total: 2, selectionCompanies: 2 });
    const found = buildB640Connections(input, { ...query, search: 'альф' });
    expect(names(found)).toEqual(['Анна Ким']);
    expect(found.selectionCompanies).toBe(2);
  });

  it('1364 связи отдаются по 20', () => {
    const contacts = Array.from({ length: 1364 }, (_, i) =>
      contact(`m${i}`, `Имя ${i}`, `Компания ${i % 90}`),
    );
    expect(buildB640Connections({ ...input, contacts }, query).nextOffset).toBe(20);
    const last = buildB640Connections({ ...input, contacts }, { ...query, offset: 1360 });
    expect(last).toMatchObject({ total: 1364, nextOffset: null });
    expect(last.items).toHaveLength(4);
  });

  it('прямой знакомый не повторяется во 2-м круге', () => {
    const contacts = [...input.contacts, contact('c4', 'Анна Ветрова', 'Гринкод')];
    const rows = buildB640Connections({ ...input, contacts }, query).items;
    const anna = rows.filter((row) => row.fullName === 'Анна Ветрова');
    expect(anna.map((row) => row.circle)).toEqual([1]);
  });
});
