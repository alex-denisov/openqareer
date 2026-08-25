import { describe, expect, it } from 'vitest';
import type { CandidateConnection } from '../coach/coachApi';
import {
  connectedProfileSource,
  connectedProfileSourceNotice,
} from './connectedProfileSource';

const disconnected: CandidateConnection = {
  platform: 'linkedin',
  available: true,
  capabilities: ['lite_identity'],
  importsCareerHistory: false,
  status: 'disconnected',
};

function snapshot(
  platform: 'hh' | 'linkedin',
  factCount: number,
): CandidateConnection {
  return {
    platform,
    available: true,
    capabilities: ['resume_read'],
    importsCareerHistory: true,
    status: 'connected',
    accessMode: 'native_session_snapshot',
    connectedAt: '2026-08-24T10:00:00.000Z',
    lastImportedAt: '2026-08-24T10:00:05.000Z',
    factCount,
  };
}

describe('connectedProfileSource', () => {
  it('recognises the session snapshot the account really carries', () => {
    // The only access mode the schema accepts. The wizard used to skip exactly
    // this row, so a connected hh.ru account looked like a blank start (B157).
    const source = connectedProfileSource([disconnected, snapshot('hh', 24)]);

    expect(source).toEqual({
      platform: 'hh',
      factCount: 24,
      lastImportedAt: '2026-08-24T10:00:05.000Z',
    });
  });

  it('finds nothing when no platform is connected', () => {
    expect(connectedProfileSource([disconnected])).toBeUndefined();
    expect(connectedProfileSource([])).toBeUndefined();
  });

  it('refuses to call an empty snapshot an imported source', () => {
    expect(connectedProfileSource([snapshot('linkedin', 0)])).toBeUndefined();
  });

  it('leaves an official-API connection to its own restore path', () => {
    const official: CandidateConnection = {
      platform: 'linkedin',
      available: true,
      capabilities: ['lite_identity'],
      importsCareerHistory: false,
      status: 'connected',
      scopes: ['r_liteprofile'],
      accessTokenExpiresAt: null,
      connectedAt: '2026-08-24T10:00:00.000Z',
      profile: {
        capturedAt: '2026-08-24T10:00:00.000Z',
        sourceUrl: null,
        facts: [
          {
            kind: 'headline',
            value: 'Head of Product',
            sourceLocator: 'linkedin:headline',
            confidence: 'official-api',
          },
        ],
      },
    };

    expect(connectedProfileSource([official])).toBeUndefined();
  });
});

describe('connectedProfileSourceNotice', () => {
  it('counts the facts in Russian and does not ask for a second import', () => {
    expect(
      connectedProfileSourceNotice({
        platform: 'hh',
        factCount: 1,
        lastImportedAt: '2026-08-24T10:00:05.000Z',
      }),
    ).toBe(
      'hh.ru уже подключён: в профиле 1 факт из этого источника. Можно продолжить — повторный импорт не нужен.',
    );
    expect(
      connectedProfileSourceNotice({
        platform: 'linkedin',
        factCount: 3,
        lastImportedAt: '2026-08-24T10:00:05.000Z',
      }),
    ).toContain('3 факта');
    expect(
      connectedProfileSourceNotice({
        platform: 'hh',
        factCount: 11,
        lastImportedAt: '2026-08-24T10:00:05.000Z',
      }),
    ).toContain('11 фактов');
    expect(
      connectedProfileSourceNotice({
        platform: 'hh',
        factCount: 24,
        lastImportedAt: '2026-08-24T10:00:05.000Z',
      }),
    ).toContain('24 факта');
  });
});
