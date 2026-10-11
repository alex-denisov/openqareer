import { describe, expect, it } from 'vitest';
import {
  buildInterviewQuestionPlan,
  createInterviewSession,
  recordInterviewAnswer,
  scoreInterviewAnswer,
  summarizeInterviewTopics,
  transitionInterviewSession,
} from './interviewSimulator';

const stories = [
  {
    id: 'story-release',
    title: 'Сокращение цикла релиза',
    sourceFactIds: ['fact-release'],
  },
];

const role = 'Руководитель инженерной команды';
const answer =
  'В проекте команда выпускала релизы раз в две недели. Задачей было сократить цикл без потери качества. Я настроил автотесты и автоматизировал деплой. Результат: цикл сократился с 14 до 3 дней.';

describe('interview simulator domain', () => {
  it('builds a bounded plan from the selected role and candidate STAR stories', () => {
    const questions = buildInterviewQuestionPlan({
      roleTitle: role,
      vacancyTitle: 'Head of Engineering',
      questionTypes: ['behavioral', 'system_design'],
      verifiedSkills: ['PostgreSQL'],
      stressMode: false,
      stories,
      questionIds: ['q1', 'q2', 'q3', 'q4', 'q5'],
    });

    expect(questions).toHaveLength(5);
    expect(questions[0]).toMatchObject({
      id: 'q1',
      type: 'behavioral',
      storyId: 'story-release',
      sourceFactIds: ['fact-release'],
    });
    expect(questions[0].prompt).toContain('Сокращение цикла релиза');
    expect(questions[1].type).toBe('system_design');
    expect(questions[1].prompt).toContain('Head of Engineering');
    expect(questions[1].prompt).toContain('PostgreSQL');
  });

  it('uses an honest behavioral prompt when there are no STAR stories', () => {
    const [question] = buildInterviewQuestionPlan({
      roleTitle: role,
      questionTypes: ['behavioral'],
      stressMode: false,
      stories: [],
      questionIds: ['q1', 'q2', 'q3', 'q4', 'q5'],
    });

    expect(question.storyId).toBeNull();
    expect(question.sourceFactIds).toEqual([]);
    expect(question.prompt).toContain('собственного опыта');
  });

  it('scores the same answer deterministically against STAR criteria', () => {
    const first = scoreInterviewAnswer(answer, 'behavioral');
    const second = scoreInterviewAnswer(answer, 'behavioral');

    expect(first).toEqual(second);
    expect(first.rubric).toBe('star');
    expect(first.points).toBe(8);
    expect(first.criteria.result.reason).toContain('числовой результат');
  });

  it('pauses and resumes at the current question, skips and summarizes by topic', () => {
    const session = createInterviewSession({
      id: 'session-1',
      mode: 'text',
      roleTitle: role,
      applicationId: null,
      questionTypes: ['behavioral', 'system_design'],
      verifiedSkills: ['PostgreSQL'],
      stressMode: false,
      stories,
      questionIds: ['q1', 'q2', 'q3', 'q4', 'q5'],
      now: '2026-10-11T08:00:00.000Z',
    });
    const answered = recordInterviewAnswer(
      session,
      answer,
      90,
      scoreInterviewAnswer(answer, 'behavioral'),
      '2026-10-11T08:01:30.000Z',
    );
    const advanced = transitionInterviewSession(answered, 'next', '2026-10-11T08:02:00.000Z');
    const interrupted = transitionInterviewSession(advanced, 'interrupt', '2026-10-11T08:03:00.000Z');
    const resumed = transitionInterviewSession(interrupted, 'resume', '2026-10-11T08:05:00.000Z');
    const skipped = transitionInterviewSession(resumed, 'skip', '2026-10-11T08:05:30.000Z');

    expect(interrupted.status).toBe('interrupted');
    expect(resumed.currentQuestionIndex).toBe(1);
    expect(skipped.currentQuestionIndex).toBe(2);
    expect(skipped.questions[1].skipped).toBe(true);
    expect(summarizeInterviewTopics(skipped)).toMatchObject([
      { topic: 'behavioral', answered: 1, points: 8, maxPoints: 8 },
      { topic: 'system_design', answered: 0, points: 0, maxPoints: 0 },
    ]);
  });
});
