import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ParsedResume } from '../workspace/resumeParser';
import {
  AccountConnections,
  persistHhSessionImport,
  persistStructuredLinkedInImport,
} from './AccountConnections';
import type { LinkedInProfileV2 } from '../../../shared/linkedinProfileV2';

describe('AccountConnections', () => {
  it('shows a connected platform and the honest local-disconnect boundary', () => {
    const html = renderToStaticMarkup(
      <AccountConnections
        connections={[
          {
            platform: 'linkedin',
            available: false,
            status: 'connected',
            accessMode: 'native_session_snapshot',
            capabilities: ['lite_identity'],
            importsCareerHistory: false,
            connectedAt: '2026-08-10T12:00:00.000Z',
            lastImportedAt: '2026-08-10T12:00:00.000Z',
            factCount: 0,
          },
        ]}
        onDisconnect={() => undefined}
      />,
    );

    expect(html).toContain('Профили на площадках');
    expect(html).toContain('LinkedIn');
    expect(html).toContain('Подключено');
    expect(html).toContain('Отключить LinkedIn');
    expect(html).toContain('вход в неё в приложении будет забыт');
  });

  // The wizard deliberately holds one source at a time (owner decision, B171).
  // The cabinet is where both live at once — a candidate searching in Russia
  // and abroad manages two платформы, not one (B158 срез 2).
  it('holds both platforms connected at the same time', () => {
    const html = renderToStaticMarkup(
      <AccountConnections
        connections={[
          {
            platform: 'linkedin',
            available: false,
            status: 'connected',
            accessMode: 'native_session_snapshot',
            capabilities: ['lite_identity'],
            importsCareerHistory: false,
            connectedAt: '2026-08-10T12:00:00.000Z',
            lastImportedAt: '2026-08-10T12:00:00.000Z',
            factCount: 4,
          },
          {
            platform: 'hh',
            available: false,
            status: 'connected',
            accessMode: 'native_session_snapshot',
            capabilities: ['resume_read'],
            importsCareerHistory: true,
            connectedAt: '2026-08-11T09:00:00.000Z',
            lastImportedAt: '2026-08-11T09:00:00.000Z',
            factCount: 10,
          },
        ]}
        onDisconnect={() => undefined}
      />,
    );

    expect(html).toContain('Отключить LinkedIn');
    expect(html).toContain('Отключить hh.ru');
    expect(html.match(/Подключено/gu)?.length).toBe(2);
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

  it('tells web candidates the connection lives in the computer app, for any platform', () => {
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

    // Площадок много: копия не называет одну и не говорит «десктопное» (B236).
    expect(html).toContain('подключаются в приложении OpenQareer для компьютера');
    expect(html).toContain('На сайте можно загрузить резюме файлом');
    expect(html).not.toContain('десктопн');
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

    expect(html).toContain('Из hh.ru сохранено 7 фактов');
    expect(html).toContain('Ваша сессия на площадке не хранится');
    expect(html).toContain('Уже добавленные факты останутся в профиле');
    expect(html).not.toContain('токены');
  });

  // B247 S7: a document import without a live session must read as its own
  // state, not the bare "Не подключено" a candidate with zero data sees.
  it('marks a document import without a live session as imported, not disconnected', () => {
    const html = renderToStaticMarkup(
      <AccountConnections
        connections={[
          {
            platform: 'linkedin',
            available: true,
            status: 'imported',
            capabilities: ['resume_read'],
            importsCareerHistory: true,
            importedAt: '2026-09-10T09:00:00.000Z',
          },
        ]}
        onDisconnect={() => undefined}
      />,
    );

    expect(html).toContain('Профиль импортирован');
    expect(html).toContain('обновить в приложении');
    expect(html).not.toContain('Не подключено');
  });

  it('lets the desktop app reconnect an imported-but-disconnected profile (B266)', () => {
    const html = renderToStaticMarkup(
      <AccountConnections
        isDesktop
        connections={[
          {
            platform: 'linkedin',
            available: true,
            status: 'imported',
            capabilities: ['resume_read'],
            importsCareerHistory: true,
            importedAt: '2026-09-25T09:00:00.000Z',
          },
        ]}
        onDisconnect={() => undefined}
        onSessionImport={() => undefined}
      />,
    );

    expect(html).toContain('Профиль импортирован');
    expect(html).toContain('Подключить LinkedIn');
    expect(html).not.toContain('обновить в приложении');
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

  it('imports a structured LinkedIn profile without going through the text importer', async () => {
    const connection = {
      platform: 'linkedin' as const,
      available: true,
      status: 'connected' as const,
      accessMode: 'native_session_snapshot' as const,
      capabilities: ['lite_identity'] as ['lite_identity'],
      importsCareerHistory: false,
      connectedAt: '2026-09-25T08:00:00.000Z',
      lastImportedAt: '2026-09-25T08:00:00.000Z',
      factCount: 12,
    };
    const profile = { headline: 'Product Director' } as unknown as LinkedInProfileV2;
    const importStructuredProfile = vi.fn().mockResolvedValue({ connection });
    const loadConnections = vi.fn().mockResolvedValue([connection]);

    const result = await persistStructuredLinkedInImport(
      {
        profile,
        extractorVersion: 'v2.0.0',
        sourceUrl: 'https://www.linkedin.com/in/jane-doe/',
        capturedAt: '2026-09-25T07:59:59.000Z',
      },
      { importStructuredProfile, loadConnections },
    );

    expect(importStructuredProfile).toHaveBeenCalledWith({
      profile,
      extractorVersion: 'v2.0.0',
      sourceUrl: 'https://www.linkedin.com/in/jane-doe/',
      capturedAt: '2026-09-25T07:59:59.000Z',
    });
    expect(loadConnections).toHaveBeenCalledOnce();
    expect(result.connection).toEqual(connection);
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
