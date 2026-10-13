import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { filterApplicationRows, listApplicationsQuerySchema } from './routes/applicationOperationsRoutes';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { apps, config, noSessions, stores, successProvider } from './appTestHarness';

/**
 * Трекер откликов, срез 1 (B251, architecture.md §6 QA):
 * - контракт `/vacancy-applications` не изменился;
 * - этап не понижается старым клиентом;
 * - перенос повторно ничего не дублирует;
 * - 409 на устаревшей версии.
 */
async function createApp() {
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
  });
  apps.push(app);
  stores.push(candidateStore);
  return {
    app,
    authorization: `Bearer ${candidate.accessToken}`,
    candidateStore,
    candidateId: candidate.id,
  };
}

const ORIGIN = { origin: 'http://localhost:3000' };
const APPLICATIONS_URL = '/api/v1/candidate/applications';
const LEGACY_URL = '/api/v1/candidate/vacancy-applications';

const vacancy = {
  title: 'Продуктовый аналитик',
  company: 'FinCloud',
  url: 'https://example.test/jobs/1',
  source: 'src-remotive',
};

async function postApplication(
  app: Awaited<ReturnType<typeof buildApp>>,
  authorization: string,
  clusterId: string,
  stage: 'saved' | 'applied' | 'archived',
  overrides: Partial<typeof vacancy> = {},
) {
  return app.inject({
    method: 'POST',
    url: APPLICATIONS_URL,
    headers: { authorization, ...ORIGIN },
    payload: {
      clusterId,
      stage,
      manualVacancy: { ...vacancy, ...overrides },
    },
  });
}

describe('applications route · CRUD', () => {
  it('creates a card and lists it back', async () => {
    const { app, authorization } = await createApp();

    const created = await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', stage: 'saved', manualVacancy: vacancy },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().data.stage).toBe('saved');
    expect(created.json().data.version).toBe(1);

    const list = await app.inject({
      method: 'GET',
      url: APPLICATIONS_URL,
      headers: { authorization },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(1);
  });

  it('returns attempted until an encrypted delivery receipt is recorded', async () => {
    const { app, authorization } = await createApp();
    const created = await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-receipt', stage: 'applied', manualVacancy: vacancy },
    });
    expect(created.json().data.deliveryReceipt).toBeNull();

    const attempted = await app.inject({
      method: 'GET',
      url: APPLICATIONS_URL,
      headers: { authorization },
    });
    expect(attempted.json().data[0]).toMatchObject({ stage: 'applied', deliveryReceipt: null });

    const id = created.json().data.id;
    const recorded = await app.inject({
      method: 'PATCH',
      url: `${APPLICATIONS_URL}/${id}`,
      headers: { authorization, ...ORIGIN },
      payload: {
        expectedVersion: 1,
        stage: 'applied',
        deliveryReceipt: { kind: 'confirmation_url', value: 'https://jobs.test/confirmation/123' },
      },
    });
    expect(recorded.statusCode).toBe(200);
    expect(recorded.json().data.deliveryReceipt).toEqual({
      kind: 'confirmation_url',
      value: 'https://jobs.test/confirmation/123',
    });
    expect(JSON.stringify(recorded.json().data)).not.toContain('payload_cipher');

    const newAttempt = await app.inject({
      method: 'PATCH',
      url: `${APPLICATIONS_URL}/${id}`,
      headers: { authorization, ...ORIGIN },
      payload: { expectedVersion: 2, stage: 'applied', deliveryReceipt: null },
    });
    expect(newAttempt.json().data.deliveryReceipt).toBeNull();
  });

  it('repeated POST with the same clusterId does not duplicate the card', async () => {
    const { app, authorization } = await createApp();
    await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', stage: 'saved', manualVacancy: vacancy },
    });
    await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', stage: 'saved', manualVacancy: vacancy },
    });
    const list = await app.inject({
      method: 'GET',
      url: APPLICATIONS_URL,
      headers: { authorization },
    });
    expect(list.json().data).toHaveLength(1);
  });

  it('PATCH allows a manual transition in any direction and bumps version', async () => {
    const { app, authorization } = await createApp();
    const created = await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', stage: 'interview', manualVacancy: vacancy },
    });
    const id = created.json().data.id;

    const patched = await app.inject({
      method: 'PATCH',
      url: `${APPLICATIONS_URL}/${id}`,
      headers: { authorization, ...ORIGIN },
      payload: { expectedVersion: 1, stage: 'applied' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.stage).toBe('applied');
    expect(patched.json().data.version).toBe(2);
  });

  it('returns 409 on a stale expectedVersion', async () => {
    const { app, authorization } = await createApp();
    const created = await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', stage: 'saved', manualVacancy: vacancy },
    });
    const id = created.json().data.id;
    await app.inject({
      method: 'PATCH',
      url: `${APPLICATIONS_URL}/${id}`,
      headers: { authorization, ...ORIGIN },
      payload: { expectedVersion: 1, stage: 'applied' },
    });
    const stale = await app.inject({
      method: 'PATCH',
      url: `${APPLICATIONS_URL}/${id}`,
      headers: { authorization, ...ORIGIN },
      payload: { expectedVersion: 1, stage: 'responded' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('application_version_conflict');
    expect(stale.json().error.details).toEqual({ currentVersion: 2 });
  });

  it('requires a candidate session for every verb', async () => {
    const { app } = await createApp();
    expect((await app.inject({ method: 'GET', url: APPLICATIONS_URL })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: APPLICATIONS_URL,
          headers: ORIGIN,
          payload: { clusterId: 'cluster-1', stage: 'saved' },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('rejects a mutating request from an unlisted origin without a bearer token', async () => {
    const { app } = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL,
      headers: { origin: 'https://attacker.test' },
      payload: { clusterId: 'cluster-1', stage: 'saved' },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('applications route · legacy dual-write (architecture.md §4)', () => {
  it('does not change the /vacancy-applications contract', async () => {
    const { app, authorization } = await createApp();
    const opened = await app.inject({
      method: 'POST',
      url: LEGACY_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', status: 'opened', vacancy },
    });
    expect(opened.statusCode).toBe(200);
    expect(Object.keys(opened.json().data).sort()).toEqual(
      ['appliedAt', 'clusterId', 'confirmedBy', 'openedAt', 'status', 'vacancy'].sort(),
    );

    const applied = await app.inject({
      method: 'POST',
      url: LEGACY_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', status: 'applied', vacancy },
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().data.status).toBe('applied');
    expect(applied.json().data.confirmedBy).toBe('candidate');
  });

  it('a confirmed legacy applied advances a fresh tracker card to applied', async () => {
    const { app, authorization } = await createApp();
    await app.inject({
      method: 'POST',
      url: LEGACY_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', status: 'applied', vacancy },
    });
    const list = await app.inject({
      method: 'GET',
      url: APPLICATIONS_URL,
      headers: { authorization },
    });
    expect(list.json().data).toHaveLength(1);
    expect(list.json().data[0].stage).toBe('applied');
  });

  it('never downgrades a card the tracker already moved past applied', async () => {
    const { app, authorization } = await createApp();
    const created = await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', stage: 'interview', manualVacancy: vacancy },
    });
    expect(created.statusCode).toBe(200);

    await app.inject({
      method: 'POST',
      url: LEGACY_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-1', status: 'applied', vacancy },
    });

    const list = await app.inject({
      method: 'GET',
      url: APPLICATIONS_URL,
      headers: { authorization },
    });
    expect(list.json().data).toHaveLength(1);
    expect(list.json().data[0].stage).toBe('interview');
  });
});

describe('applications route · lazy migration (architecture.md §5)', () => {
  it('migrates an old confirmed applied row on first GET, idempotently', async () => {
    const { app, authorization } = await createApp();
    await app.inject({
      method: 'POST',
      url: LEGACY_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-legacy', status: 'applied', vacancy },
    });

    const first = await app.inject({
      method: 'GET',
      url: APPLICATIONS_URL,
      headers: { authorization },
    });
    expect(first.json().data).toHaveLength(1);
    expect(first.json().data[0].stage).toBe('applied');

    const second = await app.inject({
      method: 'GET',
      url: APPLICATIONS_URL,
      headers: { authorization },
    });
    expect(second.json().data).toHaveLength(1);
  });

  it('does not migrate an opened-only legacy row: opening is not "Хочу"', async () => {
    const { app, authorization } = await createApp();
    await app.inject({
      method: 'POST',
      url: LEGACY_URL,
      headers: { authorization, ...ORIGIN },
      payload: { clusterId: 'cluster-opened', status: 'opened', vacancy },
    });

    const list = await app.inject({
      method: 'GET',
      url: APPLICATIONS_URL,
      headers: { authorization },
    });
    expect(list.json().data).toHaveLength(0);
  });
});


describe('B451 applications filters, labels, bulk operations and company wants', () => {
  it('builds repeated list filters and rejects an inverted period', () => {
    const parsed = listApplicationsQuerySchema.parse({
      stage: ['saved', 'applied'],
      channel: ['hh.ru', 'LinkedIn'],
      from: '2000-01-01',
      to: '2100-01-01',
      sort: 'company',
      direction: 'asc',
      limit: '50',
      offset: '10',
    });
    expect(parsed).toMatchObject({
      stage: ['saved', 'applied'],
      channel: ['hh.ru', 'LinkedIn'],
      from: '2000-01-01',
      to: '2100-01-01',
      sort: 'company',
      direction: 'asc',
      limit: 50,
      offset: 10,
    });
    expect(() => listApplicationsQuerySchema.parse({
      from: '2026-11-01',
      to: '2026-10-01',
    })).toThrow();
    const rows = [
      { id: 'kept', stage: 'applied', createdAt: '2026-07-01T00:00:00.000Z',
        vacancy: { source: 'hh.ru' }, labels: [] },
      { id: 'wrong-channel', stage: 'applied', createdAt: '2026-07-01T00:00:00.000Z',
        vacancy: { source: 'manual' }, labels: [] },
      { id: 'wrong-stage', stage: 'archived', createdAt: '2026-07-01T00:00:00.000Z',
        vacancy: { source: 'hh.ru' }, labels: [] },
      { id: 'outside-period', stage: 'applied', createdAt: '1999-07-01T00:00:00.000Z',
        vacancy: { source: 'hh.ru' }, labels: [] },
    ];
    expect(filterApplicationRows(rows, parsed).map(({ id }) => id)).toEqual(['kept']);
  });

  it('returns filtered applications and stage counts together', async () => {
    const { app, authorization } = await createApp();
    await postApplication(app, authorization, 'b451-list-a', 'saved', {
      company: 'Zeta',
      source: 'hh.ru',
    });
    await postApplication(app, authorization, 'b451-list-b', 'applied', {
      company: 'Alpha',
      source: 'hh.ru',
    });
    await postApplication(app, authorization, 'b451-list-c', 'saved', {
      company: 'Other',
      source: 'LinkedIn',
    });

    const url = APPLICATIONS_URL + '?channel=hh.ru&from=2000-01-01&to=2100-01-01&sort=company&direction=asc';
    const response = await app.inject({ url, headers: { authorization } });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.map((item: { vacancy: { company: string } }) => item.vacancy.company))
      .toEqual(['Alpha', 'Zeta']);
    expect(response.json().meta.total).toBe(2);
    expect(response.json().meta.stageCounts).toMatchObject({ saved: 1, applied: 1 });

    const applied = await app.inject({
      url: url + '&stage=applied',
      headers: { authorization },
    });
    expect(applied.json().data).toHaveLength(1);
    expect(applied.json().meta.stageCounts.saved).toBe(1);
  });

  it('creates, assigns and removes application labels idempotently', async () => {
    const { app, authorization } = await createApp();
    const card = await postApplication(app, authorization, 'b451-label', 'saved');
    const labelResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/application-labels',
      headers: { authorization, ...ORIGIN },
      payload: { name: 'Приоритет' },
    });
    expect(labelResponse.statusCode).toBe(201);
    const label = labelResponse.json().data;

    const assign = () => app.inject({
      method: 'PUT',
      url: APPLICATIONS_URL + '/' + card.json().data.id + '/labels/' + label.id,
      headers: { authorization, ...ORIGIN },
    });
    expect((await assign()).json().data.changed).toBe(true);
    expect((await assign()).json().data.changed).toBe(false);

    const list = await app.inject({ url: APPLICATIONS_URL, headers: { authorization } });
    expect(list.json().data[0].labels).toEqual([label]);

    const remove = () => app.inject({
      method: 'DELETE',
      url: APPLICATIONS_URL + '/' + card.json().data.id + '/labels/' + label.id,
      headers: { authorization, ...ORIGIN },
    });
    expect((await remove()).json().data.changed).toBe(true);
    expect((await remove()).json().data.changed).toBe(false);
  });

  it('keeps labels and assignments within the authenticated candidate', async () => {
    const { app, authorization, candidateStore } = await createApp();
    const card = await postApplication(app, authorization, 'b451-label-scope', 'saved');
    const label = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/application-labels',
      headers: { authorization, ...ORIGIN },
      payload: { name: 'Личное' },
    });
    const other = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    const otherAuthorization = `Bearer ${other.accessToken}`;

    const labels = await app.inject({
      url: '/api/v1/candidate/application-labels',
      headers: { authorization: otherAuthorization },
    });
    expect(labels.json().data).toEqual([]);

    const assignment = await app.inject({
      method: 'PUT',
      url: APPLICATIONS_URL + '/' + card.json().data.id + '/labels/' + label.json().data.id,
      headers: { authorization: otherAuthorization, ...ORIGIN },
    });
    expect(assignment.statusCode).toBe(404);
    expect(assignment.json().error.code).toBe('application_not_found');
  });

  it('previews, confirms and replays a filtered close operation', async () => {
    const { app, authorization } = await createApp();
    await postApplication(app, authorization, 'b451-bulk-a', 'saved');
    await postApplication(app, authorization, 'b451-bulk-b', 'saved');
    const filters = { stage: ['saved'] };
    const action = { type: 'close' } as const;
    const preview = await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL + '/bulk/preview',
      headers: { authorization, ...ORIGIN },
      payload: { filters, action },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().data.affectedCount).toBe(2);

    const execute = (
      confirmCount: number,
      nextAction: { type: 'close' } | { type: 'set_stage'; stage: 'archived' } = action,
    ) => app.inject({
      method: 'POST',
      url: APPLICATIONS_URL + '/bulk',
      headers: { authorization, ...ORIGIN },
      payload: {
        operationId: 'b451-close-1',
        filters,
        action: nextAction,
        confirmCount,
      },
    });
    expect((await execute(1)).statusCode).toBe(409);
    const applied = await execute(2);
    expect(applied.statusCode).toBe(200);
    expect(applied.json().data.changedCount).toBe(2);
    expect((await execute(2)).json().data.replayed).toBe(true);
    expect((await execute(2, { type: 'set_stage', stage: 'archived' })).statusCode).toBe(409);

    const list = await app.inject({
      url: APPLICATIONS_URL + '?stage=archived',
      headers: { authorization },
    });
    expect(list.json().data).toHaveLength(2);
    const first = list.json().data[0] as { id: string; version: number };
    const restored = await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL + '/' + first.id + '/restore',
      headers: { authorization, ...ORIGIN },
      payload: { expectedVersion: first.version },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().data.stage).toBe('saved');

    const statusPreview = await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL + '/bulk/preview',
      headers: { authorization, ...ORIGIN },
      payload: { filters: { stage: ['saved'] }, action: { type: 'set_stage', stage: 'responded' } },
    });
    expect(statusPreview.json().data.affectedCount).toBe(1);
    const statusChange = await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL + '/bulk',
      headers: { authorization, ...ORIGIN },
      payload: {
        operationId: 'b451-status-1',
        filters: { stage: ['saved'] },
        action: { type: 'set_stage', stage: 'responded' },
        confirmCount: 1,
      },
    });
    expect(statusChange.statusCode).toBe(200);
    expect(statusChange.json().data.changedCount).toBe(1);
  });

  it('prepares retries for failed delivery without sending them', async () => {
    const { app, authorization } = await createApp();
    const card = await postApplication(app, authorization, 'b451-retry', 'applied');
    const failed = await app.inject({
      method: 'PATCH',
      url: APPLICATIONS_URL + '/' + card.json().data.id,
      headers: { authorization, ...ORIGIN },
      payload: {
        expectedVersion: 1,
        deliveryReceipt: { kind: 'failure_note', value: 'Канал отказал' },
      },
    });
    expect(failed.statusCode).toBe(200);
    const filters = { stage: ['applied'] };
    const action = { type: 'retry' };
    const preview = await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL + '/bulk/preview',
      headers: { authorization, ...ORIGIN },
      payload: { filters, action },
    });
    expect(preview.json().data.affectedCount).toBe(1);

    const retry = await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL + '/bulk',
      headers: { authorization, ...ORIGIN },
      payload: {
        operationId: 'b451-retry-1',
        filters,
        action,
        confirmCount: 1,
      },
    });
    expect(retry.json().data).toMatchObject({
      state: 'prepared',
      preparedCount: 1,
      sentCount: 0,
    });
  });

  it('batch-adds, updates and removes candidate company wants idempotently', async () => {
    const { app, authorization } = await createApp();
    const url = '/api/v1/candidate/applications/company-wants';
    const add = {
      operationId: 'b451-wants-add',
      action: 'add',
      confirmCount: 2,
      companies: [{ companyName: 'Альфа' }, { companyName: 'Бета' }],
    };
    const preview = await app.inject({
      method: 'POST',
      url: url + '/bulk/preview',
      headers: { authorization, ...ORIGIN },
      payload: { action: add.action, companies: add.companies },
    });
    expect(preview.json().data.affectedCount).toBe(2);
    const created = await app.inject({
      method: 'POST',
      url: url + '/bulk',
      headers: { authorization, ...ORIGIN },
      payload: add,
    });
    expect(created.statusCode).toBe(200);
    const duplicate = await app.inject({
      method: 'POST',
      url: url + '/bulk',
      headers: { authorization, ...ORIGIN },
      payload: add,
    });
    expect(duplicate.json().data.replayed).toBe(true);

    const list = await app.inject({ url, headers: { authorization } });
    expect(list.json().data).toHaveLength(2);
    const nextStep = await app.inject({
      method: 'POST',
      url: url + '/bulk',
      headers: { authorization, ...ORIGIN },
      payload: {
        operationId: 'b451-wants-status',
        action: 'set_next_step',
        confirmCount: 1,
        companies: [{ companyName: 'Альфа', nextStep: 'Написать знакомому', nextStepDueAt: '2026-10-15' }],
      },
    });
    expect(nextStep.statusCode).toBe(200);
    expect(nextStep.json().data.changedCount).toBe(1);
    const remove = await app.inject({
      method: 'POST',
      url: url + '/bulk',
      headers: { authorization, ...ORIGIN },
      payload: {
        operationId: 'b451-wants-remove',
        action: 'remove',
        confirmCount: 1,
        companies: [{ companyName: 'Бета' }],
      },
    });
    expect(remove.statusCode).toBe(200);
    expect((await app.inject({ url, headers: { authorization } })).json().data).toHaveLength(1);
  });

  it('executes a confirmed status operation on 1,000 SQLite applications under one second', async () => {
    const { app, authorization, candidateStore, candidateId } = await createApp();
    for (let index = 0; index < 1_000; index += 1) {
      candidateStore.createApplication(candidateId, {
        clusterId: 'b451-performance-' + index,
        stage: 'saved',
        manualVacancy: { ...vacancy, company: 'Компания ' + index, source: 'hh.ru' },
      });
    }
    const filters = { stage: ['saved'], channel: ['hh.ru'] };
    const action = { type: 'close' };
    const previewStart = performance.now();
    const preview = await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL + '/bulk/preview',
      headers: { authorization, ...ORIGIN },
      payload: { filters, action },
    });
    const previewMs = performance.now() - previewStart;
    const executionStart = performance.now();
    const execution = await app.inject({
      method: 'POST',
      url: APPLICATIONS_URL + '/bulk',
      headers: { authorization, ...ORIGIN },
      payload: {
        operationId: 'b451-1000-close',
        filters,
        action,
        confirmCount: 1_000,
      },
    });
    const executionMs = performance.now() - executionStart;
    expect(preview.json().data.affectedCount).toBe(1_000);
    expect(execution.json().data.changedCount).toBe(1_000);
    expect(executionMs, `preview ${previewMs.toFixed(0)} ms; execution`).toBeLessThan(1_000);
  });
});
