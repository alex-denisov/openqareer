import { afterEach, describe, expect, it } from 'vitest';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { VacancyIntelligenceService } from './vacancyIntelligenceService';

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
              },
            ],
          };
        },
      },
    });

    const result = await service.runDue('2026-08-13T08:00:00.000Z');

    expect(result).toEqual({ claimed: 1, succeeded: 1, failed: 0 });
    expect(queries).toEqual(['product lead']);
    expect(store.listVacancySubscriptions(candidate.id)[0]).toMatchObject({
      lastSuccessAt: '2026-08-13T08:01:00.000Z',
      analytics: { sampleSize: 1 },
    });
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
      { source: 'hh', query: 'working query', cadenceMinutes: 360 },
      '2026-08-13T09:00:00.000Z',
    );
    const service = new VacancyIntelligenceService({
      store,
      connectors: {
        hh: async ({ text }) => {
          if (text === 'broken query') {
            throw new Error('hh_vacancy_search_unavailable');
          }
          return {
            source: 'hh',
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
    expect(store.getVacancySubscription(candidate.id, failed.id)).toMatchObject({
      lastSuccessAt: null,
      lastErrorCode: 'source_unavailable',
      nextRunAt: '2026-08-13T10:00:00.000Z',
    });
    expect(
      store.getVacancySubscription(candidate.id, succeeded.id),
    ).toMatchObject({
      lastSuccessAt: '2026-08-13T09:01:00.000Z',
      lastErrorCode: null,
    });
  });
});
