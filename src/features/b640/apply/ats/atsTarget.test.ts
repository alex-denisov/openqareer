import { describe, expect, it } from 'vitest';
import type { ApplyTarget } from '../../../../../shared/applyTarget';
import { atsAddressOf, ownSiteReason } from './atsTarget';

const target = (channel: ApplyTarget['channel'], formUrl: string, more = {}): ApplyTarget => ({
  channel,
  url: formUrl,
  formUrl,
  origin: 'url',
  ...more,
});

describe('адрес формы работодателя', () => {
  it.each([
    'https://boards.greenhouse.io/acme/jobs/1',
    'https://jobs.ashbyhq.com/acme/1/application',
    'https://jobs.lever.co/acme/1/apply',
    'https://apply.workable.com/acme/j/1/apply/',
    'https://acme.recruitee.com/o/dev/c/new',
    'https://acme.teamtailor.com/jobs/1/applications/new',
    'https://acme.pinpointhq.com/postings/1/applications/new',
    'https://acme.breezy.hr/p/0123456789ab-dev/apply',
    'https://acme.bamboohr.com/careers/90',
    'https://jobs.smartrecruiters.com/acme/744000145449249',
  ])('%s', (url) => {
    expect(atsAddressOf(target('site', url), null)?.url).toBe(url);
  });

  it('чужие, нешифрованные адреса и нераскрытый трекер не открываются', () => {
    expect(atsAddressOf(target('site', 'https://acme.example/jobs/1'), null)).toBeNull();
    expect(atsAddressOf(target('lever', 'http://jobs.lever.co/acme/1'), null)).toBeNull();
    expect(atsAddressOf(target('lever', 'https://jobs.lever.co.evil.example/1'), null)).toBeNull();
    for (const url of [
      'https://jobs.smartrecruiters.com.evil.example/acme/1',
      'https://evilbreezy.hr/p/0123456789ab-dev/apply',
      'https://acme.bamboohr.com.evil.example/careers/90',
    ]) {
      expect(atsAddressOf(target('site', url), null)).toBeNull();
    }
    const tracker = target('site', 'https://jobs.lever.co/acme/1', { needsRedirect: true });
    expect(atsAddressOf(tracker, null)).toBeNull();
  });

  it('доска из параметров вакансии не берётся, форма доски приходит с сервера', () => {
    const site = 'https://acme.example/jobs/1?gh_jid=1&board=evil';
    expect(atsAddressOf(target('greenhouse', site), site)).toBeNull();
    const form = 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1';
    expect(atsAddressOf(target('greenhouse', form), site)).toEqual({
      url: form,
      host: 'job-boards.greenhouse.io',
    });
  });

  it('в очередь встают только сайты работодателей', () => {
    expect(ownSiteReason(target('site', 'https://a.example/'))).toBe('other');
    expect(ownSiteReason(target('workday', 'https://a.example/'))).toBe('account_required');
    expect(ownSiteReason(target('email', 'mailto:a@a.example'))).toBeNull();
    expect(ownSiteReason(target('board', 'https://a.example/'))).toBeNull();
    expect(ownSiteReason(null)).toBeNull();
  });
});
