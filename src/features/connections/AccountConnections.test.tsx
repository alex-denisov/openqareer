import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ParsedResume } from '../workspace/resumeParser';
import {
  AccountConnections,
  persistHhSessionImport,
} from './AccountConnections';

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

    expect(html).toContain('Профиль LinkedIn подключается в десктопном приложении');
    expect(html).not.toContain('Подключить LinkedIn');
  });

  it('describes a persisted native snapshot without claiming a stored provider session', () => {
    const html = renderToStaticMarkup(
      <AccountConnections
        isDesktop
        connections={[
          {
            platform: 'hh',
            available: true,
            status: 'connected',
            accessMode: 'native_session_snapshot',
            capabilities: ['resume_read'],
            importsCareerHistory: true,
            connectedAt: '2026-08-24T08:00:00.000Z',
            lastImportedAt: '2026-08-24T08:00:00.000Z',
            factCount: 7,
          },
        ]}
        onDisconnect={() => undefined}
      />,
    );

    expect(html).toContain('Снимок резюме hh.ru сохранён');
    expect(html).toContain('Сессия hh.ru не хранится');
    expect(html).toContain('Импортированные данные останутся');
    expect(html).not.toContain('токены');
  });

  it('offers LinkedIn through the restored desktop session flow', () => {
    const html = renderToStaticMarkup(
      <AccountConnections
        isDesktop
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
        onSessionImport={() => undefined}
      />,
    );

    expect(html).toContain('Подключить LinkedIn');
  });

  it('reports hh.ru connected only after import and a matching persisted catalog read', async () => {
    const connection = {
      platform: 'hh' as const,
      available: true,
      status: 'connected' as const,
      accessMode: 'native_session_snapshot' as const,
      capabilities: ['resume_read'] as ['resume_read'],
      importsCareerHistory: true,
      connectedAt: '2026-08-24T08:00:00.000Z',
      lastImportedAt: '2026-08-24T08:00:00.000Z',
      factCount: 7,
    };
    const importResume = vi.fn().mockResolvedValue({ connection });
    const loadConnections = vi.fn().mockResolvedValue([connection]);

    const result = await persistHhSessionImport(
      {
        parsed: {
          rawText: 'Product Director\nLed a platform team and reduced lead time.',
        } as ParsedResume,
        sourceUrl: 'https://hh.ru/resume/resume-selected',
        capturedAt: '2026-08-24T07:59:59.000Z',
      },
      { importResume, loadConnections },
    );

    expect(importResume).toHaveBeenCalledWith({
      text: 'Product Director\nLed a platform team and reduced lead time.',
      source: 'hh',
      sourceReceipt: {
        platform: 'hh',
        accessMode: 'native_session_snapshot',
        sourceUrl: 'https://hh.ru/resume/resume-selected',
        capturedAt: '2026-08-24T07:59:59.000Z',
      },
    });
    expect(loadConnections).toHaveBeenCalledOnce();
    expect(result.connection).toEqual(connection);
    expect(result.connections).toEqual([connection]);
  });

  it('fails closed when the connection catalog does not confirm the imported receipt', async () => {
    await expect(
      persistHhSessionImport(
        {
          parsed: { rawText: 'Product Director\nLed a platform team.' } as ParsedResume,
          sourceUrl: 'https://hh.ru/resume/resume-selected',
          capturedAt: '2026-08-24T07:59:59.000Z',
        },
        {
          importResume: vi.fn().mockResolvedValue({
            connection: {
              platform: 'hh',
              available: true,
              status: 'connected',
              accessMode: 'native_session_snapshot',
              capabilities: ['resume_read'],
              importsCareerHistory: true,
              connectedAt: '2026-08-24T08:00:00.000Z',
              lastImportedAt: '2026-08-24T08:00:00.000Z',
              factCount: 3,
            },
          }),
          loadConnections: vi.fn().mockResolvedValue([
            {
              platform: 'hh',
              available: true,
              status: 'disconnected',
              capabilities: [],
              importsCareerHistory: true,
            },
          ]),
        },
      ),
    ).rejects.toThrow('native_connection_not_persisted');
  });
});
