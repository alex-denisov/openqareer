import { randomUUID } from 'node:crypto';
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
const DIARY = '/api/v1/candidate/career-diary';
const flagged = 'token-flagged';
const plain = 'token-plain';
const SLOW = 60_000;

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllGlobals();
});

/** Ответы модели по очереди: каждый — содержимое chat-completions. */
function stubModel(...answers: unknown[]) {
  const queue = [...answers];
  const bodies: string[] = [];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ''));
    const next = queue.shift();
    if (next === undefined) return new Response('down', { status: 503 });
    return Response.json({ choices: [{ message: { content: JSON.stringify(next) } }] });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, bodies, queue };
}

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'oq-goal-hints-'));
  const config = {
    ...baseConfig,
    databasePath: join(directory, 'test.sqlite'),
    cabinetB640Usernames: ['flagged.test'],
    providerCredentials: { openrouter: 'test-key' },
  };
  const store = new SqliteCandidateStore({
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
    candidate: store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' }),
  });
  const sessions = new Map([
    [flagged, principal('flagged.test')],
    [plain, principal('plain.test')],
  ]);
  const authService: SessionAuth = {
    ...noSessions,
    authenticate: (token: string) => sessions.get(token) ?? null,
  };
  const app = await buildApp({
    config,
    candidateStore: store,
    authService,
    coachProvider: {} as never,
    serveStatic: false,
  });
  cleanups.push(
    () => rmSync(directory, { recursive: true, force: true }),
    () => store.close(),
    () => app.close(),
  );
  return { app, store, candidate: sessions.get(flagged)!.candidate!.id };
}

const post = (app: App, path: string, token: string, payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: `${DIARY}/${path}`,
    headers: {
      authorization: `Bearer ${token}`,
      origin: 'http://localhost:3000',
      'idempotency-key': randomUUID(),
    },
    payload,
  });

const EXAMPLES = {
  examples: [
    { title: 'Выполнить план выручки отдела', measure: 'от плана квартала' },
    { title: 'Снизить отток клиентов', measure: 'доля ушедших клиентов' },
    { title: 'Собрать команду продаж', measure: 'закрыто по плану найма' },
  ],
};

describe('B744 · POST goal-examples: примеры целей под роль (d02c)', () => {
  it(
    'три примера; вход модели — только роль; повтор той же роли модель не зовёт',
    async () => {
      const model = stubModel(EXAMPLES);
      const { app } = await setup();
      const first = await post(app, 'goal-examples', flagged, { role: 'Коммерческий директор' });
      expect(first.statusCode).toBe(200);
      expect(first.json().data).toEqual({ items: EXAMPLES.examples });
      expect(model.bodies[0]).toContain('Роль: Коммерческий директор');
      const again = await post(app, 'goal-examples', flagged, { role: 'коммерческий директор' });
      expect(again.json().data).toEqual({ items: EXAMPLES.examples });
      expect(model.fetchMock).toHaveBeenCalledTimes(1);
    },
    SLOW,
  );

  it(
    'модель недоступна — подсказки нет, без ошибки; без флага адреса нет; пустая роль — 400',
    async () => {
      stubModel();
      const { app } = await setup();
      const down = await post(app, 'goal-examples', flagged, { role: 'COO' });
      expect(down.statusCode).toBe(200);
      expect(down.json().data).toBeNull();
      expect((await post(app, 'goal-examples', plain, { role: 'COO' })).statusCode).toBe(404);
      expect((await post(app, 'goal-examples', flagged, { role: ' ' })).statusCode).toBe(400);
    },
    SLOW,
  );
});

describe('B744 · POST goal-baseline: значение «Сейчас» из записей (d02b)', () => {
  it(
    'цитата из записи — значение с датой; пересказ — подсказки нет',
    async () => {
      // Модель подменяется до сборки приложения: подсказки берут fetch при старте.
      const model = stubModel();
      const { app, store, candidate } = await setup();
      const entry = store.diaryEntryRepo.create(
        candidate,
        {
          date: '2026-12-30',
          kind: 'note',
          text: 'Команда жалуется: ревью ждут по полтора-два дня.',
        },
        'entry-1',
      )!;
      model.queue.push(
        { value: 18, entryId: entry.id, quote: 'ревью ждут по полтора-два дня' },
        { value: 30, entryId: entry.id, quote: 'ревью идёт долго' },
        { value: 30, entryId: entry.id, quote: 'ревью идёт долго' },
      );
      const found = await post(app, 'goal-baseline', flagged, {
        indicator: 'Время до первого ревью, часов',
      });
      expect(found.json().data).toEqual({
        value: 18,
        quote: 'ревью ждут по полтора-два дня',
        entryDate: '2026-12-30',
      });
      const retold = await post(app, 'goal-baseline', flagged, { indicator: 'Длительность ревью' });
      expect(retold.json().data).toBeNull();
    },
    SLOW,
  );

  it(
    'записей нет — модель не зовётся; чужие записи не читаются',
    async () => {
      const model = stubModel({ value: 1, entryId: 'x', quote: 'x' });
      const { app } = await setup();
      const empty = await post(app, 'goal-baseline', flagged, { indicator: 'Выручка' });
      expect(empty.json().data).toBeNull();
      expect(model.fetchMock).not.toHaveBeenCalled();
      expect((await post(app, 'goal-baseline', plain, { indicator: 'Выручка' })).statusCode).toBe(
        404,
      );
    },
    SLOW,
  );
});
