import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, login } from './authRoutesTestSupport';
import { totpAt } from './totp';

const PASSWORD = 'candidate-password-for-tests';
const ORIGIN = { origin: 'http://localhost:3000' };
const BASE = '/api/v1/account/two-factor';
type App = Awaited<ReturnType<typeof createApp>>;

afterEach(() => vi.useRealTimers());

const clock = (iso: string) => vi.setSystemTime(new Date(iso));
const unixNow = () => Math.floor(Date.now() / 1000);

async function post(app: App, url: string, payload: object, cookie?: string) {
  return app.inject({ method: 'POST', url, payload, headers: { ...ORIGIN, ...(cookie ? { cookie } : {}) } });
}

async function setup(flag = true) {
  vi.useFakeTimers({ toFake: ['Date'] });
  clock('2026-11-19T10:00:00.000Z');
  const app = await createApp(undefined, undefined, undefined, {}, flag ? { cabinetB640Usernames: ['candidate.test'] } : {});
  const { cookie } = await login(app, 'candidate.test', PASSWORD);
  return { app, cookie };
}

async function enable(app: App, cookie: string) {
  const started = await post(app, `${BASE}/setup`, {}, cookie);
  const secret = started.json().data.secret as string;
  const enabled = await post(app, `${BASE}/enable`, { code: totpAt(secret, unixNow()), password: PASSWORD }, cookie);
  clock('2026-11-19T10:01:00.000Z');
  return { secret, backupCodes: enabled.json().data.backupCodes as string[] };
}

describe('B401: двухфакторная защита — маршруты', () => {
  it('login without 2FA is unchanged: session cookie and token at once, no challenge', async () => {
    const { app } = await setup();
    const { response } = await login(app, 'candidate.test', PASSWORD);
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.sessionToken).toMatch(/^oqs_/u);
    expect(data).not.toHaveProperty('twoFactorRequired');
    expect(String(response.headers['set-cookie'])).toMatch(/oq_session=|session/u);
  });

  it('account settings answer 404 without the B640 flag', async () => {
    const { app, cookie } = await setup(false);
    expect((await app.inject({ method: 'GET', url: BASE, headers: { cookie } })).statusCode).toBe(404);
    expect((await post(app, `${BASE}/setup`, {}, cookie)).statusCode).toBe(404);
  });

  it('setup gives a secret and an otpauth link; a wrong code does not enable', async () => {
    const { app, cookie } = await setup();
    const started = (await post(app, `${BASE}/setup`, {}, cookie)).json().data;
    expect(started.otpauthUrl).toMatch(/^otpauth:\/\/totp\//u);
    expect((await post(app, `${BASE}/enable`, { code: '000000', password: PASSWORD }, cookie)).statusCode).toBe(400);
    // Верный код без пароля или с чужим паролем защиту не включает.
    const secret = started.secret as string;
    expect((await post(app, `${BASE}/enable`, { code: totpAt(secret, unixNow()) }, cookie)).statusCode).toBe(400);
    const stranger = await post(app, `${BASE}/enable`, { code: totpAt(secret, unixNow()), password: 'not-the-password' }, cookie);
    expect(stranger.json().error.code).toBe('current_password_invalid');
    expect((await app.inject({ method: 'GET', url: BASE, headers: { cookie } })).json().data).toEqual({ enabled: false, backupCodesLeft: 0 });
  });

  it('with 2FA the password alone gives no session; the code step does, once', async () => {
    const { app, cookie } = await setup();
    const { secret } = await enable(app, cookie);
    const first = await login(app, 'candidate.test', PASSWORD);
    const step = first.response.json().data;
    expect(step).toEqual({ twoFactorRequired: true, challenge: expect.stringMatching(/^oq2_/u) });
    expect(first.response.headers['set-cookie']).toBeUndefined();
    expect((await post(app, '/api/v1/auth/login/two-factor', { challenge: step.challenge, code: '111111' })).statusCode).toBe(400);
    const code = totpAt(secret, unixNow());
    const done = await post(app, '/api/v1/auth/login/two-factor', { challenge: step.challenge, code });
    expect(done.statusCode).toBe(200);
    expect(done.json().data.sessionToken).toMatch(/^oqs_/u);
    // Вызов израсходован, тот же код второй раз не проходит.
    expect((await post(app, '/api/v1/auth/login/two-factor', { challenge: step.challenge, code })).statusCode).toBe(401);
    const again = (await login(app, 'candidate.test', PASSWORD)).response.json().data;
    expect((await post(app, '/api/v1/auth/login/two-factor', { challenge: again.challenge, code })).statusCode).toBe(400);
  });

  it('a backup code signs in once', async () => {
    const { app, cookie } = await setup();
    const { backupCodes } = await enable(app, cookie);
    expect(backupCodes).toHaveLength(8);
    const challenge = () => login(app, 'candidate.test', PASSWORD).then((r) => r.response.json().data.challenge as string);
    expect((await post(app, '/api/v1/auth/login/two-factor', { challenge: await challenge(), code: backupCodes[0] })).statusCode).toBe(200);
    expect((await post(app, '/api/v1/auth/login/two-factor', { challenge: await challenge(), code: backupCodes[0] })).statusCode).toBe(400);
  });

  it('changing the password needs a code when 2FA is on', async () => {
    const { app, cookie } = await setup();
    const { secret } = await enable(app, cookie);
    const change = (extra: object) =>
      post(app, '/api/v1/account/password', { currentPassword: PASSWORD, newPassword: 'another-password-for-tests', ...extra }, cookie);
    expect((await change({})).json().error.code).toBe('two_factor_invalid');
    expect((await change({ twoFactorCode: totpAt(secret, unixNow()) })).statusCode).toBe(200);
  });

  it('disabling and new codes need a current code or the password', async () => {
    const { app, cookie } = await setup();
    const { secret } = await enable(app, cookie);
    expect((await post(app, `${BASE}/backup-codes`, {}, cookie)).statusCode).toBe(400);
    expect((await post(app, `${BASE}/backup-codes`, { password: 'wrong-password' }, cookie)).statusCode).toBe(400);
    const fresh = await post(app, `${BASE}/backup-codes`, { password: PASSWORD }, cookie);
    expect(fresh.json().data.backupCodes).toHaveLength(8);
    expect((await post(app, `${BASE}/disable`, { code: '123456' }, cookie)).statusCode).toBe(400);
    // Отказ не отключает защиту (FastifyReply — thenable: отказ не должен считаться подтверждением).
    expect((await app.inject({ method: 'GET', url: BASE, headers: { cookie } })).json().data.enabled).toBe(true);
    const off = await post(app, `${BASE}/disable`, { code: totpAt(secret, unixNow()) }, cookie);
    expect(off.json().data).toEqual({ enabled: false, backupCodesLeft: 0 });
    expect((await login(app, 'candidate.test', PASSWORD)).response.json().data.sessionToken).toMatch(/^oqs_/u);
  });

  it('five wrong codes at the login step lock it, even with a fresh challenge', async () => {
    const { app, cookie } = await setup();
    const { secret } = await enable(app, cookie);
    const first = (await login(app, 'candidate.test', PASSWORD)).response.json().data.challenge;
    for (let i = 0; i < 5; i += 1) await post(app, '/api/v1/auth/login/two-factor', { challenge: first, code: '999999' });
    // Вызов исчерпан, а новый вход упирается в паузу пользователя.
    expect((await post(app, '/api/v1/auth/login/two-factor', { challenge: first, code: '999999' })).statusCode).toBe(401);
    const challenge = (await login(app, 'candidate.test', PASSWORD)).response.json().data.challenge;
    const locked = await post(app, '/api/v1/auth/login/two-factor', { challenge, code: totpAt(secret, unixNow()) });
    expect(locked.statusCode).toBe(429);
  });
});
