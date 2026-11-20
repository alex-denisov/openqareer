import { describe, expect, it } from 'vitest';
import type { ConnectionCirclePath, ConnectionCircleResult } from '../domain/candidateCompanies';
import { circlePeople } from './b640CompanyPeople';

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
