import Fastify from 'fastify';
import type { LightMyRequestResponse } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CandidateAutomationRules } from '../domain/candidateAutomation';
import { DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE } from '../candidate/candidateAutomationScheduler';
import { SqliteCandidateActionRepository } from '../candidate/sqliteCandidateActionRepository';
import { SqliteCandidateAutomationRepository } from '../candidate/sqliteCandidateAutomationRepository';
import { config } from '../appTestHarness';
import { registerCandidateAutomationRoutes } from './candidateAutomationRoutes';

const headers = { authorization: 'Bearer session', origin: config.allowedOrigins[0] };
const rules: CandidateAutomationRules = {
  roles: ['Head of Engineering'],
  minimumMatchPercent: 80,
  platforms: ['hh', 'linkedin'],
  excludeStopCompanies: true,
};

const clusters = new Map([
  ['cluster-a', cluster('cluster-a', 'Acme', 'Head of Engineering')],
  ['cluster-b', cluster('cluster-b', 'Blocked Co', 'Head of Engineering')],
  ['cluster-b2', cluster('cluster-b2', 'Blocked Co', 'Director of Engineering')],
  ['cluster-c', cluster('cluster-c', 'Example', 'Head of Engineering')],
  ['cluster-d', cluster('cluster-d', 'Other', 'Head of Engineering')],
  [
    'cluster-low',
    {
      ...cluster('cluster-low', 'Low Match', 'Head of Engineering'),
      skills: ['TypeScript', 'Node.js', 'Go', 'Rust', 'Scala'],
    },
  ],
  [
    'cluster-unsafe',
    {
      ...cluster('cluster-unsafe', 'Unsafe', 'Head of Engineering'),
      primaryUrl: 'https://evil.example/job/1',
    },
  ],
]);
const cleanup: Array<() => Promise<void>> = [];
type Inject = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
) => Promise<LightMyRequestResponse>;

afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

function cluster(id: string, company: string, title: string) {
  return {
    id,
    canonicalTitle: title,
    canonicalCompany: company,
    primaryUrl: `https://hh.ru/vacancy/${id}`,
    skills: ['TypeScript', 'Node.js', 'AWS', 'Distributed systems'],
    status: 'active',
    isRemote: false,
  };
}

async function setup(tier: 'free' | 'pro' = 'pro', rejected = false) {
  const db = new DatabaseSync(':memory:');
  db.exec(
    "CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT; INSERT INTO candidates VALUES ('alice');",
  );
  const repository = new SqliteCandidateAutomationRepository(db, config.dataEncryptionKey);
  const actionRepository = new SqliteCandidateActionRepository(db);
  const app = Fastify();
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  const candidate = { id: 'alice', locale: 'ru-RU', dataClass: 'synthetic', createdAt: '' };
  const applications: Array<Record<string, unknown>> = rejected
    ? [
        {
          id: 'rejected-a',
          clusterId: null,
          stage: 'rejected',
          vacancy: { company: 'Declined Co' },
        },
      ]
    : [];
  const listApplications = vi.fn(() => applications);
  const getApplication = vi.fn(
    (_candidateId: string, id: string) => applications.find((item) => item.id === id) ?? null,
  );
  const candidateStore = {
    authenticate: (token: string) => (token === 'session' ? candidate : null),
    getSnapshot: () => ({
      memory: ['TypeScript', 'Node.js', 'AWS', 'Distributed systems'].map((statement) => ({
        kind: 'fact',
        domain: 'skill',
        confidence: 'candidate-confirmed',
        statement,
      })),
      documents: [{ id: 'resume-a', kind: 'resume', fileName: 'CV.pdf', version: 2 }],
    }),
    listApplications,
    getApplication,
    createApplication: vi.fn(
      (_candidateId: string, input: { clusterId: string; manualVacancy: unknown }) => {
        const application = {
          id: `application-${input.clusterId}`,
          clusterId: input.clusterId,
          stage: 'saved',
          vacancy: input.manualVacancy,
          version: 1,
        };
        applications.push(application);
        return application;
      },
    ),
  };
  const authService = {
    authenticate: (token: string) =>
      token === 'session' ? { userId: 'user-a', candidate, role: 'candidate' } : null,
    getUser: () => ({
      candidateId: 'alice',
      subscriptionTier: tier,
      subscriptionStatus: 'active',
      subscriptionExpiresAt: null,
    }),
  };
  const getActiveCluster = vi.fn((id: string) => clusters.get(id));
  const deps = {
    config,
    authService,
    candidateStore,
    candidateAutomationRepository: repository,
    candidateActionRepository: actionRepository,
    multiSourceEngine: { getActiveCluster },
  } as never;
  registerCandidateAutomationRoutes(app, deps);
  cleanup.push(async () => {
    await app.close();
    db.close();
  });
  const inject: Inject = (method, url, payload) =>
    app.inject({
      method,
      url,
      headers,
      ...(payload === undefined ? {} : { payload }),
    });
  return {
    app,
    inject,
    repository,
    actionRepository,
    candidateStore,
    listApplications,
    getApplication,
    getActiveCluster,
  };
}

async function enable(
  inject: Inject,
  mode: 'drafts_only' | 'approval_required' | 'automatic' = 'approval_required',
) {
  return inject('POST', '/api/v1/candidate/automation/enable', {
    mode,
    consentKeys:
      mode === 'automatic'
        ? ['drafts', 'send_after_approval', 'notifications', 'automatic_submission']
        : ['drafts', 'send_after_approval', 'notifications'],
    rules,
  });
}

describe('candidate automation API (B452)', () => {
  it('records exact consent text and dates; automatic mode fails closed outside active Pro', async () => {
    const free = await setup('free');
    const missingConsent = await free.inject('POST', '/api/v1/candidate/automation/enable', {
      mode: 'automatic',
      consentKeys: ['drafts', 'send_after_approval', 'notifications'],
      rules,
    });
    expect(missingConsent.statusCode).toBe(400);
    const denied = await enable(free.inject, 'automatic');
    expect(denied.statusCode).toBe(402);
    expect(free.repository.listConsents('alice')).toEqual([]);

    const enabled = await enable(free.inject);
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json().data.settings).toMatchObject({
      enabled: true,
      mode: 'approval_required',
    });
    expect(enabled.json().data.consents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'drafts',
          acceptedAt: expect.any(String),
          text: expect.any(String),
        }),
        expect.objectContaining({
          key: 'send_after_approval',
          acceptedAt: expect.any(String),
          text: expect.any(String),
        }),
        expect.objectContaining({
          key: 'notifications',
          acceptedAt: expect.any(String),
          text: expect.any(String),
        }),
      ]),
    );
    expect(enabled.json().data.linkedinPublishing).toMatchObject({ enabled: false });
  });

  it('builds only server-verified queue items, honors stop companies and previews owned materials', async () => {
    const { inject, repository, candidateStore, listApplications } = await setup();
    await enable(inject);
    repository.addStopCompany('alice', 'Blocked Co', 'manual');
    const response = await inject('POST', '/api/v1/candidate/automation/queue/refresh', {
      opportunities: [
        {
          clusterId: 'cluster-a',
          letterText: 'Письмо кандидата',
          materialDocumentIds: ['resume-a'],
        },
        { clusterId: 'cluster-b', letterText: 'Не добавлять', materialDocumentIds: [] },
        { clusterId: 'cluster-c', letterText: '', materialDocumentIds: ['not-owned'] },
        {
          clusterId: 'cluster-d',
          applicationId: 'foreign-application',
          letterText: 'Чужая карточка',
          materialDocumentIds: [],
        },
        { clusterId: 'cluster-low', letterText: 'Низкое совпадение', materialDocumentIds: [] },
        { clusterId: 'cluster-unsafe', letterText: 'Недоверенная ссылка', materialDocumentIds: [] },
      ],
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data).toMatchObject({ added: 1, skipped: 5 });
    expect(candidateStore.createApplication).toHaveBeenCalledTimes(1);
    expect(candidateStore.getApplication).toHaveBeenCalledWith('alice', 'foreign-application');
    expect(listApplications).not.toHaveBeenCalled();
    const item = response.json().data.items[0];
    expect(item).toMatchObject({
      status: 'pending_approval',
      displayStatus: 'will_send_today',
      company: 'Acme',
      letterReady: true,
      materialCount: 1,
    });
    const preview = await inject('GET', `/api/v1/candidate/automation/queue/${item.id}/preview`);
    expect(preview.json().data).toMatchObject({
      letterText: 'Письмо кандидата',
      materials: [{ documentId: 'resume-a', fileName: 'CV.pdf' }],
    });
  });

  it('approves, pauses, resumes, removes and bulk-selects only candidate-owned queue entries', async () => {
    const { inject, repository } = await setup();
    await enable(inject);
    const created = await inject('POST', '/api/v1/candidate/automation/queue/refresh', {
      opportunities: [
        { clusterId: 'cluster-a', letterText: 'Письмо A', materialDocumentIds: [] },
        { clusterId: 'cluster-c', letterText: 'Письмо C', materialDocumentIds: [] },
      ],
    });
    const [first, second] = created.json().data.items;
    expect(
      (await inject('POST', '/api/v1/candidate/automation/pause', { days: 2 })).statusCode,
    ).toBe(200);
    expect(
      (
        await inject('POST', `/api/v1/candidate/automation/queue/${first.id}/actions`, {
          action: 'approve_and_send',
        })
      ).statusCode,
    ).toBe(409);
    await inject('DELETE', '/api/v1/candidate/automation/pause');
    const approved = await inject(
      'POST',
      `/api/v1/candidate/automation/queue/${first.id}/actions`,
      { action: 'approve_and_send' },
    );
    expect(approved.json().data.item).toMatchObject({
      status: 'approved',
      displayStatus: 'approved',
    });
    expect(repository.getQueueItem('alice', first.id)?.payload.approvalType).toBe('candidate');
    const bulk = await inject('POST', '/api/v1/candidate/automation/queue/bulk', {
      filter: { status: 'pending_approval' },
      action: 'remove',
    });
    expect(bulk.json().data).toMatchObject({ matched: 1, updated: 1 });
    expect(repository.getQueueItem('alice', second.id)?.status).toBe('removed');
  });

  it('edits an unready letter, hands off to a consultant, and stops a company across the queue', async () => {
    const { inject, repository } = await setup();
    await enable(inject);
    const created = await inject('POST', '/api/v1/candidate/automation/queue/refresh', {
      opportunities: [
        { clusterId: 'cluster-a', letterText: '', materialDocumentIds: [] },
        { clusterId: 'cluster-b', letterText: 'Письмо B', materialDocumentIds: [] },
        { clusterId: 'cluster-b2', letterText: 'Письмо B2', materialDocumentIds: [] },
      ],
    });
    const [unready, blockedCompany, sameCompany] = created.json().data.items;
    expect(unready.status).toBe('letter_not_ready');
    const edited = await inject(
      'PATCH',
      `/api/v1/candidate/automation/queue/${unready.id}/letter`,
      { letterText: 'Письмо после правки' },
    );
    expect(edited.json().data.item).toMatchObject({
      status: 'pending_approval',
      letterReady: true,
    });
    const consultant = await inject(
      'POST',
      `/api/v1/candidate/automation/queue/${unready.id}/actions`,
      { action: 'consultant' },
    );
    expect(consultant.json().data.item.status).toBe('consultant');

    const stopped = await inject(
      'POST',
      `/api/v1/candidate/automation/queue/${blockedCompany.id}/actions`,
      { action: 'stop_company' },
    );
    expect(stopped.json().data.item.status).toBe('removed');
    expect(repository.listStopCompanies('alice')).toEqual([
      expect.objectContaining({ company: 'Blocked Co', origin: 'manual' }),
    ]);
    expect(repository.getQueueItem('alice', blockedCompany.id)?.payload.targetUrl).toBe('');
    expect(repository.getQueueItem('alice', sameCompany.id)?.status).toBe('removed');
  });

  it('automatically approves only ready items after the separate active-Pro consent', async () => {
    const { inject, repository } = await setup('pro');
    expect((await enable(inject, 'automatic')).statusCode).toBe(200);
    const created = await inject('POST', '/api/v1/candidate/automation/queue/refresh', {
      opportunities: [
        { clusterId: 'cluster-a', letterText: 'Письмо кандидата', materialDocumentIds: [] },
      ],
    });
    const item = created.json().data.items[0];
    expect(item.status).toBe('approved');
    expect(repository.getQueueItem('alice', item.id)?.payload).toMatchObject({
      approvalType: 'automatic_consent',
    });
    const revoked = await inject(
      'POST',
      '/api/v1/candidate/automation/consents/automatic_submission/revoke',
    );
    expect(revoked.json().data.settings.enabled).toBe(false);
    expect(repository.getQueueItem('alice', item.id)?.status).toBe('pending_approval');
  });

  it('rechecks consent after reading a vacancy before automatically approving it', async () => {
    const { inject, repository, getActiveCluster } = await setup('pro');
    await enable(inject, 'automatic');
    getActiveCluster.mockImplementationOnce((id) => {
      repository.revokeConsent('alice', 'automatic_submission');
      return clusters.get(id);
    });
    const created = await inject('POST', '/api/v1/candidate/automation/queue/refresh', {
      opportunities: [
        { clusterId: 'cluster-a', letterText: 'Письмо кандидата', materialDocumentIds: [] },
      ],
    });
    expect(created.json().data).toMatchObject({ added: 0, skipped: 1 });
    expect(repository.countQueue('alice')).toBe(0);
  });

  it('imports rejected companies as stops and rejects missing consent or unsafe origins', async () => {
    const { inject, repository, app, listApplications, getApplication } = await setup('pro', true);
    expect((await app.inject('/api/v1/candidate/automation')).statusCode).toBe(401);
    const badOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/automation/enable',
      headers: { cookie: 'openqareer_session=session', origin: 'https://evil.example' },
      payload: { mode: 'approval_required', consentKeys: [] },
    });
    expect(badOrigin.statusCode).toBe(403);
    const importResponse = await inject(
      'POST',
      '/api/v1/candidate/automation/stop-companies/import-rejections',
      { applicationIds: ['rejected-a'] },
    );
    expect(importResponse.json().data).toMatchObject({ imported: 1 });
    expect(getApplication).toHaveBeenCalledWith('alice', 'rejected-a');
    expect(listApplications).not.toHaveBeenCalled();
    expect(repository.listStopCompanies('alice')).toEqual([
      expect.objectContaining({ company: 'Declined Co', origin: 'rejection' }),
    ]);
    expect(
      (
        await inject('POST', '/api/v1/candidate/automation/enable', {
          mode: 'approval_required',
          consentKeys: ['drafts'],
        })
      ).statusCode,
    ).toBe(400);
  });

  it('rate-limits bounded queue refresh requests per client', async () => {
    const { inject } = await setup();
    await enable(inject);
    const payload = {
      opportunities: [{ clusterId: 'cluster-a', letterText: 'Письмо', materialDocumentIds: [] }],
    };
    const responses = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      responses.push(await inject('POST', '/api/v1/candidate/automation/queue/refresh', payload));
    }
    expect(responses.slice(0, 10).every((response) => response.statusCode === 200)).toBe(true);
    expect(responses[10]?.statusCode).toBe(429);
  });

  it('saves only executor-bounded schedule settings and shows runtime status', async () => {
    const { inject, repository } = await setup();
    const initial = await inject('GET', '/api/v1/candidate/automation/schedule');
    expect(initial.json().data).toMatchObject({
      schedule: DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE,
      runtime: { status: 'ready' },
    });

    const rejected = await inject('PUT', '/api/v1/candidate/automation/schedule', {
      ...DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE,
      dailyLimits: { hh: 16, linkedin: 10 },
    });
    expect(rejected.statusCode).toBe(400);

    const saved = await inject('PUT', '/api/v1/candidate/automation/schedule', {
      ...DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE,
      dailyLimits: { hh: 12, linkedin: 8 },
      minPauseMinutes: 3,
    });
    expect(saved.statusCode).toBe(200);
    expect(repository.schedulerRepository.getSchedule('alice')).toMatchObject({
      dailyLimits: { hh: 12, linkedin: 8 },
      minPauseMinutes: 3,
    });
  });

  it('uses the emergency pause to stop B370 actions and resumes only on a candidate request', async () => {
    const { inject, repository, actionRepository } = await setup();
    const stopped = await inject('POST', '/api/v1/candidate/automation/emergency-pause', {});
    expect(stopped.statusCode).toBe(200);
    expect(repository.schedulerRepository.getRuntime('alice')).toMatchObject({
      emergencyPaused: true,
      status: 'paused',
    });
    expect(actionRepository.isKillSwitchActive('hh', 'alice')).toBe(true);
    expect(actionRepository.isKillSwitchActive('linkedin', 'alice')).toBe(true);

    await inject('DELETE', '/api/v1/candidate/automation/pause');
    expect(repository.schedulerRepository.getRuntime('alice').emergencyPaused).toBe(false);
    expect(actionRepository.isKillSwitchActive('hh', 'alice')).toBe(false);
  });

  it('filters the immutable journal by result, channel, and period and exports formula-safe owned rows', async () => {
    const { inject, repository } = await setup();
    const item = repository.addQueueItem(
      'alice',
      {
        clusterId: 'journal-a',
        applicationId: 'application-a',
        platform: 'hh',
        title: 'Role',
        role: 'Role',
        company: '=SUM(1,1)',
        targetUrl: 'https://hh.ru/vacancy/1',
        requirements: { matched: 4, total: 5 },
        letterText: 'Private letter',
        materials: [],
      },
      'today',
      true,
      '2026-10-10T07:00:00.000Z',
    );
    repository.schedulerRepository.appendJournalEntry({
      candidateId: 'alice',
      queueItemId: item.id,
      platform: 'hh',
      result: 'error',
      receiptStatus: 'failed',
      attempted: true,
      localDate: '2026-10-10',
      company: '=SUM(1,1)',
      occurredAt: new Date().toISOString(),
      receiptId: 'receipt-safe',
      failureCode: 'provider_error',
    });

    const listed = await inject(
      'GET',
      '/api/v1/candidate/automation/journal?result=error&platform=hh&periodDays=7',
    );
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data.entries).toMatchObject([
      { result: 'error', platform: 'hh', receiptId: 'receipt-safe' },
    ]);
    const exported = await inject('GET', '/api/v1/candidate/automation/journal/export');
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(exported.body).toContain("'=SUM");
    expect(exported.body).not.toContain('Private letter');
    expect(exported.body).not.toContain('https://hh.ru/vacancy/1');
  });

  it('fails closed when the candidate device executor is unavailable', async () => {
    const { inject, app } = await setup();
    const response = await inject('POST', '/api/v1/candidate/automation/dispatch', {});
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('runner_not_connected');
    expect((await app.inject('/api/v1/candidate/automation/journal/export')).statusCode).toBe(401);
    const badOrigin = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/automation/schedule',
      headers: { cookie: 'openqareer_session=session', origin: 'https://evil.example' },
      payload: DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE,
    });
    expect(badOrigin.statusCode).toBe(403);
  });
});
