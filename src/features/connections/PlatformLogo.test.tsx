import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlatformLogo } from './PlatformLogo';

describe('PlatformLogo', () => {
  it('draws the LinkedIn mark in the LinkedIn brand colour, not a globe', () => {
    const html = renderToStaticMarkup(
      <PlatformLogo platform="linkedin" title="LinkedIn" />,
    );

    expect(html).toContain('#0A66C2');
    expect(html).toContain('aria-label="LinkedIn"');
    expect(html).toContain('is-linkedin');
  });

  it('draws the hh.ru mark in the hh.ru brand colour', () => {
    const html = renderToStaticMarkup(<PlatformLogo platform="hh" title="hh.ru" />);

    expect(html).toContain('#D6001C');
    expect(html).toContain('is-hh');
  });

  it('hides a decorative mark from assistive technology', () => {
    const html = renderToStaticMarkup(<PlatformLogo platform="hh" />);

    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('aria-label');
  });
});
