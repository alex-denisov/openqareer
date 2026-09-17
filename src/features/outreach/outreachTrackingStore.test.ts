import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearOutreachStore,
  getOutreachRecordById,
  getOutreachRecords,
  recordOutreachInvite,
  updateOutreachStatus,
} from './outreachTrackingStore';

describe('outreachTrackingStore', () => {
  beforeEach(() => {
    clearOutreachStore();
  });

  it('starts with empty records', () => {
    expect(getOutreachRecords()).toEqual([]);
  });

  it('records an outreach invite with status invite_sent and timestamps', () => {
    const record = recordOutreachInvite({
      vacancyId: 'vac-101',
      company: 'FinTech Corp',
      contactName: 'Анна Воронова',
      contactProfileUrl: 'https://linkedin.com/in/anna-v',
      connectionNote: 'Приветствую, Анна! Хочу обсудить роль.',
    });

    expect(record.id).toBeDefined();
    expect(record.vacancyId).toBe('vac-101');
    expect(record.company).toBe('FinTech Corp');
    expect(record.contactName).toBe('Анна Воронова');
    expect(record.contactProfileUrl).toBe('https://linkedin.com/in/anna-v');
    expect(record.connectionNote).toBe('Приветствую, Анна! Хочу обсудить роль.');
    expect(record.status).toBe('invite_sent');
    expect(record.sentAt).toBeDefined();
    expect(record.updatedAt).toBeDefined();

    const stored = getOutreachRecords();
    expect(stored.length).toBe(1);
    expect(stored[0].id).toBe(record.id);
  });

  it('filters records by vacancyId when supplied', () => {
    recordOutreachInvite({
      vacancyId: 'vac-101',
      company: 'FinTech Corp',
      contactName: 'Анна Воронова',
      contactProfileUrl: 'https://linkedin.com/in/anna-v',
    });
    recordOutreachInvite({
      vacancyId: 'vac-202',
      company: 'Tech Solutions',
      contactName: 'Михаил Соколов',
      contactProfileUrl: 'https://linkedin.com/in/mikhail-s',
    });

    const vac101Records = getOutreachRecords('vac-101');
    expect(vac101Records.length).toBe(1);
    expect(vac101Records[0].company).toBe('FinTech Corp');

    const vac202Records = getOutreachRecords('vac-202');
    expect(vac202Records.length).toBe(1);
    expect(vac202Records[0].company).toBe('Tech Solutions');

    const allRecords = getOutreachRecords();
    expect(allRecords.length).toBe(2);
  });

  it('updates outreach status along the funnel (invite_sent -> connected -> dialogue_started)', () => {
    const record = recordOutreachInvite({
      vacancyId: 'vac-101',
      company: 'FinTech Corp',
      contactName: 'Анна Воронова',
      contactProfileUrl: 'https://linkedin.com/in/anna-v',
    });

    expect(record.status).toBe('invite_sent');

    const updated1 = updateOutreachStatus(record.id, 'connected');
    expect(updated1?.status).toBe('connected');

    const updated2 = updateOutreachStatus(record.id, 'dialogue_started');
    expect(updated2?.status).toBe('dialogue_started');

    const found = getOutreachRecordById(record.id);
    expect(found?.status).toBe('dialogue_started');
  });

  it('supports rejected status', () => {
    const record = recordOutreachInvite({
      company: 'FinTech Corp',
      contactName: 'Дмитрий Мельников',
      contactProfileUrl: 'https://linkedin.com/in/dmitry-m',
    });

    const updated = updateOutreachStatus(record.id, 'rejected');
    expect(updated?.status).toBe('rejected');
  });

  it('returns null when trying to update non-existing record', () => {
    const result = updateOutreachStatus('non-existent-id', 'connected');
    expect(result).toBeNull();
  });
});
