import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  SqliteCandidateAutomationRepository,
  type CandidateAutomationQueuePayload,
} from './sqliteCandidateAutomationRepository';
import { DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE } from './candidateAutomationScheduler';

const KEY = Buffer.alloc(32, 12);

function setup() {
  const database = new DatabaseSync(':memory:');
  database.exec(
    "CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT; INSERT INTO candidates VALUES ('alice');",
  );
  const repository = new SqliteCandidateAutomationRepository(database, KEY);
  return { database, repository };
}

function queuePayload(overrides: Partial<CandidateAutomationQueuePayload> = {}) {
  return {
    clusterId: 'cluster-a',
    applicationId: 'application-a',
    platform: 'hh' as const,
    title: 'Head of Engineering',
    role: 'Head of Engineering',
    company: 'Acme',
    targetUrl: 'https://hh.ru/vacancy/1',
    requirements: { matched: 4, total: 5 },
    letterText: 'Confidential letter text',
    materials: [
      { documentId: 'resume-a', kind: 'resume' as const, fileName: 'CV.pdf', version: 2 },
    ],
    ...overrides,
  };
}

describe('SqliteCandidateAutomationRepository', () => {
  it('returns disabled defaults and persists candidate consents with their exact text and date', () => {
    const { repository } = setup();
    expect(repository.getSettings('alice').enabled).toBe(false);
    repository.acceptConsent(
      'alice',
      'send_after_approval',
      'B452-1',
      'Текст согласия',
      '2026-10-10T10:00:00.000Z',
    );
    expect(repository.listConsents('alice')).toEqual([
      expect.objectContaining({
        key: 'send_after_approval',
        version: 'B452-1',
        text: 'Текст согласия',
        acceptedAt: '2026-10-10T10:00:00.000Z',
        revokedAt: null,
      }),
    ]);
  });

  it('encrypts queue previews and requires a letter before approval', () => {
    const { database, repository } = setup();
    const item = repository.addQueueItem(
      'alice',
      queuePayload(),
      'today',
      false,
      '2026-10-10T10:00:00.000Z',
    );
    const stored = database
      .prepare('SELECT payload_cipher FROM candidate_auto_apply_queue')
      .get() as { payload_cipher: string };
    expect(stored.payload_cipher).not.toContain('Confidential letter text');
    expect(stored.payload_cipher).not.toContain('https://hh.ru/vacancy/1');
    expect(item).toMatchObject({ status: 'pending_approval', payload: queuePayload() });

    const missing = repository.addQueueItem(
      'alice',
      queuePayload({ clusterId: 'cluster-b', letterText: '' }),
      'later',
      false,
      '2026-10-10T10:00:00.000Z',
    );
    expect(missing.status).toBe('letter_not_ready');
    expect(() => repository.transitionQueueItem('alice', missing.id, 'approve')).toThrow(
      'automation_letter_not_ready',
    );
  });

  it('scrubs private payload and appends an immutable removal event', () => {
    const { database, repository } = setup();
    const item = repository.addQueueItem('alice', queuePayload(), 'today', false);
    repository.transitionQueueItem('alice', item.id, 'remove');
    expect(repository.getQueueItem('alice', item.id)?.payload).toMatchObject({
      company: 'Acme',
      letterText: '',
      targetUrl: '',
      materials: [],
    });
    expect(
      repository.schedulerRepository.listJournal('alice', {
        now: new Date(Date.now() + 1_000).toISOString(),
      }),
    ).toMatchObject([
      { queueItemId: item.id, result: 'removed', attempted: false, company: 'Acme' },
    ]);
    expect(() =>
      database.prepare(`UPDATE candidate_auto_apply_journal SET result = 'delivered'`).run(),
    ).toThrow('automation_journal_immutable');
    expect(() => database.prepare('DELETE FROM candidate_auto_apply_journal').run()).toThrow(
      'automation_journal_immutable',
    );
  });

  it('merges manual and rejection stops by normalized company name', () => {
    const { repository } = setup();
    repository.addStopCompany('alice', 'Acme Group', 'rejection', '2026-10-10T10:00:00.000Z');
    repository.addStopCompany('alice', '  ACME\u00a0GROUP ', 'manual', '2026-10-10T10:01:00.000Z');
    expect(repository.listStopCompanies('alice')).toEqual([
      expect.objectContaining({ company: 'ACME GROUP', origin: 'manual' }),
    ]);
    expect(repository.removeStopCompany('alice', 'acme group')).toBe(true);
    expect(repository.listStopCompanies('alice')).toEqual([]);
  });

  it('withdrawal disables the mode and returns approved entries to candidate review', () => {
    const { repository } = setup();
    repository.acceptConsent('alice', 'automatic_submission', 'B452-1', 'Отдельное согласие');
    repository.saveSettings('alice', {
      enabled: true,
      mode: 'automatic',
      rules: {
        roles: ['Head of Engineering'],
        minimumMatchPercent: 80,
        platforms: ['hh'],
        excludeStopCompanies: true,
      },
    });
    const item = repository.addQueueItem('alice', queuePayload(), 'today', true);

    expect(repository.revokeConsent('alice', 'automatic_submission')).toBe(true);
    expect(repository.getSettings('alice').enabled).toBe(false);
    expect(repository.getQueueItem('alice', item.id)).toMatchObject({
      status: 'pending_approval',
      payload: { letterText: 'Confidential letter text' },
    });
    expect(repository.getQueueItem('alice', item.id)?.payload.approvalType).toBeUndefined();
  });

  it('encrypts schedule settings and persists an emergency pause', () => {
    const { database, repository } = setup();
    repository.schedulerRepository.saveSchedule(
      'alice',
      DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE,
      '2026-10-12T07:00:00.000Z',
    );
    const stored = database
      .prepare('SELECT schedule_cipher FROM candidate_auto_apply_schedule WHERE candidate_id = ?')
      .get('alice') as { schedule_cipher: string };
    expect(stored.schedule_cipher).not.toContain('Europe/Moscow');
    expect(repository.schedulerRepository.getSchedule('alice')).toEqual(
      DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE,
    );

    repository.schedulerRepository.setEmergencyPause('alice', true, '2026-10-12T07:01:00.000Z');
    expect(repository.schedulerRepository.getRuntime('alice')).toMatchObject({
      emergencyPaused: true,
      status: 'paused',
    });
  });

  it('keeps a candidate-scoped append-only journal and counts actual attempts by local day', () => {
    const { repository } = setup();
    const item = repository.addQueueItem('alice', queuePayload(), 'today', true);
    repository.schedulerRepository.appendJournalEntry({
      candidateId: 'alice',
      queueItemId: item.id,
      platform: 'hh',
      result: 'error',
      receiptStatus: 'attempted',
      attempted: true,
      localDate: '2026-10-12',
      company: 'Acme',
      occurredAt: '2026-10-12T07:02:00.000Z',
      receiptId: 'receipt-a',
      failureCode: 'provider_error',
    });

    expect(
      repository.schedulerRepository.listJournal('alice', {
        periodDays: 30,
        now: '2026-10-12T07:03:00.000Z',
      }),
    ).toMatchObject([
      {
        platform: 'hh',
        result: 'error',
        company: 'Acme',
        receiptId: 'receipt-a',
        failureCode: 'provider_error',
      },
    ]);
    expect(
      repository.schedulerRepository.listJournal('bob', {
        periodDays: 30,
        now: '2026-10-12T07:03:00.000Z',
      }),
    ).toEqual([]);
    expect(repository.schedulerRepository.countDailyAttempts('alice', '2026-10-12', 'hh')).toBe(1);
  });

  it('reinstalls the idempotent scheduler schema and clears candidate records on deletion', () => {
    const { database, repository } = setup();
    repository.schedulerRepository.saveSchedule('alice', DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE);
    repository.schedulerRepository.appendJournalEntry({
      candidateId: 'alice',
      queueItemId: 'deleted-queue',
      platform: 'hh',
      result: 'removed',
      attempted: false,
      localDate: '2026-10-10',
      company: 'Acme',
      occurredAt: '2026-10-10T07:00:00.000Z',
    });
    const restarted = new SqliteCandidateAutomationRepository(database, KEY);
    expect(restarted.schedulerRepository.getSchedule('alice')).toEqual(
      DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE,
    );

    database.prepare("DELETE FROM candidates WHERE id = 'alice'").run();

    expect(
      database.prepare('SELECT COUNT(*) AS count FROM candidate_auto_apply_journal').get(),
    ).toMatchObject({ count: 0 });
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM candidate_auto_apply_schedule').get(),
    ).toMatchObject({ count: 0 });
  });
});
