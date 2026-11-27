import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { config as baseConfig, noSessions } from '../appTestHarness';
import type { SessionAuth } from '../auth/authService';
import type { AuthPrincipal } from '../auth/authTypes';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';

type App = Awaited<ReturnType<typeof buildApp>>;
const cleanups: Array<() => Promise<void> | void> = [];
const ORIGIN = 'http://localhost:3000';
const STATUS = '/api/v1/candidate/status';

afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'oq-status-'));
  const config = {
    ...baseConfig,
    databasePath: join(directory, 'test.sqlite'),
    cabinetB640Usernames: ['flagged.test'],
  };
  const candidateStore = new SqliteCandidateStore({
    databasePath: config.databasePath,
    encryptionKey: config.dataEncryptionKey,
  });
  const principal = (username: string): AuthPrincipal => ({
    userId: `user-${username}`,
    username,
    email: null,
    displayName: null,
    role: 'candidate',
    isTest: true,
    candidate: candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' }),
  });
  const sessions = new Map([
    ['token-flagged', principal('flagged.test')],
    ['token-plain', principal('plain.test')],
  ]);
  const authService: SessionAuth = {
    ...noSessions,
    authenticate: (token: string) => sessions.get(token) ?? null,
  };
  const app = await buildApp({ config, candidateStore, authService, coachProvider: {} as never, serveStatic: false });
  cleanups.push(
    () => rmSync(directory, { recursive: true, force: true }),
    () => candidateStore.close(),
    () => app.close(),
  );
  return app;
}

function call(app: App, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, token?: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin: ORIGIN },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

const flagged = 'token-flagged';
const plain = 'token-plain';

async function pausedUntil(app: App, token: string): Promise<string | null> {
  const response = await call(app, 'GET', '/api/v1/candidate/automation', token);
  return response.json().data.settings.pausedUntil ?? null;
}

async function profileHistory(app: App, token: string) {
  const response = await call(app, 'GET', '/api/v1/candidate/profile/history', token);
  return response.json().data.entries as Array<Record<string, unknown>>;
}

const NEW_ROUTES: ReadonlyArray<['GET' | 'POST' | 'PUT', string, unknown?]> = [
  ['GET', STATUS],
  ['POST', `${STATUS}/preview`, { status: 'working' }],
  ['PUT', STATUS, { status: 'working' }],
  ['POST', `${STATUS}/revert`],
  ['GET', `${STATUS}/today`],
];

describe('candidate status routes without the B640 flag', () => {
  it('answers like a missing address and writes nothing', async () => {
    const app = await setup();
    const missing = await call(app, 'GET', '/api/v1/candidate/no-such-route', plain);
    for (const [method, url, payload] of NEW_ROUTES) {
      for (const token of [plain, undefined]) {
        const response = await call(app, method, url, token, payload);
        expect(response.statusCode, `${method} ${url}`).toBe(404);
        expect(response.json().error.code).toBe(missing.json().error.code);
      }
    }
    expect(await pausedUntil(app, plain)).toBeNull();
    expect(await profileHistory(app, plain)).toEqual([]);
  });

  it('leaves the old pause, Today and history routes working as before', async () => {
    const app = await setup();
    const todayBefore = await call(app, 'GET', '/api/v1/candidate/today?tz=Europe/Moscow', plain);
    const todayFlagged = await call(app, 'GET', '/api/v1/candidate/today?tz=Europe/Moscow', flagged);
    expect(todayBefore.statusCode).toBe(200);
    expect(Object.keys(todayFlagged.json().data)).toEqual(Object.keys(todayBefore.json().data));
    const pause = await call(app, 'POST', '/api/v1/candidate/automation/pause', plain, { days: 3 });
    expect(pause.statusCode).toBe(200);
    expect(await pausedUntil(app, plain)).toBe(pause.json().data.settings.pausedUntil);
    const resume = await call(app, 'DELETE', '/api/v1/candidate/automation/pause', plain);
    expect(resume.statusCode).toBe(200);
    expect(await pausedUntil(app, plain)).toBeNull();
  });
});

describe('candidate status routes with the B640 flag', () => {
  it('starts as «Ищу работу», not chosen, with five statuses', async () => {
    const app = await setup();
    const response = await call(app, 'GET', STATUS, flagged);
    expect(response.statusCode).toBe(200);
    const { current, statuses, history, revert } = response.json().data;
    expect(current).toMatchObject({ status: 'job_search', label: 'Ищу работу', chosen: false, since: null });
    expect(statuses.map((item: { label: string }) => item.label)).toEqual([
      'Присматриваюсь', 'Ищу работу', 'Ищу, кем работать', 'Меняю профессию', 'Работаю',
    ]);
    expect(history).toEqual([]);
    expect(revert).toBeNull();
  });

  it('previews what will change without saving', async () => {
    const app = await setup();
    const response = await call(app, 'POST', `${STATUS}/preview`, flagged, { status: 'working' });
    expect(response.statusCode).toBe(200);
    const { preview } = response.json().data;
    expect(preview).toMatchObject({ from: 'job_search', to: 'working', title: 'Работаю', unchanged: false });
    expect(preview.appears.length).toBeGreaterThan(0);
    expect(preview.leaves.length).toBeGreaterThan(0);
    expect(preview.stays.length).toBeGreaterThan(0);
    expect(preview.options).toEqual([
      { key: 'pauseAutoApply', label: 'Поставить автоотклики на паузу', checked: true },
      { key: 'weeklySelection', label: 'Подборку в своей роли — раз в неделю', checked: false },
    ]);
    expect((await call(app, 'GET', STATUS, flagged)).json().data.current.chosen).toBe(false);
    expect(await pausedUntil(app, flagged)).toBeNull();
  });

  it('rejects an unknown status and a foreign origin', async () => {
    const app = await setup();
    expect((await call(app, 'PUT', STATUS, flagged, { status: 'retired' })).statusCode).toBe(400);
    expect((await call(app, 'POST', `${STATUS}/preview`, flagged, {})).statusCode).toBe(400);
    const foreign = await app.inject({
      method: 'PUT',
      url: STATUS,
      headers: { cookie: `openqareer_session=${flagged}`, origin: 'http://malicious.example' },
      payload: { status: 'working' },
    });
    expect(foreign.statusCode).toBe(403);
    expect((await call(app, 'GET', STATUS, flagged)).json().data.current.chosen).toBe(false);
  });

  it('saves «Работаю», pauses auto-applies and writes the change history', async () => {
    const app = await setup();
    const response = await call(app, 'PUT', STATUS, flagged, { status: 'working' });
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.current).toMatchObject({ status: 'working', title: 'Работаю', chosen: true });
    expect(data.applied).toEqual({ pauseAutoApply: true });
    expect(data.history).toHaveLength(1);
    expect(data.revert).toMatchObject({ previousStatus: 'job_search', previousTitle: 'Ищу работу' });
    expect(await pausedUntil(app, flagged)).not.toBeNull();
    expect(await pausedUntil(app, plain)).toBeNull();
    const [entry] = await profileHistory(app, flagged);
    expect(entry).toMatchObject({
      section: 'status', label: 'Статус', previousText: 'Ищу работу', appliedText: 'Работаю', actor: 'candidate', revertedAt: null,
    });
  });

  it('B779: «Подборку раз в неделю» сохраняет отметка при смене статуса', async () => {
    const app = await setup();
    const saved = await call(app, 'PUT', STATUS, flagged, {
      status: 'working',
      options: { weeklySelection: true },
    });
    expect(saved.statusCode).toBe(200);
    const preview = await call(app, 'POST', `${STATUS}/preview`, flagged, { status: 'looking' });
    const weekly = preview
      .json()
      .data.preview.options.find((option: { key: string }) => option.key === 'weeklySelection');
    expect(weekly).toMatchObject({ checked: true });
    expect(
      (await call(app, 'PUT', STATUS, flagged, { status: 'looking', options: { weeklySelection: 'yes' } }))
        .statusCode,
    ).toBe(400);
  });

  it('does not pause when the candidate cleared the mark', async () => {
    const app = await setup();
    const response = await call(app, 'PUT', STATUS, flagged, { status: 'working', options: { pauseAutoApply: false } });
    expect(response.json().data.applied).toEqual({ pauseAutoApply: false });
    expect(await pausedUntil(app, flagged)).toBeNull();
  });

  it('pauses for another status only when the candidate set the mark', async () => {
    const app = await setup();
    await call(app, 'PUT', STATUS, flagged, { status: 'looking' });
    expect(await pausedUntil(app, flagged)).toBeNull();
    await call(app, 'PUT', STATUS, flagged, { status: 'choosing_role', options: { pauseAutoApply: true } });
    expect(await pausedUntil(app, flagged)).not.toBeNull();
  });

  it('keeps the named profession and refuses the same status twice', async () => {
    const app = await setup();
    const payload = { status: 'changing_profession', targetProfession: ' продакт-менеджер ' };
    const saved = await call(app, 'PUT', STATUS, flagged, payload);
    expect(saved.json().data.current).toMatchObject({
      title: 'Меняю профессию: продакт-менеджер', targetProfession: 'продакт-менеджер',
    });
    const again = await call(app, 'PUT', STATUS, flagged, payload);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('status_unchanged');
    const other = await call(app, 'PUT', STATUS, flagged, { status: 'changing_profession', targetProfession: 'аналитик' });
    expect(other.statusCode).toBe(200);
    expect(other.json().data.history).toHaveLength(2);
  });

  it('returns the previous status together with the pause it set', async () => {
    const app = await setup();
    await call(app, 'PUT', STATUS, flagged, { status: 'looking' });
    await call(app, 'PUT', STATUS, flagged, { status: 'working' });
    const response = await call(app, 'POST', `${STATUS}/revert`, flagged);
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.current).toMatchObject({ status: 'looking', chosen: true });
    expect(data.history).toHaveLength(1);
    expect(await pausedUntil(app, flagged)).toBeNull();
    const entries = await profileHistory(app, flagged);
    // B665: «История изменений» — журнал: смена остаётся, возврат — свой шаг.
    expect(entries.find((entry) => entry.appliedText === 'Работаю')?.revertedAt).toBeNull();
    expect(entries.find((entry) => entry.label === 'Возврат прежнего статуса')).toMatchObject({
      previousText: 'Работаю',
      appliedText: 'Присматриваюсь',
    });
  });

  it('keeps a pause the candidate changed after the status change', async () => {
    const app = await setup();
    await call(app, 'PUT', STATUS, flagged, { status: 'working' });
    const manual = await call(app, 'POST', '/api/v1/candidate/automation/pause', flagged, { days: 3 });
    await call(app, 'POST', `${STATUS}/revert`, flagged);
    expect(await pausedUntil(app, flagged)).toBe(manual.json().data.settings.pausedUntil);
  });

  it('returns the first choice back to «не выбран» and refuses a second revert', async () => {
    const app = await setup();
    await call(app, 'PUT', STATUS, flagged, { status: 'working' });
    const first = await call(app, 'POST', `${STATUS}/revert`, flagged);
    expect(first.json().data.current).toMatchObject({ status: 'job_search', chosen: false });
    expect(first.json().data.revert).toBeNull();
    const second = await call(app, 'POST', `${STATUS}/revert`, flagged);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('status_revert_unavailable');
  });

  it('offers «Вернуть прежний» only until the end of the day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T20:30:00.000Z'));
    const app = await setup();
    const saved = await call(app, 'PUT', STATUS, flagged, { status: 'looking' });
    expect(saved.json().data.revert.until).toBe('2026-11-16T21:00:00.000Z');
    vi.setSystemTime(new Date('2026-11-16T21:00:01.000Z'));
    expect((await call(app, 'GET', STATUS, flagged)).json().data.revert).toBeNull();
    expect((await call(app, 'POST', `${STATUS}/revert`, flagged)).statusCode).toBe(409);
    expect((await call(app, 'GET', STATUS, flagged)).json().data.current.status).toBe('looking');
  });

  it('gives Today the modules of the current status', async () => {
    const app = await setup();
    const initial = (await call(app, 'GET', `${STATUS}/today`, flagged)).json().data.today;
    expect(initial).toMatchObject({ status: 'job_search', chosen: false, revert: null });
    expect(initial.modules[0].key).toBe('next_action');
    await call(app, 'PUT', STATUS, flagged, { status: 'working' });
    const today = (await call(app, 'GET', `${STATUS}/today`, flagged)).json().data.today;
    expect(today).toMatchObject({ status: 'working', title: 'Работаю', chosen: true });
    expect(today.modules.map((module: { key: string }) => module.key)).toEqual(['onboarding_plan', 'next_meeting', 'record_result']);
    expect(today.revert).toMatchObject({ previousTitle: 'Ищу работу' });
  });
});
