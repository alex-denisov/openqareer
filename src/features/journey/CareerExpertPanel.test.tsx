import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CoachResult } from '../coach/coachApi';
import { CareerIntelligenceSummary } from './CareerExpertPanel';

describe('CareerIntelligenceSummary', () => {
  it('shows role coverage, a measurable track and honest execution state', () => {
    const result: CoachResult = {
      message: 'Сначала проверим спрос.',
      phase: 'market',
      nextQuestion: null,
      completeness: { known: ['Цель'], unknown: [] },
      safety: { needsHuman: false, reason: null },
      careerTrack: {
        objective: 'Проверить переход в продуктовую роль',
        alternatives: [
          {
            label: 'Product Manager',
            reason: 'Есть подтверждённый опыт',
            evidenceRefs: ['message-1'],
            unknowns: [],
          },
        ],
        milestones: [
          {
            label: 'Собрать выборку рынка',
            expectedSignal: 'Пять релевантных вакансий',
            measureAfter: '2026-08-19',
            successCriterion: 'Не менее пяти совпадений',
          },
        ],
      },
      actionProposals: [
        {
          kind: 'application.submit',
          objective: 'Отправить проверенный отклик',
          evidenceRefs: ['message-1'],
          acceptanceCriteria: ['Кандидат подтвердил текст'],
          expectedSignal: 'Отклик принят площадкой',
          measureAfter: '2026-08-19',
          risk: 'external_side_effect',
        },
      ],
      intelligence: {
        orchestrationRevision: 'test',
        roleCoverage: [
          'career_expert',
          'career_strategist',
          'career_consultant',
        ],
        roleContributions: [],
        evidenceCoverage: 1,
        unsupportedClaimCount: 0,
      },
    };

    const html = renderToStaticMarkup(
      <CareerIntelligenceSummary result={result} />,
    );

    expect(html).toContain('Консультант');
    expect(html).toContain('Стратег');
    expect(html).toContain('Эксперт');
    expect(html).toContain('Проверить переход в продуктовую роль');
    expect(html).toContain('Пять релевантных вакансий');
    expect(html).toContain('Требует вашего подтверждения');
    expect(html).not.toContain('Выполнено');
  });
});
