import type { CandidateAutomationJournalEntry } from '../../../../../server/candidate/sqliteCandidateAutomationRepository';
import { formatWhen } from '../format';

export const JOURNAL_PERIOD_DAYS = 30;

export interface JournalRowView {
  readonly id: string;
  readonly title: string;
  readonly sub: string;
  readonly tag: { readonly text: string; readonly ok: boolean };
}

const PLATFORM: Readonly<Record<string, string>> = { hh: 'hh.ru', linkedin: 'LinkedIn' };

const TITLE: Readonly<Record<CandidateAutomationJournalEntry['result'], string>> = {
  delivered: 'Отклик отправлен',
  error: 'Отклик не отправлен',
  removed: 'Отклик убран из очереди',
};

const TAG: Readonly<Record<CandidateAutomationJournalEntry['result'], string>> = {
  delivered: 'отправлен',
  error: 'ошибка',
  removed: 'убран',
};

/** Строка журнала: что было, где и когда; сырых кодов сбоя в тексте нет. */
export function journalRow(entry: CandidateAutomationJournalEntry): JournalRowView {
  const parts = [entry.company, PLATFORM[entry.platform] ?? '', formatWhen(entry.occurredAt) ?? ''];
  return {
    id: entry.id,
    title: TITLE[entry.result],
    sub: parts.filter(Boolean).join(' · '),
    tag: { text: TAG[entry.result], ok: entry.result === 'delivered' },
  };
}

export interface JournalTotals {
  readonly id: string;
  readonly label: string;
  readonly value: number;
}

/** Итоги периода: только то, что считает сервер. */
export function journalTotals(counts: { readonly delivered: number; readonly errors: number; readonly removed: number }): readonly JournalTotals[] {
  return [
    { id: 'delivered', label: 'Отправлено', value: counts.delivered },
    { id: 'errors', label: 'Ошибки', value: counts.errors },
    { id: 'removed', label: 'Убрано', value: counts.removed },
  ];
}
