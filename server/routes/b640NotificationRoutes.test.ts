import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
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
const PATH = '/api/v1/candidate/b640/notifications';

afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'oq-b671-'));
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
  const principals = { flagged: principal('flagged.test'), plain: principal('plain.test') };
  const sessions = new Map([
    ['token-flagged', principals.flagged],
    ['token-plain', principals.plain],
  ]);
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
  const id = principals.flagged.candidate!.id;
  return { app, candidateStore, id, notifications: candidateStore.notificationRepository };
}

function call(
  app: App,
  method: 'GET' | 'POST' | 'PUT',
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
const plain = 'token-plain';
const LEGACY = '/api/v1/candidate/notifications';

type Fixture = Awaited<ReturnType<typeof setup>>;

function applicationWithReply(fixture: Fixture, company: string) {
  const created = fixture.candidateStore.createApplication(fixture.id, {
    stage: 'applied',
    manualVacancy: { title: 'Backend', company, url: 'https://example.test/v/1', source: 'manual' },
  });
  const moved = fixture.candidateStore.patchApplication(fixture.id, created.id, {
    expectedVersion: created.version,
    stage: 'interview',
  });
  fixture.notifications.recordEvent(fixture.id, {
    kind: 'employer_reply',
    sourceType: 'application',
    sourceId: created.id,
    idempotencyKey: `employer-reply:${created.id}:${moved.version}`,
  });
  return created.id;
}

describe('лента уведомлений без флага B640', () => {
  it('отвечает как несуществующий адрес', async () => {
    const { app } = await setup();
    const missing = await call(app, 'GET', '/api/v1/candidate/no-such-route', plain);
    for (const token of [plain, undefined]) {
      const response = await call(app, 'GET', PATH, token);
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe(missing.json().error.code);
    }
  });
});

describe('лента уведомлений с флагом B640', () => {
  it('приглашение берёт компанию и роль из отклика и лежит в pinned', async () => {
    const fixture = await setup();
    const applicationId = applicationWithReply(fixture, 'Вектор Банк');
    const data = (await call(fixture.app, 'GET', PATH, flagged)).json().data;
    expect(data.items).toEqual([]);
    expect(data.unreadCount).toBe(1);
    expect(data.nextCursor).toBeNull();
    expect(data.pinned).toHaveLength(1);
    expect(data.pinned[0]).toMatchObject({
      kind: 'interview_invitation',
      category: 'invitations',
      important: true,
      title: 'Вектор Банк приглашает на интервью',
      company: 'Вектор Банк',
      role: 'Backend',
      sourceType: 'application',
      sourceId: applicationId,
    });
  });

  it('фильтр категорий действует на items и pinned', async () => {
    const fixture = await setup();
    applicationWithReply(fixture, 'Вектор Банк');
    fixture.notifications.recordEvent(fixture.id, {
      kind: 'new_vacancies_by_role',
      sourceType: 'role',
      sourceId: 'role-1',
      idempotencyKey: 'vacancies:1',
    });
    const invitations = (
      await call(fixture.app, 'GET', `${PATH}?category=invitations`, flagged)
    ).json().data;
    expect(invitations.pinned).toHaveLength(1);
    expect(invitations.items).toEqual([]);
    const vacancies = (await call(fixture.app, 'GET', `${PATH}?category=vacancies`, flagged)).json()
      .data;
    expect(vacancies.pinned).toEqual([]);
    expect(vacancies.items.map((item: { kind: string }) => item.kind)).toEqual([
      'new_vacancies_by_role',
    ]);
    expect(vacancies.unreadCount).toBe(2);
  });

  it('«Новые вакансии по вашей роли» несут роль поиска и время подборки (B671)', async () => {
    const fixture = await setup();
    fixture.candidateStore.saveResumeDraft(
      fixture.id,
      { ...EMPTY_RESUME_DRAFT, targetRole: 'Инженер данных' },
      [],
    );
    fixture.notifications.recordEvent(fixture.id, {
      kind: 'new_vacancies_by_role',
      sourceType: 'matched_vacancy_batch',
      sourceId: 'batch-1',
      idempotencyKey: 'new-vacancies:batch-1',
    });
    const [item] = (await call(fixture.app, 'GET', `${PATH}?category=vacancies`, flagged)).json()
      .data.items;
    expect(item).toMatchObject({ kind: 'new_vacancies_by_role', role: 'Инженер данных' });
    expect(item.eventAt).toBe(item.createdAt);
  });

  it('роль поиска на английском показывается по-русски (B737)', async () => {
    const fixture = await setup();
    fixture.candidateStore.saveResumeDraft(
      fixture.id,
      { ...EMPTY_RESUME_DRAFT, targetRole: 'Chief Operating Officer' },
      [],
    );
    fixture.notifications.recordEvent(fixture.id, {
      kind: 'new_vacancies_by_role',
      sourceType: 'matched_vacancy_batch',
      sourceId: 'batch-2',
      idempotencyKey: 'new-vacancies:batch-2',
    });
    const [item] = (await call(fixture.app, 'GET', `${PATH}?category=vacancies`, flagged)).json()
      .data.items;
    expect(item.role).toBe('Операционный директор (COO)');
  });

  it('неверный запрос — 400 invalid_query', async () => {
    const { app } = await setup();
    for (const query of [
      'category=x',
      'limit=0',
      'limit=51',
      'cursor=-1',
      'cursor=abc',
      'extra=1',
    ]) {
      const response = await call(app, 'GET', `${PATH}?${query}`, flagged);
      expect(response.statusCode, query).toBe(400);
      expect(response.json().error.code).toBe('invalid_query');
    }
  });

  it('страницы идут по смещению', async () => {
    const fixture = await setup();
    for (const n of [1, 2, 3]) {
      fixture.notifications.recordEvent(fixture.id, {
        kind: 'import_completed',
        sourceType: 'import',
        sourceId: `i${n}`,
        idempotencyKey: `import:${n}`,
        createdAt: `2026-11-1${n}T10:00:00.000Z`,
      });
    }
    const first = (await call(fixture.app, 'GET', `${PATH}?limit=2`, flagged)).json().data;
    expect(first.items.map((item: { sourceId: string }) => item.sourceId)).toEqual(['i3', 'i2']);
    expect(first.nextCursor).toBe('2');
    const second = (await call(fixture.app, 'GET', `${PATH}?limit=2&cursor=2`, flagged)).json()
      .data;
    expect(second.items.map((item: { sourceId: string }) => item.sourceId)).toEqual(['i1']);
    expect(second.nextCursor).toBeNull();
  });

  it('прежний список уведомлений отвечает как раньше', async () => {
    const fixture = await setup();
    applicationWithReply(fixture, 'Вектор Банк');
    const response = await call(fixture.app, 'GET', LEGACY, flagged);
    expect(response.statusCode).toBe(200);
    const [item] = response.json().data.items;
    expect(item).toMatchObject({ kind: 'employer_reply', title: 'Есть ответ работодателя' });
  });
});

const PREF = `${PATH}/preferences/invitations`;

function replyAt(fixture: Fixture, company: string, stage: 'responded' | 'interview') {
  const created = fixture.candidateStore.createApplication(fixture.id, {
    stage: 'applied',
    manualVacancy: {
      title: 'Backend',
      company,
      url: `https://example.test/${company}`,
      source: 'manual',
    },
  });
  const moved = fixture.candidateStore.patchApplication(fixture.id, created.id, {
    expectedVersion: created.version,
    stage,
  });
  return fixture.notifications.recordEvent(fixture.id, {
    kind: 'employer_reply',
    sourceType: 'application',
    sourceId: created.id,
    idempotencyKey: `employer-reply:${created.id}:${moved.version}`,
    invitation: stage === 'interview',
  });
}

describe('B671: ключ «Приглашения»', () => {
  it('без флага GET и PUT отвечают 404', async () => {
    const { app } = await setup();
    expect((await call(app, 'GET', PREF, plain)).statusCode).toBe(404);
    expect(
      (await call(app, 'PUT', PREF, plain, { app: true, email: true, telegram: true })).statusCode,
    ).toBe(404);
  });

  it('без сохранённого ключа отдаёт значения «Ответов» и ничего не пишет', async () => {
    const fixture = await setup();
    fixture.notifications.setPreference(fixture.id, 'ev-reply', { app: true, email: false });
    const response = await call(fixture.app, 'GET', PREF, flagged);
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      key: 'ev-invitation',
      app: true,
      email: false,
      telegram: true,
    });
    expect(fixture.notifications.getInvitationPreference(fixture.id).stored).toBe(false);
  });

  it('PUT проверяет тело и сохраняет ключ', async () => {
    const fixture = await setup();
    for (const body of [
      {},
      { app: true, email: true },
      { app: 'yes', email: true, telegram: true },
      { app: true, email: true, telegram: true, extra: 1 },
    ]) {
      const response = await call(fixture.app, 'PUT', PREF, flagged, body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json().error.code).toBe('invalid_preference');
    }
    const saved = await call(fixture.app, 'PUT', PREF, flagged, {
      app: false,
      email: true,
      telegram: false,
    });
    expect(saved.json().data).toEqual({
      key: 'ev-invitation',
      app: false,
      email: true,
      telegram: false,
    });
    expect((await call(fixture.app, 'GET', PREF, flagged)).json().data.app).toBe(false);
  });

  it('лента: приглашения по своему ключу, ответы — по «Ответам»', async () => {
    const fixture = await setup();
    replyAt(fixture, 'Вектор', 'interview');
    replyAt(fixture, 'Гринкод', 'responded');
    await call(fixture.app, 'PUT', PREF, flagged, { app: false, email: true, telegram: true });
    let data = (await call(fixture.app, 'GET', PATH, flagged)).json().data;
    expect([...data.pinned, ...data.items].map((item: { kind: string }) => item.kind)).toEqual([
      'employer_reply',
    ]);
    expect(data.unreadCount).toBe(1);
    fixture.notifications.setPreference(fixture.id, 'ev-reply', { app: false, email: true });
    await call(fixture.app, 'PUT', PREF, flagged, { app: true, email: true, telegram: true });
    data = (await call(fixture.app, 'GET', PATH, flagged)).json().data;
    expect([...data.pinned, ...data.items].map((item: { kind: string }) => item.kind)).toEqual([
      'interview_invitation',
    ]);
    expect(data.unreadCount).toBe(1);
  });

  it('почта приглашения идёт по ключу «Приглашения», ответа — по «Ответам»', async () => {
    const fixture = await setup();
    await call(fixture.app, 'PUT', PREF, flagged, { app: true, email: false, telegram: false });
    const invitation = replyAt(fixture, 'Вектор', 'interview')!;
    const reply = replyAt(fixture, 'Гринкод', 'responded')!;
    const claimed = fixture.notifications.claimDueDeliveries(
      new Date(Date.now() + 60_000).toISOString(),
      10,
    );
    expect(claimed.map((item) => [item.notificationId, item.channel])).toEqual([
      [reply.id, 'email'],
    ]);
    expect(
      fixture.notifications.isDeliveryEnabled(fixture.id, 'email', 'employer_reply', invitation.id),
    ).toBe(false);
    expect(
      fixture.notifications.isDeliveryEnabled(fixture.id, 'email', 'employer_reply', reply.id),
    ).toBe(true);
  });

  it('удаление данных кандидата снимает ключ', async () => {
    const fixture = await setup();
    await call(fixture.app, 'PUT', PREF, flagged, { app: false, email: false, telegram: false });
    fixture.notifications.deleteByCandidate(fixture.id);
    expect(fixture.notifications.getInvitationPreference(fixture.id).stored).toBe(false);
  });
});

const DELIVERY = `${PATH}/preferences/delivery`;

describe('n02: «Как часто» и «Не показывать название компании»', () => {
  it('без флага GET и PUT отвечают 404', async () => {
    const { app } = await setup();
    expect((await call(app, 'GET', DELIVERY, plain)).statusCode).toBe(404);
    expect(
      (await call(app, 'PUT', DELIVERY, plain, { frequency: 'daily', hideCompany: true })).statusCode,
    ).toBe(404);
  });

  it('без выбора — сразу и с названием; чтение ничего не пишет', async () => {
    const fixture = await setup();
    const response = await call(fixture.app, 'GET', DELIVERY, flagged);
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ frequency: 'immediate', hideCompany: false });
  });

  it('PUT проверяет тело и сохраняет выбор', async () => {
    const fixture = await setup();
    for (const body of [
      {},
      { frequency: 'hourly', hideCompany: false },
      { frequency: 'daily', hideCompany: 'yes' },
      { frequency: 'daily', hideCompany: true, extra: 1 },
    ]) {
      const response = await call(fixture.app, 'PUT', DELIVERY, flagged, body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json().error.code).toBe('invalid_preference');
    }
    const saved = await call(fixture.app, 'PUT', DELIVERY, flagged, {
      frequency: 'weekly',
      hideCompany: true,
    });
    expect(saved.json().data).toEqual({ frequency: 'weekly', hideCompany: true });
    expect(fixture.notifications.getDeliverySettings(fixture.id)).toEqual({ frequency: 'weekly', hideCompany: true });
    expect((await call(fixture.app, 'GET', DELIVERY, flagged)).json().data.frequency).toBe('weekly');
  });
});
