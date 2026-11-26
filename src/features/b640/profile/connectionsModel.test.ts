import { describe, expect, it } from 'vitest';
import type { B640Connection } from '../../../../shared/b640Connections';
import {
  appendConnections,
  connectionGroups,
  connectionNote,
  connectionsHeading,
} from './connectionsModel';

const person = (id: string, companyName: string, extra: Partial<B640Connection> = {}) =>
  ({
    id,
    fullName: id,
    roleTitle: 'инженер',
    companyName,
    inSelection: false,
    vacancyId: null,
    circle: 1,
    via: null,
    message: { kind: 'known_contact', target: { contactId: id } },
    ...extra,
  }) as B640Connection;

describe('b640 profile: связи (p11)', () => {
  it('собирает людей по компаниям в порядке сервера', () => {
    const groups = connectionGroups([
      person('a', 'Ладога', { inSelection: true }),
      person('b', 'Ладога', { inSelection: true }),
      person('c', ''),
    ]);
    expect(groups.map((g) => [g.company, g.inSelection, g.people.length])).toEqual([
      ['Ладога', true, 2],
      ['Компания не указана', false, 1],
    ]);
  });

  it('подпись пути и заголовок со счётом компаний', () => {
    expect(connectionNote(person('a', 'Л'))).toBe('инженер · ваша связь');
    expect(connectionNote(person('a', 'Л', { via: 'Роман Ефимов' }))).toBe(
      'инженер · общий знакомый: Роман Ефимов',
    );
    expect(connectionsHeading(512, 4)).toEqual({
      full: 'Знакомые есть в 4 компаниях из подборки',
      short: 'Знакомые в 4 компаниях',
    });
    expect(connectionsHeading(512, 21).short).toBe('Знакомые в 21 компании');
    expect(connectionsHeading(512, 0).full).toBe('512 связей');
    expect(connectionsHeading(0, 0).full).toBe('Связи ещё не подключены');
  });

  it('повторная порция не дублирует людей', () => {
    const before = [person('a', 'Л')];
    expect(appendConnections(before, [person('a', 'Л'), person('b', 'Л')])).toHaveLength(2);
  });
});
