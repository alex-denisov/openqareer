import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RouteNoticeLine } from './RouteNoticeLine';

/** Phosphor renders every icon inside the same `<svg>` tag: the glyph that
 *  actually distinguishes them lives in the children, so compare the whole
 *  element rather than its opening tag. */
function iconsOf(html: string): string[] {
  return [...html.matchAll(/<svg[\s\S]*?<\/svg>/g)].map((match) => match[0]);
}

describe('RouteNoticeLine', () => {
  it('renders the notice text for every tone', () => {
    const html = renderToStaticMarkup(
      <RouteNoticeLine notice={{ tone: 'unknown', text: 'Проверить не удалось' }} />,
    );

    expect(html).toContain('career-modal-network-status');
    expect(html).toContain('Проверить не удалось');
  });

  it('never dresses an unmeasured route in the icon of a confirmed one', () => {
    const unknown = renderToStaticMarkup(
      <RouteNoticeLine notice={{ tone: 'unknown', text: 'не проверено' }} />,
    );
    const ok = renderToStaticMarkup(
      <RouteNoticeLine notice={{ tone: 'ok', text: 'работает' }} />,
    );

    expect(iconsOf(unknown)).toHaveLength(1);
    expect(iconsOf(unknown)).not.toEqual(iconsOf(ok));
  });

  it('claims nothing at all while the probe is still in flight', () => {
    const html = renderToStaticMarkup(
      <RouteNoticeLine notice={{ tone: 'pending', text: 'Проверяем…' }} />,
    );

    expect(iconsOf(html)).toHaveLength(0);
    expect(html).toContain('Проверяем…');
  });

  it('shrinks to the connector toolbar without losing the text', () => {
    const html = renderToStaticMarkup(
      <RouteNoticeLine notice={{ tone: 'blocked', text: 'недоступен' }} compact />,
    );

    expect(html).toContain('is-compact');
    expect(html).toContain('недоступен');
  });
});
