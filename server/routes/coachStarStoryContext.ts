import type { StoredStarStory } from '../data/sqliteStarStoriesRepository';
import { starStoryEvidenceStatus, type StarStoryFactSummary } from '../../shared/starStories';

/** Шесть историй держат блок около 1 500 токенов; остальные модель видит по названию. */
export const STAR_STORIES_IN_TURN = 6;
const OTHER_STORY_TITLES = 30;
const STORY_FIELD_CHARS = 600;
const STEM_CHARS = 5;
const MIN_WORD_CHARS = 4;

export interface TurnStarStory {
  readonly ref: string;
  readonly title: string;
  readonly situation: string;
  readonly task: string;
  readonly action: string;
  readonly result: string;
  /** Числа результата есть в связанных фактах профиля: то же правило, что на экране историй. */
  readonly confirmed: boolean;
}

export interface TurnStarStories {
  starStories: TurnStarStory[];
  otherStoryTitles: string[];
}

/** Основа слова: «кризис» и «кризисе» должны совпасть без морфологического словаря. */
function stems(text: string): ReadonlySet<string> {
  const words = text.toLocaleLowerCase('ru-RU').match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(
    words.filter((word) => word.length >= MIN_WORD_CHARS).map((word) => word.slice(0, STEM_CHARS)),
  );
}

function topicScore(story: StoredStarStory, query: ReadonlySet<string>): number {
  const text = stems([story.title, ...Object.values(story.fields)].join(' '));
  return [...query].filter((stem) => text.has(stem)).length;
}

function toTurnStory(story: StoredStarStory, confirmed: boolean): TurnStarStory {
  const { situation, task, action, result } = story.fields;
  const clip = (value: string) => value.slice(0, STORY_FIELD_CHARS);
  return {
    ref: `star:${story.id}`,
    title: story.title,
    situation: clip(situation),
    task: clip(task),
    action: clip(action),
    result: clip(result),
    confirmed,
  };
}

/**
 * STAR-истории для хода консультанта. Без них модель отвечала «в подтверждённых данных
 * нет ничего про кризис», пока экран письма предлагал фразу из этой же истории (B511 Д6).
 * История по теме реплики идёт первой, даже старая: иначе при многих историях ответ
 * снова говорил бы, что её нет.
 */
export function starStoriesForTurn(
  stories: readonly StoredStarStory[],
  facts: readonly StarStoryFactSummary[],
  query: string,
): TurnStarStories {
  const queryStems = stems(query);
  const ranked = stories
    .map((story) => ({
      story,
      score: topicScore(story, queryStems),
      confirmed:
        starStoryEvidenceStatus(story.fields.result, story.sourceFactIds, facts) === 'confirmed',
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.confirmed) - Number(a.confirmed) ||
        b.story.updatedAt.localeCompare(a.story.updatedAt),
    );
  return {
    starStories: ranked
      .slice(0, STAR_STORIES_IN_TURN)
      .map(({ story, confirmed }) => toTurnStory(story, confirmed)),
    otherStoryTitles: ranked
      .slice(STAR_STORIES_IN_TURN, STAR_STORIES_IN_TURN + OTHER_STORY_TITLES)
      .map(({ story }) => story.title),
  };
}
