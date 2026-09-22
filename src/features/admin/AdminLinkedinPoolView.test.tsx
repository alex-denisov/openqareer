import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminLinkedinPoolView } from './AdminLinkedinPoolView';

describe('AdminLinkedinPoolView', () => {
  it('names the admin-only identifier boundary and desktop login flow', () => {
    const html = renderToStaticMarkup(<AdminLinkedinPoolView />);

    expect(html).toContain('Аккаунты LinkedIn');
    expect(html).toContain('Идентификатор сессии');
    expect(html).toContain('только администратору');
    expect(html).toContain('OpenQareer Desktop');
    expect(html).not.toContain('Provider account marker');
    expect(html).not.toContain('Метка администратора');
    expect(html).not.toContain('mask');
  });
});
