import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PublicFooter, PublicHeader } from '../src/features/site/PublicSiteChrome';
import {
  PUBLIC_FOOTER_COLUMNS,
  PUBLIC_NAV,
  PUBLIC_TOOLS,
  renderChromeFooterHtml,
  renderChromeHeaderHtml,
  renderPlanBarHtml,
  sectionForPath,
  showsPlanBar,
} from './publicSiteChrome';
import { catalogChromeFooter, catalogChromeHeader } from '../server/vacancies/catalogChrome';

const hrefs = (html: string): string[] =>
  [...new Set([...html.matchAll(/href="([^"]+)"/gu)].map((m) => m[1] ?? ''))].sort();
const noop = () => {};

describe('B569: public chrome has one link list', () => {
  const props = { onNavigate: noop, onLanding: false, signedIn: false } as const;

  it('React and server headers link the same places', () => {
    const react = renderToStaticMarkup(React.createElement(PublicHeader, props));
    const server = catalogChromeHeader();
    const nav = PUBLIC_NAV.map((item) => item.href);
    for (const html of [react, server]) {
      for (const href of nav) expect(hrefs(html)).toContain(href);
      expect(html).not.toContain('Как это работает');
    }
    // /signup, /login, brand, 4 sections twice (nav + phone menu)
    expect(hrefs(react).filter((h) => !h.startsWith('/#') || h === '/#tools')).toEqual(
      hrefs(server).filter((h) => !h.startsWith('/#') || h === '/#tools'),
    );
  });

  it('React and server footers link the same places', () => {
    const react = renderToStaticMarkup(React.createElement(PublicFooter, props));
    const server = renderChromeFooterHtml('<a href="/" class="ps-brand"></a>', 2026);
    expect(hrefs(react)).toEqual(hrefs(server));
    for (const column of PUBLIC_FOOTER_COLUMNS) {
      for (const link of column.links) expect(hrefs(react)).toContain(link.href);
    }
    expect(react).toContain('data-oq-consent-open');
    expect(server).toContain('data-oq-consent-open');
  });

  it('links the relocation list from the footer once it answers 200 (B574)', () => {
    expect(hrefs(catalogChromeFooter())).toContain('/vacancies/relocation');
  });

  it('B574: the logo leads home, «Инструменты» is a link to /#tools, both action pairs are printed', () => {
    const react = renderToStaticMarkup(React.createElement(PublicHeader, props));
    for (const html of [react, catalogChromeHeader()]) {
      expect(html).toMatch(/class="ps-tooldrop-trigger" href="\/#tools"/u);
      expect(html).toContain('aria-label="openqareer — на главную"');
      expect(html).toMatch(/class="ps-btn is-login ps-guest"[^>]*>Войти/u);
      expect(html).toMatch(/class="ps-btn is-cta ps-member"[^>]*>Открыть кабинет/u);
    }
  });

  it('B574: oq-chrome-2.js builds the same six tools as PUBLIC_TOOLS', () => {
    const script = readFileSync(
      new URL('../public/assets/oq-chrome-2.js', import.meta.url),
      'utf8',
    );
    const listed = [...script.matchAll(/\['([^']+)', '([^']+)'\]/gu)].map((m) => [m[1], m[2]]);
    expect(listed).toEqual(PUBLIC_TOOLS.map((tool) => [tool.href, tool.label]));
  });

  it('marks the current section and shows the plan strip where the mockup does', () => {
    expect(renderChromeHeaderHtml('', 'faq')).toContain('href="/faq" aria-current="page"');
    expect(catalogChromeHeader()).toContain('href="/vacancies" aria-current="page"');
    expect(sectionForPath('/faq')).toBe('faq');
    expect(sectionForPath('/vacancies/moscow')).toBe('vacancies');
    expect(sectionForPath('/tools/resume')).toBe('tools');
    expect(sectionForPath('/salaries/accountant')).toBe('tools');
    expect(['/tools/resume', '/salaries/germany', '/vacancies'].every(showsPlanBar)).toBe(true);
    expect(['/', '/faq', '/legal/terms'].some(showsPlanBar)).toBe(false);
    expect(catalogChromeFooter()).toContain(renderPlanBarHtml());
    expect(
      renderToStaticMarkup(React.createElement(PublicFooter, { ...props, planBar: true })),
    ).toContain('Free навсегда');
  });
});
