import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { challengeOf } from './appCodeStore';
import type { AppSignInDelivery } from './authTypes';
import { createApp, login, resources } from './authRoutesTestSupport';

const PASSWORD = 'candidate-password-for-tests';
const SITE = 'http://localhost:3000';
const VERIFIER = 'a'.repeat(20) + 'B'.repeat(23);
const CHALLENGE = challengeOf(VERIFIER);
type App = Awaited<ReturnType<typeof createApp>>;

afterEach(async () => {
  vi.useRealTimers();
  for (const item of resources.splice(0)) {
    await item.app.close();
    item.auth.close();
    item.candidates.close();
  }
});

async function setup(flagged = true) {
  const sent: AppSignInDelivery[] = [];
  const app = await createApp(
    undefined,
    undefined,
    undefined,
    { onAppSignIn: async (input) => void sent.push(input) },
    { cabinetB640Usernames: flagged ? ['candidate.test'] : [] },
  );
  const { cookie } = await login(app, 'candidate.test', PASSWORD);
  const database = new DatabaseSync(join(resources.at(-1)!.directory, 'app.db'));
  database
    .prepare('UPDATE users SET email = ? WHERE username = ?')
    .run('candidate@example.test', 'candidate.test');
  database.close();
  return { app, cookie, sent };
}

function issue(app: App, headers: Record<string, string>, challenge = CHALLENGE) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/app-code',
    headers,
    payload: { challenge },
  });
}

function exchange(app: App, code: string, verifier = VERIFIER) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/app-code/exchange',
    // Приложение шлёт свой id устройства (apiClient): сессия видна в списке отдельной строкой.
    headers: {
      origin: 'tauri://localhost',
      'x-openqareer-device-id': '6f1c7c2e-3b8a-4c1e-9d55-2a7b0e4f9a11',
    },
    payload: { code, verifier },
  });
}

describe('B755: вход в приложение через системный лист', () => {
  it('сайт выдаёт код, приложение меняет его на свою сессию; второй раз код не работает', async () => {
    const { app, cookie, sent } = await setup();
    const issued = await issue(app, { origin: SITE, cookie });
    expect(issued.statusCode).toBe(200);
    const code = issued.json().data.code as string;
    expect(code).toMatch(/^oqa_[A-Za-z0-9_-]{43}$/u);

    const first = await exchange(app, code);
    expect(first.statusCode).toBe(200);
    const token = first.json().data.sessionToken as string;
    expect(first.headers['set-cookie']).toBeUndefined();
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.json().data.username).toBe('candidate.test');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      email: 'candidate@example.test',
      deviceLabel: 'Приложение openqareer · Mac',
    });

    expect((await exchange(app, code)).statusCode).toBe(400);
  });

  it('сессия приложения видна в списке устройств как «Приложение openqareer · Mac» и завершается', async () => {
    const { app, cookie } = await setup();
    const code = (await issue(app, { origin: SITE, cookie })).json().data.code as string;
    const token = (await exchange(app, code)).json().data.sessionToken as string;
    const sessions = await app.inject({
      method: 'GET',
      url: '/api/v1/account',
      headers: { origin: SITE, cookie },
    });
    const listed = sessions.json().data.sessions as Array<{
      id: string;
      deviceLabel: string | null;
    }>;
    const appSession = listed.find((item) => item.deviceLabel === 'Приложение openqareer · Mac');
    expect(appSession).toBeDefined();
    const ended = await app.inject({
      method: 'DELETE',
      url: `/api/v1/account/sessions/${appSession!.id}`,
      headers: { origin: SITE, cookie },
    });
    expect(ended.statusCode).toBe(204);
    const account = await app.inject({
      method: 'GET',
      url: '/api/v1/account',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(account.statusCode).toBe(401);
  });

  it('без verifier приложения код бесполезен и сгорает', async () => {
    const { app, cookie } = await setup();
    const code = (await issue(app, { origin: SITE, cookie })).json().data.code as string;
    expect((await exchange(app, code, 'z'.repeat(43))).statusCode).toBe(400);
    expect((await exchange(app, code)).statusCode).toBe(400);
  });

  it('через минуту код недействителен', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-23T01:00:00.000Z'));
    const { app, cookie } = await setup();
    const code = (await issue(app, { origin: SITE, cookie })).json().data.code as string;
    vi.setSystemTime(new Date('2026-11-23T01:01:00.000Z'));
    expect((await exchange(app, code)).statusCode).toBe(400);
  });

  it('код выдаёт только cookie сайта: Bearer, чужой адрес и приложение получают отказ', async () => {
    const { app, cookie } = await setup();
    const code = (await issue(app, { origin: SITE, cookie })).json().data.code as string;
    const token = (await exchange(app, code)).json().data.sessionToken as string;
    const bearer = await issue(app, { origin: SITE, authorization: `Bearer ${token}` });
    expect(bearer.statusCode).toBe(403);
    expect((await issue(app, { origin: 'https://evil.example', cookie })).statusCode).toBe(403);
    expect((await issue(app, { origin: 'tauri://localhost', cookie })).statusCode).toBe(403);
    expect((await issue(app, { cookie })).statusCode).toBe(403);
    expect((await issue(app, { origin: SITE })).statusCode).toBe(401);
  });

  it('неверный challenge и пользователь без нового кабинета кода не получают', async () => {
    const flagged = await setup();
    const bad = await issue(flagged.app, { origin: SITE, cookie: flagged.cookie }, 'short');
    expect(bad.statusCode).toBe(400);
    const plain = await setup(false);
    expect((await issue(plain.app, { origin: SITE, cookie: plain.cookie })).statusCode).toBe(400);
  });

  it('сессия администратора «от имени» кандидата код для приложения не получает', async () => {
    const { app } = await setup();
    const { cookie: admin } = await login(app, 'admin.test', 'admin-password-for-tests');
    const users = (
      await app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: { cookie: admin } })
    ).json().data;
    const list = (Array.isArray(users) ? users : users.users) as Array<{
      id: string;
      username: string;
    }>;
    const candidate = list.find((user) => user.username === 'candidate.test');
    const started = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/users/${candidate?.id}/impersonate`,
      payload: {},
      headers: { origin: SITE, cookie: admin },
    });
    expect(started.statusCode).toBe(200);
    const cookie = String(started.headers['set-cookie']).split(';')[0]!;
    const refused = await issue(app, { origin: SITE, cookie });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('impersonated_session');
  });

  it('обмен ограничен по числу попыток', async () => {
    const { app } = await setup();
    const codes = Array.from({ length: 11 }, () => `oqa_${'x'.repeat(43)}`);
    const statuses = [];
    for (const code of codes) statuses.push((await exchange(app, code)).statusCode);
    expect(statuses.slice(0, 10).every((status) => status === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
