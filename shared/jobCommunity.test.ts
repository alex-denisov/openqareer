import { describe, expect, it } from 'vitest';
import { employerOrNone, isJobCommunityName } from './jobCommunity';

describe('B801: страница-сообщество вакансий — не работодатель', () => {
  it.each([
    'Medical Billing/RCM Jobs - Pakistan',
    'Confidential Careers',
    'Confidential Jobs',
    'SINGAPORE & MALAYSIA JOBS-HIRING',
    'Middle East Jobs Updates',
    'USA, UK, Canada, India Jobs',
    'All jobs',
    'Hiring',
  ])('%s', (name) => expect(employerOrNone(name)).toBe(''));

  it.each([
    'Mistral Careers',
    'HeyJobs',
    'Jobster',
    'Bdjobs.com',
    'Tether Operations Limited Careers',
    'Children’s Health Ireland Jobs',
    'JobCloud SA | jobup.ch - jobs.ch',
    'Dubai Careers - A Smart Dubai Initiative',
    'Datamatics Careers- Philippines',
  ])('%s остаётся', (name) => expect(isJobCommunityName(name)).toBe(false));
});
