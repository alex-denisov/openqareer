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
    const { app, authorization } = await createApp();
    const id = await createCard(app, authorization, 'cluster-1');
    const response = await app.inject({
      method: 'POST',
      url: `${APPLICATIONS_URL}/${id}/events`,
      headers: { authorization, ...ORIGIN },
      payload: { kind: 'follow_up_sent', occurredAt: '2030-01-01T00:00:00.000Z' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.stage).toBe('applied');
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

describe('applications route · vacancy closed on the platform (owner decision 2026-09-23 22:26)', () => {
  it('auto-archives the card with a system event and vacancy_closed reason, idempotently', async () => {
    const engine = new MultiSourceVacancyEngine({});
    (engine as unknown as { clusters: VacancyCluster[] }).clusters = [expiredCluster('cluster-1')];
    const { app, authorization } = await createApp(engine);
    const id = await createCard(app, authorization, 'cluster-1', 'applied');

    const firstRead = await app.inject({ method: 'GET', url: APPLICATIONS_URL, headers: { authorization } });
    const firstCard = firstRead.json().data.find((a: { id: string }) => a.id === id);
    expect(firstCard.stage).toBe('archived');
    expect(firstCard.closedReason).toBe('vacancy_closed');

    // Idempotent: a second read does not append a second system event.
    await app.inject({ method: 'GET', url: APPLICATIONS_URL, headers: { authorization } });
    const secondRead = await app.inject({ method: 'GET', url: APPLICATIONS_URL, headers: { authorization } });
    const secondCard = secondRead.json().data.find((a: { id: string }) => a.id === id);
    expect(secondCard.version).toBe(firstCard.version);
  });

  it('leaves an unknown clusterId alone (never seen ≠ gone)', async () => {
    const { app, authorization } = await createApp();
    const id = await createCard(app, authorization, 'cluster-never-seen', 'applied');
    const list = await app.inject({ method: 'GET', url: APPLICATIONS_URL, headers: { authorization } });
    const card = list.json().data.find((a: { id: string }) => a.id === id);
    expect(card.stage).toBe('applied');
  });
});
