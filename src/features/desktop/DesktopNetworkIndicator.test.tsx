import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DesktopNetworkIndicator } from './DesktopNetworkIndicator';

describe('DesktopNetworkIndicator', () => {
  it('renders network indicator badge with aria-label', () => {
    const html = renderToStaticMarkup(<DesktopNetworkIndicator />);
    expect(html).toContain('career-desktop-network-indicator');
    expect(html).toContain('aria-label="Сетевой маршрут и защита аккаунтов"');
    expect(html).toContain('Перепроверить сеть');
  });
});
