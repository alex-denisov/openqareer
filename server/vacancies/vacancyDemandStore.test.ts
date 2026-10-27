import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SqliteVacancyDemandStore } from './vacancyDemandStore';

const DAY = 24 * 60 * 60_000;

describe('спрос на роли для сбора вакансий (27.10)', () => {
  it('новые роли идут первыми, старше срока — не читаются', () => {
    const store = new SqliteVacancyDemandStore(new DatabaseSync(':memory:'));
    store.record(['head of accounting'], 0);
    store.record(['head of ai', 'vp of customer support'], 40 * DAY);
    store.record(['head of ai'], 41 * DAY);
    expect(store.recentTerms(41 * DAY, 10)).toEqual(['head of ai', 'vp of customer support']);
  });

  it('держит не больше заданного числа запросов', () => {
    const store = new SqliteVacancyDemandStore(new DatabaseSync(':memory:'));
    store.record(['a b', 'c d', 'e f'], 1_000);
    expect(store.recentTerms(1_000, 2)).toHaveLength(2);
  });

  it('пустой набор не пишет ничего', () => {
    const store = new SqliteVacancyDemandStore(new DatabaseSync(':memory:'));
    store.record([], 1_000);
    expect(store.recentTerms(1_000, 10)).toEqual([]);
  });
});
