import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LEGAL_PACK_VERSION_ID } from '../../shared/legalRegistry';
import { createApp, login } from './authRoutesTestSupport';

describe('account auth routes', () => {
  it('revokes one other device session and keeps the requesting session active', async () => {
    const app = await createApp();
    const older = await loginOnDevice(app);
    const current = await loginOnDevice(app);
    const account = await app.inject({
      method: 'GET',
      url: '/api/v1/account',
      headers: { cookie: current.cookie },
    });
    const target = account.json().data.sessions.find((session: { current: boolean }) => !session.current);
    expect(target).toBeDefined();

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/v1/account/sessions/${target.id}`,
      headers: {
        cookie: current.cookie,
        origin: 'http://localhost:3000',
      },
    });

    expect(revoked.statusCode).toBe(204);
    const oldMe = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: older.cookie },
    });
    const currentMe = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: current.cookie },
    });
    expect(oldMe.json().data).toBeNull();
    expect(currentMe.json().data).toMatchObject({ role: 'candidate' });
  });

  it('rejects revoking the current device and requires a safe origin and valid id', async () => {
    const app = await createApp();
    const current = await loginOnDevice(app);
    const account = await app.inject({
      method: 'GET',
      url: '/api/v1/account',
      headers: { cookie: current.cookie },
    });
    const session = account.json().data.sessions.find((value: { current: boolean }) => value.current);

    const currentSession = await app.inject({
      method: 'DELETE',
      url: `/api/v1/account/sessions/${session.id}`,
      headers: {
        cookie: current.cookie,
        origin: 'http://localhost:3000',
      },
    });
    const csrf = await app.inject({
      method: 'DELETE',
      url: '/api/v1/account/sessions/0123456789abcdef',
      headers: { cookie: current.cookie },
    });
    const invalid = await app.inject({
      method: 'DELETE',
      url: '/api/v1/account/sessions/not-a-session',
      headers: {
        cookie: current.cookie,
        origin: 'http://localhost:3000',
      },
    });

    expect(currentSession.statusCode).toBe(409);
    expect(currentSession.json().error.code).toBe('current_session_cannot_be_revoked');
    expect(csrf.statusCode).toBe(403);
    expect(invalid.statusCode).toBe(400);
    expect((await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: current.cookie },
    })).json().data).toMatchObject({ role: 'candidate' });
  });

  it('changes a verified email only after the new address code is confirmed', async () => {
    const deliveries: Array<{ email: string; code: string }> = [];
    const app = await createApp(undefined, undefined, undefined, {
      emailVerificationRequired: true,
      emailVerificationHashKey: Buffer.alloc(32, 13),
      emailVerificationFixedCode: '123456',
      emailMxCheckBypassDomains: ['example.test'],
      onEmailVerification: async (delivery) => {
        deliveries.push({ email: delivery.email, code: delivery.code });
      },
    });
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin: 'http://localhost:3000' },
      payload: {
        email: 'candidate@example.test',
        displayName: 'Candidate Test',
        password: 'candidate-password-for-tests',
        legalConsent: { versionId: LEGAL_PACK_VERSION_ID },
      },
    });
    expect(registered.statusCode).toBe(201);
    let cookie = String(registered.headers['set-cookie']).split(';')[0];
    const verified = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/email-verification/verify',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { code: deliveries[0]!.code },
    });
    expect(verified.statusCode).toBe(200);
    cookie = String(verified.headers['set-cookie']).split(';')[0];

    const requested = await app.inject({
      method: 'POST',
      url: '/api/v1/account/email-change-requests',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: {
        email: 'new-address@example.test',
        currentPassword: 'candidate-password-for-tests',
      },
    });
    expect(requested.statusCode).toBe(202);
    expect(requested.json().data).toMatchObject({
      status: 'pending',
      email: 'new-address@example.test',
    });
    expect((await app.inject({
      method: 'GET',
      url: '/api/v1/account',
      headers: { cookie },
    })).json().data.email).toBe('candidate@example.test');

    const pending = await app.inject({
      method: 'GET',
      url: '/api/v1/account/email-change-requests/current',
      headers: { cookie },
    });
    expect(pending.statusCode).toBe(200);
    expect(pending.json().data.email).toBe('new-address@example.test');
    expect(deliveries.at(-1)?.email).toBe('new-address@example.test');

    const wrongCode = await app.inject({
      method: 'POST',
      url: '/api/v1/account/email-change-requests/current/verification',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { code: '000000' },
    });
    expect(wrongCode.statusCode).toBe(422);
    expect(wrongCode.json().error.code).toBe('email_verification_invalid');
    expect((await app.inject({
      method: 'GET',
      url: '/api/v1/account',
      headers: { cookie },
    })).json().data.email).toBe('candidate@example.test');

    const confirmed = await app.inject({
      method: 'POST',
      url: '/api/v1/account/email-change-requests/current/verification',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { code: deliveries.at(-1)!.code },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().data).toMatchObject({
      email: 'new-address@example.test',
      emailVerified: true,
    });
    expect(confirmed.json().data.sessionToken).toBeUndefined();
    expect(confirmed.headers['set-cookie']).toBeDefined();
    expect((await app.inject({
      method: 'GET',
      url: '/api/v1/account',
      headers: { cookie },
    })).json().data.email).toBe('new-address@example.test');
  });

  it('allows password-confirmed direct address changes when email verification is disabled', async () => {
    const app = await createApp();
    const current = await login(app, 'candidate.test', 'candidate-password-for-tests');
    const changed = await app.inject({
      method: 'POST',
      url: '/api/v1/account/email-change-requests',
      headers: { cookie: current.cookie, origin: 'http://localhost:3000' },
      payload: {
        email: 'new-candidate@example.test',
        currentPassword: 'candidate-password-for-tests',
      },
    });

    expect(changed.statusCode).toBe(200);
    expect(changed.json().data).toMatchObject({
      status: 'updated',
      email: 'new-candidate@example.test',
    });
    expect(changed.json().data.sessionToken).toBeUndefined();
    expect((await app.inject({
      method: 'GET',
      url: '/api/v1/account',
      headers: { cookie: current.cookie },
    })).json().data.email).toBe('new-candidate@example.test');
  });
});

async function loginOnDevice(app: Awaited<ReturnType<typeof createApp>>) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: {
      origin: 'http://localhost:3000',
      'x-openqareer-device-id': randomUUID(),
    },
    payload: {
      username: 'candidate.test',
      password: 'candidate-password-for-tests',
    },
  });
  return { response, cookie: String(response.headers['set-cookie']).split(';')[0] };
}
