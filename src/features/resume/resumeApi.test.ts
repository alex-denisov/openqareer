import { afterEach, describe, expect, it, vi } from 'vitest';
import { importCandidateResume } from './resumeApi';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('native resume import API', () => {
  it('sends the strict hh source receipt and returns the persisted connection', async () => {
    const connection = {
      platform: 'hh' as const,
      available: true as const,
      status: 'connected' as const,
      accessMode: 'native_session_snapshot' as const,
      capabilities: ['resume_read'] as ['resume_read'],
      importsCareerHistory: true as const,
      connectedAt: '2026-08-23T13:00:00.000Z',
      lastImportedAt: '2026-08-23T13:00:00.000Z',
      factCount: 4,
    };
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        text: 'Product Director\nLed a platform team and reduced lead time.',
        source: 'hh',
        sourceReceipt: {
          platform: 'hh',
          accessMode: 'native_session_snapshot',
          sourceUrl: 'https://hh.ru/resume/resume-selected',
          capturedAt: '2026-08-23T12:59:59.000Z',
        },
      });
      return new Response(
        JSON.stringify({
          data: {
            parsed: { rawText: 'Product Director' },
            resume: {},
            structuredBy: 'rules',
            factCount: 4,
            connection,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const imported = await importCandidateResume({
      text: 'Product Director\nLed a platform team and reduced lead time.',
      source: 'hh',
      sourceReceipt: {
        platform: 'hh',
        accessMode: 'native_session_snapshot',
        sourceUrl: 'https://hh.ru/resume/resume-selected',
        capturedAt: '2026-08-23T12:59:59.000Z',
      },
    });

    expect(imported.connection).toEqual(connection);
  });
});
