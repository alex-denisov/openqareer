import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, login } from './authRoutesTestSupport';
import { totpAt } from './totp';

// B401: администратор входит в кабинет кандидата своей сессией и своей 2FA,
// код кандидата не спрашивается. Поэтому из такой сессии защиту кандидата
// не включить, не отключить, коды не перевыпустить и пароль не сменить: 403 impersonated_session.

const PASSWORD = 'candidate-password-for-tests';
const ORIGIN = { origin: 'http://localhost:3000' };
const BASE = '/api/v1/account/two-factor';
type App = Awaited<ReturnType<typeof createApp>>;

afterEach(() => vi.useRealTimers());

const post = (app: App, url: string, payload: object, cookie: string) =>
  app.inject({ method: 'POST', url, payload, headers: { ...ORIGIN, cookie } });

async function impersonate(app: App): Promise<string> {
  const { cookie: admin } = await login(app, 'admin.test', 'admin-password-for-tests');
  const users = (await app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: { cookie: admin } })).json().data;
  const list = (Array.isArray(users) ? users : users.users) as Array<{ id: string; username: string }>;
  const candidate = list.find((user) => user.username === 'candidate.test');
  const response = await post(app, `/api/v1/admin/users/${candidate?.id}/impersonate`, {}, admin);
  expect(response.statusCode).toBe(200);
  return String(response.headers['set-cookie']).split(';')[0];
}

const ROUTES = [
  { name: 'setup', url: `${BASE}/setup`, payload: () => ({}) },
  { name: 'enable', url: `${BASE}/enable`, payload: (code: string) => ({ code, password: PASSWORD }) },
  { name: 'disable', url: `${BASE}/disable`, payload: () => ({ password: PASSWORD }) },
  { name: 'backup-codes', url: `${BASE}/backup-codes`, payload: () => ({ password: PASSWORD }) },
  {
    name: 'password',
    url: '/api/v1/account/password',
    payload: (code: string) => ({ currentPassword: PASSWORD, newPassword: 'another-password-123', twoFactorCode: code }),
  },
] as const;

async function prepare() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-19T10:00:00.000Z'));
  const app = await createApp(undefined, undefined, undefined, {}, { cabinetB640Usernames: ['candidate.test'] });
  const { cookie: own } = await login(app, 'candidate.test', PASSWORD);
  const secret = (await post(app, `${BASE}/setup`, {}, own)).json().data.secret as string;
  const enabled = await post(app, `${BASE}/enable`, { code: totpAt(secret, Math.floor(Date.now() / 1000)), password: PASSWORD }, own);
  expect(enabled.statusCode).toBe(200);
  vi.setSystemTime(new Date('2026-11-19T10:01:00.000Z'));
  return { app, own, secret, cookie: await impersonate(app) };
}

describe('B401: 2FA и вход администратора в кабинет кандидата', () => {
  it.each(ROUTES)('$name: refused from an impersonated session, state unchanged', async (route) => {
    const { app, own, secret, cookie } = await prepare();
    const refused = await post(app, route.url, route.payload(totpAt(secret, Math.floor(Date.now() / 1000))), cookie);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('impersonated_session');
    const state = await app.inject({ method: 'GET', url: BASE, headers: { cookie: own } });
    expect(state.json().data).toEqual({ enabled: true, backupCodesLeft: 8 });
    expect((await login(app, 'candidate.test', PASSWORD)).response.json().data.twoFactorRequired).toBe(true);
  });

  it('an impersonated session still reads the state; the candidate keeps full control', async () => {
    const { app, own, cookie } = await prepare();
    const status = await app.inject({ method: 'GET', url: BASE, headers: { cookie } });
    expect(status.json().data).toEqual({ enabled: true, backupCodesLeft: 8 });
    expect((await post(app, `${BASE}/backup-codes`, { password: PASSWORD }, own)).statusCode).toBe(200);
  });
});
