import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jpeg from 'jpeg-js';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { config as baseConfig, noSessions } from '../appTestHarness';
import type { SessionAuth } from '../auth/authService';
import type { AuthPrincipal } from '../auth/authTypes';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import type { ResumeDraft } from '../domain/resumeDraft';

type App = Awaited<ReturnType<typeof buildApp>>;
const cleanups: Array<() => Promise<void> | void> = [];
const ORIGIN = 'http://localhost:3000';
const PROFILE = '/api/v1/candidate/profile';

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const DRAFT = {
  schemaVersion: 2,
  candidate: { fullName: 'Мария Соколова', headline: 'Руководитель продукта' },
  experience: [],
  education: [],
  languages: [],
} as unknown as ResumeDraft;

async function setup(options: { withProfile?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'oq-profile-b640-'));
  const config = {
    ...baseConfig,
    databasePath: join(directory, 'test.sqlite'),
    cabinetB640Usernames: ['flagged.test', 'other.test'],
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
  const people = {
    flagged: principal('flagged.test'),
    other: principal('other.test'),
    plain: principal('plain.test'),
  };
  if (options.withProfile !== false) {
    for (const person of Object.values(people)) {
      candidateStore.saveResumeDraft(person.candidate!.id, DRAFT, []);
    }
  }
  const sessions = new Map(Object.entries(people).map(([name, value]) => [`token-${name}`, value]));
  const authService: SessionAuth = {
    ...noSessions,
    authenticate: (token: string) => sessions.get(token) ?? null,
  };
  const app = await buildApp({
    config,
    candidateStore,
    authService,
    coachProvider: {} as never,
    serveStatic: false,
  });
  cleanups.push(
    () => rmSync(directory, { recursive: true, force: true }),
    () => candidateStore.close(),
    () => app.close(),
  );
  return { app, candidateStore, people };
}

function call(
  app: App,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  token?: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), origin: ORIGIN },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

const flagged = 'token-flagged';
const other = 'token-other';
const plain = 'token-plain';

function jpegBase64(width = 120, height = 90, extra = ''): string {
  const data = Buffer.alloc(width * height * 4, 200);
  const image = jpeg.encode({ data, width, height }, 90).data;
  return Buffer.concat([image, Buffer.from(extra)]).toString('base64');
}

async function photoIdOf(app: App, token: string): Promise<string | undefined> {
  const resume = await call(app, 'GET', '/api/v1/candidate/resume', token);
  return resume.json().data.draft?.candidate.photoMediaId;
}

const NEW_ROUTES: ReadonlyArray<['GET' | 'POST' | 'PUT' | 'DELETE', string, unknown?]> = [
  ['PUT', `${PROFILE}/photo`, { contentBase64: jpegBase64() }],
  ['DELETE', `${PROFILE}/photo`],
  ['GET', `${PROFILE}/income`],
  ['PUT', `${PROFILE}/income`, { current: 440_000, expected: 500_000 }],
  ['POST', `${PROFILE}/history/any-id/reapply`],
];

describe('маршруты фото и дохода без флага B640', () => {
  it('отвечают как несуществующий адрес и ничего не пишут', async () => {
    const { app } = await setup();
    const missing = await call(app, 'GET', '/api/v1/candidate/no-such-route', plain);
    for (const [method, url, payload] of NEW_ROUTES) {
      for (const token of [plain, undefined]) {
        const response = await call(app, method, url, token, payload);
        expect(response.statusCode, `${method} ${url}`).toBe(404);
        expect(response.json().error.code).toBe(missing.json().error.code);
      }
    }
    expect(await photoIdOf(app, plain)).toBeUndefined();
    const history = await call(app, 'GET', `${PROFILE}/history`, plain);
    expect(history.json().data.entries).toEqual([]);
  });
});

describe('фото профиля', () => {
  it('загруженное фото встаёт в профиль, отдаётся владельцу и не отдаётся другому', async () => {
    const { app } = await setup();
    const put = await call(app, 'PUT', `${PROFILE}/photo`, flagged, {
      contentBase64: jpegBase64(),
    });
    expect(put.statusCode).toBe(200);
    const mediaId = put.json().data.photoMediaId as string;
    expect(mediaId).toMatch(/^[0-9a-f]{32}$/u);
    expect(await photoIdOf(app, flagged)).toBe(mediaId);

    const own = await call(app, 'GET', `/api/v1/candidate/media/${mediaId}`, flagged);
    expect(own.statusCode).toBe(200);
    expect(own.headers['content-type']).toBe('image/jpeg');
    expect(own.headers['x-content-type-options']).toBe('nosniff');
    const foreign = await call(app, 'GET', `/api/v1/candidate/media/${mediaId}`, other);
    expect(foreign.statusCode).toBe(404);
  });

  it('в хранилище лежит пересобранный файл: хвост и метаданные исходника не сохраняются', async () => {
    const { app } = await setup();
    const put = await call(app, 'PUT', `${PROFILE}/photo`, flagged, {
      contentBase64: jpegBase64(120, 90, '<script>alert(1)</script>'),
    });
    const stored = await call(
      app,
      'GET',
      `/api/v1/candidate/media/${put.json().data.photoMediaId}`,
      flagged,
    );
    expect(stored.rawPayload.includes('<script>')).toBe(false);
  });

  it('замена убирает прежний файл, удаление убирает фото из профиля; обе правки в истории', async () => {
    const { app } = await setup();
    const first = (
      await call(app, 'PUT', `${PROFILE}/photo`, flagged, { contentBase64: jpegBase64() })
    ).json().data.photoMediaId;
    const second = (
      await call(app, 'PUT', `${PROFILE}/photo`, flagged, { contentBase64: jpegBase64(200, 200) })
    ).json().data.photoMediaId;
    expect(second).not.toBe(first);
    expect((await call(app, 'GET', `/api/v1/candidate/media/${first}`, flagged)).statusCode).toBe(
      404,
    );

    const removed = await call(app, 'DELETE', `${PROFILE}/photo`, flagged);
    expect(removed.json().data).toEqual({ photoMediaId: null });
    expect(await photoIdOf(app, flagged)).toBeUndefined();
    expect((await call(app, 'GET', `/api/v1/candidate/media/${second}`, flagged)).statusCode).toBe(
      404,
    );

    const entries = (await call(app, 'GET', `${PROFILE}/history`, flagged)).json().data.entries;
    expect(
      entries.map((entry: { section: string; appliedText: string }) => [
        entry.section,
        entry.appliedText,
      ]),
    ).toEqual([
      ['photo', 'без фото'],
      ['photo', 'новое фото'],
      ['photo', 'новое фото'],
    ]);
  });

  it('отклоняет не-изображение, не-base64, лишние поля и слишком большой файл с понятной причиной', async () => {
    const { app } = await setup();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>').toString(
      'base64',
    );
    const cases: Array<[unknown, number, string]> = [
      [{ contentBase64: svg }, 400, 'photo_format'],
      [{ contentBase64: 'не base64!!' }, 400, 'photo_format'],
      [{ contentBase64: jpegBase64(), fileName: '../../etc/passwd' }, 400, 'photo_format'],
      [{ contentBase64: jpegBase64(), mime: 'image/svg+xml' }, 400, 'photo_format'],
      [{}, 400, 'photo_format'],
      [{ contentBase64: jpegBase64(30, 30) }, 400, 'photo_too_small'],
      [
        {
          contentBase64: Buffer.concat([
            Buffer.from(jpegBase64(), 'base64'),
            Buffer.alloc(5 * 1024 * 1024 + 10),
          ]).toString('base64'),
        },
        413,
        'photo_too_large',
      ],
    ];
    for (const [payload, status, code] of cases) {
      const response = await call(app, 'PUT', `${PROFILE}/photo`, flagged, payload);
      expect(response.statusCode, code).toBe(status);
      expect(response.json().error.code).toBe(code);
      expect(response.json().error.message).toMatch(/[А-Яа-я]/u);
    }
    expect(await photoIdOf(app, flagged)).toBeUndefined();
  });

  it('без профиля фото приложить не к чему', async () => {
    const { app } = await setup({ withProfile: false });
    const response = await call(app, 'PUT', `${PROFILE}/photo`, flagged, {
      contentBase64: jpegBase64(),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('profile_missing');
  });
});

describe('доход и ожидания', () => {
  it('хранятся у кандидата, другому не видны, правка попадает в историю', async () => {
    const { app } = await setup();
    expect((await call(app, 'GET', `${PROFILE}/income`, flagged)).json().data).toEqual({
      current: null,
      expected: null,
    });
    const put = await call(app, 'PUT', `${PROFILE}/income`, flagged, {
      current: 440_000,
      expected: 500_000,
    });
    expect(put.statusCode).toBe(200);
    expect(put.headers['cache-control']).toBe('no-store');
    await call(app, 'PUT', `${PROFILE}/income`, flagged, { current: 440_000, expected: null });
    expect((await call(app, 'GET', `${PROFILE}/income`, flagged)).json().data).toEqual({
      current: 440_000,
      expected: null,
    });
    expect((await call(app, 'GET', `${PROFILE}/income`, other)).json().data).toEqual({
      current: null,
      expected: null,
    });

    const entries = (await call(app, 'GET', `${PROFILE}/history`, flagged)).json().data.entries;
    expect(
      entries.map((entry: { label: string; previousText: string; appliedText: string }) => [
        entry.label,
        entry.previousText,
        entry.appliedText,
      ]),
    ).toEqual([
      ['Ожидания по доходу', '500 000 ₽', ''],
      ['Ожидания по доходу', '', '500 000 ₽'],
      ['Доход сейчас', '', '440 000 ₽'],
    ]);
    expect((await call(app, 'GET', `${PROFILE}/history`, other)).json().data.entries).toEqual([]);
  });

  it('не попадает в профиль, условия поиска и снимок кандидата', async () => {
    const { app } = await setup();
    await call(app, 'PUT', `${PROFILE}/income`, flagged, { current: 444_111, expected: 555_222 });
    for (const url of [
      '/api/v1/candidate/resume',
      '/api/v1/candidate/me',
      '/api/v1/candidate/decision-profile',
    ]) {
      const body = (await call(app, 'GET', url, flagged)).body;
      expect(body, url).not.toContain('444111');
      expect(body, url).not.toContain('555222');
      expect(body, url).not.toContain('444 111');
    }
  });

  it('прежняя «отмена» из истории на записях дохода и фото отвечает отказом, а не сбоем', async () => {
    const { app } = await setup();
    await call(app, 'PUT', `${PROFILE}/income`, flagged, { current: 440_000, expected: null });
    await call(app, 'PUT', `${PROFILE}/photo`, flagged, { contentBase64: jpegBase64() });
    const entries = (await call(app, 'GET', `${PROFILE}/history`, flagged)).json().data.entries;
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      const response = await call(app, 'POST', `${PROFILE}/history/${entry.id}/revert`, flagged);
      expect(response.statusCode, entry.section).toBe(409);
    }
    expect((await call(app, 'GET', `${PROFILE}/income`, flagged)).json().data.current).toBe(440_000);
  });

  it('отклоняет не-числа, отрицательные, дробные, огромные суммы и лишние поля', async () => {
    const { app } = await setup();
    for (const payload of [
      { current: '440000', expected: null },
      { current: -1, expected: null },
      { current: 1.5, expected: null },
      { current: 1_000_000_000, expected: null },
      { current: 1, expected: null, candidateId: 'x' },
      { current: 1 },
      {},
    ]) {
      const response = await call(app, 'PUT', `${PROFILE}/income`, flagged, payload);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('invalid_income');
    }
    expect((await call(app, 'GET', `${PROFILE}/income`, flagged)).json().data).toEqual({
      current: null,
      expected: null,
    });
  });
});

describe('повторное применение отменённой правки', () => {
  async function editedHeadline() {
    const context = await setup();
    const id = context.people.flagged.candidate!.id;
    const next = {
      ...DRAFT,
      candidate: { ...DRAFT.candidate, headline: 'Директор по продукту' },
    } as ResumeDraft;
    context.candidateStore.saveResumeDraft(id, next, []);
    context.candidateStore.profileChangeLog.recordDraftChanges(id, DRAFT, next, 'candidate');
    const [entry] = (await call(context.app, 'GET', `${PROFILE}/history`, flagged)).json().data
      .entries;
    return { ...context, entryId: entry.id as string };
  }
  const headline = async (app: App) =>
    (await call(app, 'GET', '/api/v1/candidate/resume', flagged)).json().data.draft.candidate
      .headline;

  it('отменённую правку можно вернуть; действующую — нельзя', async () => {
    const { app, entryId } = await editedHeadline();
    const early = await call(app, 'POST', `${PROFILE}/history/${entryId}/reapply`, flagged);
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe('profile_change_not_reverted');

    expect(
      (await call(app, 'POST', `${PROFILE}/history/${entryId}/revert`, flagged)).statusCode,
    ).toBe(200);
    expect(await headline(app)).toBe('Руководитель продукта');
    const reapplied = await call(app, 'POST', `${PROFILE}/history/${entryId}/reapply`, flagged);
    expect(reapplied.statusCode).toBe(200);
    expect(await headline(app)).toBe('Директор по продукту');
    const [entry] = (await call(app, 'GET', `${PROFILE}/history`, flagged)).json().data.entries;
    expect(entry.revertedAt).toBeNull();
  });

  it('если место с тех пор изменилось, новое значение не затирается', async () => {
    const { app, candidateStore, people, entryId } = await editedHeadline();
    await call(app, 'POST', `${PROFILE}/history/${entryId}/revert`, flagged);
    const changed = { ...DRAFT, candidate: { ...DRAFT.candidate, headline: 'CPO' } } as ResumeDraft;
    candidateStore.saveResumeDraft(people.flagged.candidate!.id, changed, []);
    const response = await call(app, 'POST', `${PROFILE}/history/${entryId}/reapply`, flagged);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('profile_change_conflict');
    expect(await headline(app)).toBe('CPO');
  });

  it('чужую и несуществующую правку не трогает; правку фото и дохода не возвращает', async () => {
    const { app, entryId } = await editedHeadline();
    await call(app, 'POST', `${PROFILE}/history/${entryId}/revert`, flagged);
    expect(
      (await call(app, 'POST', `${PROFILE}/history/${entryId}/reapply`, other)).statusCode,
    ).toBe(404);
    expect(
      (await call(app, 'POST', `${PROFILE}/history/no-such/reapply`, flagged)).statusCode,
    ).toBe(404);
    expect(await headline(app)).toBe('Руководитель продукта');
  });
});
