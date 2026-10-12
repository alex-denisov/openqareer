import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { buildApp } from '../app';
import { apps, candidateAuthorization, config, createApp, noSessions, stores, successProvider } from '../appTestHarness';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { SqliteCandidateReputationRepository } from '../data/sqliteCandidateReputationRepository';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';

const footprintRepositories: SqliteCandidateReputationRepository[] = [];
afterEach(() => footprintRepositories.splice(0).forEach((repository) => repository.close()));

async function createAppWithFreshMatches() {
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  candidateStore.saveResumeDraft(candidate.id, { ...EMPTY_RESUME_DRAFT, targetRole: 'Инженер данных' }, []);
  const match = {
    cluster: {
      id: 'notification-cluster-1',
      canonicalTitle: 'Инженер данных',
      canonicalCompany: 'Компания',
      canonicalLocation: 'Москва',
      isRemote: false,
      skills: [],
      descriptionSummary: 'Роль инженера данных.',
      primaryUrl: 'https://example.test/vacancy/notification',
      sources: [],
      firstObservedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      status: 'active',
      vacanciesCount: 1,
    },
    explanation: {
      clusterId: 'notification-cluster-1',
      roleMatch: 'target',
      requirements: { matched: 1, total: 1 },
      matchingPoints: [],
      missingPoints: [],
      summary: 'Вакансия совпала с выбранной ролью.',
      calculatedAt: new Date().toISOString(),
    },
  } as unknown as MatchedVacancyItem;
  const engine = {
    getMatchedVacanciesAsync: async () => [match],
    isKnownVacancyGone: () => false,
    restore: () => ({ clusters: 0, sources: 0 }),
  };
  const app = await buildApp({
    config,
    coachProvider: successProvider,
    candidateStore,
    authService: noSessions,
    multiSourceVacancyEngine: engine as never,
    serveStatic: false,
  });
  apps.push(app);
  stores.push(candidateStore);
  return { app, authorization: `Bearer ${candidate.accessToken}` };
}

describe('candidate notification routes', () => {
  it('returns an empty paginated inbox for an authenticated candidate', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/notifications?limit=10',
      headers: { authorization: candidateAuthorization(app) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ items: [], unreadCount: 0, nextCursor: null });
  });

  it('requires candidate authentication before reading notifications', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/notifications',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('unauthorized');
  });

  it('stores candidate event preferences and marks all visible notifications read', async () => {
    const app = await createApp();
    const authorization = candidateAuthorization(app);
    const defaults = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/notifications/preferences',
      headers: { authorization },
    });
    expect(defaults.statusCode).toBe(200);
    expect(defaults.json().data.events).toContainEqual({ key: 'ev-approval', app: true, email: false, telegram: false });

    const updated = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/notifications/preferences/ev-approval',
      headers: { authorization, origin: 'http://localhost:3000' },
      payload: { app: false, email: true, telegram: true },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data).toMatchObject({ key: 'ev-approval', app: false, email: true, telegram: true });

    const readAll = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/notifications/read-all',
      headers: { authorization, origin: 'http://localhost:3000' },
    });
    expect(readAll.statusCode).toBe(200);
    expect(readAll.json().data.updated).toBe(0);
  });

  it('reports locked mandatory channels and unavailable delivery sources', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/notifications/channels',
      headers: { authorization: candidateAuthorization(app) },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      emailAvailable: false,
      telegram: { available: false, connected: false, botUsername: 'openqareer_bot' },
      mandatory: {
        security: { app: true, email: true, telegram: false, locked: true, sourceAvailable: false },
        payments: { app: true, email: true, telegram: false, locked: true, sourceAvailable: false },
      },
    });
    const forbidden = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/notifications/preferences/mand-payments',
      headers: { authorization: candidateAuthorization(app), origin: 'http://localhost:3000' },
      payload: { app: false, email: false },
    });
    expect(forbidden.statusCode).toBe(400);
  });

  it('does not create Telegram link codes without a ready bot webhook', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/notifications/telegram/link',
      headers: { authorization: candidateAuthorization(app), origin: 'http://localhost:3000' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('telegram_unavailable');
  });

  it('rejects Telegram webhook requests without the configured secret', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/integrations/telegram/webhook',
      payload: { message: { text: '/start not-a-code', chat: { id: 12345 } } },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('telegram_webhook_unauthorized');
  });

  it('unsubscribes only after POST and leaves app and Telegram preferences untouched', async () => {
    const app = await createApp();
    const token = Buffer.alloc(32, 8).toString('base64url');
    const candidateStore = stores.at(-1)!;
    const identity = candidateStore.authenticate(candidateAuthorization(app).slice('Bearer '.length))!;
    const tokenHash = createHash('sha256').update(`openqareer:notification-unsubscribe-v1:\0${token}`).digest('hex');
    candidateStore.notificationRepository.issueUnsubscribeToken(identity.id, tokenHash, '2027-10-11T12:00:00.000Z', '2026-10-11T12:00:00.000Z');
    const page = await app.inject({ url: `/api/v1/candidate/notifications/unsubscribe?token=${token}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Отписаться от необязательных писем?');
    expect(candidateStore.notificationRepository.getPreferences(identity.id).find((item) => item.key === 'ev-reply')?.email).toBe(true);

    const applied = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/notifications/unsubscribe',
      headers: { origin: 'http://localhost:3000', 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ token }).toString(),
    });
    expect(applied.statusCode, applied.body).toBe(200);
    const preferences = candidateStore.notificationRepository.getPreferences(identity.id);
    expect(preferences.every((item) => !item.email)).toBe(true);
    expect(preferences.find((item) => item.key === 'ev-reply')).toMatchObject({ app: true, telegram: true });
  });

  it('validates pagination and reports another candidate’s notification as not found', async () => {
    const app = await createApp();
    const authorization = candidateAuthorization(app);
    const invalidLimit = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/notifications?limit=1000',
      headers: { authorization },
    });
    expect(invalidLimit.statusCode).toBe(400);
    const missing = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/notifications/00000000-0000-4000-8000-000000000000/read',
      headers: { authorization, origin: 'http://localhost:3000' },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('notification_not_found');
  });

  it('creates candidate notifications from recorded employer responses and delivery failures', async () => {
    const app = await createApp();
    const authorization = candidateAuthorization(app);
    const application = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/applications',
      headers: { authorization, origin: 'http://localhost:3000' },
      payload: {
        clusterId: 'cluster-notification-test',
        stage: 'saved',
        manualVacancy: { title: 'Product Manager', company: 'Example', source: 'recruiter' },
      },
    });
    expect(application.statusCode).toBe(200);
    const applicationId = application.json().data.id as string;
    const interview = await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/applications/${applicationId}/interviews`,
      headers: { authorization, origin: 'http://localhost:3000' },
      payload: { round: 1, scheduledAt: '2026-10-12T12:00:00.000Z', format: 'Video' },
    });
    expect(interview.statusCode).toBe(200);

    const responseStage = await app.inject({
      method: 'PATCH',
      url: `/api/v1/candidate/applications/${applicationId}`,
      headers: { authorization, origin: 'http://localhost:3000' },
      payload: { expectedVersion: 2, stage: 'responded', occurredAt: '2026-10-11T11:00:00.000Z' },
    });
    expect(responseStage.statusCode).toBe(200);
    const failedDelivery = await app.inject({
      method: 'PATCH',
      url: `/api/v1/candidate/applications/${applicationId}`,
      headers: { authorization, origin: 'http://localhost:3000' },
      payload: {
        expectedVersion: 3,
        deliveryReceipt: { kind: 'failure_note', value: 'Площадка отклонила отправку.' },
      },
    });
    expect(failedDelivery.statusCode).toBe(200);
    const document = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/documents',
      headers: { authorization, origin: 'http://localhost:3000' },
      payload: {
        kind: 'cover_letter',
        source: 'generated',
        fileName: 'letter.txt',
        mimeType: 'text/plain',
        contentBase64: Buffer.from('Пример письма кандидата').toString('base64'),
        extractedText: 'Пример письма кандидата',
        parseStatus: 'ready',
      },
    });
    expect(document.statusCode).toBe(201);
    const linked = await app.inject({
      method: 'PUT',
      url: `/api/v1/candidate/applications/${applicationId}/materials/cover_letter`,
      headers: { authorization, origin: 'http://localhost:3000' },
      payload: { documentId: document.json().data.document.id },
    });
    expect(linked.statusCode, linked.body).toBe(200);

    const inbox = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/notifications?limit=10',
      headers: { authorization },
    });
    const items = inbox.json().data.items as Array<{ id: string; kind: string }>;
    expect(items.map((item) => item.kind)).toEqual(
      expect.arrayContaining([
        'interview_reminder',
        'employer_reply',
        'delivery_error',
        'email_approval',
      ]),
    );
    expect(JSON.stringify(inbox.json().data)).not.toContain('Площадка отклонила');
    const marked = await app.inject({
      method: 'PUT',
      url: `/api/v1/candidate/notifications/${items[0]!.id}/read`,
      headers: { authorization, origin: 'http://localhost:3000' },
    });
    expect(marked.statusCode).toBe(200);
    const allRead = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/notifications/read-all',
      headers: { authorization, origin: 'http://localhost:3000' },
    });
    expect(allRead.json().data.updated).toBe(items.length - 1);
    const afterRead = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/notifications',
      headers: { authorization },
    });
    expect(afterRead.json().data.unreadCount).toBe(0);
  });

  it('creates one idempotent notification from the today matched-vacancy source', async () => {
    const { app, authorization } = await createAppWithFreshMatches();
    const todayUrl = '/api/v1/candidate/today?tz=Europe/Moscow';
    const today = await app.inject({ url: todayUrl, headers: { authorization } });
    expect(today.statusCode).toBe(200);
    const inbox = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/notifications',
      headers: { authorization },
    });
    expect(inbox.json().data.items.map((item: { kind: string }) => item.kind)).toContain('new_vacancies_by_role');

    await app.inject({ url: todayUrl, headers: { authorization } });
    const repeated = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/notifications',
      headers: { authorization },
    });
    expect(repeated.json().data.items.filter((item: { kind: string }) => item.kind === 'new_vacancies_by_role')).toHaveLength(1);
  });

  it('materializes a notification when a completed footprint audit has findings', async () => {
    const candidateStore = new SqliteCandidateStore({
      databasePath: ':memory:',
      encryptionKey: config.dataEncryptionKey,
    });
    const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    const database = new DatabaseSync(':memory:');
    database.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;');
    database.prepare('INSERT INTO candidates (id) VALUES (?)').run(candidate.id);
    const repository = new SqliteCandidateReputationRepository({
      database,
      encryptionKey: config.dataEncryptionKey,
    });
    footprintRepositories.push(repository);
    const app = await buildApp({
      config,
      candidateStore,
      authService: noSessions,
      coachProvider: successProvider,
      candidateReputationRepo: repository,
      serveStatic: false,
    });
    apps.push(app);
    stores.push(candidateStore);
    const authorization = `Bearer ${candidate.accessToken}`;
    repository.saveFootprintAudit({
      id: 'audit-notification-test',
      candidateId: candidate.id,
      state: 'completed',
      selectedQueryIds: [],
      adapterStatuses: [],
      findings: [{
        id: 'finding-notification-test',
        adapter: 'wayback',
        kind: 'profile',
        url: null,
        title: 'Публичная страница',
        detail: 'Требуется проверить принадлежность.',
        match: 'likely_self',
        observedAt: '2026-10-11T10:00:00.000Z',
        receipt: { method: 'snapshot', source: 'wayback', query: 'profile' },
        sources: ['wayback'],
        receipts: [{ method: 'snapshot', source: 'wayback', query: 'profile' }],
        automatedMatch: 'likely_self',
        review: 'unreviewed',
      }],
      ownershipConfirmedAt: '2026-10-11T09:00:00.000Z',
      startedAt: '2026-10-11T09:00:00.000Z',
      completedAt: '2026-10-11T10:00:00.000Z',
    });

    await app.inject({ url: '/api/v1/candidate/footprint', headers: { authorization } });
    const inbox = await app.inject({ url: '/api/v1/candidate/notifications', headers: { authorization } });
    expect(inbox.json().data.items.map((item: { kind: string }) => item.kind)).toContain('footprint_findings');
  });
});
