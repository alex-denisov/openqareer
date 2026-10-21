import { describe, expect, it } from 'vitest';
import type { CandidateFootprintAudit, CandidateFootprintFinding } from './candidateFootprint';
import { buildFootprintChecklist } from './footprintChecklist';

function finding(id: string, patch: Partial<CandidateFootprintFinding> = {}): CandidateFootprintFinding {
  return {
    id,
    adapter: 'sherlock',
    kind: 'profile',
    url: null,
    title: `Находка ${id}`,
    detail: '',
    match: 'unknown',
    automatedMatch: 'unknown',
    review: 'unreviewed',
    observedAt: '2026-10-06T09:00:00.000Z',
    sources: [],
    receipt: { method: 'm', source: 's', query: 'q' },
    receipts: [],
    ...patch,
  };
}

function audit(
  findings: CandidateFootprintFinding[],
  hibp: 'checked' | 'not_run' = 'not_run',
): CandidateFootprintAudit {
  return {
    id: 'a',
    candidateId: 'c',
    state: 'completed',
    selectedQueryIds: [],
    adapterStatuses: [{ adapterId: 'hibp', state: hibp, sourcesChecked: 1, findingsCount: 0 }],
    findings,
    ownershipConfirmedAt: '2026-10-05T09:00:00.000Z',
    startedAt: '2026-10-06T09:00:00.000Z',
    completedAt: '2026-10-06T09:12:00.000Z',
  };
}

describe('buildFootprintChecklist (B544)', () => {
  it('has five items and nothing done for the mockup scenario', () => {
    const list = buildFootprintChecklist(
      audit([
        finding('1'),
        finding('2', { kind: 'mention' }),
        finding('3', { staleAccount: true }),
      ]),
    );
    expect(list.items.map((item) => item.id)).toEqual([
      'review',
      'leaks',
      'metadata',
      'old_accounts',
      'artifacts',
    ]);
    expect(list.done).toBe(0);
    expect(list.items[0]).toMatchObject({ done: false, remaining: 3 });
    expect(list.items[1]?.status).toBe('Утечки не проверялись');
    expect(list.items[2]?.status).toBe('Файлы не проверялись');
    expect(list.items[3]?.status).toBe('После разбора находок');
  });

  it('counts leaks, stale accounts and artifacts from server marks', () => {
    const list = buildFootprintChecklist(
      audit(
        [
          finding('1', { kind: 'breach', review: 'confirmed_self', checklistMark: 'password_changed' }),
          finding('2', { kind: 'breach', review: 'confirmed_self' }),
          finding('3', { review: 'confirmed_self', staleAccount: true, checklistMark: 'account_kept' }),
          finding('4', { kind: 'mention', review: 'confirmed_self' }),
          finding('5', { review: 'not_self' }),
        ],
        'checked',
      ),
    );
    const byId = Object.fromEntries(list.items.map((item) => [item.id, item]));
    expect(byId.review).toMatchObject({ done: true });
    expect(byId.leaks).toMatchObject({ done: false, remaining: 1, findingIds: ['2'] });
    expect(byId.old_accounts).toMatchObject({ done: true, status: 'Сделано' });
    expect(byId.artifacts).toMatchObject({ done: false, remaining: 1, findingIds: ['4'] });
    expect(list.done).toBe(2);
  });

  it('marks leaks done only after HIBP answered with nothing found', () => {
    const list = buildFootprintChecklist(audit([finding('1', { review: 'not_self' })], 'checked'));
    expect(list.items[1]).toMatchObject({ done: true, status: 'Утечек не найдено' });
    expect(list.items[3]).toMatchObject({ done: true, status: 'Старых аккаунтов нет' });
  });

  it('never reports done without a completed audit', () => {
    expect(buildFootprintChecklist(null).done).toBe(0);
  });
});
