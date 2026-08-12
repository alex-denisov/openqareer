import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CoachResult } from '../coach/coachApi';
import { CareerIntelligenceSummary } from './CareerExpertPanel';
import { CareerActionProposalCard } from './CareerCommandActions';

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
        marketEvidence: {
          source: 'hh',
          observationCount: 1,
          observedAt: '2026-08-12T12:00:00.000Z',
        },
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
    expect(html).toContain('1 наблюдение hh.ru');
    expect(html).toContain('12 авг.');
    expect(html).toContain('Требует вашего подтверждения');
    expect(html).not.toContain('Выполнено');
  });
});

describe('CareerActionProposalCard', () => {
  const proposal: CoachResult['actionProposals'][number] = {
    kind: 'application.submit',
    objective: 'Отправить проверенный отклик',
    evidenceRefs: ['message-1'],
    acceptanceCriteria: ['Получен receipt'],
    expectedSignal: 'Отклик принят площадкой',
    measureAfter: '2026-08-19',
    risk: 'external_side_effect',
  };

  it('asks the candidate for explicit approval before an external write', () => {
    const html = renderToStaticMarkup(
      <CareerActionProposalCard
        proposal={proposal}
        command={{
          commandId: 'command-1',
          capability: 'application.submit',
          status: 'awaiting_approval',
          proposal,
          execution: null,
        }}
        busy={false}
        onPrepare={() => undefined}
        onApprove={() => undefined}
        onRefresh={() => undefined}
      />,
    );

    expect(html).toContain('Подтвердить отправку');
    expect(html).toContain('Ничего не отправлено');
    expect(html).not.toContain('Выполнено');
  });

  it('shows a verified provider receipt only after completion', () => {
    const html = renderToStaticMarkup(
      <CareerActionProposalCard
        proposal={proposal}
        command={{
          commandId: 'command-1',
          capability: 'application.submit',
          status: 'completed_with_receipt',
          proposal,
          execution: {
            status: 'completed_with_receipt',
            updatedAt: '2026-08-12T19:00:01.000Z',
            connector: {
              id: 'hh-api',
              transport: 'official_api',
              providerReference: 'receipt-1',
              evidenceKind: 'provider_receipt',
              evidenceObservedAt: '2026-08-12T19:00:01.000Z',
            },
            diagnosticReason: null,
          },
        }}
        busy={false}
        onPrepare={() => undefined}
        onApprove={() => undefined}
        onRefresh={() => undefined}
      />,
    );

    expect(html).toContain('Выполнено с подтверждением площадки');
    expect(html).toContain('receipt-1');
    expect(html).not.toContain('Подтвердить отправку');
  });
});
