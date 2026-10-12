import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorSessionToolbar } from './ConnectorSessionToolbar';

describe('ConnectorSessionToolbar', () => {
  it('shows the verified platform address and working show/cancel actions', () => {
    const onShow = vi.fn();
    const onCancel = vi.fn();
    const html = renderToStaticMarkup(
      <ConnectorSessionToolbar
        platform="linkedin"
        onShow={onShow}
        onCancel={onCancel}
      />,
    );

    expect(html).toContain('https://www.linkedin.com');
    expect(html).toContain('Показать окно входа');
    expect(html).toContain('Отмена');
    expect(html).toContain('aria-label="Защищённый адрес входа"');
  });

  it('uses the hh.ru address for the hh session', () => {
    const html = renderToStaticMarkup(
      <ConnectorSessionToolbar
        platform="hh"
        onShow={async () => true}
        onCancel={() => undefined}
      />,
    );

    expect(html).toContain('https://hh.ru');
    expect(html).not.toContain('www.linkedin.com');
  });
});
