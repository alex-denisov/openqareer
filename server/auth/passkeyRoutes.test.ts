import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, login, resources } from './authRoutesTestSupport';
import { totpAt } from './totp';

vi.mock('@simplewebauthn/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@simplewebauthn/server')>()),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

const PASSWORD = 'candidate-password-for-tests';
const ORIGIN = { origin: 'http://localhost:3000' };
const BASE = '/api/v1/account/passkeys';
const MAC = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
};
type App = Awaited<ReturnType<typeof createApp>>;

const registerVerify = vi.mocked(verifyRegistrationResponse);
const authVerify = vi.mocked(verifyAuthenticationResponse);

const unixNow = () => Math.floor(Date.now() / 1000);
const clock = (iso: string) => vi.setSystemTime(new Date(iso));

const credential = (id: string) => ({
  id,
  rawId: id,
  type: 'public-key' as const,
  clientExtensionResults: {},
  response: {
    clientDataJSON: 'Y2xpZW50',
    attestationObject: 'YXR0ZXN0',
    authenticatorData: 'YXV0aA',
    signature: 'c2ln',
  },
});

function post(app: App, url: string, payload: object, cookie?: string) {
  return app.inject({
    method: 'POST',
    url,
    payload,
    headers: { ...ORIGIN, ...MAC, ...(cookie ? { cookie } : {}) },
  });
}

async function setup() {
  vi.useFakeTimers({ toFake: ['Date'] });
  clock('2026-11-22T10:00:00.000Z');
  const app = await createApp(
    undefined,
    undefined,
    undefined,
    {},
    { cabinetB640Usernames: ['candidate.test'] },
  );
  const { cookie } = await login(app, 'candidate.test', PASSWORD);
  return { app, cookie };
}

function acceptRegistration(id: string, options: { userVerified?: boolean } = {}) {
  registerVerify.mockResolvedValueOnce({
    verified: true,
    registrationInfo: {
      credential: {
        id,
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
        transports: ['internal'],
      },
      credentialBackedUp: true,
      userVerified: options.userVerified ?? true,
    },
  } as never);
}

function acceptAssertion(id: string, newCounter: number, userVerified = true) {
  authVerify.mockResolvedValueOnce({
    verified: true,
    authenticationInfo: { credentialID: id, newCounter, userVerified },
  } as never);
}

async function addKey(
  app: App,
  cookie: string,
  id = 'cred-1',
  proof: object = { password: PASSWORD },
) {
  const options = await post(app, `${BASE}/options`, proof, cookie);
  const { token } = options.json().data;
  acceptRegistration(id);
  return post(app, BASE, { token, response: credential(id) }, cookie);
}

async function signIn(app: App, id = 'cred-1', counter = 1) {
  const { token } = (await post(app, '/api/v1/auth/passkey/options', {})).json().data;
  acceptAssertion(id, counter);
  return post(app, '/api/v1/auth/passkey', { token, response: credential(id) });
}

function rows(app: App, sql: string): unknown[] {
  const resource = resources.find((item) => item.app === app);
  const database = new DatabaseSync(join(resource?.directory ?? '', 'app.db'));
  database.exec('PRAGMA foreign_keys = ON');
  try {
    return database.prepare(sql).all();
  } finally {
    database.close();
  }
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());

describe('B755: ключи доступа — добавление', () => {
  it('options need a session, the B640 flag and the password', async () => {
    const { app, cookie } = await setup();
    expect((await post(app, `${BASE}/options`, { password: PASSWORD })).statusCode).toBe(404);
    expect((await post(app, `${BASE}/options`, {}, cookie)).statusCode).toBe(400);
    const wrong = await post(app, `${BASE}/options`, { password: 'not-the-password' }, cookie);
    expect(wrong.json().error.code).toBe('current_password_invalid');
    const ok = (await post(app, `${BASE}/options`, { password: PASSWORD }, cookie)).json().data;
    expect(ok.token).toMatch(/^oqp_/u);
    expect(ok.options.rp.id).toBe('localhost');
    expect(ok.options.authenticatorSelection).toMatchObject({
      residentKey: 'required',
      userVerification: 'required',
    });
  });

  it('with 2FA on the options also need a current code', async () => {
    const { app, cookie } = await setup();
    const secret = (await post(app, '/api/v1/account/two-factor/setup', {}, cookie)).json().data
      .secret as string;
    await post(
      app,
      '/api/v1/account/two-factor/enable',
      { code: totpAt(secret, unixNow()), password: PASSWORD },
      cookie,
    );
    clock('2026-11-22T10:01:00.000Z');
    expect(
      (await post(app, `${BASE}/options`, { password: PASSWORD }, cookie)).json().error.code,
    ).toBe('two_factor_invalid');
    expect(
      (await post(app, `${BASE}/options`, { password: PASSWORD, code: '000000' }, cookie))
        .statusCode,
    ).toBe(400);
    const done = await post(
      app,
      `${BASE}/options`,
      { password: PASSWORD, code: totpAt(secret, unixNow()) },
      cookie,
    );
    expect(done.statusCode).toBe(200);
  });

  it('registration stores the key with the device label and lists it without keys', async () => {
    const { app, cookie } = await setup();
    expect((await addKey(app, cookie)).statusCode).toBe(200);
    const listed = (await app.inject({ method: 'GET', url: BASE, headers: { cookie } })).json().data
      .passkeys;
    expect(listed).toEqual([
      {
        id: expect.any(String),
        deviceLabel: 'MacBook · Safari',
        createdAt: expect.any(String),
        lastUsedAt: null,
      },
    ]);
    expect(registerVerify.mock.calls[0]?.[0]).toMatchObject({
      requireUserVerification: true,
      expectedRPID: 'localhost',
    });
  });

  it('a key without user verification is not stored', async () => {
    const { app, cookie } = await setup();
    const { token } = (await post(app, `${BASE}/options`, { password: PASSWORD }, cookie)).json()
      .data;
    acceptRegistration('cred-1', { userVerified: false });
    const response = await post(app, BASE, { token, response: credential('cred-1') }, cookie);
    expect(response.statusCode).toBe(400);
    expect(rows(app, 'SELECT id FROM user_passkeys')).toEqual([]);
  });

  it('a registration challenge works once and not for another token', async () => {
    const { app, cookie } = await setup();
    const { token } = (await post(app, `${BASE}/options`, { password: PASSWORD }, cookie)).json()
      .data;
    acceptRegistration('cred-1');
    expect(
      (await post(app, BASE, { token, response: credential('cred-1') }, cookie)).statusCode,
    ).toBe(200);
    acceptRegistration('cred-2');
    const again = await post(app, BASE, { token, response: credential('cred-2') }, cookie);
    expect(again.json().error.code).toBe('passkey_challenge_expired');
    expect(rows(app, 'SELECT id FROM user_passkeys')).toHaveLength(1);
  });

  it('an expired registration challenge is rejected', async () => {
    const { app, cookie } = await setup();
    const { token } = (await post(app, `${BASE}/options`, { password: PASSWORD }, cookie)).json()
      .data;
    clock('2026-11-22T10:06:00.000Z');
    acceptRegistration('cred-1');
    const late = await post(app, BASE, { token, response: credential('cred-1') }, cookie);
    expect(late.json().error.code).toBe('passkey_challenge_expired');
  });

  it('a failed verification stores nothing', async () => {
    const { app, cookie } = await setup();
    const { token } = (await post(app, `${BASE}/options`, { password: PASSWORD }, cookie)).json()
      .data;
    registerVerify.mockRejectedValueOnce(new Error('bad attestation'));
    expect(
      (await post(app, BASE, { token, response: credential('cred-1') }, cookie)).statusCode,
    ).toBe(400);
    expect(rows(app, 'SELECT id FROM user_passkeys')).toEqual([]);
  });
});

describe('B755: вход ключом', () => {
  it('options are public, discoverable and require user verification', async () => {
    const { app } = await setup();
    const data = (await post(app, '/api/v1/auth/passkey/options', {})).json().data;
    expect(data.options.userVerification).toBe('required');
    expect(data.options.allowCredentials ?? []).toEqual([]);
    expect(rows(app, 'SELECT user_id, purpose FROM passkey_challenges')).toEqual([
      { user_id: null, purpose: 'login' },
    ]);
  });

  it('a valid assertion starts a session, updates the counter and skips 2FA even when it is on', async () => {
    const { app, cookie } = await setup();
    await addKey(app, cookie);
    const secret = (await post(app, '/api/v1/account/two-factor/setup', {}, cookie)).json().data
      .secret as string;
    await post(
      app,
      '/api/v1/account/two-factor/enable',
      { code: totpAt(secret, unixNow()), password: PASSWORD },
      cookie,
    );
    clock('2026-11-22T10:01:00.000Z');
    const response = await signIn(app, 'cred-1', 5);
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      username: 'candidate.test',
      sessionToken: expect.stringMatching(/^oqs_/u),
    });
    expect(response.json().data).not.toHaveProperty('twoFactorRequired');
    expect(String(response.headers['set-cookie'])).toMatch(/session/u);
    expect(authVerify.mock.calls[0]?.[0]).toMatchObject({ requireUserVerification: true });
    expect(rows(app, 'SELECT sign_count, last_used_at FROM user_passkeys')).toEqual([
      { sign_count: 5, last_used_at: '2026-11-22T10:01:00.000Z' },
    ]);
  });

  it('a reused challenge is rejected', async () => {
    const { app, cookie } = await setup();
    await addKey(app, cookie);
    const { token } = (await post(app, '/api/v1/auth/passkey/options', {})).json().data;
    acceptAssertion('cred-1', 1);
    expect(
      (await post(app, '/api/v1/auth/passkey', { token, response: credential('cred-1') }))
        .statusCode,
    ).toBe(200);
    acceptAssertion('cred-1', 2);
    expect(
      (await post(app, '/api/v1/auth/passkey', { token, response: credential('cred-1') }))
        .statusCode,
    ).toBe(401);
  });

  it('an expired challenge is rejected', async () => {
    const { app, cookie } = await setup();
    await addKey(app, cookie);
    const { token } = (await post(app, '/api/v1/auth/passkey/options', {})).json().data;
    clock('2026-11-22T10:06:00.000Z');
    acceptAssertion('cred-1', 1);
    expect(
      (await post(app, '/api/v1/auth/passkey', { token, response: credential('cred-1') }))
        .statusCode,
    ).toBe(401);
  });

  it('an unknown credential and a bad signature answer the same 401', async () => {
    const { app, cookie } = await setup();
    await addKey(app, cookie);
    const first = (await post(app, '/api/v1/auth/passkey/options', {})).json().data.token;
    const unknown = await post(app, '/api/v1/auth/passkey', {
      token: first,
      response: credential('no-such-key'),
    });
    const second = (await post(app, '/api/v1/auth/passkey/options', {})).json().data.token;
    authVerify.mockRejectedValueOnce(new Error('signature mismatch'));
    const bad = await post(app, '/api/v1/auth/passkey', {
      token: second,
      response: credential('cred-1'),
    });
    expect([unknown.statusCode, bad.statusCode]).toEqual([401, 401]);
    const shape = (body: { error: { code: string; message: string } }) => [
      body.error.code,
      body.error.message,
    ];
    expect(shape(unknown.json())).toEqual(shape(bad.json()));
    expect(unknown.headers['set-cookie']).toBeUndefined();
  });

  it('a key that did not verify the user never signs in', async () => {
    const { app, cookie } = await setup();
    await addKey(app, cookie);
    const { token } = (await post(app, '/api/v1/auth/passkey/options', {})).json().data;
    acceptAssertion('cred-1', 1, false);
    const response = await post(app, '/api/v1/auth/passkey', {
      token,
      response: credential('cred-1'),
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('a counter going backwards is rejected, 0 and 0 is allowed', async () => {
    const { app, cookie } = await setup();
    await addKey(app, cookie);
    expect((await signIn(app, 'cred-1', 7)).statusCode).toBe(200);
    expect((await signIn(app, 'cred-1', 7)).statusCode).toBe(401);
    expect((await signIn(app, 'cred-1', 3)).statusCode).toBe(401);
    expect((await signIn(app, 'cred-1', 8)).statusCode).toBe(200);
    await addKey(app, cookie, 'cred-2');
    expect((await signIn(app, 'cred-2', 0)).statusCode).toBe(200);
  });

  it('a login challenge cannot be used for registration and the other way round', async () => {
    const { app, cookie } = await setup();
    const { token } = (await post(app, '/api/v1/auth/passkey/options', {})).json().data;
    acceptRegistration('cred-1');
    expect(
      (await post(app, BASE, { token, response: credential('cred-1') }, cookie)).statusCode,
    ).toBe(400);
    expect(rows(app, 'SELECT id FROM user_passkeys')).toEqual([]);
  });
});

describe('B755: удаление ключа', () => {
  it('needs the password and removes only the own key', async () => {
    const { app, cookie } = await setup();
    await addKey(app, cookie);
    const id = (await app.inject({ method: 'GET', url: BASE, headers: { cookie } })).json().data
      .passkeys[0].id as string;
    const remove = (key: string, payload: object) =>
      app.inject({
        method: 'DELETE',
        url: `${BASE}/${key}`,
        payload,
        headers: { ...ORIGIN, cookie },
      });
    expect((await remove(id, {})).statusCode).toBe(400);
    expect(rows(app, 'SELECT id FROM user_passkeys')).toHaveLength(1);
    expect(
      (await remove('11111111-1111-4111-8111-111111111111', { password: PASSWORD })).statusCode,
    ).toBe(404);
    expect((await remove(id, { password: PASSWORD })).statusCode).toBe(200);
    expect(rows(app, 'SELECT id FROM user_passkeys')).toEqual([]);
  });

  it("another user's key answers 404 and stays", async () => {
    const { app, cookie } = await setup();
    await addKey(app, cookie);
    const id = (rows(app, 'SELECT id FROM user_passkeys')[0] as { id: string }).id;
    const database = new DatabaseSync(
      join(resources.find((item) => item.app === app)?.directory ?? '', 'app.db'),
    );
    const admin = database.prepare("SELECT id FROM users WHERE username = 'admin.test'").get() as {
      id: string;
    };
    database.prepare('UPDATE user_passkeys SET user_id = ? WHERE id = ?').run(admin.id, id);
    database.close();
    const response = await app.inject({
      method: 'DELETE',
      url: `${BASE}/${id}`,
      payload: { password: PASSWORD },
      headers: { ...ORIGIN, cookie },
    });
    expect(response.statusCode).toBe(404);
    expect(rows(app, 'SELECT id FROM user_passkeys')).toHaveLength(1);
  });

  it('deleting the user removes the keys and challenges', async () => {
    const { app, cookie } = await setup();
    await addKey(app, cookie);
    await post(app, `${BASE}/options`, { password: PASSWORD }, cookie);
    expect(rows(app, 'SELECT token_hash FROM passkey_challenges')).toHaveLength(1);
    rows(app, "DELETE FROM users WHERE username = 'candidate.test'");
    expect(rows(app, 'SELECT id FROM user_passkeys')).toEqual([]);
    expect(rows(app, 'SELECT token_hash FROM passkey_challenges')).toEqual([]);
  });
});
