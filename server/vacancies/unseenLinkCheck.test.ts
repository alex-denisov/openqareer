import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import { judgeLinkOutcome } from './linkLivenessProbe';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';

const DAY = 24 * 60 * 60 * 1000;
const SOURCE = 'ats-greenhouse-acme';
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((done) => done()));

function vacancy(id: string, seenAgoDays: number): UnifiedVacancy {
  return {
    id,
    fingerprint: `fp-${id}`,
    title: `CFO ${id}`,
    company: 'Acme',
    isRemote: true,
    description: 'Executive search.',
    requiredSkills: [],
    url: `https://boards.example.com/acme/jobs/${id}`,
    provenance: {
      sourceType: 'json_api',
      sourceId: SOURCE,
      sourceUrl: `https://boards.example.com/acme/jobs/${id}`,
      observedAt: new Date(Date.now() - seenAgoDays * DAY).toISOString(),
    },
    publishedAt: new Date(Date.now() - 60 * DAY).toISOString(),
    status: 'active',
  };
}

const source: VacancySourceConfig = {
  id: SOURCE,
  name: 'Acme',
  type: 'json_api',
  enabled: true,
  targetUrl: 'https://boards.example.com/acme',
  refreshIntervalMinutes: 180,
  itemsFoundTotal: 0,
  itemsActiveTotal: 0,
};

describe('переход на список вакансий — снятое объявление (B642)', () => {
  it('редирект на корень или на родительский список — gone, на другую страницу — open', () => {
    const url = 'https://boards.example.com/acme/jobs/123';
    expect(
      judgeLinkOutcome({ status: 302, location: 'https://boards.example.com/acme/jobs' }, url)
        .verdict,
    ).toBe('gone');
    expect(judgeLinkOutcome({ status: 301, location: '/' }, url).verdict).toBe('gone');
    expect(
      judgeLinkOutcome({ status: 301, location: '/acme/jobs/123?gh_src=1' }, url).verdict,
    ).toBe('open');
    expect(judgeLinkOutcome({ status: 302 }, url).verdict).toBe('open');
  });
});

describe('проверка ссылок, невиденных в последнем чтении (B642)', () => {
  it('снятое хоронит, живое отмечает виденным, свежевиденное не трогает', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'unseen-'));
    const path = join(directory, 'pool.db');
    const pool = new SqliteVacancyPoolStore({ databasePath: path });
    const read = new DatabaseSync(path);
    cleanup.push(() => {
      read.close();
      pool.close();
      rmSync(directory, { recursive: true, force: true });
    });
    pool.replaceSourceSlice(SOURCE, [vacancy('dead', 3), vacancy('alive', 3), vacancy('fresh', 0)]);
    const asked: string[] = [];
    const engine = new MultiSourceVacancyEngine({
      sources: [source],
      pool,
      linkProbe: async (url) => {
        asked.push(url);
        return url.endsWith('/dead') ? { status: 404 } : { status: 200 };
      },
    });

    const report = await engine.probeUnseenEmployerLinks();

    expect(report).toEqual({ checked: 2, gone: 1, open: 1, unknown: 0 });
    expect(asked.some((url) => url.endsWith('/fresh'))).toBe(false);
    const rows = read
      .prepare('SELECT id, expired, observed_ms FROM vacancy_pool_index ORDER BY id')
      .all() as Array<{ id: string; expired: number; observed_ms: number }>;
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get('dead')?.expired).toBe(1);
    expect(byId.get('alive')?.expired).toBe(0);
    expect(byId.get('alive')!.observed_ms).toBeGreaterThan(Date.now() - 60_000);

    const again = await engine.probeUnseenEmployerLinks();
    expect(again.checked).toBe(0);
  });
});
