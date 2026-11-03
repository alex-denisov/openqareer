import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ensureJobSearchSchema, saveJobCards, setPoolJobReadingEnabled } from '../linkedinPool/jobSearchStore';
import { LINKEDIN_POOL_SOURCE_ID, readLinkedinPoolJobs } from './linkedinPoolSource';
import { detailTextSourceFor } from './detailTextSources';

const now = new Date('2026-11-03T12:00:00Z');
const card = (jobId: string) => ({
  jobId,
  title: `QA ${jobId}`,
  company: 'Co',
  location: 'Dubai',
  url: `https://www.linkedin.com/jobs/view/${jobId}`,
  publishedAt: '2026-11-01',
});

describe('readLinkedinPoolJobs', () => {
  it('returns a partial reading and skips jobs the guest source already has', () => {
    const db = new DatabaseSync(':memory:');
    ensureJobSearchSchema(db);
    saveJobCards(db, [card('1111111'), card('2222222')], now);
    const known = new Set(['src-linkedin-guest:1111111']);
    const reading = readLinkedinPoolJobs(db, {
      now,
      observedAt: now.toISOString(),
      hasVacancy: (id) => known.has(id),
    });
    expect(reading.partial).toBe(true);
    expect(reading.vacancies.map((v) => v.id)).toEqual([`${LINKEDIN_POOL_SOURCE_ID}:2222222`]);
    expect(reading.vacancies[0]).toMatchObject({ title: 'QA 2222222', company: 'Co', location: 'Dubai' });
  });

  it('is an empty partial reading when the staging table does not exist or the flag is off', () => {
    const empty = new DatabaseSync(':memory:');
    const args = { now, observedAt: now.toISOString(), hasVacancy: () => false };
    expect(readLinkedinPoolJobs(empty, args)).toEqual({ vacancies: [], partial: true });
    ensureJobSearchSchema(empty);
    saveJobCards(empty, [card('3333333')], now);
    setPoolJobReadingEnabled(empty, false, now);
    expect(readLinkedinPoolJobs(empty, args)).toEqual({ vacancies: [], partial: true });
  });
});

describe('detail text for pool vacancies', () => {
  it('uses the guest jobPosting endpoint by LinkedIn id', () => {
    const url = detailTextSourceFor(LINKEDIN_POOL_SOURCE_ID)?.detailUrl(LINKEDIN_POOL_SOURCE_ID, {
      url: 'https://www.linkedin.com/jobs/view/2222222',
    } as never);
    expect(url).toBe('https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/2222222');
  });
});
