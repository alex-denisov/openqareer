import { describe, expect, it } from 'vitest';
import type { CandidateConnectionContact } from '../../outreach/connectionContactsApi';
import type { ResumeDraft } from '../../resume/resumeTypes';
import { contactGroups, contactsHeading, nextQuestion, teamAnswer } from './partTwoModel';

const draft = (experience: unknown[]) =>
  ({ candidate: {}, experience, education: [], languages: [] }) as unknown as ResumeDraft;

describe('b640 profile: один вопрос о профиле', () => {
  it('спрашивает размер команды у первого места, где он не указан', () => {
    const question = nextQuestion(
      draft([
        { id: 'e1', employer: 'Финтех Лаб', teamSize: 9 },
        { id: 'e2', employer: 'Сфера Платежи' },
        { id: 'e3', employer: 'Ритейл Тех' },
      ]),
    );
    expect(question).toEqual({
      entryId: 'e2',
      employer: 'Сфера Платежи',
      text: 'Сколько человек было в команде в «Сфера Платежи»?',
    });
  });

  it('без названия компании спрашивает по должности; вопросов нет — null', () => {
    expect(nextQuestion(draft([{ id: 'e1', title: 'Аналитик' }]))?.text).toBe(
      'Сколько человек было в команде на месте «Аналитик»?',
    );
    expect(nextQuestion(draft([{ id: 'e1', employer: 'x', teamSize: 3 }]))).toBeNull();
    expect(nextQuestion(draft([]))).toBeNull();
  });

  it('ответ — целое число от 1 до 100 000', () => {
    expect(teamAnswer(' 9 ')).toBe(9);
    expect(teamAnswer('0')).toBeNull();
    expect(teamAnswer('девять')).toBeNull();
    expect(teamAnswer('1000000')).toBeNull();
    expect(teamAnswer('')).toBeNull();
  });
});

function contact(
  id: string,
  fullName: string,
  companyName: string,
  roleTitle = '',
): CandidateConnectionContact {
  return { id, fullName, companyName, roleTitle } as CandidateConnectionContact;
}

describe('b640 profile: связи', () => {
  const contacts = [
    contact('1', 'Роман Ефимов', 'Ладога Банк', 'руководитель группы платежей'),
    contact('2', 'Анна Ким', 'Северный Банк', 'руководитель подбора'),
    contact('3', 'Наталья Седова', 'Ладога Банк', 'директор по разработке'),
    contact('4', 'Без Компании', ''),
  ];

  it('группирует по компаниям в порядке появления', () => {
    const groups = contactGroups(contacts, '');
    expect(
      groups.map((group) => [group.company, group.people.map((person) => person.name)]),
    ).toEqual([
      ['Ладога Банк', ['Роман Ефимов', 'Наталья Седова']],
      ['Северный Банк', ['Анна Ким']],
      ['Компания не указана', ['Без Компании']],
    ]);
    expect(groups[0].people[0].role).toBe('руководитель группы платежей');
  });

  it('ищет по имени и компании без учёта регистра', () => {
    expect(contactGroups(contacts, 'ладога').map((group) => group.company)).toEqual([
      'Ладога Банк',
    ]);
    expect(contactGroups(contacts, 'КИМ')[0].people.map((person) => person.name)).toEqual([
      'Анна Ким',
    ]);
    expect(contactGroups(contacts, 'нет таких')).toEqual([]);
  });

  it('заголовок считает связи', () => {
    expect(contactsHeading(512)).toBe('512 связей');
    expect(contactsHeading(1)).toBe('1 связь');
    expect(contactsHeading(0)).toBe('Связей пока нет');
  });
});
