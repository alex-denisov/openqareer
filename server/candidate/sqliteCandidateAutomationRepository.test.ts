import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  SqliteCandidateAutomationRepository,
  type CandidateAutomationQueuePayload,
} from './sqliteCandidateAutomationRepository';

const KEY = Buffer.alloc(32, 12);

function setup() {
  const database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT; INSERT INTO candidates VALUES (\'alice\');');
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
    materials: [{ documentId: 'resume-a', kind: 'resume' as const, fileName: 'CV.pdf', version: 2 }],
    ...overrides,
  };
}

describe('SqliteCandidateAutomationRepository', () => {
  it('returns disabled defaults and persists candidate consents with their exact text and date', () => {
    const { repository } = setup();
    expect(repository.getSettings('alice').enabled).toBe(false);
    repository.acceptConsent('alice', 'send_after_approval', 'B452-1', 'Текст согласия', '2026-10-10T10:00:00.000Z');
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
    const item = repository.addQueueItem('alice', queuePayload(), 'today', false, '2026-10-10T10:00:00.000Z');
    const stored = database.prepare('SELECT payload_cipher FROM candidate_auto_apply_queue').get() as { payload_cipher: string };
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

  it('scrubs letter, destination and materials after a candidate removes an entry', () => {
    const { repository } = setup();
    const item = repository.addQueueItem('alice', queuePayload(), 'today', false);
    repository.transitionQueueItem('alice', item.id, 'remove');
    expect(repository.getQueueItem('alice', item.id)?.payload).toMatchObject({
      company: 'Acme',
      letterText: '',
      targetUrl: '',
      materials: [],
    });
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
      rules: { roles: ['Head of Engineering'], minimumMatchPercent: 80, platforms: ['hh'], excludeStopCompanies: true },
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
});
