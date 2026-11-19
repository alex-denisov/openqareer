import { describe, expect, it } from 'vitest';
import type { ResumeDraft } from '../../resume/resumeTypes';
import { achievementGroups, missingAchievementKinds } from './achievementsModel';
import { questionCount } from './partTwoModel';

const draft = (patch: Partial<ResumeDraft>): ResumeDraft =>
  ({
    candidate: {},
    experience: [],
    education: [],
    languages: [],
    ...patch,
  }) as unknown as ResumeDraft;

describe('b640 profile: награды, публикации и организации (B645 s01)', () => {
  const achievements = [
    {
      id: 'h1',
      kind: 'honor',
      title: 'Лучшая команда года',
      issuer: 'Финтех Лаб',
      date: '2023-05',
    },
    { id: 'p1', kind: 'publication', title: 'Платформа релизов', issuer: 'Конференция' },
    { id: 'o1', kind: 'organization', title: 'Go Moscow Meetup', role: 'Участница сообщества' },
    { id: 'x', kind: 'honor', title: '   ' },
  ] as ResumeDraft['achievements'];

  it('делит записи на группы с подзаголовками макета, пустые группы опускает', () => {
    const groups = achievementGroups(draft({ achievements }));
    expect(groups.awards).toEqual([
      {
        sub: 'Награды',
        rows: [{ id: 'h1', title: 'Лучшая команда года', sub: 'Финтех Лаб · 2023' }],
      },
      {
        sub: 'Публикации и выступления',
        rows: [{ id: 'p1', title: 'Платформа релизов', sub: 'Конференция' }],
      },
    ]);
    expect(groups.orgs).toEqual([
      {
        sub: 'Организации',
        rows: [{ id: 'o1', title: 'Go Moscow Meetup', sub: 'Участница сообщества' }],
      },
    ]);
  });

  it('пустой раздел — подзаголовки макета без строк, «Ещё можно добавить» перечисляет недостающее', () => {
    expect(achievementGroups(draft({}))).toEqual({
      awards: [
        { sub: 'Награды', rows: [] },
        { sub: 'Публикации и выступления', rows: [] },
      ],
      orgs: [{ sub: 'Организации', rows: [] }],
    });
    expect(missingAchievementKinds(draft({ achievements }))).toEqual(['Патенты', 'Волонтёрство']);
  });
});

describe('b640 profile: число вопросов «Уточнить» (B645 s01)', () => {
  it('один вопрос на каждое место работы без размера команды', () => {
    const experience = [
      { id: 'a', employer: 'A' },
      { id: 'b', employer: 'B', teamSize: 5 },
      { id: 'c', employer: 'C' },
    ] as unknown as ResumeDraft['experience'];
    expect(questionCount(draft({ experience }))).toBe(2);
    expect(questionCount(draft({}))).toBe(0);
  });
});
