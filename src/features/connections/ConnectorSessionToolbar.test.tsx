import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorSessionToolbar } from './ConnectorSessionToolbar';

describe('ConnectorSessionToolbar (mockup 12)', () => {
  it('waits for the sign-in in the native window with show and cancel, no address line', () => {
    const html = renderToStaticMarkup(
      <ConnectorSessionToolbar platform="linkedin" onShow={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(html).toContain('Войдите в открывшемся окне');
    expect(html).toContain('Ждём вход');
    expect(html).toContain('Показать окно');
    expect(html).toContain('Отмена');
    expect(html).not.toContain('https://');
  });

  it('says the password stays on the platform page', () => {
    const html = renderToStaticMarkup(
      <ConnectorSessionToolbar
        platform="hh"
        onShow={async () => true}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain('Пароль вводится на странице площадки, мы его не видим.');
  });
});
