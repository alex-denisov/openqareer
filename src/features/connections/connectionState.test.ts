import { describe, expect, it } from 'vitest';
import { CoachApiError, type CandidateConnection } from '../coach/coachApi';
import {
  accountRequiredNotice,
  applyConnectionDisconnectResult,
  connectionDisconnectNotice,
  connectionStartNotice,
} from './connectionState';

describe('connection start failures', () => {
  it('explains that a connection needs an account instead of reporting a fault', () => {
    expect(
      connectionStartNotice(
        new CoachApiError('Нужна действующая сессия кандидата.', 'unauthorized', false),
        'hh',
      ),
    ).toBe(accountRequiredNotice('hh'));
  });

  it('states plainly that an unconfigured platform is not worked around', () => {
    expect(
      connectionStartNotice(
        new CoachApiError('Не настроено.', 'connector_not_configured', false),
        'linkedin',
      ),
    ).toMatch(/не обходим ограничения/i);
  });

  it('keeps document import available when the platform refuses', () => {
    expect(connectionStartNotice(new Error('offline'), 'linkedin')).toMatch(
      /экспорт|PDF/i,
    );
  });
});

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
});
