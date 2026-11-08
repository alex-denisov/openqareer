import { describe, expect, it } from 'vitest';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { corporateRejectReason, gateCorporateVacancies } from './corporateSourceQuality';

const v = (title: string, url: string) => ({ title, url }) as UnifiedVacancy;
const HOSTS = ['careers.acme.com'];

describe('corporateSourceQuality (B622)', () => {
  it('keeps titles on the company domain or an ATS', () => {
    expect(
      corporateRejectReason(v('Senior Go Engineer', 'https://acme.com/jobs/1'), HOSTS),
    ).toBeNull();
    expect(
      corporateRejectReason(v('Data Analyst', 'https://boards.greenhouse.io/acme/jobs/2'), HOSTS),
    ).toBeNull();
  });

  it('rejects foreign links like jobs.dou.ua and builtin.com', () => {
    expect(
      corporateRejectReason(v('QA Engineer', 'https://jobs.dou.ua/companies/x/1'), HOSTS),
    ).toBe('foreign_link');
    expect(corporateRejectReason(v('Product Manager', 'https://builtin.com/job/1'), HOSTS)).toBe(
      'foreign_link',
    );
  });

  it('rejects broken and navigation titles', () => {
    for (const title of ['[object Object]', 'Apply now', 'Вакансии', 'x', 'a'.repeat(200)]) {
      expect(corporateRejectReason(v(title, 'https://acme.com/j'), HOSTS)).toBe('bad_title');
    }
  });

  it('fails the source when fewer than half pass, keeps only good rows otherwise', () => {
    const good = v('Backend Engineer', 'https://acme.com/1');
    const bad = v('[object Object]', 'https://acme.com/2');
    expect(gateCorporateVacancies([good, bad, bad], ['https://careers.acme.com']).passed).toBe(
      false,
    );
    const ok = gateCorporateVacancies([good, good, bad], ['https://careers.acme.com']);
    expect(ok.passed).toBe(true);
    expect(ok.kept).toHaveLength(2);
    expect(ok.rejected.bad_title).toBe(1);
  });
});

describe('corporateSourceQuality navigation and aggregators (B622)', () => {
  it('rejects listing pages and navigation phrases', () => {
    for (const [title, url] of [
      ['All vacancies', 'https://career.acme.com/vacancies/'],
      ['Search jobs', 'https://acme.com/jobs/'],
      ['View Openings →', 'https://jobs.acme.com/jobs/Careers'],
      ['0 Your Saved Jobs', 'https://acme.com/en/jobs/saved-jobs/'],
      ['Growth', 'https://acme.com/careers/jobs/?department=growth'],
    ] as const) {
      expect(corporateRejectReason(v(title, url), HOSTS)).toBe('bad_title');
    }
  });

  it('a source whose own address is DOU never counts DOU as the company domain', () => {
    const verdict = gateCorporateVacancies(
      [v('Account Manager', 'https://jobs.dou.ua/companies/acme/vacancies/1/')],
      ['https://jobs.dou.ua/companies/acme/vacancies/'],
    );
    expect(verdict.passed).toBe(false);
  });
});
