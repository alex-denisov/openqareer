import { describe, expect, it } from 'vitest';
import { teamSizeFromWorkplaceText } from './workplaceTeamSize';

describe('team size the candidate names in one workplace text', () => {
  it.each([
    [
      'Распределение задач по сотрудникам внутри отдела ( 8 человек кросфункциональная команда).',
      8,
    ],
    ['Руководство кросс-функциональной командой из 6 человек (разработка, QA).', 6],
    ['Управлял командой 12 разработчиков и двумя тимлидами.', 12],
    ['В подчинении 5 сотрудников.', 5],
    ['Grew and led a team of 9 IT engineers; managed IT budget.', 9],
    ['Coordination of L1, L2 and application support teams (20+ engineers).', 20],
    ['Two technology divisions managing 250+ professionals.', 250],
    ['Отдел из 15 специалистов и 3 подрядчиков.', 15],
    ['Built a 40-person engineering org.', 40],
  ])('reads «%s» as %i people', (text, size) => {
    expect(teamSizeFromWorkplaceText(text)).toBe(size);
  });

  it.each([
    'Руководитель разработки с 9-летним опытом в IT (5+ лет в управлении командами).',
    'Рост конверсии мобильного канала на 10–15%, время команды на рутину сократилось на 20%.',
    'Управление бюджетами до 5 млн ₽, каталог 60k+ SKU.',
    'Led multinational team across 10+ nationalities.',
    '',
  ])('finds no team size in «%s»', (text) => {
    expect(teamSizeFromWorkplaceText(text)).toBeNull();
  });

  it('takes the largest team when one workplace names several', () => {
    expect(
      teamSizeFromWorkplaceText('Вырастил команду с 4 до 11 человек; в подчинении 2 тимлида.'),
    ).toBe(11);
  });
});
