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
  ])('%s', (url) => {
    expect(atsAddressOf(target('site', url), null)?.url).toBe(url);
  });

  it('чужие, нешифрованные адреса и нераскрытый трекер не открываются', () => {
    expect(atsAddressOf(target('site', 'https://acme.example/jobs/1'), null)).toBeNull();
    expect(atsAddressOf(target('lever', 'http://jobs.lever.co/acme/1'), null)).toBeNull();
    expect(atsAddressOf(target('lever', 'https://jobs.lever.co.evil.example/1'), null)).toBeNull();
    const tracker = target('site', 'https://jobs.lever.co/acme/1', { needsRedirect: true });
    expect(atsAddressOf(tracker, null)).toBeNull();
  });

  it('в очередь встают только сайты работодателей', () => {
    expect(ownSiteReason(target('site', 'https://a.example/'))).toBe('other');
    expect(ownSiteReason(target('workday', 'https://a.example/'))).toBe('account_required');
    expect(ownSiteReason(target('email', 'mailto:a@a.example'))).toBeNull();
    expect(ownSiteReason(target('board', 'https://a.example/'))).toBeNull();
    expect(ownSiteReason(null)).toBeNull();
  });
});
