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
import { DatabaseSync } from 'node:sqlite';
import { SqliteResumeEditChoicesRepository } from '../candidate/sqliteResumeEditChoicesRepository';
import { SqliteTextVariantRepository } from '../candidate/sqliteTextVariantRepository';
import { LINKEDIN_QUEUE_TABLES } from '../data/linkedinQueueSchema';
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
  const database = new DatabaseSync(config.databasePath);
  const edits = new SqliteResumeEditChoicesRepository(database, config.dataEncryptionKey);
  const variants = new SqliteTextVariantRepository(database, config.dataEncryptionKey);
  cleanups.push(() => database.close());
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
  return { database, edits, variants, store, candidate, messages, call, text, about };
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
    const { id } = response.json().data;
    expect((await call('POST', `${URL}/revert`, { id })).statusCode).toBe(200);
    expect([text(BULLET), text(COPY), about()]).toEqual([
      OLD,
      'Рентабельность выросла с 16% до 80%',
      'Leader. Margin 16% to 80% in two years.',
    ]);
  });

  // Набор из аудита 25.11 (S13-80pct-audit.md): память ×3, «О себе», правки и переводы, черновик, варианты.
  it('неотправленное меняется и возвращается, ушедшее с откликом цело', async () => {
    const { call, text, messages, candidate, edits, variants, database, store } = await setup();
    const now = '2026-11-25T00:00:00.000Z';
    const open = 'Открыто: рентабельность 16% до 80%';
    store.addManualExperienceFact(candidate.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', open);
    const choices = {
      cancelled: [],
      texts: { [`exp-2:${BULLET}`]: OLD },
      translations: { [`ru:${OLD}`]: 'Рост маржи с 16% до 80%', 'ru:Team': 'Команда' },
    };
    for (const id of ['open', 'sent']) {
      edits.save(candidate.id, id, choices, now);
      const subject = { candidateId: candidate.id, kind: 'letter' as const, subjectId: id };
      variants.add({
        ...subject,
        text: 'Margin from 16% to 80%',
        wish: { chips: [], text: '' },
        createdAt: now,
      });
    }
    const list = (subjectId: string) =>
      variants.list({ candidateId: candidate.id, kind: 'letter', subjectId }).variants.length;
    database
      .prepare(
        `INSERT INTO applications (id, candidate_id, cluster_id, stage, stage_changed_at, created_at, updated_at)
         VALUES ('app', ?, 'sent', 'applied', ?, ?, ?)`,
      )
      .run(candidate.id, now, now, now);
    const sentMessage = { ...messages.get(candidate.id, 'msg')!, id: 'gone' };
    messages.create(sentMessage);
    messages.approve(candidate.id, 'gone', now);
    messages.markSent(candidate.id, 'gone', now);
    for (const kind of ['cover_letter', 'resume'] as const) {
      store.saveDocument(candidate.id, {
        kind,
        source: 'generated',
        fileName: `${kind}.txt`,
        mimeType: 'text/plain',
        contentBase64: Buffer.from(`${kind}: margin from 16% to 80%`).toString('base64'),
        extractedText: `${kind}: margin from 16% to 80%`,
        parseStatus: 'ready',
      });
    }
    const files = () => database.prepare('SELECT * FROM candidate_documents').all();
    const filesBefore = files();

    const response = await call('POST', URL, { target, before: OLD, after: NEW });
    expect(response.json().data).toMatchObject({ resetMessages: 1, staleVariants: 1 });
    expect(edits.read(candidate.id, 'open')).toEqual({
      cancelled: [],
      texts: { [`exp-2:${BULLET}`]: NEW },
      translations: { 'ru:Team': 'Команда' },
    });
    expect(edits.read(candidate.id, 'sent')).toEqual(choices);
    expect([list('open'), list('sent')]).toEqual([0, 1]);
    expect(messages.get(candidate.id, 'gone')).toMatchObject({
      text: 'Маржа с 16% до 80%',
      state: 'sent',
    });
    expect(files()).toEqual(filesBefore);
    expect(filesBefore).toHaveLength(2);

    const { id } = response.json().data;
    expect((await call('POST', `${URL}/revert`, { id })).statusCode).toBe(200);
    expect(edits.read(candidate.id, 'open')).toEqual(choices);
    expect(list('open')).toBe(1);
    expect(messages.get(candidate.id, 'msg')).toMatchObject({
      text: 'Маржа с 16% до 80%',
      state: 'approved',
    });
    expect(text(BULLET)).toBe(OLD);
    expect((await call('POST', `${URL}/revert`, { id })).statusCode).toBe(409);
  });

  it('варианты резюме и постов ушедшего отклика и публикации остаются', async () => {
    const { call, candidate, variants, database } = await setup();
    const now = '2026-11-25T00:00:00.000Z';
    const add = (kind: 'resume' | 'post' | 'headline', subjectId: string, payload?: object, text = 'Margin from 16% to 80%') =>
      variants.add({
        candidateId: candidate.id,
        kind,
        subjectId,
        text,
        wish: { chips: [], text: '' },
        payload,
        createdAt: now,
      });
    add('resume', 'r-sent', { vacancyId: 'sent' });
    add('resume', 'r-open', { vacancyId: 'open' });
    add('resume', 'r-unknown');
    add('post', 'p-done');
    add('post', 'p-open');
    add('headline', 'h');
    add('headline', 'h-other', undefined, 'CTO');
    database
      .prepare(
        `INSERT INTO applications (id, candidate_id, cluster_id, stage, stage_changed_at, created_at, updated_at)
         VALUES ('app', ?, 'sent', 'applied', ?, ?, ?)`,
      )
      .run(candidate.id, now, now, now);
    database.exec(LINKEDIN_QUEUE_TABLES);
    database
      .prepare(
        `INSERT INTO candidate_linkedin_queue (id, candidate_id, draft_id, kind, scheduled_at, state, created_at, updated_at)
         VALUES ('q', ?, 'p-done', 'post', ?, 'done', ?, ?)`,
      )
      .run(candidate.id, now, now, now);
    const response = await call('POST', URL, { target, before: OLD, after: NEW });
    expect(response.json().data.staleVariants).toBe(4);
    const left = (kind: 'resume' | 'post' | 'headline', subjectId: string) =>
      variants.list({ candidateId: candidate.id, kind, subjectId }).variants.length;
    expect([left('resume', 'r-sent'), left('post', 'p-done')]).toEqual([1, 1]);
    expect([left('resume', 'r-open'), left('post', 'p-open')]).toEqual([0, 0]);
    // Пункт резюме без вакансии и заголовок со старым фактом никуда не ушли.
    expect([left('resume', 'r-unknown'), left('headline', 'h')]).toEqual([0, 0]);
    expect(left('headline', 'h-other')).toBe(1);
  });

  it('сбой на копиях откатывает и профиль', async () => {
    const { call, text, database } = await setup();
    database.exec(
      "CREATE TRIGGER broken BEFORE UPDATE ON candidate_contact_messages BEGIN SELECT RAISE(ABORT, 'x'); END",
    );
    expect((await call('POST', URL, { target, before: OLD, after: NEW })).statusCode).toBe(500);
    expect(text(BULLET)).toBe(OLD);
    expect(text(COPY)).toContain('80%');
  });

  it('отклонённая и чувствительная записи не меняются', async () => {
    const { call, text, store, candidate, database } = await setup();
    const draft = store.getSnapshot(candidate.id).resume!.draft;
    store.saveResumeDraft(candidate.id, { ...draft, declinedFactIds: [COPY] }, []);
    const SENSITIVE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
    store.addManualExperienceFact(candidate.id, SENSITIVE, 'Маржа 16% до 80%');
    database.prepare('UPDATE memory SET sensitive = 1 WHERE id = ?').run(SENSITIVE);
    store.saveResumeDraft(candidate.id, { ...draft, declinedFactIds: [COPY] }, []);
    await call('POST', URL, { target, before: OLD, after: NEW });
    expect(text(COPY)).toContain('80%');
    expect(text(SENSITIVE)).toContain('80%');
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
