import { describe, expect, it } from 'vitest';
import { application } from '../responses/model/testApplication';
import { funnelLine } from './funnelLineModel';

const SINCE = '2026-10-02T08:00:00.000Z';

function sent(id: string, appliedAt: string, extra: Parameters<typeof application>[0] = {}) {
  return application({ id, appliedAt, createdAt: appliedAt, ...extra });
}

describe('funnelLine (B650 s05b)', () => {
  it('считает отклики, интервью и офферы с даты статуса', () => {
    const items = [
      sent('a', '2026-10-03T10:00:00.000Z'),
      sent('b', '2026-10-10T10:00:00.000Z', { stage: 'interview' }),
      sent('c', '2026-10-12T10:00:00.000Z', {
        stage: 'offer',
        reachedStages: ['applied', 'interview', 'offer'],
      }),
      sent('old', '2026-09-20T10:00:00.000Z', { stage: 'interview' }),
      application({ id: 'saved', stage: 'saved', appliedAt: null }),
    ];
    expect(funnelLine(items, SINCE)).toBe('С 2 октября: 3 отклика → 2 интервью → 1 оффер');
  });

  it('отказ после интервью остаётся в интервью', () => {
    const items = [
      sent('a', '2026-10-03T10:00:00.000Z', {
        stage: 'rejected',
        archivePreviousStage: 'interview',
      }),
    ];
    expect(funnelLine(items, SINCE)).toBe('С 2 октября: 1 отклик → 1 интервью → 0 офферов');
  });

  it('без даты статуса — с первого отклика', () => {
    const items = [sent('a', '2026-11-05T10:00:00.000Z'), sent('b', '2026-11-01T10:00:00.000Z')];
    expect(funnelLine(items, null)).toBe('С 1 ноября: 2 отклика → 0 интервью → 0 офферов');
  });

  it('откликов с даты нет — строки нет', () => {
    expect(funnelLine([sent('old', '2026-09-20T10:00:00.000Z')], SINCE)).toBeNull();
    expect(funnelLine([], null)).toBeNull();
  });
});
