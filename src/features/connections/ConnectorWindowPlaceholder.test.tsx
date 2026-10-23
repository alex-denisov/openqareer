import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConnectorWindowPlaceholder } from './ConnectorWindowPlaceholder';

describe('ConnectorWindowPlaceholder (B464)', () => {
  it('says the platform page is loading while its window is still hidden', () => {
    const html = renderToStaticMarkup(<ConnectorWindowPlaceholder platform="hh" />);
    expect(html).toContain('Загружаем страницу hh.ru…');
    expect(html).toContain('role="status"');
  });

  it('names LinkedIn for the LinkedIn window', () => {
    expect(renderToStaticMarkup(<ConnectorWindowPlaceholder platform="linkedin" />)).toContain(
      'Загружаем страницу LinkedIn…',
    );
  });
});
