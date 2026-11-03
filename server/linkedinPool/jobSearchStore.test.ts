import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  JOB_SEARCH_DAILY_PAGE_LIMIT,
  ensureJobSearchSchema,
  isPoolJobReadingEnabled,
  nextJobSearchQuery,
  readPoolJobCards,
  saveJobCards,
  setPoolJobReadingEnabled,
  shouldReadJobsNow,
} from './jobSearchStore';

const card = (jobId: string) => ({
  jobId,
  title: `Role ${jobId}`,
  company: 'Co',
  location: 'Dubai',
  url: `https://www.linkedin.com/jobs/view/${jobId}`,
});

function database() {
  const db = new DatabaseSync(':memory:');
  ensureJobSearchSchema(db);
  return db;
}

describe('job reading flag', () => {
  it('is on by default and can be switched off and on', () => {
    const db = database();
    expect(isPoolJobReadingEnabled(db)).toBe(true);
    setPoolJobReadingEnabled(db, false, new Date('2026-11-03T10:00:00Z'));
    expect(isPoolJobReadingEnabled(db)).toBe(false);
    setPoolJobReadingEnabled(db, true, new Date('2026-11-03T11:00:00Z'));
    expect(isPoolJobReadingEnabled(db)).toBe(true);
  });
});

describe('job reading flag on database errors', () => {
  it('stays on only when the settings table does not exist yet', () => {
    expect(isPoolJobReadingEnabled(new DatabaseSync(':memory:'))).toBe(true);
  });

  it('fails closed (off) on any other database error', () => {
    const db = database();
    db.close();
    expect(isPoolJobReadingEnabled(db)).toBe(false);
  });
});

describe('shouldReadJobsNow', () => {
  it('interleaves: about one job page per two other pages, capped per day', () => {
    expect(shouldReadJobsNow({ jobPages: 0, otherPages: 0 })).toBe(true);
    expect(shouldReadJobsNow({ jobPages: 1, otherPages: 1 })).toBe(false);
    expect(shouldReadJobsNow({ jobPages: 1, otherPages: 2 })).toBe(true);
    expect(shouldReadJobsNow({ jobPages: JOB_SEARCH_DAILY_PAGE_LIMIT, otherPages: 99 })).toBe(false);
  });
});

describe('job cards storage', () => {
  it('upserts by job id and keeps first-seen time', () => {
    const db = database();
    saveJobCards(db, [card('1'), card('2')], new Date('2026-11-01T00:00:00Z'));
    saveJobCards(db, [{ ...card('1'), title: 'Renamed' }], new Date('2026-11-02T00:00:00Z'));
    const rows = readPoolJobCards(db, new Date('2026-11-03T00:00:00Z'), 100);
    expect(rows.map((r) => r.jobId).sort()).toEqual(['1', '2']);
    expect(rows.find((r) => r.jobId === '1')?.title).toBe('Renamed');
  });

  it('drops cards not seen for 30 days and hides cards older than the read window', () => {
    const db = database();
    saveJobCards(db, [card('old')], new Date('2026-09-01T00:00:00Z'));
    saveJobCards(db, [card('new')], new Date('2026-11-02T00:00:00Z'));
    expect(readPoolJobCards(db, new Date('2026-11-03T00:00:00Z'), 100).map((r) => r.jobId)).toEqual(['new']);
    expect(db.prepare('SELECT count(*) AS n FROM linkedin_pool_job_cards').get()).toEqual({ n: 1 });
  });
});

describe('nextJobSearchQuery', () => {
  const base = { demandTerms: ['QA engineer', 'Продакт', 'bad;term<'], dayIndex: 3, attemptedHashes: [] as string[] };

  it('alternates UAE first, then other markets, using latin demand roles only', () => {
    const first = nextJobSearchQuery({ ...base, jobPagesToday: 0 });
    expect(['Dubai', 'Abu Dhabi', 'Sharjah', 'United Arab Emirates']).toContain(first?.location);
    expect(first?.term).toBe('QA engineer');
    const second = nextJobSearchQuery({ ...base, jobPagesToday: 1 });
    expect(['Dubai', 'Abu Dhabi', 'Sharjah', 'United Arab Emirates']).not.toContain(second?.location);
  });

  it('skips queries already read today and returns undefined without demand', () => {
    const first = nextJobSearchQuery({ ...base, jobPagesToday: 0 })!;
    const next = nextJobSearchQuery({ ...base, jobPagesToday: 0, attemptedHashes: [first.hash] })!;
    expect(next.hash).not.toBe(first.hash);
    expect(nextJobSearchQuery({ ...base, demandTerms: [], jobPagesToday: 0 })).toBeUndefined();
  });
});
