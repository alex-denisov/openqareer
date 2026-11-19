import { describe, expect, it } from 'vitest';
import type { CandidateAutomationJournalEntry } from '../../../../../server/candidate/sqliteCandidateAutomationRepository';
import { journalRow, journalTotals } from './journalModel';

const entry: CandidateAutomationJournalEntry = {
  id: 'j1', queueItemId: 'q1', platform: 'hh', result: 'error', receiptStatus: 'failed', attempted: true,
  localDate: '2026-11-10', company: 'Гринкод', occurredAt: '2026-11-10T16:05:00Z', receiptId: null, failureCode: 'hh_captcha_required',
};

describe('journalRow', () => {
  it('название, место и метка без сырого кода сбоя', () => {
    const row = journalRow(entry);
    expect(row.title).toBe('Отклик не отправлен');
    expect(row.sub).toContain('Гринкод · hh.ru');
    expect(row.tag).toEqual({ text: 'ошибка', ok: false });
    expect(JSON.stringify(row)).not.toContain('hh_captcha');
  });
  it('доставленный — «ok»', () => {
    expect(journalRow({ ...entry, result: 'delivered' }).tag.ok).toBe(true);
  });
  it('нечитаемая дата не попадает в строку', () => {
    expect(journalRow({ ...entry, occurredAt: 'x' }).sub).toBe('Гринкод · hh.ru');
  });
});

describe('journalTotals', () => {
  it('три итога периода', () => {
    expect(journalTotals({ delivered: 5, errors: 1, removed: 2 }).map((t) => t.value)).toEqual([5, 1, 2]);
  });
});
