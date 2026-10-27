import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import type { RecruiterContact } from '../../../shared/recruiterContact';
import { FootprintRequestGate } from '../../osint/adapters/requestScheduler';
import { collectCompanyPages } from './companyPages';
import { withDossier } from './recruiterDossierService';

const now = () => new Date('2026-10-27T00:00:00.000Z');

function site(pages: Record<string, string>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://api.exa.ai/')) return new Response(JSON.stringify({ results: [] }), { status: 200 });
    const body = pages[url];
    if (body === '429') return new Response('', { status: 429 });
    return body ? new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }) : new Response('', { status: 404 });
  });
}

const deps = (fetch: ReturnType<typeof site>) => ({
  exaApiKey: 'test-key',
  fetch,
  requestGate: new FootprintRequestGate({ intervalMs: 0 }),
  now,
  lookupHost: async (host: string) => (host === 'intranet.acme.com' ? ['10.0.0.5'] : ['93.184.216.34']),
});

const teamPage =
  '<h2>John Doe</h2><p>Head of Sales</p><a href="mailto:j.doe@acme.com">Write</a>' +
  '<h2>Mary Major</h2><a href="mailto:m.major@acme.com">m.major@acme.com</a><p>hr@acme.com</p>';

const contact: RecruiterContact = {
  id: 'c1', vacancyId: 'v1', companyName: 'Acme', fullName: 'Anna Smith', roleTitle: 'Recruiter',
  email: 'anna.smith@acme.com', emailStatus: 'hypothesis', phone: null, telegram: null, whatsapp: null,
  linkedinUrl: null, githubUrl: null, twitterUrl: null, sourceType: 'company_osint', confidence: 0.65,
  createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z',
} as RecruiterContact;

describe('company pages', () => {
  it('learns the email format from people the company publishes', async () => {
    const result = await collectCompanyPages('acme.com', deps(site({ 'https://acme.com/team': teamPage })));
    expect(result.format).toEqual({ id: 'f.last', support: 2, sourceUrl: 'https://acme.com/team' });
    expect(result.samples.map((sample) => sample.email)).not.toContain('hr@acme.com');
    expect(result.complete).toBe(true);
  });

  it('does not touch internal hosts or hosts that are not plain domain names', async () => {
    const fetch = site({});
    for (const domain of ['intranet.acme.com', 'localhost', '127.0.0.1', 'a(b.com', 'acme.local']) {
      expect((await collectCompanyPages(domain, deps(fetch))).samples).toEqual([]);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stops asking the site after it refuses by rate', async () => {
    const fetch = site({ 'https://acme.com/team': '429', 'https://acme.com/about': teamPage });
    const result = await collectCompanyPages('acme.com', deps(fetch));
    expect(result.complete).toBe(false);
    expect(fetch.mock.calls.some(([url]) => String(url) === 'https://acme.com/about')).toBe(false);
  });

  it('parses a hostile page in linear time', async () => {
    const started = Date.now();
    await collectCompanyPages('acme.com', deps(site({ 'https://acme.com/team': `${'a'.repeat(90_000)}${'<'.repeat(9_000)}` })));
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('replaces the generic guess with the company format and caches the site', async () => {
    const database = new DatabaseSync(':memory:');
    const fetch = site({ 'https://acme.com/team': teamPage });
    const options = { ...deps(fetch), database };

    const first = await withDossier(contact, 'acme.com', options);
    const emails = (first.channels ?? []).filter((channel) => channel.kind === 'email_corporate');
    expect(emails.map((channel) => `${channel.value}:${channel.status}`)).toEqual(['a.smith@acme.com:hypothesis']);
    expect(emails[0]?.sourceUrl).toBe('https://acme.com/team');

    const sitePages = fetch.mock.calls.filter(([url]) => String(url).startsWith('https://acme.com')).length;
    await withDossier({ ...contact, id: 'c2', fullName: 'Bob Brown' }, 'acme.com', options);
    expect(fetch.mock.calls.filter(([url]) => String(url).startsWith('https://acme.com')).length).toBe(sitePages);
  });

  it('prefers the address the company published for the person', async () => {
    const database = new DatabaseSync(':memory:');
    const page = `${teamPage}<h2>Anna Smith</h2><a href="mailto:anna@acme.com">anna@acme.com</a>`;
    const result = await withDossier(contact, 'acme.com', { ...deps(site({ 'https://acme.com/team': page })), database });
    const email = result.channels?.find((channel) => channel.kind === 'email_corporate');
    expect(email).toMatchObject({ value: 'anna@acme.com', status: 'published' });
  });
});
