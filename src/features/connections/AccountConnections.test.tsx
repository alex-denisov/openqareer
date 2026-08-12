import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AccountConnections } from './AccountConnections';

describe('AccountConnections', () => {
  it('shows a connected platform and the honest local-disconnect boundary', () => {
    const html = renderToStaticMarkup(
      <AccountConnections
        connections={[
          {
            platform: 'linkedin',
            available: true,
            status: 'connected',
            capabilities: ['lite_identity'],
            importsCareerHistory: false,
            scopes: ['openid', 'profile'],
            accessTokenExpiresAt: null,
            connectedAt: '2026-08-10T12:00:00.000Z',
            profile: {
              capturedAt: '2026-08-10T12:00:00.000Z',
              sourceUrl: null,
              facts: [],
            },
          },
        ]}
        onDisconnect={() => undefined}
      />,
    );

    expect(html).toContain('Подключённые площадки');
    expect(html).toContain('LinkedIn');
    expect(html).toContain('Подключено');
    expect(html).toContain('не переносит карьерную историю');
    expect(html).toContain('Отключить LinkedIn');
    expect(html).toContain('может потребовать отдельного отзыва');
  });
});
