import { describe, expect, it, vi } from 'vitest';
import { FootprintRequestGate } from '../../osint/adapters/requestScheduler';
import { collectRecruiterDossier } from './collectRecruiterDossier';

const now = () => new Date('2026-10-27T00:00:00.000Z');
const person = { fullName: 'Anna Smith', companyName: 'Acme', companyDomain: 'acme.com' };

function router(routes: Record<string, unknown>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!key) return new Response('', { status: 404 });
    const body = routes[key];
    return typeof body === 'string'
      ? new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
      : new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

const deps = (fetch: ReturnType<typeof router>) => ({
  exaApiKey: 'test-key',
  fetch,
  requestGate: new FootprintRequestGate({ intervalMs: 0 }),
  now,
});

describe('recruiter dossier', () => {
  it('collects channels only from open pages that name the person', async () => {
    const fetch = router({
      'https://api.exa.ai/search': {
        results: [
          { url: 'https://conf.example/speakers', title: 'Speakers', text: 'Anna Smith, Talent Partner at Acme. t.me/anna_hr' },
          { url: 'https://other.example', title: 'Other', text: 'Bob Brown, wa.me/447700900999' },
        ],
      },
    });

    const { channels: dossier } = await collectRecruiterDossier(person, deps(fetch));

    expect(dossier.map((c) => `${c.kind}=${c.value}`)).toContain('telegram=@anna_hr');
    expect(dossier.some((c) => c.value === '+447700900999')).toBe(false);
    expect(dossier.find((c) => c.kind === 'telegram')?.sourceUrl).toBe('https://conf.example/speakers');
  });

  it('takes a GitHub profile only when it names the company', async () => {
    const fetch = router({
      'https://api.exa.ai/search': { results: [] },
      'https://api.github.com/search/users': { items: [{ login: 'annasmith' }, { login: 'anna-other' }] },
      'https://api.github.com/users/annasmith': {
        login: 'annasmith', name: 'Anna Smith', company: '@acme', email: 'anna@gmail.com',
        blog: 'https://annasmith.dev', twitter_username: 'annahires', html_url: 'https://github.com/annasmith',
      },
      'https://api.github.com/users/anna-other': { login: 'anna-other', name: 'Anna Smith', company: 'Globex' },
      'https://t.me/': '<meta property="og:title" content="Telegram: Contact @x">',
    });

    const { channels: dossier } = await collectRecruiterDossier(person, deps(fetch));
    const kinds = dossier.map((c) => `${c.kind}=${c.value}`);

    expect(kinds).toEqual(expect.arrayContaining([
      'email_personal=anna@gmail.com', 'x=annahires', 'github=annasmith', 'website=annasmith.dev',
    ]));
    expect(kinds.join()).not.toContain('anna-other');
  });

  it('checks known nicknames in Telegram and keeps only a page with the same name', async () => {
    const fetch = router({
      'https://api.exa.ai/search': {
        results: [{ url: 'https://acme.com/team', title: 'Team', text: 'Anna Smith — recruiter. https://instagram.com/annahires' }],
      },
      'https://t.me/annahires': '<meta property="og:title" content="Anna Smith">',
    });

    const { channels: dossier } = await collectRecruiterDossier(person, deps(fetch));

    expect(dossier.find((c) => c.kind === 'telegram')).toMatchObject({
      value: '@annahires',
      status: 'hypothesis',
      sourceUrl: 'https://t.me/annahires',
    });
  });

  it('survives a failing source and returns what the others found', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('network');
    });
    await expect(collectRecruiterDossier(person, deps(fetch as never))).resolves.toEqual({ channels: [], complete: false });
  });

  it('stops calling GitHub after a rate limit and marks the run incomplete', async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('https://api.exa.ai')) return new Response(JSON.stringify({ results: [] }), { status: 200 });
      return new Response('', { status: 403 });
    });
    const result = await collectRecruiterDossier(person, deps(fetch as never));
    expect(result.complete).toBe(false);
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('api.github.com'))).toHaveLength(1);
  });

  it('ignores contacts on the page that sit far from the person name', async () => {
    const filler = ' lorem'.repeat(200);
    const fetch = router({
      'https://api.exa.ai/search': {
        results: [{ url: 'https://acme.com/team', title: 'Team', text: `Anna Smith, recruiter, t.me/anna_hr.${filler} Office: wa.me/447700900999` }],
      },
    });
    const { channels } = await collectRecruiterDossier(person, deps(fetch));
    expect(channels.map((c) => c.kind)).toContain('telegram');
    expect(channels.some((c) => c.kind === 'whatsapp')).toBe(false);
  });
  it('takes a profile found by nickname only when the page names the person', async () => {
    const fetch = router({
      'https://api.exa.ai/search': {
        results: [{ url: 'https://conf.example/talk', title: 'Anna Smith', text: 'Anna Smith, Acme recruiting. x.com/annahires' }],
      },
      'https://medium.com/@annahires': '<h1>Anna Smith</h1><p>Talent partner at Acme. Write me: wa.me/447700900124</p>',
      'https://teletype.in/@annahires': '<h1>Someone Else</h1><p>t.me/someone_else</p>',
      'https://t.me/': '<meta property="og:title" content="Telegram: Contact @x">',
    });

    const { channels } = await collectRecruiterDossier(person, deps(fetch));
    const kinds = channels.map((c) => `${c.kind}=${c.value}`);

    expect(kinds).toContain('whatsapp=+447700900124');
    expect(kinds).toContain('other=medium.com/@annahires');
    expect(kinds.some((kind) => kind.includes('someone_else') || kind.includes('teletype'))).toBe(false);
    expect(channels.find((c) => c.kind === 'whatsapp')?.sourceUrl).toBe('https://medium.com/@annahires');
  });
});
