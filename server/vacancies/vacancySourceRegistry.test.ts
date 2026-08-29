import { describe, expect, it } from 'vitest';
import { vacancySourceRegistryView } from './vacancySourceRegistry';

describe('vacancy source registry view', () => {
  it('reports the known hh.ru access refusal before anyone tries it (B175, INC-022)', () => {
    const hh = vacancySourceRegistryView([]).find((source) => source.id === 'hh');

    expect(hh?.health).toMatchObject({
      status: 'official_access_required',
      lastErrorCode: 'official_access_required',
    });
  });

  it('leaves a source with no declared refusal unchecked until it is measured', () => {
    const remotive = vacancySourceRegistryView([]).find((source) => source.id === 'remotive');

    expect(remotive?.health.status).toBe('not_checked');
  });

  it('prefers a measured reading over the declared access state', () => {
    const hh = vacancySourceRegistryView([
      {
        source: 'hh',
        status: 'healthy',
        lastAttemptAt: '2026-08-29T10:00:00.000Z',
        lastSuccessAt: '2026-08-29T10:00:00.000Z',
        lastErrorCode: null,
        retryAfterAt: null,
        consecutiveFailures: 0,
      },
    ]).find((source) => source.id === 'hh');

    expect(hh?.health.status).toBe('healthy');
  });
});
