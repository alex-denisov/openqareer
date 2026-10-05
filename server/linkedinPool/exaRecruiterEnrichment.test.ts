import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  enrichRecruitersFromExa,
  matchesLinkedinCard,
  normalizeExaLinkedinUrl,
  parseExaProfileText,
} from './exaRecruiterEnrichment';
import { SqliteLinkedinPoolRepository } from './sqliteLinkedinPoolRepository';
import { FootprintRequestGate } from '../osint/adapters/requestScheduler';

const now = new Date('2026-10-05T12:00:00.000Z');
const resources: Array<{ repository: SqliteLinkedinPoolRepository; directory: string }> = [];

afterEach(() => {
  for (const resource of resources.splice(0)) {
    resource.repository.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
});

function createRepository() {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-exa-enrich-'));
  const repository = new SqliteLinkedinPoolRepository({
    databasePath: join(directory, 'pool.db'),
    encryptionKey: Buffer.alloc(32, 7),
    runtimeRoot: join(directory, 'runtime'),
    now: () => now,
  });
  resources.push({ repository, directory });
  return repository;
}

function exaResponse(results: unknown[]) {
  return vi.fn(async () => new Response(JSON.stringify({ results }), { status: 200 }));
}

const nick = {
  url: 'https://es.linkedin.com/in/nick-wadding/en',
  title: 'Nick Wadding',
  text: '# Nick Wadding\nRecruiting for Data roles at Booking.com\nManchester, England, United Kingdom (GB)\n500 connections',
};

const hidden = (headline: string, location: string) => ({
  fullName: null,
  linkedinUrl: null,
  headline,
  location,
});

function run(
  repository: SqliteLinkedinPoolRepository,
  fetch: unknown,
  extra: Record<string, unknown> = {},
) {
  return enrichRecruitersFromExa({
    repository,
    companyName: 'Booking.com',
    cards: [],
    apiKey: 'exa-test-key',
    fetch: fetch as typeof globalThis.fetch,
    requestGate: new FootprintRequestGate({ intervalMs: 0 }),
    now: () => now,
    signal: new AbortController().signal,
    ...extra,
  });
}

describe('normalizeExaLinkedinUrl', () => {
  it('приводит поддомены и хвосты к https://www.linkedin.com/in/<slug>', () => {
    expect(normalizeExaLinkedinUrl('https://es.linkedin.com/in/nick-wadding/en')).toBe(
      'https://www.linkedin.com/in/nick-wadding',
    );
    expect(normalizeExaLinkedinUrl('https://www.linkedin.com/in/a-b/?trk=x')).toBe(
      'https://www.linkedin.com/in/a-b',
    );
  });
  it('отвергает чужие сайты и не профили', () => {
    expect(normalizeExaLinkedinUrl('https://evil.example/in/x')).toBeNull();
    expect(normalizeExaLinkedinUrl('https://www.linkedin.com/company/booking')).toBeNull();
    expect(normalizeExaLinkedinUrl('not a url')).toBeNull();
  });
});

describe('parseExaProfileText', () => {
  it('берёт заголовок и город, убирая код страны', () => {
    expect(parseExaProfileText(nick.text)).toEqual({
      headline: 'Recruiting for Data roles at Booking.com',
      location: 'Manchester, England, United Kingdom',
    });
  });
  it('без заголовка возвращает null', () => {
    expect(parseExaProfileText('# Name')).toBeNull();
  });
});

describe('matchesLinkedinCard', () => {
  const profile = {
    headline: 'Senior Tech Recruiter at Booking.com',
    location: 'Amsterdam, North Holland, Netherlands',
  };
  it('совпадает при одинаковом заголовке и городе', () => {
    expect(matchesLinkedinCard(profile, [hidden(profile.headline, profile.location)])).toBe(true);
  });
  it('совпадает, если одна строка содержит другую', () => {
    expect(
      matchesLinkedinCard(profile, [hidden('Senior Tech Recruiter at Booking.com | MBA', 'Amsterdam, X')]),
    ).toBe(true);
  });
  it('не совпадает при другом городе', () => {
    expect(matchesLinkedinCard(profile, [hidden(profile.headline, 'Toronto, Canada')])).toBe(false);
  });
});

describe('enrichRecruitersFromExa', () => {
  const rows = (repository: SqliteLinkedinPoolRepository) =>
    repository
      .getDatabase()
      .prepare(
        `SELECT r.full_name, r.role_title, r.linkedin_url, s.source
         FROM linkedin_pool_company_recruiters r
         LEFT JOIN linkedin_pool_company_recruiter_sources s ON s.recruiter_id = r.id`,
      )
      .all();

  it('сохраняет только URL, имя и заголовок; подтверждённого карточкой помечает exa+linkedin', async () => {
    const repository = createRepository();
    const fetch = exaResponse([nick]);
    const outcome = await run(repository, fetch, {
      cards: [hidden('Recruiting for Data roles at Booking.com', 'Manchester, England')],
    });
    expect(outcome).toEqual({ status: 'done', saved: 1 });
    expect(rows(repository)).toEqual([
      {
        full_name: 'Nick Wadding',
        role_title: 'Recruiting for Data roles at Booking.com',
        linkedin_url: 'https://www.linkedin.com/in/nick-wadding',
        source: 'exa+linkedin',
      },
    ]);
    const call = fetch.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(call[1].body)).toMatchObject({
      query: 'recruiter at Booking.com',
      category: 'people',
      numResults: 10,
      includeDomains: ['linkedin.com'],
    });
  });

  it('без совпадения с карточкой источник — exa', async () => {
    const repository = createRepository();
    await run(repository, exaResponse([nick]));
    expect(rows(repository)).toMatchObject([{ source: 'exa' }]);
  });

  it('не принимает чужую компанию и профиль без признака найма', async () => {
    const repository = createRepository();
    const other = {
      ...nick,
      url: 'https://www.linkedin.com/in/a',
      text: '# A\nRecruiter at Booking Holdings\nParis, France\n',
    };
    const noHiring = {
      ...nick,
      url: 'https://www.linkedin.com/in/b',
      text: '# B\nSoftware Engineer at Booking.com\nParis, France\n',
    };
    const outcome = await run(repository, exaResponse([other, noHiring]));
    expect(outcome).toEqual({ status: 'done', saved: 0 });
    expect(rows(repository)).toEqual([]);
  });

  it('не больше одного запроса на компанию за 30 дней', async () => {
    const repository = createRepository();
    const fetch = exaResponse([nick]);
    await run(repository, fetch);
    const again = await run(repository, fetch, { companyName: 'booking.com' });
    expect(again).toEqual({ status: 'cached', saved: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const later = await run(repository, fetch, {
      now: () => new Date(now.getTime() + 31 * 86_400_000),
    });
    expect(later.status).toBe('done');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('без ключа пропускает без запроса', async () => {
    const repository = createRepository();
    const fetch = exaResponse([]);
    const outcome = await run(repository, fetch, { apiKey: undefined });
    expect(outcome).toEqual({ status: 'exa_not_configured', saved: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('сбой Exa — статус failed, кэш не ставится', async () => {
    const repository = createRepository();
    const bad = vi.fn(async () => new Response('x', { status: 500 }));
    expect((await run(repository, bad)).status).toBe('failed');
    expect((await run(repository, exaResponse([nick]))).status).toBe('done');
  });
});
