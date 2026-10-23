import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CountryFitPage } from './CountryFitPage';

describe('Country Fit public first paint', () => {
  it('renders a complete sourced calculator and FAQ without a session or browser storage', () => {
    const html = renderToStaticMarkup(<CountryFitPage onNavigate={() => {}} />);
    expect((html.match(/<h1[ >]/gu) ?? [])).length(1);
    expect(html).toContain('Чистый доход в месяц');
    expect(html).toContain('2026-10-10');
    expect(html).toContain('https://www.gesetze-im-internet.de/');
    expect(html).toContain('FAQPage');
    expect(html).toContain('укажите расходы');
    expect(html).not.toContain('<select');
  });
});
