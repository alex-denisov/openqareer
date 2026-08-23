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
            available: false,
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
    expect(html).toContain('Отключить LinkedIn');
  });

  it('offers a plain «Подключить» control for hh.ru in the desktop app', () => {
    const html = renderToStaticMarkup(
      <AccountConnections
        isDesktop
        connections={[
          {
            platform: 'hh',
            available: false,
            status: 'disconnected',
            capabilities: [],
            importsCareerHistory: true,
          },
        ]}
        onDisconnect={() => undefined}
        onSessionImport={() => undefined}
      />,
    );

    expect(html).toContain('Подключить hh.ru');
  });

  it('tells web candidates the connection lives in the desktop app', () => {
    const html = renderToStaticMarkup(
      <AccountConnections
        connections={[
          {
            platform: 'linkedin',
            available: false,
            status: 'disconnected',
            capabilities: [],
            importsCareerHistory: false,
          },
        ]}
        onDisconnect={() => undefined}
      />,
    );

    expect(html).toContain('десктопном приложении OpenQareer');
    expect(html).not.toContain('Подключить LinkedIn');
  });
});
