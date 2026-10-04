import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { apps, config, noSessions, stores, successProvider } from './appTestHarness';
import { MultiSourceVacancyEngine } from './vacancies/multiSourceVacancyEngine';
import type { VacancyCluster } from './domain/unifiedVacancy';

/**
 * Трекер откликов, срез 2 (B251, architecture.md §6 QA + owner decisions
 * 2026-09-23 22:26): материалы, интервью, оффер, события, funnel,
 * vacancy-skips, ручные карточки, автоматический архив закрывшейся вакансии.
 */
async function createApp(multiSourceVacancyEngine?: MultiSourceVacancyEngine) {
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const app = await buildApp({
    config,
    coachProvider: successProvider,
    candidateStore,
    authService: noSessions,
    serveStatic: false,
    multiSourceVacancyEngine,
  });
  apps.push(app);
  stores.push(candidateStore);
  return { app, authorization: `Bearer ${candidate.accessToken}`, candidateStore, candidateId: candidate.id };
}

const ORIGIN = { origin: 'http://localhost:3000' };
const APPLICATIONS_URL = '/api/v1/candidate/applications';

const vacancy = {
  title: 'Продуктовый аналитик',
  company: 'FinCloud',
  url: 'https://example.test/jobs/1',
  source: 'src-remotive',
};

async function createCard(app: Awaited<ReturnType<typeof createApp>>['app'], authorization: string, clusterId: string, stage = 'applied') {
  const created = await app.inject({
    method: 'POST',
    url: APPLICATIONS_URL,
    headers: { authorization, ...ORIGIN },
    payload: { clusterId, stage, manualVacancy: vacancy },
  });
  return created.json().data.id as string;
}

describe('applications route · S2 materials/interviews/offer/events', () => {
  it('links a resume document to a card', async () => {
    const { app, authorization, candidateStore, candidateId } = await createApp();
    const id = await createCard(app, authorization, 'cluster-1');
    const { document } = candidateStore.saveDocument(candidateId, {
      kind: 'resume',
      source: 'upload',
      fileName: 'resume.txt',
      mimeType: 'text/plain',
      contentBase64: Buffer.from('resume text').toString('base64'),
      parseStatus: 'not_applicable',
    });
    const linked = await app.inject({
      method: 'PUT',
      url: `${APPLICATIONS_URL}/${id}/materials/resume`,
      headers: { authorization, ...ORIGIN },
      payload: { documentId: document.id },
    });
    expect(linked.statusCode).toBe(200);
    expect(linked.json().data).toMatchObject({ role: 'resume', documentId: document.id });
  });

  it('rejects a resume document owned by another candidate', async () => {
    const { app, authorization, candidateStore } = await createApp();
    const applicationId = await createCard(app, authorization, 'cluster-1');
    const otherCandidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    const { document } = candidateStore.saveDocument(otherCandidate.id, {
      kind: 'resume',
      source: 'upload',
      fileName: 'private-resume.txt',
      mimeType: 'text/plain',
      contentBase64: Buffer.from('other candidate resume').toString('base64'),
      parseStatus: 'not_applicable',
    });

    const response = await app.inject({
      method: 'PUT',
      url: `${APPLICATIONS_URL}/${applicationId}/materials/resume`,
      headers: { authorization, ...ORIGIN },
      payload: { documentId: document.id },
    });

    expect(response.statusCode).toBe(404);
    const applications = await app.inject({ method: 'GET', url: APPLICATIONS_URL, headers: { authorization } });
    const ownCard = applications.json().data.find((entry: { id: string }) => entry.id === applicationId);
    expect(ownCard.materials.resume).toBe(false);
  });

  it('does not report a legacy material link to another candidate document', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'openqareer-material-read-'));
    const databasePath = join(directory, 'candidate.db');
    const candidateStore = new SqliteCandidateStore({
      databasePath,
      encryptionKey: config.dataEncryptionKey,
    });
    const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    const app = await buildApp({
      config: { ...config, databasePath },
      coachProvider: successProvider,
      candidateStore,
      authService: noSessions,
      serveStatic: false,
    });
    const authorization = `Bearer ${candidate.accessToken}`;
    const other = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });

    try {
      const applicationId = await createCard(app, authorization, 'cluster-1');
      const { document } = candidateStore.saveDocument(other.id, {
        kind: 'resume',
        source: 'upload',
        fileName: 'private-resume.txt',
        mimeType: 'text/plain',
        contentBase64: Buffer.from('other candidate resume').toString('base64'),
        parseStatus: 'not_applicable',
      });
      const database = new DatabaseSync(databasePath);
      database
        .prepare(
          `INSERT INTO application_materials (application_id, role, document_id, linked_at)
           VALUES (?, 'resume', ?, ?)`,
        )
        .run(applicationId, document.id, '2026-09-26T00:00:00.000Z');
      database.close();

      const response = await app.inject({ method: 'GET', url: APPLICATIONS_URL, headers: { authorization } });
      const ownCard = response.json().data.find((entry: { id: string }) => entry.id === applicationId);

      expect(response.statusCode).toBe(200);
      expect(ownCard.materials.resume).toBe(false);
    } finally {
      await app.close();
      candidateStore.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('records a follow-up-sent event without changing the stage', async () => {
    const { app, authorization, candidateStore } = await createApp();
    const id = await createCard(app, authorization, 'cluster-1');
    const before = await app.inject({
      method: 'GET',
      url: APPLICATIONS_URL,
      headers: { authorization },
    });
    const initialDueAt = before.json().data.find((entry: { id: string }) => entry.id === id)
      .followUp.dueAt as string;
    const secondReminderDueAt = new Date(Date.parse(initialDueAt) + 3 * 86_400_000).toISOString();
    const response = await app.inject({
      method: 'POST',
      url: `${APPLICATIONS_URL}/${id}/events`,
      headers: { authorization, ...ORIGIN },
      payload: { kind: 'follow_up_sent', occurredAt: '2030-01-01T00:00:00.000Z' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.stage).toBe('applied');
    expect(response.json().data.followUp).toMatchObject({
      source: 'standard_schedule',
      dueAt: secondReminderDueAt,
    });

    const other = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    const foreign = await app.inject({
      method: 'POST',
      url: `${APPLICATIONS_URL}/${id}/events`,
      headers: { authorization: `Bearer ${other.accessToken}`, ...ORIGIN },
      payload: { kind: 'follow_up_sent', occurredAt: '2030-02-01T00:00:00.000Z' },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('creates an interview round and patches its prep', async () => {
    const { app, authorization } = await createApp();
    const id = await createCard(app, authorization, 'cluster-1', 'interview');
    const created = await app.inject({
      method: 'POST',
      url: `${APPLICATIONS_URL}/${id}/interviews`,
      headers: { authorization, ...ORIGIN },
      payload: { round: 1, scheduledAt: '2030-02-01T10:00:00Z' },
    });
    expect(created.statusCode).toBe(200);
    const interviewId = created.json().data.id;
    const patched = await app.inject({
      method: 'PATCH',
      url: `${APPLICATIONS_URL}/${id}/interviews/${interviewId}`,
      headers: { authorization, ...ORIGIN },
      payload: { prepStatus: 'ready', prep: 'STAR stories' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data).toMatchObject({ prepStatus: 'ready', prep: 'STAR stories' });
  });

  it('moves an applied application to interview in the same transaction as its interview date', async () => {
    const { app, authorization } = await createApp();
    const id = await createCard(app, authorization, 'cluster-1', 'applied');
    const scheduledAt = '2030-02-01T10:00:00Z';

    const created = await app.inject({
      method: 'POST',
      url: `${APPLICATIONS_URL}/${id}/interviews`,
      headers: { authorization, ...ORIGIN },
      payload: { round: 1, scheduledAt },
    });

    expect(created.statusCode).toBe(200);
    const listed = await app.inject({ method: 'GET', url: APPLICATIONS_URL, headers: { authorization } });
    expect(listed.json().data[0]).toMatchObject({
      id,
      stage: 'interview',
      nearestInterview: { scheduledAt, round: 1 },
    });
  });

  it('keeps the previous stage when interview creation fails', async () => {
    const { app, authorization, candidateStore } = await createApp();
    const id = await createCard(app, authorization, 'cluster-1', 'applied');
    const database = (candidateStore as unknown as { database: DatabaseSync }).database;
    database.exec(`
      CREATE TRIGGER reject_interview_for_test
      BEFORE INSERT ON application_interviews
      BEGIN
        SELECT RAISE(ABORT, 'test interview write failure');
      END;
    `);

    const failed = await app.inject({
      method: 'POST',
      url: `${APPLICATIONS_URL}/${id}/interviews`,
      headers: { authorization, ...ORIGIN },
      payload: { round: 1, scheduledAt: '2030-02-01T10:00:00Z' },
    });

    expect(failed.statusCode).toBe(500);
    const listed = await app.inject({ method: 'GET', url: APPLICATIONS_URL, headers: { authorization } });
    expect(listed.json().data[0]).toMatchObject({ id, stage: 'applied', nearestInterview: null });
  });

  it('rolls back the vacancy status when its tracker-card write fails', async () => {
    const { app, authorization, candidateStore } = await createApp();
    const database = (candidateStore as unknown as { database: DatabaseSync }).database;
    database.exec(`
      CREATE TRIGGER reject_tracker_card_for_test
      BEFORE INSERT ON applications
      BEGIN
        SELECT RAISE(ABORT, 'test tracker write failure');
      END;
    `);

    const failed = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancy-applications',
      headers: { authorization, ...ORIGIN },
      payload: {
        clusterId: 'cluster-1',
        status: 'applied',
        vacancy: {
          title: 'Architect',
          company: 'Example',
          url: 'https://example.test/jobs/1',
          source: 'src-remotive',
        },
      },
    });

    expect(failed.statusCode).toBe(500);
    const legacy = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/vacancy-applications',
      headers: { authorization },
    });
    const tracker = await app.inject({ method: 'GET', url: APPLICATIONS_URL, headers: { authorization } });
    expect(legacy.json().data).toEqual([]);
    expect(tracker.json().data).toEqual([]);
  });

  it('puts and reads back sealed offer terms', async () => {
    const { app, authorization } = await createApp();
    const id = await createCard(app, authorization, 'cluster-1', 'offer');
    const put = await app.inject({
      method: 'PUT',
      url: `${APPLICATIONS_URL}/${id}/offer`,
      headers: { authorization, ...ORIGIN },
      payload: { terms: { baseSalary: 250_000, currency: 'USD' }, respondBy: '2030-03-01' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().data.terms).toEqual({ baseSalary: 250_000, currency: 'USD' });
  });

  it('counts distinct cards per stage they ever reached', async () => {
    const { app, authorization } = await createApp();
    await createCard(app, authorization, 'cluster-1', 'saved');
    await createCard(app, authorization, 'cluster-2', 'interview');
    const funnel = await app.inject({ method: 'GET', url: `${APPLICATIONS_URL}/funnel`, headers: { authorization } });
    expect(funnel.statusCode).toBe(200);
    expect(funnel.json().data.saved).toBe(1);
    expect(funnel.json().data.interview).toBe(1);
  });
});

describe('applications route · S2 manual cards and process profile', () => {
  it('creates a manual card with no vacancy in the pool and a hidden company', async () => {
    const { app, authorization } = await createApp();
    const created = await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL,
      headers: { authorization, ...ORIGIN },
      payload: {
        stage: 'saved',
        manualVacancy: { title: 'Через рекрутера', companyHidden: true, source: 'recruiter' },
      },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().data.clusterId).toBeNull();
    expect(created.json().data.vacancy).toMatchObject({ companyHidden: true, source: 'recruiter' });
  });

  it('rejects a card with neither clusterId nor manualVacancy', async () => {
    const { app, authorization } = await createApp();
    const created = await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL,
      headers: { authorization, ...ORIGIN },
      payload: { stage: 'saved' },
    });
    expect(created.statusCode).toBe(422);
  });

  it('defaults a VP-titled card to the executive process profile', async () => {
    const { app, authorization } = await createApp();
    const created = await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', stage: 'saved', manualVacancy: { ...vacancy, title: 'VP of Engineering' } },
    });
    expect(created.json().data.processProfile).toBe('executive');
  });
});

describe('vacancy-skips route · one transaction that shifts a saved card to archive', () => {
  it('archives the saved card for the skipped clusterId', async () => {
    const { app, authorization } = await createApp();
    const id = await createCard(app, authorization, 'cluster-1', 'saved');

    const skipped = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancy-skips',
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', reasonId: 'geo-format', origin: 'vacancy_card' },
    });
    expect(skipped.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: APPLICATIONS_URL, headers: { authorization } });
    const card = list.json().data.find((a: { id: string }) => a.id === id);
    expect(card.stage).toBe('archived');
    expect(card.closedReason).toBe('geo-format');

    const skips = await app.inject({ method: 'GET', url: '/api/v1/candidate/vacancy-skips', headers: { authorization } });
    expect(skips.json().data).toHaveLength(1);
  });

  it('deletes a skip', async () => {
    const { app, authorization } = await createApp();
    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancy-skips',
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-9', reasonId: 'duplicate', origin: 'kanban' },
    });
    const deleted = await app.inject({
      method: 'DELETE',
      url: '/api/v1/candidate/vacancy-skips/cluster-9',
      headers: { authorization, ...ORIGIN },
    });
    expect(deleted.statusCode).toBe(204);
    const skips = await app.inject({ method: 'GET', url: '/api/v1/candidate/vacancy-skips', headers: { authorization } });
    expect(skips.json().data).toHaveLength(0);
  });
});

function expiredCluster(id: string): VacancyCluster {
  return {
    id,
    canonicalTitle: 'Продуктовый аналитик',
    canonicalCompany: 'FinCloud',
    isRemote: false,
    descriptionSummary: '',
    skills: [],
    primaryUrl: 'https://example.test/jobs/1',
    sources: [],
    firstObservedAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    status: 'archived',
    vacanciesCount: 1,
  };
}

describe('applications route · disappearance from the active pool', () => {
  it('keeps an active application when its vacancy is only absent from the active pool', async () => {
    const engine = new MultiSourceVacancyEngine({});
    (engine as unknown as { clusters: VacancyCluster[] }).clusters = [expiredCluster('cluster-1')];
    const { app, authorization } = await createApp(engine);
    const id = await createCard(app, authorization, 'cluster-1', 'applied');

    const list = await app.inject({ method: 'GET', url: APPLICATIONS_URL, headers: { authorization } });
    const card = list.json().data.find((a: { id: string }) => a.id === id);
    expect(card.stage).toBe('applied');
    expect(card.version).toBe(1);
  });

  it('leaves an unknown clusterId alone (never seen ≠ gone)', async () => {
    const { app, authorization } = await createApp();
    const id = await createCard(app, authorization, 'cluster-never-seen', 'applied');
    const list = await app.inject({ method: 'GET', url: APPLICATIONS_URL, headers: { authorization } });
    const card = list.json().data.find((a: { id: string }) => a.id === id);
    expect(card.stage).toBe('applied');
  });
});

describe('applications route · restore archived card', () => {
  it('returns the card to its previous stage with an optimistic version check', async () => {
    const { app, authorization } = await createApp();
    const id = await createCard(app, authorization, 'cluster-restore', 'interview');
    await app.inject({
      method: 'PATCH',
      url: `${APPLICATIONS_URL}/${id}`,
      headers: { authorization, ...ORIGIN },
      payload: { expectedVersion: 1, stage: 'archived' },
    });

    const restored = await app.inject({
      method: 'POST',
      url: `${APPLICATIONS_URL}/${id}/restore`,
      headers: { authorization, ...ORIGIN },
      payload: { expectedVersion: 2 },
    });

    expect(restored.statusCode).toBe(200);
    expect(restored.json().data).toMatchObject({
      stage: 'interview',
      archiveReason: null,
      archivePreviousStage: null,
      version: 3,
    });
  });

  it('does not restore a card owned by another candidate', async () => {
    const { app, authorization, candidateStore } = await createApp();
    const id = await createCard(app, authorization, 'cluster-private', 'applied');
    const otherCandidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });

    const response = await app.inject({
      method: 'POST',
      url: `${APPLICATIONS_URL}/${id}/restore`,
      headers: { authorization: `Bearer ${otherCandidate.accessToken}`, ...ORIGIN },
      payload: { expectedVersion: 1 },
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 409 when the archived card has changed since the board loaded it', async () => {
    const { app, authorization } = await createApp();
    const id = await createCard(app, authorization, 'cluster-version', 'applied');
    await app.inject({
      method: 'PATCH',
      url: `${APPLICATIONS_URL}/${id}`,
      headers: { authorization, ...ORIGIN },
      payload: { expectedVersion: 1, stage: 'archived' },
    });

    const response = await app.inject({
      method: 'POST',
      url: `${APPLICATIONS_URL}/${id}/restore`,
      headers: { authorization, ...ORIGIN },
      payload: { expectedVersion: 1 },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('application_version_conflict');
  });
});
