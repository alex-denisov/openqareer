// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { todaySnapshot } from '../../../e2e/fixtures/readabilityWorkspace';
import { TodayDesktopContent } from './TodayDesktop';

function funnel(context?: {
  found?: number;
  favorites?: number;
  responses?: number;
  offers?: number;
}) {
  const root = document.createElement('div');
  root.innerHTML = renderToStaticMarkup(
    <TodayDesktopContent
      snapshot={{
        ...todaySnapshot,
        queue: [],
        followUps: [],
        momentum: {
          calculatedAt: '2026-10-16T09:00:00.000Z',
          windows: {
            '7d': { applied: 4, views: 'unknown', screenings: 'unknown', interviews: 1 },
            '30d': { applied: 7, views: 'unknown', screenings: 3, interviews: 2 },
          },
          burnoutNotice: false,
        },
      }}
      funnelContext={context}
      onAccept={() => undefined}
      onPostpone={() => undefined}
    />,
  );
  return root.querySelector('.career-today-funnel')!;
}

describe('Today funnel values', () => {
  it('keeps pending feedback inside the approved queue instead of adding a new screen block', () => {
    const root = document.createElement('div');
    root.innerHTML = renderToStaticMarkup(
      <TodayDesktopContent
        snapshot={{ ...todaySnapshot, queue: [], followUps: [], vacanciesPending: true }}
        onAccept={() => undefined}
        onPostpone={() => undefined}
      />,
    );
    expect(root.querySelector('.career-today-pending')).toBeNull();
    expect(root.querySelector('#today-queue')?.getAttribute('aria-busy')).toBe('true');
    expect(root.querySelector('#today-queue')?.textContent).toContain('Загружаем очередь дня');
  });
  it('draws measured proportions from available counts without inline CSS', () => {
    const element = funnel({ found: 214, favorites: 18, responses: 3, offers: 0 });
    const bars = [...element.querySelectorAll('.career-today-funnel-track-fill')].map((e) =>
      Number(e.getAttribute('width')),
    );
    expect(bars[0]).toBe(100);
    expect(bars[1]).toBeCloseTo((18 / 214) * 100);
    expect(bars[2]).toBeCloseTo((7 / 214) * 100);
    expect(bars[5]).toBe(0);
    expect(element.querySelector('[style]')).toBeNull();
    expect(element.querySelector('.is-current .career-today-funnel-label')?.textContent).toBe(
      'Интервью',
    );
  });

  it('keeps unavailable counts unknown rather than drawing invented zeroes', () => {
    const element = funnel();
    const first = element.querySelector('li')!;
    expect(first.getAttribute('aria-label')).toContain('нет проверенных данных');
    expect(first.querySelector('.career-today-funnel-value')?.textContent).toBe('—');
    expect(first.querySelector('.career-today-funnel-track-fill')).toBeNull();
  });
});
