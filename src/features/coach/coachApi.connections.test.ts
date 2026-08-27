import { afterEach, describe, expect, it, vi } from 'vitest';
import { disconnectConnection, getConnections } from './coachApi';

describe('candidate connection API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the candidate-scoped connection catalog without exposing tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              platform: 'linkedin',
              available: true,
              status: 'connected',
              accessMode: 'native_session_snapshot',
              capabilities: ['lite_identity'],
              importsCareerHistory: false,
              connectedAt: '2026-08-10T12:00:00.000Z',
              lastImportedAt: '2026-08-10T12:00:00.000Z',
              factCount: 0,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const connections = await getConnections();

    expect(connections[0]).toMatchObject({
      platform: 'linkedin',
      status: 'connected',
      importsCareerHistory: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/candidate/connections',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('disconnects one platform and reports whether upstream access was revoked', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            platform: 'hh',
            status: 'disconnected',
            localDataRemoved: true,
            upstreamRevocation: 'unsupported',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(disconnectConnection('hh')).resolves.toMatchObject({
      localDataRemoved: true,
      upstreamRevocation: 'unsupported',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/candidate/connections/hh',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' }),
    );
  });
});
