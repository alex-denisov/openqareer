import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { config as baseConfig, noSessions } from '../appTestHarness';
import type { SessionAuth } from '../auth/authService';
import { SqliteContactMessageRepository } from '../data/sqliteContactMessageRepository';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { output, turnRequest } from '../data/sqliteTestHarness';
import { EMPTY_RESUME_DRAFT, type ResumeDraft } from '../domain/resumeDraft';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const KEY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const BULLET = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const COPY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const OTHER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const OLD = 'Grew revenue to RUB 920M and margin from 16% to 80%';
const NEW = OLD.replace('80%', '40%');

async function setup(asked = 'Рентабельность была не 80%, а 40%. Исправь.') {
  const directory = mkdtempSync(join(tmpdir(), 'oq-fact-'));
  const config = {
    ...baseConfig,
    databasePath: join(directory, 't.sqlite'),
    cabinetB640Usernames: ['a.test'],
  };
  const store = new SqliteCandidateStore({
    databasePath: config.databasePath,
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const principal = {
    userId: 'u',
    username: 'a.test',
    email: null,
    displayName: null,
    role: 'candidate' as const,
    isTest: true,
    candidate,
  };
  const authService: SessionAuth = {
    ...noSessions,
    authenticate: (token: string) => (token === 'ok' ? principal : null),
  };
  const app = await buildApp({
    config,
    candidateStore: store,
    authService,
    coachProvider: {} as never,
    serveStatic: false,
  });
  const messages = new SqliteContactMessageRepository({ databasePath: config.databasePath });
  cleanups.push(
    () => rmSync(directory, { recursive: true, force: true }),
    () => store.close(),
    () => app.close(),
    () => messages.close(),
  );
  store.addManualExperienceFact(candidate.id, BULLET, OLD);
  store.addManualExperienceFact(candidate.id, COPY, 'Рентабельность выросла с 16% до 80%');
  store.addManualExperienceFact(candidate.id, OTHER, 'CSAT from 25% to 80%');
  const draft: ResumeDraft = {
    ...EMPTY_RESUME_DRAFT,
    candidate: {
      ...EMPTY_RESUME_DRAFT.candidate,
      about: 'Leader. Margin 16% to 80% in two years.',
    },
    experience: [
      {
        id: 'exp-2',
        chronologyMemoryId: OTHER,
        employer: 'Rosseti',
        title: 'Director',
        current: false,
        bulletMemoryIds: [BULLET, OTHER],
      },
    ],
  } as ResumeDraft;
  store.saveResumeDraft(candidate.id, draft, []);
  messages.create({
    id: 'msg',
    candidateId: candidate.id,
    contactId: null,
    recruiterId: null,
    vacancyId: null,
    kind: 'intro' as never,
    text: 'Маржа с 16% до 80%',
    recipientName: 'Павел',
    recipientUrl: null,
    createdAt: '2026-11-25T00:00:00.000Z',
  });
  messages.approve(candidate.id, 'msg', '2026-11-25T00:00:00.000Z');
  const started = store.startTurn(candidate.id, KEY, {
    ...turnRequest,
    stage: 'today',
    content: asked,
  } as never);
  if (started.state !== 'ready') throw new Error('expected a ready turn');
  store.completeTurn(candidate.id, KEY, output);
  const call = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { authorization: 'Bearer ok', origin: 'http://localhost:3000' },
      ...(payload ? { payload } : {}),
    });
  const text = (id: string) =>
    store.getSnapshot(candidate.id).memory.find((item) => item.id === id)?.statement;
  const about = () => store.getSnapshot(candidate.id).resume?.draft.candidate.about;
  return { store, candidate, messages, call, text, about };
}

const URL = '/api/v1/candidate/fact-corrections';
const target = { kind: 'memory', id: BULLET };

describe('B796: исправление факта', () => {
  it('меняет пункт, «О себе», память и черновик сообщения; чужие 80 % остаются; отмена возвращает', async () => {
    const { call, text, about, messages, candidate } = await setup();
    const response = await call('POST', URL, { target, before: OLD, after: NEW });
    expect(response.statusCode, response.body).toBe(200);
    expect(text(BULLET)).toBe(NEW);
    expect(text(COPY)).toBe('Рентабельность выросла с 16% до 40%');
    expect(about()).toBe('Leader. Margin 16% to 40% in two years.');
    expect(text(OTHER)).toBe('CSAT from 25% to 80%');
    expect(messages.get(candidate.id, 'msg')).toMatchObject({
      text: 'Маржа с 16% до 40%',
      state: 'draft',
    });
    const { changes } = response.json().data;
    expect((await call('POST', `${URL}/revert`, { changes })).statusCode).toBe(200);
    expect([text(BULLET), text(COPY), about()]).toEqual([
      OLD,
      'Рентабельность выросла с 16% до 80%',
      'Leader. Margin 16% to 80% in two years.',
    ]);
  });

  it('запись с тех пор изменилась — 409, ничего не записано', async () => {
    const { call, text } = await setup();
    const response = await call('POST', URL, { target, before: 'другое', after: NEW });
    expect(response.statusCode).toBe(409);
    expect(text(BULLET)).toBe(OLD);
  });

  it('под ответом консультанта — карточка правки, после применения её нет', async () => {
    const { call } = await setup();
    const current = '/api/v1/candidate/consultant/current?stage=today';
    const read = async () =>
      (await call('GET', current))
        .json()
        .data.replies.flatMap((item: { corrections?: unknown[] }) => item.corrections ?? []);
    const cards = await read();
    expect(cards[0]).toMatchObject({ before: OLD, after: NEW, place: 'Rosseti' });
    await call('POST', URL, { target, before: OLD, after: NEW });
    expect((await read()).some((card: { before: string }) => card.before === OLD)).toBe(false);
  });
});
