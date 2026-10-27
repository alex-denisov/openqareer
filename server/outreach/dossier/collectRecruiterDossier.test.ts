import jpeg from 'jpeg-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FootprintRequestGate } from '../../osint/adapters/requestScheduler';
import { collectRecruiterDossier, nameNicknames, resetProfileRefusals } from './collectRecruiterDossier';
import { resetPhotoRefusals } from './photoHash';

const now = () => new Date('2026-10-27T00:00:00.000Z');
const person = { fullName: 'Anna Smith', companyName: 'Acme', companyDomain: 'acme.com' };

function router(routes: Record<string, unknown>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!key) return new Response('', { status: 404 });
    const body = routes[key];
    if (Buffer.isBuffer(body)) return new Response(new Uint8Array(body), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    return typeof body === 'string'
      ? new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
      : new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

const deps = (fetch: ReturnType<typeof router>) => ({
  exaApiKey: 'test-key',
  fetch,
  requestGate: new FootprintRequestGate({ intervalMs: 0 }),
  lookupHost: async () => ['93.184.216.34'],
  now,
});

/** Портрет-заглушка: пятно в разном месте — разные люди. */
function portrait(spotX: number, size = 96, mirror = false): Buffer {
  const data = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const gradient = ((mirror ? size - x : x) / size) * 60 + (y / size) * 30;
      const value = Math.min(255, Math.round(gradient) + (Math.hypot(x - spotX * size, y - size / 2) < size / 5 ? 120 : 0));
      data.set([value, value, value, 255], (y * size + x) * 4);
    }
  }
  return Buffer.from(jpeg.encode({ data, width: size, height: size }, 85).data);
}

const seedPage = {
  url: 'https://www.linkedin.com/in/annasmith', title: 'Anna Smith - Acme', text: 'Anna Smith\nTalent Partner at Acme\nLondon, UK',
  image: 'https://media.licdn.com/anna.jpg',
};

describe('recruiter dossier', () => {
  beforeEach(() => {
    resetProfileRefusals();
    resetPhotoRefusals();
  });
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
      status: 'published',
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
    expect(channels.find((c) => c.kind === 'whatsapp')).toMatchObject({ sourceUrl: 'https://medium.com/@annahires', status: 'published' });
  });
  it('derives nicknames from the name, Cyrillic included', () => {
    expect(nameNicknames('Anna Smith')).toEqual(['annasmith', 'anna_smith', 'asmith', 'smithanna', 'annas']);
    expect(nameNicknames('Ольга Петрова')[0]).toBe('olgapetrova');
  });

  it('finds Telegram by a name nickname and trusts it when the bio names the job', async () => {
    const fetch = router({
      'https://api.exa.ai/search': { results: [] },
      'https://t.me/annasmith': '<meta property="og:title" content="Anna Smith"><meta property="og:description" content="Talent partner at Acme">',
      'https://t.me/': '<meta property="og:title" content="Telegram: Contact @x">',
    });
    const { channels } = await collectRecruiterDossier(person, deps(fetch));
    expect(channels.find((c) => c.kind === 'telegram')).toMatchObject({ value: '@annasmith', status: 'published' });
  });

  it('drops a name-only Telegram match as a namesake', async () => {
    const fetch = router({
      'https://api.exa.ai/search': { results: [] },
      'https://t.me/anna_smith': '<meta property="og:title" content="Anna Smith"><meta property="og:description" content="You can contact @anna_smith right away.">',
      'https://t.me/': '<meta property="og:title" content="Telegram: Contact @x">',
    });
    const { channels } = await collectRecruiterDossier(person, deps(fetch));
    expect(channels.some((c) => c.kind === 'telegram')).toBe(false);
  });
  it('does not take an empty Telegram page whose nickname spells the name', async () => {
    const fetch = router({
      'https://api.exa.ai/search': { results: [] },
      'https://t.me/': '<meta property="og:title" content="Telegram: Contact @annasmith">',
    });
    const { channels } = await collectRecruiterDossier(person, deps(fetch));
    expect(channels.some((c) => c.kind === 'telegram')).toBe(false);
  });

  it('ignores contact broker pages', async () => {
    const fetch = router({
      'https://api.exa.ai/search': { results: [{ url: 'https://contactout.com/Anna-Smith-1', title: 'Anna Smith', text: 'Anna Smith Acme anna.smith@gmail.com' }] },
      'https://t.me/': '<meta property="og:title" content="Telegram: Contact @x">',
    });
    const { channels } = await collectRecruiterDossier(person, deps(fetch));
    expect(channels.some((c) => c.kind.startsWith('email_'))).toBe(false);
  });
  it('links a Telegram account through a past employer from the LinkedIn profile', async () => {
    const fetch = router({
      'https://api.exa.ai/search': {
        results: [{ url: 'https://www.linkedin.com/in/anna-smith', title: 'Anna Smith', text: '# Anna Smith\nTalent Partner at Acme\nLondon, United Kingdom\nRecruiter at Globex (2019-2023)' }],
      },
      'https://t.me/annasmith': '<meta property="og:title" content="Anna Smith"><meta property="og:description" content="Globex alumni, London">',
      'https://t.me/': '<meta property="og:title" content="Telegram: Contact @x">',
    });
    const { channels } = await collectRecruiterDossier({ ...person, linkedinUrl: 'https://www.linkedin.com/in/anna-smith' }, deps(fetch));
    expect(channels.find((c) => c.kind === 'telegram')).toMatchObject({ value: '@annasmith', status: 'published' });
  });
  it('does not confirm a namesake Telegram through a nickname taken from an email', async () => {
    const fetch = router({
      'https://api.exa.ai/search': { results: [{ url: 'https://acme.com/team', title: 'Team', text: 'Anna Smith, anna_smith@acme.com' }] },
      'https://t.me/anna_smith': '<meta property="og:title" content="Anna Smith"><meta property="og:description" content="Photos and travel">',
      'https://t.me/': '<meta property="og:title" content="Telegram: Contact @x">',
    });
    const { channels } = await collectRecruiterDossier(person, deps(fetch));
    expect(channels.some((c) => c.kind === 'telegram')).toBe(false);
  });
  it('does not take a colleague LinkedIn link from the person page', async () => {
    const fetch = router({
      'https://api.exa.ai/search': { results: [{ url: 'https://acme.com/team', title: 'Anna Smith', text: 'Anna Smith, recruiter. Reposted from linkedin.com/in/kelliegillenwater' }] },
      'https://t.me/': '<meta property="og:title" content="Telegram: Contact @x">',
    });
    const { channels } = await collectRecruiterDossier(person, deps(fetch));
    expect(channels.some((c) => c.kind === 'linkedin')).toBe(false);
  });

  it('confirms Telegram and VK through the same photo plus a second signal; a namesake from the same city stays out', async () => {
    const vkPage = (nick: string, photo: string) => `<script>{"method":"users.get","response":[{"first_name":"Anna","last_name":"Smith",`
      + `"about":"London","screen_name":"${nick}","photo_200":"${photo.replace(/\//gu, '\\/')}"}]}</script>`;
    const fetch = router({
      'https://api.exa.ai/search': { results: [seedPage] },
      'https://media.licdn.com/anna.jpg': portrait(0.3),
      'https://cdn4.telesco.pe/anna.jpg': portrait(0.3, 64),
      'https://sun9-1.userapi.com/anna.jpg': portrait(0.3, 200),
      'https://sun9-1.userapi.com/other.jpg': portrait(0.75, 96, true),
      'https://t.me/annasmith': '<meta property="og:title" content="Anna Smith"><meta property="og:description" content="London"><meta property="og:image" content="https://cdn4.telesco.pe/anna.jpg">',
      'https://t.me/': '<meta property="og:title" content="Telegram: Contact @x">',
      'https://vk.com/annasmith': vkPage('annasmith', 'https://sun9-1.userapi.com/other.jpg'),
      'https://vk.com/anna_smith': vkPage('anna_smith', 'https://sun9-1.userapi.com/anna.jpg'),
    });

    const { channels } = await collectRecruiterDossier({ ...person, companyName: 'Globex', linkedinUrl: seedPage.url }, deps(fetch));

    expect(channels.find((c) => c.kind === 'telegram')).toMatchObject({ value: '@annasmith', status: 'published' });
    expect(channels.filter((c) => c.kind === 'vk').map((c) => `${c.value}:${c.status}`)).toEqual(['anna_smith:published']);
  });

  it('does not download candidate photos when the person has no profile photo', async () => {
    const fetch = router({
      'https://api.exa.ai/search': { results: [{ ...seedPage, image: undefined }] },
      'https://t.me/annasmith': '<meta property="og:title" content="Anna Smith"><meta property="og:image" content="https://cdn4.telesco.pe/anna.jpg">',
    });
    await collectRecruiterDossier({ ...person, linkedinUrl: seedPage.url }, deps(fetch));
    expect(fetch.mock.calls.map(([url]) => String(url)).some((url) => url.includes('telesco.pe'))).toBe(false);
  });

  it('never takes a Telegram channel or group for a personal account', async () => {
    const fetch = router({
      'https://api.exa.ai/search': {
        results: [{ url: 'https://acme.com/team', title: 'Team', text: 'Anna Smith — recruiter. https://instagram.com/annahires' }],
      },
      'https://t.me/annahires': '<meta property="og:title" content="Anna Smith"><div class="tgme_page_extra">80 subscribers</div><a>Preview channel</a>',
    });
    const { channels } = await collectRecruiterDossier(person, deps(fetch));
    expect(channels.some((c) => c.kind === 'telegram' && c.value === '@annahires')).toBe(false);
  });

  it('drops a t.me link from a page when it leads to a channel', async () => {
    const fetch = router({
      'https://api.exa.ai/search': {
        results: [{ url: 'https://conf.example/speakers', title: 'Speakers', text: 'Anna Smith, Talent Partner at Acme. t.me/anna_hr' }],
      },
      'https://t.me/anna_hr': '<meta property="og:title" content="HR notes"><div class="tgme_page_extra">80 subscribers</div>',
    });
    const { channels } = await collectRecruiterDossier(person, deps(fetch));
    expect(channels.some((c) => c.kind === 'telegram')).toBe(false);
  });

  it('takes the contacts a person published in the About section of their own open LinkedIn profile', async () => {
    const own = { ...seedPage, text: 'Anna Smith\nTalent Partner at Acme\nLondon, UK\nAbout: write me anna.smith@gmail.com or WhatsApp +44 7700 900123' };
    const fetch = router({ 'https://api.exa.ai/search': { results: [own] } });
    const { channels } = await collectRecruiterDossier({ ...person, linkedinUrl: seedPage.url }, deps(fetch));
    expect(channels.filter((c) => c.sourceUrl === seedPage.url).map((c) => `${c.kind}=${c.value}:${c.status}`)).toEqual(
      expect.arrayContaining(['email_personal=anna.smith@gmail.com:published']),
    );
    expect(channels.some((c) => c.sourceUrl === seedPage.url && /7700900123/u.test(c.value.replace(/\D/gu, '')))).toBe(true);
  });
});
