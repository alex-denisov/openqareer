import { describe, expect, it } from 'vitest';
import { type CandidateConnection } from '../coach/coachApi';
import {
  applyConnectionDisconnectResult,
  connectionDisconnectNotice,
} from './connectionState';

describe('connection disconnect result', () => {
  it('keeps the connection active when local deletion was not confirmed', () => {
    const connections: CandidateConnection[] = [
      {
        platform: 'linkedin' as const,
        available: true,
        status: 'connected' as const,
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
    ];

    expect(
      applyConnectionDisconnectResult(connections, {
        platform: 'linkedin',
        status: 'disconnected',
        localDataRemoved: false,
        upstreamRevocation: 'unsupported',
      }),
    ).toEqual(connections);
  });

  it('does not claim local deletion when the server did not remove local data', () => {
    const notice = connectionDisconnectNotice({
      platform: 'linkedin',
      status: 'disconnected',
      localDataRemoved: false,
      upstreamRevocation: 'unsupported',
    });

    expect(notice).toMatch(/не удалось удалить|не подтверждено/i);
    expect(notice).not.toMatch(/данные удалены|токены и снимок профиля удалены/i);
  });

  it('does not claim that unsupported upstream revocation happened', () => {
    expect(
      connectionDisconnectNotice({
        platform: 'linkedin',
        status: 'disconnected',
        localDataRemoved: true,
        upstreamRevocation: 'unsupported',
      }),
    ).toContain('удалены из OpenQareer');
    expect(
      connectionDisconnectNotice({
        platform: 'linkedin',
        status: 'disconnected',
        localDataRemoved: true,
        upstreamRevocation: 'unsupported',
      }),
    ).toContain('проверьте доступы в LinkedIn');
  });

  it('reports a confirmed upstream revocation and a failed one differently', () => {
    expect(
      connectionDisconnectNotice({
        platform: 'hh',
        status: 'disconnected',
        localDataRemoved: true,
        upstreamRevocation: 'revoked',
      }),
    ).toContain('доступ на площадке отозван');
    expect(
      connectionDisconnectNotice({
        platform: 'hh',
        status: 'disconnected',
        localDataRemoved: true,
        upstreamRevocation: 'failed',
      }),
    ).toMatch(/не подтвердила отзыв доступа/i);
  });

  it('marks only the disconnected platform and keeps the others untouched', () => {
    const connections: CandidateConnection[] = [
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
      {
        platform: 'hh',
        available: true,
        status: 'disconnected',
        capabilities: ['profile_read'],
        importsCareerHistory: true,
      },
    ];

    const updated = applyConnectionDisconnectResult(connections, {
      platform: 'linkedin',
      status: 'disconnected',
      localDataRemoved: true,
      upstreamRevocation: 'revoked',
    });

    expect(updated[0]).toEqual({
      platform: 'linkedin',
      available: true,
      capabilities: ['lite_identity'],
      importsCareerHistory: false,
      status: 'disconnected',
    });
    expect(updated[1]).toBe(connections[1]);
    expect(connections[0].status).toBe('connected');
  });
});
