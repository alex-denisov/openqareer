import { describe, expect, it } from 'vitest';
import type { InterviewQuestionView, InterviewSessionView } from './interviewSimulatorApi';
import {
  deriveInterviewRecommendations,
  presentInterviewTopics,
} from './interviewSimulatorPresentation';

describe('interviewSimulatorPresentation', () => {
  it('labels each topic from its saved answers without inventing a total score', () => {
    const topics: InterviewSessionView['topicSummary'] = [
      { topic: 'behavioral', answered: 2, points: 8, maxPoints: 8 },
      { topic: 'system_design', answered: 1, points: 2, maxPoints: 8 },
      { topic: 'behavioral', answered: 0, points: 0, maxPoints: 0 },
    ];

    expect(presentInterviewTopics(topics)).toEqual([
      { topic: 'Поведенческие вопросы', answered: 2, points: 8, maxPoints: 8, status: 'Есть' },
      { topic: 'System Design', answered: 1, points: 2, maxPoints: 8, status: 'Частично' },
      { topic: 'Поведенческие вопросы', answered: 0, points: 0, maxPoints: 0, status: 'Не оценено' },
    ]);
  });

  it('builds up to three next actions from saved rubric reasons and removes duplicates', () => {
    const question = (id: string, actionReason: string): InterviewQuestionView => ({
      id,
      type: 'behavioral',
      topic: 'behavioral',
      prompt: 'Вопрос',
      storyId: null,
      storyTitle: null,
      sourceFactIds: [],
      skipped: false,
      answer: {
        text: 'Ответ',
        elapsedSeconds: 30,
        evaluation: {
          rubric: 'star',
          points: 3,
          maxPoints: 8,
          criteria: {
            action: { points: 0, reason: actionReason },
            result: { points: 1, reason: 'Добавьте наблюдаемый результат.' },
          },
        },
      },
    });

    expect(
      deriveInterviewRecommendations({ questions: [
        question('q1', 'Уточните ваш личный вклад.'),
        question('q2', 'Уточните ваш личный вклад.'),
      ] }),
    ).toEqual(['Уточните ваш личный вклад.', 'Добавьте наблюдаемый результат.']);
  });
});
