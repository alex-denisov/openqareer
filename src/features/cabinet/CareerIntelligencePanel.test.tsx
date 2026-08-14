import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { buildCanonicalProfileJourney } from '../journey/careerJourneyEngine';
import { NextAction } from './CareerIntelligencePanel';

describe('CareerIntelligencePanel next action', () => {
  it('renders the complete reasoned-action contract for a signed-in journey', () => {
    const journey = buildCanonicalProfileJourney(
      undefined,
      [
        {
          id: 'confirmed-result',
          statement: 'Запустил продукт и сократил срок релиза на 30 процентов.',
          kind: 'fact',
          domain: 'outcome',
          status: 'confirmed',
          sourceMessageIds: ['message-1'],
        },
      ],
      '',
      '2026-08-14T00:00:00.000Z',
    );

    const html = renderToStaticMarkup(
      <NextAction journey={journey} onNavigate={vi.fn()} />,
    );
    const action = journey.reasonedAction;

    expect(action).toBeDefined();
    expect(html).toContain('Что изменится');
    expect(html).toContain(action?.expectedChange ?? 'missing expected change');
    expect(html).toContain('Другой путь');
    expect(html).toContain('Исправить исходные данные');
    expect(html).toContain(action?.approvalBoundary ?? 'missing approval boundary');
  });
});
