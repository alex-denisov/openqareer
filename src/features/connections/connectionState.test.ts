import { describe, expect, it } from 'vitest';
import { type CandidateConnection } from '../coach/coachApi';
import {
  applyConnectionDisconnectResult,
  connectionDisconnectNotice,
  disconnectAndForgetSession,
} from './connectionState';

describe('connection disconnect result', () => {
  it('keeps the connection active when receipt removal was not confirmed', () => {
    const connections: CandidateConnection[] = [
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
    ];

    expect(
      applyConnectionDisconnectResult(connections, {
        platform: 'hh',
        status: 'disconnected',
        accessMode: 'native_session_snapshot',
        connectionRemoved: false,
        providerSession: 'not_managed',
        importedData: 'retained',
      }),
    ).toEqual(connections);
  });

  it('does not claim disconnection when the server did not remove connection', () => {
    const notice = connectionDisconnectNotice({
      platform: 'linkedin',
      status: 'disconnected',
      accessMode: 'native_session_snapshot',
      connectionRemoved: false,
      providerSession: 'not_managed',
      importedData: 'retained',
    });

    expect(notice).toMatch(/не удалось отключить/i);
    expect(notice).not.toContain('отключён');
    expect(notice).not.toMatch(/данные удалены|снимок.*удал/i);
  });

  it('marks only the disconnected platform and keeps the others untouched', () => {
    const connections: CandidateConnection[] = [
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
      {
        platform: 'linkedin',
        available: true,
        status: 'disconnected',
        capabilities: ['profile_read'],
        importsCareerHistory: false,
      },
    ];

    const updated = applyConnectionDisconnectResult(connections, {
      platform: 'hh',
      status: 'disconnected',
      accessMode: 'native_session_snapshot',
      connectionRemoved: true,
      providerSession: 'not_managed',
      importedData: 'retained',
    });

    expect(updated[0]).toEqual({
      platform: 'hh',
      available: true,
      capabilities: ['resume_read'],
      importsCareerHistory: true,
      status: 'disconnected',
    });
    expect(updated[1]).toBe(connections[1]);
    expect(connections[0].status).toBe('connected');
  });

  it('describes native disconnect without claiming provider revocation or data deletion', () => {
    const result = {
      platform: 'hh' as const,
      status: 'disconnected' as const,
      accessMode: 'native_session_snapshot' as const,
      connectionRemoved: true,
      providerSession: 'not_managed' as const,
      importedData: 'retained' as const,
    };

    const notice = connectionDisconnectNotice(result);

    expect(notice).toContain('Импортированные данные остаются');
    expect(notice).toContain('сессию hh.ru не хранит');
    expect(notice).not.toMatch(/отозван|токены.*удалены/i);
  });

  it('marks a native snapshot disconnected only after its receipt was removed', () => {
    const connected: CandidateConnection = {
      platform: 'hh',
      available: true,
      status: 'connected',
      accessMode: 'native_session_snapshot',
      capabilities: ['resume_read'],
      importsCareerHistory: true,
      connectedAt: '2026-08-24T08:00:00.000Z',
      lastImportedAt: '2026-08-24T08:00:00.000Z',
      factCount: 7,
    };

    expect(
      applyConnectionDisconnectResult([connected], {
        platform: 'hh',
        status: 'disconnected',
        accessMode: 'native_session_snapshot',
        connectionRemoved: true,
        providerSession: 'not_managed',
        importedData: 'retained',
      }),
    ).toEqual([
      {
        platform: 'hh',
        available: true,
        capabilities: ['resume_read'],
        importsCareerHistory: true,
        status: 'disconnected',
      },
    ]);
  });
});

describe('disconnecting forgets the sign-in on this device (B266)', () => {
  const removed = { platform: 'linkedin', connectionRemoved: true } as never;

  it('forgets the platform session in the desktop app after the server disconnect', async () => {
    const calls: string[] = [];
    const outcome = await disconnectAndForgetSession('linkedin', {
      disconnect: async () => {
        calls.push('server');
        return removed;
      },
      forgetDeviceSession: async () => {
        calls.push('device');
        return true;
      },
      isDesktop: true,
    });
    expect(calls).toEqual(['server', 'device']);
    expect(outcome.device).toBe('forgotten');
    expect(connectionDisconnectNotice(outcome.result, outcome.device)).toContain(
      'Вход в LinkedIn на этом устройстве забыт',
    );
  });

  it('says so plainly when the device session could not be cleared', async () => {
    const outcome = await disconnectAndForgetSession('linkedin', {
      disconnect: async () => removed,
      forgetDeviceSession: async () => {
        throw new Error('bridge down');
      },
      isDesktop: true,
    });
    expect(outcome.device).toBe('failed');
    const notice = connectionDisconnectNotice(outcome.result, outcome.device);
    expect(notice).toContain('забыть не удалось');
    expect(notice).not.toContain('не хранит');
  });

  it('does not touch a device session in the browser, where none is kept', async () => {
    let touched = false;
    const outcome = await disconnectAndForgetSession('linkedin', {
      disconnect: async () => removed,
      forgetDeviceSession: async () => {
        touched = true;
        return true;
      },
      isDesktop: false,
    });
    expect(touched).toBe(false);
    expect(outcome.device).toBe('none');
  });
});
