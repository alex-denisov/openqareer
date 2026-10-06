import { describe, expect, it } from 'vitest';
import type { ApplicationView } from './applicationsApi';
import { computePipelineAnalytics } from './pipelineAnalytics';

function makeApp(overrides: Partial<ApplicationView>): ApplicationView {
  return {
    id: 'app-1',
    candidateId: 'cand-1',
    clusterId: 'cl-1',
    stage: 'applied',
    closedReason: null,
    archiveReason: null,
    archivePreviousStage: null,
    processProfile: 'standard',
    vacancy: {
      title: 'Senior Frontend Engineer',
      company: 'Tech Corp',
      url: 'https://example.com/vac/1',
      source: 'hh',
    },
    notes: null,
    followUpDueAt: null,
    stageChangedAt: '2026-09-25T10:00:00.000Z',
    version: 1,
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-25T10:00:00.000Z',
    followUp: null,
    whoseTurn: 'company',
    materials: { coverLetter: true, resume: true },
    nearestInterview: null,
    ...overrides,
  };
}

describe('computePipelineAnalytics', () => {
  it('возвращает пустые показатели для пустого списка откликов', () => {
    const summary = computePipelineAnalytics([]);
    expect(summary.totalCount).toBe(0);
    expect(summary.activeCount).toBe(0);
    expect(summary.overallConversionRate).toBe(0);
    expect(summary.bottleneck.id).toBe('need_more_data');
    expect(summary.steps).toHaveLength(5);
    expect(summary.steps[0].count).toBe(0);
    expect(summary.steps[1].count).toBe(0);
  });

  it('считает сквозные переходы по этапам воронки', () => {
    const apps: readonly ApplicationView[] = [
      makeApp({ id: '1', stage: 'saved' }),
      makeApp({ id: '2', stage: 'applied' }),
      makeApp({ id: '3', stage: 'responded' }),
      makeApp({ id: '4', stage: 'interview' }),
      makeApp({ id: '5', stage: 'offer' }),
    ];

    const summary = computePipelineAnalytics(apps);
    expect(summary.totalCount).toBe(5);
    expect(summary.activeCount).toBe(5);

    // saved: все 5 (были сохранены или добавлены)
    const savedStep = summary.steps.find((s) => s.stage === 'saved');
    expect(savedStep?.count).toBe(5);

    // applied: 4 дошли до отклика (2, 3, 4, 5)
    const appliedStep = summary.steps.find((s) => s.stage === 'applied');
    expect(appliedStep?.count).toBe(4);

    // responded: 3 дошли до ответа (3, 4, 5)
    const respondedStep = summary.steps.find((s) => s.stage === 'responded');
    expect(respondedStep?.count).toBe(3);

    // interview: 2 дошли до интервью (4, 5)
    const interviewStep = summary.steps.find((s) => s.stage === 'interview');
    expect(interviewStep?.count).toBe(2);

    // offer: 1 оффер (5)
    const offerStep = summary.steps.find((s) => s.stage === 'offer');
    expect(offerStep?.count).toBe(1);

    // Конверсия отклик -> оффер: 1 из 4 = 25%
    expect(summary.overallConversionRate).toBe(25);
  });

  it('учитывает историю этапа для отклоненных карточек', () => {
    const apps: readonly ApplicationView[] = [
      makeApp({ id: '1', stage: 'applied' }),
      makeApp({ id: '2', stage: 'rejected', archivePreviousStage: 'interview' }),
      makeApp({ id: '3', stage: 'archived', archivePreviousStage: 'responded' }),
    ];

    const summary = computePipelineAnalytics(apps);
    const appliedStep = summary.steps.find((s) => s.stage === 'applied');
    const respondedStep = summary.steps.find((s) => s.stage === 'responded');
    const interviewStep = summary.steps.find((s) => s.stage === 'interview');

    expect(appliedStep?.count).toBe(3);
    expect(respondedStep?.count).toBe(2);
    expect(interviewStep?.count).toBe(1);
    expect(summary.rejectedCount).toBe(1);
    expect(summary.archivedCount).toBe(1);
  });

  it('определяет узкое место при низком отклике работодателей', () => {
    const apps: readonly ApplicationView[] = [
      makeApp({ id: '1', stage: 'applied' }),
      makeApp({ id: '2', stage: 'applied' }),
      makeApp({ id: '3', stage: 'applied' }),
      makeApp({ id: '4', stage: 'applied' }),
      makeApp({ id: '5', stage: 'applied' }),
    ];

    const summary = computePipelineAnalytics(apps);
    expect(summary.bottleneck.id).toBe('low_response_rate');
    expect(summary.bottleneck.severity).toBe('warning');
  });

  it('определяет узкое место при отсутствии интервью при наличии ответов', () => {
    const apps: readonly ApplicationView[] = [
      makeApp({ id: '1', stage: 'responded' }),
      makeApp({ id: '2', stage: 'responded' }),
      makeApp({ id: '3', stage: 'applied' }),
    ];

    const summary = computePipelineAnalytics(apps);
    expect(summary.bottleneck.id).toBe('low_interview_rate');
  });

  it('рассчитывает среднее время прохождения этапов', () => {
    const apps: readonly ApplicationView[] = [
      makeApp({
        id: '1',
        createdAt: '2026-09-01T00:00:00.000Z',
        stageChangedAt: '2026-09-05T00:00:00.000Z',
      }),
      makeApp({
        id: '2',
        createdAt: '2026-09-01T00:00:00.000Z',
        stageChangedAt: '2026-09-07T00:00:00.000Z',
      }),
    ];

    const summary = computePipelineAnalytics(apps);
    expect(summary.averageCycleDays).toBe(5);
  });

  it('группирует статистику по источникам вакансий', () => {
    const apps: readonly ApplicationView[] = [
      makeApp({
        id: '1',
        stage: 'interview',
        vacancy: { title: 'A', company: 'C', source: 'hh', url: 'https://hh.ru/1' },
      }),
      makeApp({
        id: '2',
        stage: 'applied',
        vacancy: { title: 'B', company: 'D', source: 'hh', url: 'https://hh.ru/2' },
      }),
      makeApp({
        id: '3',
        stage: 'offer',
        vacancy: { title: 'E', company: 'F', source: 'linkedin', url: 'https://li.com/3' },
      }),
    ];

    const summary = computePipelineAnalytics(apps);
    expect(summary.sources.length).toBeGreaterThanOrEqual(2);
    const hhSource = summary.sources.find((s) => s.source === 'hh');
    expect(hhSource?.total).toBe(2);
    expect(hhSource?.interview).toBe(1);
  });
});
