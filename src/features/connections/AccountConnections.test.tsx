import { describe, expect, it, vi } from 'vitest';
import type { ParsedResume } from '../workspace/resumeParser';
import { persistHhSessionImport, persistStructuredLinkedInImport } from './AccountConnections';
import type { LinkedInProfileV2 } from '../../../shared/linkedinProfileV2';

describe('account connector import persistence', () => {
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

  it('passes the replace request through and reports a connect-only answer (one profile source, 23.10.2026)', async () => {
    const connection = {
      platform: 'hh' as const,
      available: true,
      status: 'connected' as const,
      accessMode: 'native_session_snapshot' as const,
      capabilities: ['resume_read'] as ['resume_read'],
      importsCareerHistory: true,
      connectedAt: '2026-10-23T08:00:00.000Z',
      lastImportedAt: '2026-10-23T08:00:00.000Z',
      factCount: 0,
    };
    const importResume = vi.fn().mockResolvedValue({ connection, connectOnly: true });
    const loadConnections = vi.fn().mockResolvedValue([connection]);
    const input = {
      parsed: { rawText: 'Product Director\nLed a platform team.' } as ParsedResume,
      sourceUrl: 'https://hh.ru/resume/resume-selected',
      capturedAt: '2026-10-23T07:59:59.000Z',
    };

    const connected = await persistHhSessionImport(input, { importResume, loadConnections });
    await persistHhSessionImport(
      { ...input, importMode: 'replace_profile' },
      { importResume, loadConnections },
    );

    expect(connected.connectOnly).toBe(true);
    expect(importResume.mock.calls[0]?.[0]).not.toHaveProperty('importMode');
    expect(importResume.mock.calls[1]?.[0]).toMatchObject({ importMode: 'replace_profile' });
  });

  it('treats a 0-fact answer next to a profile from another platform as connect only (24.10)', async () => {
    const hh = {
      platform: 'hh' as const,
      available: true,
      status: 'connected' as const,
      accessMode: 'native_session_snapshot' as const,
      capabilities: ['resume_read'] as ['resume_read'],
      importsCareerHistory: true,
      connectedAt: '2026-10-23T08:00:00.000Z',
      lastImportedAt: '2026-10-23T08:00:00.000Z',
      factCount: 0,
    };
    const linkedin = { ...hh, platform: 'linkedin' as const, factCount: 59 };
    // An idempotent replay from an older server: no connectOnly flag, 0 facts.
    const importResume = vi.fn().mockResolvedValue({ connection: hh, factCount: 0 });
    const loadConnections = vi.fn().mockResolvedValue([linkedin, hh]);

    const connected = await persistHhSessionImport(
      {
        parsed: { rawText: 'Product Director' } as ParsedResume,
        sourceUrl: 'https://hh.ru/resume/resume-selected',
        capturedAt: '2026-10-24T02:00:00.000Z',
      },
      { importResume, loadConnections },
    );

    expect(connected.connectOnly).toBe(true);
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
