import { describe, expect, it } from 'vitest';
import type { ResumeDraft } from './resumeDraft';
import { monthIndex } from './resumeMonth';
import { vacancyFitEvidenceFacts } from './vacancyFitProfileEvidence';
import { isSoftRequirementText } from './vacancyRequirementKind';
import { leadershipMet, leadershipYears, workShownRole } from './vacancyFitWorkEvidence';

const NOW = new Date('2026-11-25T00:00:00Z');
const facts = [
  {
    id: 'profile:experience:1',
    statement:
      'VP of Technology — Энергия; Apr 2023 – Oct 2025; команда 250; Achieved 99% SLA compliance; signing contracts',
  },
  {
    id: 'profile:experience:2',
    statement: 'Head of Support — Облако; Mar 2020 – Apr 2023; Led support',
  },
  {
    id: 'profile:experience:3',
    statement: 'Co-Founder — Ферма; Jul 2016 – Oct 2019; construction',
  },
  {
    id: 'profile:experience:4',
    statement:
      'IT Lead — Университет; Dec 2012 – Jul 2016; managed IT budget growing to $4M; навыки: Cloud',
  },
  { id: 'profile:skill:1', statement: 'Security' },
];

describe('B794: experience the model could not add up', () => {
  it.each([
    ['Apr 2023', 2023 * 12 + 3],
    ['июль 2016', 2016 * 12 + 6],
    ['2020-03', 2020 * 12 + 2],
    ['04.2023', 2023 * 12 + 3],
    ['2012', 2012 * 12],
  ])('reads the month of %s', (date, month) => expect(monthIndex(date)).toBe(month));
  it('reads no date from words', () =>
    expect([monthIndex('наст. время'), monthIndex(undefined)]).toEqual([null, null]));
  it('sums leading IT places only', () => expect(leadershipYears(facts, NOW)).toBe(9));

  it('meets a term at an IT leading post', () =>
    expect(leadershipMet('Опыт работы на позиции IT-директора от 5 лет', facts, NOW)).toBe(
      'VP of Technology, Энергия',
    ));
  it.each([
    'Опыт работы на позиции IT-директора от 12 лет',
    'стаж работы в роли IT Director, Head of IT Operations в банках от 5 лет',
    'Опыт руководства IT-отделом от 5 лет в компании от 300 пользователей',
  ])('leaves «%s» to the model', (text) => expect(leadershipMet(text, facts, NOW)).toBeUndefined());

  it('meets a line whose every area the work shows', () =>
    expect(
      workShownRole(
        'Формирование и защита ИТ-бюджета, работа с договорами и SLA подрядчиков.',
        facts,
      ),
    ).toBe('IT Lead, Университет'));
  it.each([
    'Опыт внедрения 1С и ведения бюджета',
    'Управление бюджетом в ритейле',
    'Управление облаком',
    'Управление бюджетом и портфелем инвестиций',
    'Понимание вопросов информационной безопасности',
    'Управление бюджетом от 30 млн',
  ])('leaves «%s» to the model', (text) => expect(workShownRole(text, facts)).toBeUndefined());

  it.each(['Системность, самостоятельность, ориентация на результат', 'Стратегическое мышление'])(
    '«%s» is a trait',
    (text) => expect(isSoftRequirementText(text)).toBe(true),
  );
  it('a system is no trait', () =>
    expect(isSoftRequirementText('Системное администрирование Linux')).toBe(false));

  it('sends the tenure of imported dates and the leading part of it', () => {
    const draft = {
      candidate: {},
      education: [],
      languages: [],
      skills: [],
      experience: [
        { id: 'a', title: 'Head of IT', employer: 'A', startDate: 'Mar 2020', endDate: 'Feb 2025' },
        { id: 'b', title: 'Инженер', employer: 'B', startDate: 'Mar 2015', endDate: 'Feb 2020' },
      ],
    } as unknown as ResumeDraft;
    const sent = vacancyFitEvidenceFacts('c', { memory: [], resume: { draft } } as never, NOW);
    expect(sent.find((fact) => fact.id === 'profile:tenure')?.statement).toBe(
      'Общий стаж работы: 10 лет (по датам мест работы); на руководящих ИТ-должностях: 5 лет',
    );
  });
});
