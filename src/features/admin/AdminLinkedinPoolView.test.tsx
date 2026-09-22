import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminLinkedinPoolView } from './AdminLinkedinPoolView';

describe('AdminLinkedinPoolView', () => {
  it('names the admin-only full identifier boundary and desktop fallback', () => {
    const html = renderToStaticMarkup(<AdminLinkedinPoolView />);

    expect(html).toContain('Аккаунты LinkedIn');
    expect(html).toContain('Полный email login');
    expect(html).toContain('только администратору');
    expect(html).toContain('desktop');
    expect(html).not.toContain('mask');
  });
});
