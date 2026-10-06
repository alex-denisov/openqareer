// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResponsesCard } from './ResponsesCard';
import type { ApplicationView } from './applicationsApi';

function makeApplication(overrides: Partial<ApplicationView> = {}): ApplicationView {
  return {
    id: 'a1',
    candidateId: 'c1',
    clusterId: 'cl1',
    stage: 'applied',
    closedReason: null,
    archiveReason: null,
    archivePreviousStage: null,
    processProfile: 'standard',
    vacancy: {
      title: 'Senior Frontend Developer',
      company: 'FinCloud',
      url: 'https://hh.ru/1',
      source: 'hh',
    },
    notes: null,
    followUpDueAt: null,
    stageChangedAt: '2026-09-20T10:00:00.000Z',
    version: 1,
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    followUp: null,
    whoseTurn: 'company',
    materials: { coverLetter: true, resume: true },
    nearestInterview: null,
    archiveStaleDays: 30,
    deliveryReceipt: { kind: 'confirmation_url', value: 'https://hh.ru/app/1' },
    ...overrides,
  };
}

describe('ResponsesCard (B414)', () => {
  it('Критерий 1: Оба select карточки используют один класс стиля', () => {
    const app = makeApplication({ stage: 'applied' });
    const html = renderToStaticMarkup(
      <ResponsesCard
        application={app}
        failed={false}
        conflicted={false}
        isMenuOpen={true}
        onRetry={() => {}}
        onRefresh={() => {}}
        onSaveNote={() => {}}
        onSkip={() => {}}
        onMarkFollowUpSent={async () => {}}
        onChangeStage={() => {}}
        onScheduleInterview={async () => {}}
      />,
    );

    // В карточке на этапе applied присутствуют оба select: "Этап" и "Доказательство доставки"
    expect(html).toContain('Этап');
    expect(html).toContain('Доказательство доставки');

    // Проверяем, что оба select имеют общий класс career-responses-select
    const selectMatches = Array.from(html.matchAll(/<select[^>]*class="([^"]*)"[^>]*>/g));
    expect(selectMatches.length).toBeGreaterThanOrEqual(2);

    for (const match of selectMatches) {
      const classes = match[1].split(/\s+/);
      expect(classes).toContain('career-responses-select');
    }

    // Проверяем, что оба select обернуты в класс career-responses-select-wrap
    const wrapMatches = Array.from(html.matchAll(/class="career-responses-select-wrap"/g));
    expect(wrapMatches.length).toBeGreaterThanOrEqual(2);
  });
});
