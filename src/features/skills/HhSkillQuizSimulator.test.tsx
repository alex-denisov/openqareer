import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HhSkillQuizSimulator } from './HhSkillQuizSimulator';
import { getSkillQuizById } from '../../services/hhSkillQuizzes';

describe('HhSkillQuizSimulator (B376 / US-01.3)', () => {
  it('renders skill quiz catalog with tests from hh.ru and LinkedIn', () => {
    const html = renderToStaticMarkup(<HhSkillQuizSimulator onClose={() => undefined} />);

    expect(html).toContain('Верификация навыков');
    expect(html).toContain('hh.ru');
    expect(html).toContain('LinkedIn');
    expect(html).toContain('TypeScript');
    expect(html).toContain('React');
    expect(html).toContain('Node.js');
    expect(html).toContain('Python');
    expect(html).toContain('Начать тест');
  });

  it('renders specific quiz directly when initialQuizId is provided', () => {
    const html = renderToStaticMarkup(
      <HhSkillQuizSimulator initialQuizId="typescript" onClose={() => undefined} />,
    );

    const quiz = getSkillQuizById('typescript')!;
    expect(html).toContain(quiz.questions[0].question);
    expect(html).toContain('Вопрос 1 из');
  });

  it('shows honest wording «не подтверждено» and does not use «слабый навык» on failed quiz preview', () => {
    const html = renderToStaticMarkup(
      <HhSkillQuizSimulator
        initialQuizId="typescript"
        initialResult={{
          quizId: 'typescript',
          scorePercent: 25,
          correctAnswersCount: 1,
          totalQuestions: 4,
          passed: false,
          status: 'не подтверждён',
          statusLabel: 'не подтверждено',
          source: 'Банк квизов hh.ru',
          verifiedAt: '2026-10-05',
          verifiedBadgeAwarded: false,
          review: [],
        }}
        onClose={() => undefined}
      />,
    );

    expect(html).toContain('не подтверждено');
    expect(html).not.toContain('слабый навык');
    expect(html).toContain('Принять результат');
  });

  it('provides accept button with explicit action and does not apply automatically', () => {
    const html = renderToStaticMarkup(
      <HhSkillQuizSimulator
        initialQuizId="typescript"
        initialResult={{
          quizId: 'typescript',
          scorePercent: 100,
          correctAnswersCount: 4,
          totalQuestions: 4,
          passed: true,
          status: 'подтверждён',
          statusLabel: 'подтверждён',
          source: 'Банк квизов hh.ru',
          verifiedAt: '2026-10-05',
          verifiedBadgeAwarded: true,
          review: [],
        }}
        onClose={() => undefined}
      />,
    );

    expect(html).toContain('Принять результат');
    expect(html).toContain('Тест успешно пройден');
    expect(html).toContain('подтверждён');
  });
});
