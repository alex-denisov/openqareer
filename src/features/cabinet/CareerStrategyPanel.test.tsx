import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CareerStrategyPanel } from './CareerStrategyPanel';
import type { CareerStrategy } from '../../../shared/careerStrategy';

const strategy: CareerStrategy = {
  current: {
    version: 2,
    role: {
      title: 'Head of Product',
      origin: 'model',
      reason: 'вёл продукты девять лет',
      evidenceRefs: ['memory:1'],
      confirmation: { state: 'not-found', sampleSize: 0 },
    },
    constraints: { regions: ['eu'], note: null },
    reason: 'откликов много, разговоров нет',
    decidedAt: '2026-09-03T16:00:00.000Z',
    provenance: { namedBy: 'gemini:gemini-3.6-flash', language: 'en', poolSize: 534 },
  },
  history: [
    {
      version: 1,
      role: {
        title: 'Product Manager',
        origin: 'model',
        reason: null,
        evidenceRefs: [],
        confirmation: { state: 'not-found', sampleSize: 0 },
      },
      constraints: { regions: ['eu'], note: null },
      reason: 'Первый выбор роли',
      decidedAt: '2026-09-01T10:00:00.000Z',
      provenance: { namedBy: 'gemini:gemini-3.6-flash', language: 'en', poolSize: 512 },
    },
  ],
};

describe('CareerStrategyPanel', () => {
  it('печатает роль, версию, причину смены и прежнее решение', () => {
    const markup = renderToStaticMarkup(<CareerStrategyPanel strategy={strategy} />);

    expect(markup).toContain('Head of Product');
    expect(markup).toContain('версия 2 от 3 сентября');
    expect(markup).toContain('Причина смены: откликов много, разговоров нет');
    expect(markup).toContain('Product Manager');
  });

  it('до выбора зовёт выбрать роль, а не показывает пустое место', () => {
    const markup = renderToStaticMarkup(<CareerStrategyPanel strategy={null} />);
    expect(markup).toContain('Роль ещё не выбрана');
  });

  it('поломку маршрута не выдаёт за отсутствие выбора', () => {
    const markup = renderToStaticMarkup(<CareerStrategyPanel strategy={null} failed />);
    expect(markup).toContain('не удалось прочитать');
    expect(markup).not.toContain('Роль ещё не выбрана');
  });
});
