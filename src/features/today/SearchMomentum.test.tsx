import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SearchMomentum } from './SearchMomentum';
import type { SearchMomentum as SearchMomentumData } from './todayApi';

const MOCK_MOMENTUM_EMPTY: SearchMomentumData = {
  calculatedAt: '2026-10-09T12:00:00.000Z',
  windows: {
    '7d': { applied: 0, views: 'unknown', screenings: 'unknown', interviews: 0 },
    '30d': { applied: 0, views: 'unknown', screenings: 'unknown', interviews: 0 },
  },
  burnoutNotice: false,
};

const MOCK_MOMENTUM_ACTIVE: SearchMomentumData = {
  calculatedAt: '2026-10-09T12:00:00.000Z',
  windows: {
    '7d': { applied: 3, views: 'unknown', screenings: 'unknown', interviews: 1 },
    '30d': { applied: 12, views: 'unknown', screenings: 'unknown', interviews: 2 },
  },
  burnoutNotice: false,
};

describe('SearchMomentum Component (B397)', () => {
  it('renders honest empty state without any numbers (Criterion 3)', () => {
    const html = renderToStaticMarkup(<SearchMomentum momentum={MOCK_MOMENTUM_EMPTY} />);
    expect(html).toContain(
      'Пока нет подтверждённых откликов. Когда отклики будут отправлены и подтверждены, здесь появятся цифры',
    );
    // Strip tags and ensure no digits/numbers exist in empty state body
    const textContent = html.replace(/<[^>]*>/g, '');
    expect(textContent).not.toMatch(/\d/);
  });

  it('renders metrics and shows "нет данных" when source is unknown (Criterion 2)', () => {
    const html = renderToStaticMarkup(<SearchMomentum momentum={MOCK_MOMENTUM_ACTIVE} />);
    expect(html).toContain('Подтверждённые отклики');
    expect(html).toContain('3');
    expect(html).toContain('Просмотры');
    expect(html).toContain('Скрининги');
    expect(html).toContain('нет данных');
    expect(html).toContain('Интервью');
    expect(html).toContain('1');
  });

  it('shows burnout protection hint at >= 30 applications and 0 interviews (Criterion 4)', () => {
    const onNavigate = vi.fn();
    const momentumBurnout: SearchMomentumData = {
      calculatedAt: '2026-10-09T12:00:00.000Z',
      windows: {
        '7d': { applied: 8, views: 'unknown', screenings: 'unknown', interviews: 0 },
        '30d': { applied: 30, views: 'unknown', screenings: 'unknown', interviews: 0 },
      },
      burnoutNotice: true,
    };

    const htmlBurnout = renderToStaticMarkup(
      <SearchMomentum momentum={momentumBurnout} onNavigate={onNavigate} />,
    );
    expect(htmlBurnout).toContain('30 откликов без интервью — возможно, стоит сменить тактику');
    expect(htmlBurnout).toContain('Обсудить с консультантом');

    // At 29 applications (burnoutNotice = false), no hint is rendered
    const momentumNoBurnout: SearchMomentumData = {
      ...momentumBurnout,
      burnoutNotice: false,
    };
    const htmlNoBurnout = renderToStaticMarkup(
      <SearchMomentum momentum={momentumNoBurnout} onNavigate={onNavigate} />,
    );
    expect(htmlNoBurnout).not.toContain('30 откликов без интервью — возможно, стоит сменить тактику');
  });

  it('contains no forbidden words in markup and no font-size literals in css (Criterion 5)', () => {
    const html = renderToStaticMarkup(<SearchMomentum momentum={MOCK_MOMENTUM_ACTIVE} />).toLowerCase();
    expect(html).not.toContain('выгорание');
    expect(html).not.toContain('балл');
    expect(html).not.toContain('рейтинг');

    const cssPath = resolve(__dirname, './searchMomentum.css');
    const cssContent = readFileSync(cssPath, 'utf8');
    // Ensure no font-size literal (e.g. font-size: 14px or font-size: 1rem)
    const fontLiterals = [...cssContent.matchAll(/font-size:\s*([^;]+);/g)];
    expect(fontLiterals.length).toBeGreaterThan(0);
    for (const [, val] of fontLiterals) {
      expect(val.trim()).toMatch(/^var\(--career-text-/);
    }
  });
});
