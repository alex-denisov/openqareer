import { describe, expect, it } from 'vitest';
import type { StarStoryView } from '../../../../../shared/starStories';
import {
  buildPrepRows,
  formatInterviewWhen,
  paragraphsFromStory,
  pickNextResponse,
  prepHeadline,
  replaceQuestionParagraphs,
  type PrepParagraph,
} from './prepModel';

const NOW = new Date('2026-11-10T09:00:00Z');

function app(
  id: string,
  stage: string,
  scheduledAt: string | null,
  hasInterview = scheduledAt !== null,
) {
  return {
    id,
    stage,
    nearestInterview: hasInterview
      ? { id: `iv-${id}`, scheduledAt, prepStatus: 'none', round: 1 }
      : null,
  };
}

function story(id: string, title: string, facts: readonly string[] = ['f1']): StarStoryView {
  return {
    id,
    title,
    fields: { situation: `S ${title}`, task: `T ${title}`, action: `A ${title}`, result: '' },
    sourceFactIds: facts,
    version: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    confidence: 'confirmed',
    sourceFacts: [],
  };
}

describe('pickNextResponse', () => {
  it('takes the response with the nearest future interview', () => {
    const apps = [
      app('a', 'interview', '2026-11-20T12:00:00Z'),
      app('b', 'interview', '2026-11-12T12:00:00Z'),
      app('c', 'interview', '2026-11-01T12:00:00Z'),
    ];
    expect(pickNextResponse(apps, NOW)?.id).toBe('b');
  });

  it('without a scheduled interview takes the first response at the interview stage', () => {
    expect(
      pickNextResponse([app('x', 'applied', null), app('y', 'interview', null)], NOW)?.id,
    ).toBe('y');
    expect(pickNextResponse([app('x', 'applied', null)], NOW)).toBeNull();
  });
});

describe('answers', () => {
  const questions = [
    { id: 'q1', question: 'Почему уходите?' },
    { id: 'q2', question: 'Конфликт в команде' },
  ];

  it('a question is ready when it has paragraphs; the example is the story with the same situation', () => {
    const paragraphs =
      paragraphsFromStory('q2', story('s1', 'спор разработчика и тестировщика')) ?? [];
    const rows = buildPrepRows(questions, paragraphs, [
      story('s1', 'спор разработчика и тестировщика'),
    ]);
    expect(rows).toEqual([
      { id: 'q1', title: 'Почему уходите?', ready: false, sub: 'Ответа пока нет' },
      {
        id: 'q2',
        title: 'Конфликт в команде',
        ready: true,
        sub: 'Ответ готов · пример: спор разработчика и тестировщика',
      },
    ]);
  });

  it('a story paragraph needs a source fact; empty fields are skipped', () => {
    expect(paragraphsFromStory('q1', story('s', 'без фактов', []))).toBeNull();
    expect(paragraphsFromStory('q1', story('s', 'пример'))).toEqual([
      { questionId: 'q1', field: 'situation', text: 'S пример', sourceFactId: 'f1' },
      { questionId: 'q1', field: 'task', text: 'T пример', sourceFactId: 'f1' },
      { questionId: 'q1', field: 'action', text: 'A пример', sourceFactId: 'f1' },
    ]);
  });

  it('a new answer replaces only its own question', () => {
    const current: PrepParagraph[] = [
      { questionId: 'q1', field: 'situation', text: 'old', sourceFactId: 'f0' },
      { questionId: 'q2', field: 'situation', text: 'keep', sourceFactId: 'f0' },
    ];
    const next = replaceQuestionParagraphs(current, 'q1', [
      { questionId: 'q1', field: 'task', text: 'new', sourceFactId: 'f1' },
    ]);
    expect(next.map((p) => p.text)).toEqual(['keep', 'new']);
    expect(current[0]?.text).toBe('old');
  });

  it('headline counts ready answers in Russian', () => {
    expect(prepHeadline(3, 5)).toBe('Готовы ответы на 3 вопроса из 5');
    expect(prepHeadline(1, 5)).toBe('Готов ответ на 1 вопрос из 5');
    expect(prepHeadline(0, 4)).toBe('Готовы ответы на 0 вопросов из 4');
  });
});

describe('formatInterviewWhen', () => {
  it('shows the day and the local time', () => {
    expect(formatInterviewWhen('2026-11-12T12:00:00Z', 'Europe/Moscow')).toBe('12 ноября, 15:00');
    expect(formatInterviewWhen(null, 'Europe/Moscow')).toBeNull();
  });
});
