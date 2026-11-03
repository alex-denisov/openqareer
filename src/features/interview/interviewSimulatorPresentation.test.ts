import { describe, expect, it } from 'vitest';
import type { InterviewSessionView } from './interviewSimulatorApi';
import { presentInterviewTopics } from './interviewSimulatorPresentation';

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
      {
        topic: 'Поведенческие вопросы',
        answered: 0,
        points: 0,
        maxPoints: 0,
        status: 'Не оценено',
      },
    ]);
  });
});
