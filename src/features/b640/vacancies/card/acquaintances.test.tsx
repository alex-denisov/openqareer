import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { B640CompanyPerson } from '../../../../../shared/b640Companies';
import { acquaintancesOf, friendOf, pathLine, writeLabel } from './acquaintances';
import { AcquaintBlock } from './AcquaintBlock';

vi.mock('../../shell/ShellContext', () => ({
  useShell: () => ({ navigate: () => undefined }),
  useScreenChrome: () => undefined,
}));

const person = (overrides: Partial<B640CompanyPerson>): B640CompanyPerson => ({
  id: 'p',
  circle: 1,
  name: 'Роман Ефимов',
  roleTitle: 'руководитель группы платежей',
  evidence: 'ваша связь в LinkedIn, работали вместе в «Сфере Платежи»',
  nextStep: 'write_known_contact',
  vacancyId: 'v',
  platformMember: false,
  ...overrides,
});

const people = [
  person({ id: 'r1' }),
  person({
    id: 'r2',
    circle: 2,
    name: 'Наталья Седова',
    roleTitle: 'директор по разработке',
    evidence: 'через Романа Ефимова',
    nextStep: 'ask_for_introduction',
  }),
  person({
    id: 'r3',
    circle: 2,
    name: null,
    platformMember: true,
    roleTitle: 'руководитель платформы',
    evidence: null,
    nextStep: 'ask_for_introduction',
  }),
  person({
    id: 'r4',
    circle: 3,
    name: 'Алина Громова',
    roleTitle: 'технический рекрутер',
    evidence: 'рекрутёр вакансии',
    nextStep: 'cold_application',
  }),
];

describe('acquaintancesOf', () => {
  it('круги 1 и 2; круг 3 (холодный) знакомым не считается', () => {
    expect(acquaintancesOf(people).map((row) => row.key)).toEqual(['r1', 'r2', 'r3']);
  });

  it('участник платформы: «Участник сети», без имени', () => {
    const row = acquaintancesOf(people)[2]!;
    expect(row).toEqual({
      key: 'r3',
      name: 'Участник сети',
      sub: 'руководитель платформы · 2-й круг',
    });
  });

  it('строка пути: круг и основание', () => {
    expect(pathLine(people[0]!)).toBe(
      '1-й круг · ваша связь в LinkedIn, работали вместе в «Сфере Платежи»',
    );
    expect(pathLine(people[2]!)).toBe('2-й круг');
  });

  it('нет данных — пустой список', () => {
    expect(acquaintancesOf(undefined)).toEqual([]);
  });
});

describe('friendOf', () => {
  it('первый знакомый 1-го круга с именем', () => {
    expect(friendOf(people)?.id).toBe('r1');
  });

  it('круг 2, участник платформы и круг 3 — не «через знакомого»', () => {
    expect(friendOf(people.slice(1))).toBeUndefined();
  });
});

describe('writeLabel', () => {
  it.each([
    ['Роман Ефимов', 'Написать Роману'],
    ['Алина Громова', 'Написать Алине'],
    ['Сергей Петров', 'Написать Сергею'],
    ['Мария Лебедева', 'Написать Марии'],
    ['John Smith', 'Написать знакомому'],
  ])('%s → %s', (name, label) => {
    expect(writeLabel(name)).toBe(label);
  });
});

describe('AcquaintBlock', () => {
  it('строки знакомых и счёт в заголовке', () => {
    const html = renderToStaticMarkup(<AcquaintBlock people={acquaintancesOf(people)} />);
    expect(html).toContain('Знакомые в компании · 3');
    expect(html).toContain('Роман Ефимов');
    expect(html).toContain('Участник сети');
    expect(html).toContain('Все связи');
  });

  it('никого нет — блока нет', () => {
    expect(renderToStaticMarkup(<AcquaintBlock people={[]} />)).toBe('');
  });
});
