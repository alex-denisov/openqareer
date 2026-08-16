import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrandMark } from './BrandMark';

describe('BrandMark', () => {
  it('draws the openqareer sign as vector art with an accessible name', () => {
    const html = renderToStaticMarkup(<BrandMark />);

    expect(html).toContain('<svg');
    expect(html).toContain('role="img"');
    expect(html).toContain('openqareer');
    expect(html).not.toContain('<image');
    expect(html).not.toContain('.png');
  });

  it('carries the brand gradient extracted from the owner-provided logo', () => {
    const html = renderToStaticMarkup(<BrandMark />);

    expect(html).toContain('#0488F4');
    expect(html).toContain('#0A70E0');
    expect(html).toContain('#0F43A2');
  });

  it('renders the lockup with a readable wordmark next to the sign', () => {
    const html = renderToStaticMarkup(<BrandMark variant="lockup" />);

    expect(html).toContain('open');
    expect(html).toContain('qareer');
    expect(html).toContain('brand-lockup-open');
    expect(html).toContain('brand-lockup-qareer');
    // The wordmark ink is a stylesheet token, because CSP forbids the inline
    // style attribute that used to carry it.
    expect(readFileSync(new URL('../../App.css', import.meta.url), 'utf8')).toContain(
      '--brand-ink: #182344;',
    );
  });

  it('gives every instance its own gradient ids so two marks never collide', () => {
    const first = renderToStaticMarkup(<BrandMark idPrefix="a" />);
    const second = renderToStaticMarkup(<BrandMark idPrefix="b" />);

    expect(first).toContain('id="a-ring"');
    expect(second).toContain('id="b-ring"');
    expect(first).not.toContain('id="b-ring"');
  });

  it('drops the brand colours in monochrome so it survives inverted surfaces', () => {
    const html = renderToStaticMarkup(<BrandMark tone="mono" className="x" />);

    expect(html).toContain('currentColor');
    expect(html).not.toContain('#0488F4');
  });

  it('styles itself without a style attribute, which production CSP blocks', () => {
    // openqareer.com serves `style-src 'self'`, so an inline style attribute is
    // dropped by the browser and the wordmark loses its size and its colours.
    for (const html of [
      renderToStaticMarkup(<BrandMark />),
      renderToStaticMarkup(<BrandMark variant="lockup" size={26} />),
      renderToStaticMarkup(<BrandMark variant="lockup" tone="mono" />),
    ]) {
      expect(html).not.toContain('style="');
    }
  });

  it('marks the monochrome lockup with a class so CSS can drop the brand ink', () => {
    const html = renderToStaticMarkup(<BrandMark variant="lockup" tone="mono" />);

    expect(html).toContain('is-mono');
  });
});

describe('favicon.svg', () => {
  // The favicon is a static file, so nothing forces it to follow the
  // component. This pins the two to the same measured geometry.
  const favicon = readFileSync(
    new URL('../../../public/favicon.svg', import.meta.url),
    'utf8',
  );
  const component = renderToStaticMarkup(<BrandMark idPrefix="x" />);

  it.each(['31.87', '25.2', '11.59', '37.34', '41.9', '57.3', '60.45', '10.33', '17.5'])(
    'keeps geometry value %s in step with the component',
    (value) => {
      expect(favicon).toContain(value);
      expect(component).toContain(value);
    },
  );

  it('uses the same brand gradient stops', () => {
    for (const stop of ['#0488F4', '#0A70E0', '#0F43A2']) {
      expect(favicon).toContain(stop);
      expect(component).toContain(stop);
    }
  });
});
