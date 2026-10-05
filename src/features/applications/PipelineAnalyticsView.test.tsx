// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PipelineAnalyticsView } from './PipelineAnalyticsView';
import type { ApplicationView } from './applicationsApi';

function makeApp(overrides: Partial<ApplicationView>): ApplicationView {
  return {
    id: 'a-1',
    candidateId: 'c-1',
    clusterId: null,
    stage: 'applied',
    closedReason: null,
    archiveReason: null,
    archivePreviousStage: null,
    processProfile: 'standard',
    vacancy: {
      title: 'Senior Frontend Developer',
      company: 'Acme Corp',
      url: 'https://example.com',
      source: 'hh',
    },
    notes: null,
    followUpDueAt: null,
    stageChangedAt: '2026-09-20T10:00:00.000Z',
    version: 1,
    createdAt: '2026-09-15T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    followUp: null,
    whoseTurn: 'company',
    materials: { coverLetter: true, resume: true },
    nearestInterview: null,
    ...overrides,
  };
}

describe('PipelineAnalyticsView', () => {
  it('отображает заглушку, когда откликов нет', () => {
    const html = renderToStaticMarkup(
      <PipelineAnalyticsView applications={[]} onOpenVacancies={() => {}} />,
    );
    expect(html).toContain('Пока нет данных для аналитики');
    expect(html).toContain('Перейти к вакансиям');
  });

  it('отображает ключевые метрики воронки, этапы и узкие места', () => {
    const apps: readonly ApplicationView[] = [
      makeApp({ id: '1', stage: 'applied' }),
      makeApp({ id: '2', stage: 'responded' }),
      makeApp({ id: '3', stage: 'interview' }),
      makeApp({ id: '4', stage: 'offer' }),
    ];

    const html = renderToStaticMarkup(
      <PipelineAnalyticsView applications={apps} onOpenVacancies={() => {}} />,
    );

    expect(html).toContain('Аналитика воронки');
    expect(html).toContain('Откликнулись');
    expect(html).toContain('Ответ компании');
    expect(html).toContain('Интервью');
    expect(html).toContain('Получен оффер');
    expect(html).toContain('hh.ru');
    expect(html).toContain('Воронка стабильна');
  });

  it('отображает диагностику узкого места и рекомендацию стратега', () => {
    const apps: readonly ApplicationView[] = [
      makeApp({ id: '1', stage: 'applied' }),
      makeApp({ id: '2', stage: 'applied' }),
      makeApp({ id: '3', stage: 'applied' }),
      makeApp({ id: '4', stage: 'applied' }),
    ];

    const html = renderToStaticMarkup(
      <PipelineAnalyticsView applications={apps} onOpenVacancies={() => {}} />,
    );

    expect(html).toContain('Узкое место: низкий отклик работодателей');
    expect(html).toContain('Проверьте ключевые слова в резюме');
  });

  it('отображает причины отказов и архива, если они есть', () => {
    const apps: readonly ApplicationView[] = [
      makeApp({ id: '1', stage: 'rejected', closedReason: 'Зарплатные ожидания' }),
      makeApp({ id: '2', stage: 'archived', archiveReason: 'stale' }),
    ];

    const html = renderToStaticMarkup(
      <PipelineAnalyticsView applications={apps} onOpenVacancies={() => {}} />,
    );

    expect(html).toContain('Зарплатные ожидания');
    expect(html).toContain('Причины закрытия');
  });
});
