import { describe, expect, it } from 'vitest';
import { onestFontFaceCss, onestPreloadLinks, withOgImage, withOnestPreload } from './seoHead';

const files = {
  'cyrillic-400': '/assets/onest-cyrillic-400-normal-a.woff2',
  'cyrillic-600': '/assets/onest-cyrillic-600-normal-b.woff2',
  'latin-400': '/assets/onest-latin-400-normal-c.woff2',
};
const head =
  '<title>T</title><meta property="og:title" content="Заголовок"><meta property="og:image" content="https://openqareer.com/og-cover-4.png"><meta property="og:image:alt" content="old"><meta name="twitter:image" content="https://openqareer.com/og-cover-4.png">';

describe('seoHead', () => {
  it('points og and twitter images at the page picture', () => {
    const out = withOgImage(head, 'faq');
    expect(out.match(/\/og\/faq\.png/gu)).toHaveLength(2);
    expect(out).toContain('og:image:alt" content="Заголовок"');
  });

  it('preloads only cyrillic 400 and 600 once', () => {
    expect(onestPreloadLinks(files).match(/as="font"/gu)).toHaveLength(2);
    const once = withOnestPreload(head, files);
    expect(withOnestPreload(once, files)).toBe(once);
  });

  it('declares swap faces with the same files', () => {
    const css = onestFontFaceCss(files);
    expect(css.match(/font-display:swap/gu)).toHaveLength(3);
    expect(css).toContain('/assets/onest-latin-400-normal-c.woff2');
  });
});
