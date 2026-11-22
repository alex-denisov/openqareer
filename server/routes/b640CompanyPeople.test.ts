import { describe, expect, it } from 'vitest';
import type { ConnectionCirclePath, ConnectionCircleResult } from '../domain/candidateCompanies';
import type { B640Contact } from '../../shared/b640Contacts';
import { candidateCompanyKey } from '../domain/candidateCompanies';
import { circlePeople, contactPeople, contactSourceNote, mergePeople } from './b640CompanyPeople';

const me = { id: 'cand', fullName: 'Кандидат', roleTitle: null, companyName: null, linkedinUrl: null };
const person = (id: string, fullName: string) => ({ id, fullName, roleTitle: 'Рекрутер', companyName: 'Ромашка', linkedinUrl: null });
const path = (over: Partial<ConnectionCirclePath> & Pick<ConnectionCirclePath, 'id' | 'circle' | 'recipient'>): ConnectionCirclePath => ({
  path: [me, over.recipient], evidence: ['общая работа'], strength: 'direct', source: 'manual', nextStep: 'write_known_contact', ...over,
});
const circle = (n: 1 | 2 | 3, paths: ConnectionCirclePath[]) =>
  ({ circle: n, state: 'found', message: '', paths }) as unknown as ConnectionCircleResult;

describe('B645 v04: у человека из кругов — кому и о чём писать', () => {
  it('знакомый 1-го круга — его контакт, recruiter 1-го и 3-го круга — по вакансии, 2-й круг — просьба представить через посредника', () => {
    const roman = person('c-roman', 'Роман');
    const rec = person('r-1', 'Ольга');
    const via = person('c-via', 'Пётр');
    const people = circlePeople(
      [
        circle(1, [
          path({ id: 'circle-1:contact:c-roman', circle: 1, recipient: roman }),
          path({ id: 'circle-1:work:r-1:romashka', circle: 1, recipient: rec, source: 'work_history' }),
        ]),
        circle(2, [path({ id: 'circle-2:c-via:r-1', circle: 2, recipient: rec, path: [me, via, rec], nextStep: 'ask_for_introduction' })]),
        circle(3, [path({ id: 'circle-3:r-1', circle: 3, recipient: rec, nextStep: 'cold_application' })]),
      ],
      { id: 'v-1', title: 'CTO' },
    );
    expect(people.map((item) => item.message)).toEqual([
      { kind: 'known_contact', target: { contactId: 'c-roman' } },
      { kind: 'known_contact', target: { recruiterId: 'r-1', vacancyId: 'v-1' } },
      { kind: 'ask_introduction', target: { contactId: 'c-via' } },
      { kind: 'recruiter', target: { recruiterId: 'r-1', vacancyId: 'v-1' } },
    ]);
  });
});

describe('B645 v10b: люди компании — те же контакты, что в «Контактах» по этой компании', () => {
  const contact = (over: Partial<B640Contact> & Pick<B640Contact, 'id' | 'fullName' | 'companyName'>): B640Contact => ({
    roleTitle: 'Senior Recruiter', link: 'none', linkNote: null, status: { state: 'none', at: null }, inSelection: false, ...over,
  });

  it('у компании без вакансий рекрутер из контактов — ваш контакт 1-го круга с черновиком ему самому', () => {
    const people = contactPeople(
      [
        contact({ id: 'igor', fullName: 'Igor Siusiukov', companyName: 'Autodesk' }),
        contact({ id: 'anna', fullName: 'Анна', companyName: 'AUTODESK ', link: 'direct', linkNote: 'работали вместе в «Сфере»' }),
        contact({ id: 'oleg', fullName: 'Олег', companyName: 'Ромашка' }),
        contact({ id: 'pyotr', fullName: 'Пётр', companyName: 'Autodesk', link: 'intro', linkNote: 'общий знакомый: Иван' }),
      ],
      candidateCompanyKey('Autodesk'),
      null,
    );
    expect(people.map((item) => [item.name, item.circle, item.nextStep, item.evidence])).toEqual([
      ['Igor Siusiukov', 1, 'write_known_contact', null],
      ['Анна', 1, 'write_known_contact', 'работали вместе в «Сфере»'],
      ['Пётр', 2, 'ask_for_introduction', 'общий знакомый: Иван'],
    ]);
    expect(people.map((item) => item.message)).toEqual([
      { kind: 'known_contact', target: { contactId: 'igor' } },
      { kind: 'known_contact', target: { contactId: 'anna' } },
      { kind: 'ask_introduction', target: { contactId: 'pyotr' } },
    ]);
    expect(people.every((item) => item.vacancyId === null && !item.platformMember)).toBe(true);
  });

  it('тот же человек из круга вакансии и из контактов — одна строка, ближний круг', () => {
    const fromCircle = circlePeople(
      [circle(1, [path({ id: 'circle-1:contact:igor', circle: 1, recipient: person('igor', 'Igor Siusiukov') })])],
      { id: 'v-1', title: 'CTO' },
    );
    const fromContacts = contactPeople([contact({ id: 'igor', fullName: 'Igor Siusiukov', companyName: 'Ромашка' })], candidateCompanyKey('Ромашка'), 'v-1');
    const merged = mergePeople([...fromCircle, ...fromContacts]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ circle: 1, vacancyId: 'v-1' });
  });
});

describe('B645 v10b: строка «как связаны» у контакта без пояснения — источник с датой, как в макете', () => {
  it('импорт LinkedIn — «импорт контактов LinkedIn, ДД.ММ» по Москве; добавлен вручную — «добавлено вами»', () => {
    expect(contactSourceNote({ source: 'linkedin_import', updatedAt: '2026-11-09T22:30:00.000Z' })).toBe(
      'импорт контактов LinkedIn, 10.11',
    );
    expect(contactSourceNote({ source: 'linkedin_import', updatedAt: 'нет даты' })).toBe('импорт контактов LinkedIn');
    expect(contactSourceNote({ source: 'manual', updatedAt: '2026-11-10T10:00:00.000Z' })).toBe('добавлено вами');
  });
});
