import { describe, expect, it } from 'vitest';
import type { StoredStarStory } from '../data/sqliteStarStoriesRepository';
import { starStoriesForTurn, STAR_STORIES_IN_TURN } from './coachStarStoryContext';

const FACT = { id: 'fact-1', statement: 'Сервис вырос с 91 до 97%' };

function story(id: string, title: string, result: string, overrides: Partial<StoredStarStory> = {}): StoredStarStory {
  return {
    id,
    title,
    version: 1,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    sourceFactIds: [],
    fields: { situation: `ситуация ${title}`, task: '', action: `действие ${title}`, result },
    ...overrides,
  };
}

describe('STAR-истории в контексте хода консультанта (B511 Д6)', () => {
  it('отдаёт историю с полями, ссылкой и признаком подтверждения фактами', () => {
    const context = starStoriesForTurn(
      [story('s1', 'Кризис в команде', 'Сервис вырос с 91 до 97%', { sourceFactIds: ['fact-1'] })],
      [FACT],
      'Добавь фразу про кризис',
    );
    expect(context.starStories).toEqual([
      {
        ref: 'star:s1',
        title: 'Кризис в команде',
        situation: 'ситуация Кризис в команде',
        task: '',
        action: 'действие Кризис в команде',
        result: 'Сервис вырос с 91 до 97%',
        confirmed: true,
        topicMatch: true,
      },
    ]);
  });

  it('topicMatch отмечает только историю по теме реплики, а общие слова темой не считает', () => {
    const { starStories } = starStoriesForTurn(
      [story('s1', 'Кризис в команде', ''), story('s2', 'История про письмо и вакансию', '')],
      [],
      'Добавь в письмо историю про кризис для этой вакансии',
    );
    expect(starStories.map((item) => [item.title, item.topicMatch])).toEqual([
      ['Кризис в команде', true],
      ['История про письмо и вакансию', false],
    ]);
  });

  it('история без фактов или с числом не из фактов не считается подтверждённой', () => {
    const context = starStoriesForTurn(
      [
        story('s1', 'Без фактов', 'Вышли в срок'),
        story('s2', 'Чужое число', 'Рост на 40%', { sourceFactIds: ['fact-1'] }),
      ],
      [FACT],
      '',
    );
    expect(context.starStories.map((item) => item.confirmed)).toEqual([false, false]);
  });

  it('история по теме реплики идёт первой, даже если она старше и не подтверждена', () => {
    const context = starStoriesForTurn(
      [
        story('new', 'Запуск продукта', 'Сервис вырос с 91 до 97%', {
          sourceFactIds: ['fact-1'],
          updatedAt: '2026-11-04T00:00:00.000Z',
        }),
        story('old', 'Кризис в команде', 'Вышли в срок'),
      ],
      [FACT],
      'Добавь фразу про кризисе команды',
    );
    expect(context.starStories[0]?.ref).toBe('star:old');
  });

  it('без темы первыми идут подтверждённые, затем свежие', () => {
    const context = starStoriesForTurn(
      [
        story('fresh', 'Свежая', '', { updatedAt: '2026-11-04T00:00:00.000Z' }),
        story('sure', 'Подтверждённая', 'Сервис вырос с 91 до 97%', { sourceFactIds: ['fact-1'] }),
      ],
      [FACT],
      'Письмо суховато',
    );
    expect(context.starStories.map((item) => item.ref)).toEqual(['star:sure', 'star:fresh']);
  });

  it('остальные истории видны по названию: про них нельзя сказать «нет данных»', () => {
    const many = Array.from({ length: STAR_STORIES_IN_TURN + 2 }, (_, index) =>
      story(`s${index}`, `История ${index}`, ''),
    );
    const context = starStoriesForTurn(many, [FACT], '');
    expect(context.starStories).toHaveLength(STAR_STORIES_IN_TURN);
    expect(context.otherStoryTitles).toHaveLength(2);
  });

  it('длинные поля обрезаются, а без историй контекст пуст', () => {
    const long = 'я'.repeat(4_000);
    const context = starStoriesForTurn([story('s1', 'Длинная', long)], [FACT], '');
    expect(context.starStories[0]?.result.length).toBeLessThanOrEqual(600);
    expect(starStoriesForTurn([], [FACT], 'кризис')).toEqual({ starStories: [], otherStoryTitles: [] });
  });
});
