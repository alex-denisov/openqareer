import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CoachResult } from '../coach/coachApi';
import { CareerExpertPanel, CareerIntelligenceSummary, ExpertWaitingRow } from './CareerExpertPanel';
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

    expect(html).toContain('Проверить переход в продуктовую роль');
    expect(html).toContain('Пять релевантных вакансий');
    expect(html).toContain('Требует вашего подтверждения');
    expect(html).not.toContain('Выполнено');
  });

  /**
   * «Проверка 31 дек.» без года — дата, по которой нельзя понять, прошёл срок
   * или ещё нет (B162).
   */
  it('dates every milestone check with its year', () => {
    const html = renderToStaticMarkup(
      <CareerIntelligenceSummary result={resultWithMilestone('2026-12-31')} />,
    );

    expect(html).toContain('31 декабря 2026');
    expect(html).not.toMatch(/Проверка 31 дек\.\s*·/u);
  });
});

describe('CareerExpertPanel copy', () => {
  it('uses one product term: career consultant', () => {
    const html = renderToStaticMarkup(
      <CareerExpertPanel initialUser={null} onClose={() => undefined} />,
    );

    expect(html).toContain('Карьерный консультант');
    expect(html).not.toContain('Карьерный советник');
    expect(html).not.toContain('сообщение карьерному советнику');
  });
});

/**
 * Ответ консультанта занимает до полутора минут. Пока он идёт, единственным
 * признаком отправки была галочка на кнопке — она читается как «готово», а не
 * «ждём», и кандидат уходит со страницы или отправляет вопрос второй раз
 * (B162, P1-3).
 */
describe('ExpertWaitingRow', () => {
  it('keeps the asked question visible and says how long the answer takes', () => {
    const html = renderToStaticMarkup(
      <ExpertWaitingRow question="Как усилить позиционирование?" />,
    );

    expect(html).toContain('Как усилить позиционирование?');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toMatch(/до полутора минут/u);
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

function resultWithMilestone(measureAfter: string): CoachResult {
  return {
    message: 'Проверим срок.',
    phase: 'market',
    nextQuestion: null,
    completeness: { known: [], unknown: [] },
    safety: { needsHuman: false, reason: null },
    careerTrack: {
      objective: 'Проверить переход',
      alternatives: [],
      milestones: [
        {
          label: 'Собрать выборку рынка',
          expectedSignal: 'Пять релевантных вакансий',
          measureAfter,
          successCriterion: 'Не менее пяти совпадений',
        },
      ],
    },
    actionProposals: [],
    intelligence: {
      orchestrationRevision: 'test',
      roleCoverage: [],
      roleContributions: [],
      evidenceCoverage: 1,
      unsupportedClaimCount: 0,
      marketEvidence: null,
    },
  };
}
