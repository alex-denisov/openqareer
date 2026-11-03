import { describe, expect, it } from 'vitest';
import type { InterviewQuestionView } from './interviewSimulatorApi';
import { deriveRecommendationActions } from './interviewRecommendations';

const textAndAction = (items: ReturnType<typeof deriveRecommendationActions>) =>
  items.map(({ text, action }) => ({ text, action }));

function question(
  id: string,
  type: InterviewQuestionView['type'],
  storyId: string | null,
  reason: string,
  criterion = 'result',
): InterviewQuestionView {
  return {
    id,
    type,
    topic: type,
    prompt: 'Вопрос',
    storyId,
    storyTitle: storyId ? 'Кризис в команде' : null,
    sourceFactIds: [],
    skipped: false,
    answer: {
      text: 'Ответ',
      elapsedSeconds: 30,
      evaluation: {
        rubric: type === 'behavioral' ? 'star' : 'system_design',
        points: 1,
        maxPoints: 8,
        feedback: '',
        criteria: { [criterion]: { points: 0, reason } },
      },
    },
  } as InterviewQuestionView;
}

describe('deriveRecommendationActions', () => {
  it('binds each recommendation to the action its question allows', () => {
    expect(
      textAndAction(
        deriveRecommendationActions({
          questions: [
            question('q1', 'behavioral', 's1', 'Допишите результат в историю.'),
            question('q2', 'behavioral', null, 'Назовите цифры из профиля.'),
            question('q3', 'system_design', null, 'Опишите нагрузку.'),
          ],
        }),
      ),
    ).toEqual([
      { text: 'Допишите результат в историю.', action: 'story' },
      { text: 'Назовите цифры из профиля.', action: 'profile' },
      { text: 'Опишите нагрузку.', action: 'restart' },
    ]);
  });

  it('sends STAR structure gaps to the story editor even without a linked story', () => {
    expect(
      textAndAction(
        deriveRecommendationActions({
          questions: [
            question('q1', 'behavioral', null, 'Не описан контекст ситуации.', 'situation'),
          ],
        }),
      ),
    ).toEqual([{ text: 'Не описан контекст ситуации.', action: 'story' }]);
  });

  it('keeps at most three unique reasons and skips closed criteria', () => {
    const closed = question('q0', 'behavioral', 's1', 'Закрыто.');
    const closedAnswer = closed.answer!;
    const done = {
      ...closed,
      answer: {
        ...closedAnswer,
        evaluation: {
          ...closedAnswer.evaluation,
          criteria: { result: { points: 2 as const, reason: 'Закрыто.' } },
        },
      },
    };
    const repeated = question('q1', 'system_design', null, 'Опишите нагрузку.');
    expect(
      textAndAction(
        deriveRecommendationActions({ questions: [done, repeated, { ...repeated, id: 'q2' }] }),
      ),
    ).toEqual([{ text: 'Опишите нагрузку.', action: 'restart' }]);
  });

  it('says under each item which answer it comes from (mockup 14 res subline)', () => {
    const partial = question('q2', 'behavioral', null, 'Назовите цифры.');
    const partialAnswer = partial.answer!;
    const [story, profile, design] = deriveRecommendationActions({
      questions: [
        question('q1', 'behavioral', 's1', 'Допишите результат.'),
        {
          ...partial,
          prompt: 'Расскажите, как вы сократили бюджет платформы',
          sourceFactIds: ['f1', 'f2'],
          answer: {
            ...partialAnswer,
            evaluation: {
              ...partialAnswer.evaluation,
              criteria: { result: { points: 1 as const, reason: 'Назовите цифры.' } },
            },
          },
        },
        {
          ...question('q3', 'system_design', null, 'Опишите нагрузку.'),
          prompt:
            'Спроектируйте ленту событий для 10 млн пользователей в сутки с задержкой меньше секунды',
        },
      ],
    });
    expect(story.detail).toBe('История «Кризис в команде»: критерий не закрыт');
    expect(profile.detail).toBe(
      'Вопрос «Расскажите, как вы сократили бюджет платформы»: критерий закрыт частично, фактов профиля к вопросу: 2',
    );
    expect(design.detail).toBe(
      'Вопрос «Спроектируйте ленту событий для 10 млн пользователей в…»: критерий не закрыт',
    );
  });
});
