import { afterEach, describe, expect, it } from 'vitest';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { VacancyIntelligenceService } from './vacancyIntelligenceService';
import { VacancyConnectorError } from '../connectors/vacancyConnectorError';

const stores: SqliteCandidateStore[] = [];

afterEach(() => stores.splice(0).forEach((store) => store.close()));

function createStore() {
  const store = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: Buffer.alloc(32, 6),
  });
  stores.push(store);
  return store;
}

describe('vacancy intelligence scheduler', () => {
  it('claims and refreshes a bounded batch of due subscriptions', async () => {
    const store = createStore();
    const candidate = store.createCandidate({
      dataClass: 'synthetic',
      locale: 'ru-RU',
    });
    store.createVacancySubscription(
      candidate.id,
      { source: 'hh', query: 'product lead', cadenceMinutes: 360 },
      '2026-08-13T08:00:00.000Z',
    );
    const queries: string[] = [];
    const service = new VacancyIntelligenceService({
      store,
      maxBatchSize: 5,
      connectors: {
        hh: async ({ text }) => {
          queries.push(text);
          return {
            source: 'hh',
            query: text,
            found: 10,
            fetchedAt: '2026-08-13T08:01:00.000Z',
            items: [
              {
                id: '991',
                title: 'Product Lead',
                company: 'Synthetic Company',
                location: 'Москва',
                sourceUrl: 'https://hh.ru/vacancy/991',
                publishedAt: null,
                salary: null,
                workMode: 'unknown',
                requirements: [],
              },
            ],
          };
        },
      },
    });

    const result = await service.runDue('2026-08-13T08:00:00.000Z');

    expect(result).toEqual({ claimed: 1, succeeded: 1, failed: 0 });
    expect(queries).toEqual(['product lead']);
    const refreshed = store.listVacancySubscriptions(candidate.id)[0]!;
    expect(refreshed).toMatchObject({
      lastSuccessAt: '2026-08-13T08:01:00.000Z',
      analytics: { sampleSize: 1 },
    });
    expect(new Date(refreshed.nextRunAt).getTime()).toBeGreaterThan(
      new Date('2026-08-13T14:01:00.000Z').getTime(),
    );
    expect(new Date(refreshed.nextRunAt).getTime()).toBeLessThanOrEqual(
      new Date('2026-08-13T14:16:00.000Z').getTime(),
    );
    expect(await service.runDue('2026-08-13T08:02:00.000Z')).toEqual({
      claimed: 0,
      succeeded: 0,
      failed: 0,
    });
  });

  it('records a failed refresh without blocking the rest of the batch', async () => {
    const store = createStore();
    const candidate = store.createCandidate({
      dataClass: 'synthetic',
      locale: 'ru-RU',
    });
    const failed = store.createVacancySubscription(
      candidate.id,
      { source: 'hh', query: 'broken query', cadenceMinutes: 360 },
      '2026-08-13T09:00:00.000Z',
    );
    const succeeded = store.createVacancySubscription(
      candidate.id,
      { source: 'arbeitnow', query: 'working query', cadenceMinutes: 360 },
      '2026-08-13T09:00:00.000Z',
    );
    const service = new VacancyIntelligenceService({
      store,
      connectors: {
        hh: async () => {
          throw new Error('hh_vacancy_search_unavailable');
        },
        arbeitnow: async ({ text }) => {
          return {
            source: 'arbeitnow',
            query: text,
            found: 0,
            fetchedAt: '2026-08-13T09:01:00.000Z',
            items: [],
          };
        },
      },
    });

    await expect(
      service.runDue('2026-08-13T09:00:00.000Z'),
    ).resolves.toEqual({ claimed: 2, succeeded: 1, failed: 1 });
    const failedSubscription = store.getVacancySubscription(candidate.id, failed.id)!;
    expect(failedSubscription).toMatchObject({
      lastSuccessAt: null,
      lastErrorCode: 'source_unavailable',
    });
    expect(new Date(failedSubscription.nextRunAt).getTime()).toBeGreaterThan(
      new Date('2026-08-13T10:00:00.000Z').getTime(),
    );
    expect(new Date(failedSubscription.nextRunAt).getTime()).toBeLessThanOrEqual(
      new Date('2026-08-13T10:15:00.000Z').getTime(),
    );
    expect(
      store.getVacancySubscription(candidate.id, succeeded.id),
    ).toMatchObject({
      lastSuccessAt: '2026-08-13T09:01:00.000Z',
      lastErrorCode: null,
    });
    expect(store.listVacancySourceHealth()).toMatchObject([
      { source: 'arbeitnow', status: 'healthy' },
      { source: 'hh', status: 'degraded' },
    ]);
  });

  it('schedules a source retry no earlier than Retry-After', async () => {
    const store = createStore();
    const candidate = store.createCandidate({
      dataClass: 'synthetic',
      locale: 'ru-RU',
    });
    const subscription = store.createVacancySubscription(
      candidate.id,
      { source: 'arbeitnow', query: 'product manager', cadenceMinutes: 360 },
      '2026-08-13T10:00:00.000Z',
    );
    const service = new VacancyIntelligenceService({
      store,
      connectors: {
        arbeitnow: async () => {
          throw new VacancyConnectorError(
            'arbeitnow_vacancy_search_rate_limited',
            '2026-08-13T10:15:00.000Z',
          );
        },
      },
    });

    await expect(service.runDue('2026-08-13T10:00:00.000Z')).resolves.toEqual({
      claimed: 1,
      succeeded: 0,
      failed: 1,
    });
    expect(store.getVacancySubscription(candidate.id, subscription.id)).toMatchObject({
      lastErrorCode: 'source_rate_limited',
      nextRunAt: '2026-08-13T10:15:00.000Z',
    });
  });

  it('backs off official-access failures instead of polling the source hourly', async () => {
    const store = createStore();
    const candidate = store.createCandidate({
      dataClass: 'synthetic',
      locale: 'ru-RU',
    });
    const subscription = store.createVacancySubscription(
      candidate.id,
      { source: 'hh', query: 'operations lead', cadenceMinutes: 360 },
      '2026-08-13T11:00:00.000Z',
    );
    const service = new VacancyIntelligenceService({
      store,
      connectors: {
        hh: async () => {
          throw new Error('hh_vacancy_search_official_access_required');
        },
      },
    });

    await service.runDue('2026-08-13T11:00:00.000Z');
    const failed = store.getVacancySubscription(candidate.id, subscription.id)!;
    expect(failed.lastErrorCode).toBe('official_access_required');
    expect(new Date(failed.nextRunAt).getTime()).toBeGreaterThan(
      new Date('2026-08-14T11:00:00.000Z').getTime(),
    );
    expect(new Date(failed.nextRunAt).getTime()).toBeLessThanOrEqual(
      new Date('2026-08-14T11:15:00.000Z').getTime(),
    );
  });
});
