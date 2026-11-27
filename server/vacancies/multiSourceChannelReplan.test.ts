import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { COMPANY_DIRECTORY_MIGRATION } from '../data/companyDirectorySchema';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import { composeVacancyEngine, holdDuringLinkedinPause } from './composeVacancyEngine';
import { createLinkedinGuestBudget } from './linkedinGuestBudget';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeVacancy(id: string, sourceId: string, publishedAt: string): UnifiedVacancy {
  return {
    id,
    fingerprint: `fp-${id}`,
    title: `Software Engineer ${id}`,
    company: 'TestCo',
    location: 'Remote',
    isRemote: true,
    description: `Role ${id}`,
    requiredSkills: ['TypeScript'],
    url: `https://example.com/jobs/${id}`,
    provenance: {
      sourceType: 'json_api',
      sourceId,
      sourceUrl: `https://example.com/jobs/${id}`,
      observedAt: publishedAt,
    },
    publishedAt,
    status: 'active',
  };
}

function makeCfg(id: string, type: VacancySourceConfig['type'] = 'json_api'): VacancySourceConfig {
  return {
    id,
    name: id,
    type,
    enabled: true,
    targetUrl: `https://${id}.example/jobs`,
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  };
}

describe('MultiSourceVacancyEngine channel replan & rate-limit holds', () => {
  it('F6: keeps transient failures retrying, auto-disables terminal failures across restarts, and stamps placement gone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oq-f6-terminal-'));
    dirs.push(dir);
    const dbPath = join(dir, 'pool.db');
    const pool = new SqliteVacancyPoolStore({ databasePath: dbPath });
    pool.replaceSourceSlice('ats-lever-dead', [
      makeVacancy('dead-1', 'ats-lever-dead', new Date().toISOString()),
    ]);
    pool.replaceSourceSlice('src-plain', [
      makeVacancy('plain-1', 'src-plain', new Date().toISOString()),
    ]);
    const db = new DatabaseSync(dbPath);
    db.prepare(
      `INSERT INTO company_placement (placement_id, company_key, type, provider, slug, priority, source_id, discovered_by, updated_at)
       VALUES ('ats:lever:dead', 'deadco', 'ats', 'lever', 'dead', 1, 'ats-lever-dead', 'directory', 0)`,
    ).run();

    const engine = new MultiSourceVacancyEngine({
      sources: [makeCfg('ats-lever-dead'), makeCfg('src-transient'), makeCfg('src-plain')],
      pool,
      fetcher: async (src) => {
        if (src.id === 'src-transient') {
          throw Object.assign(new Error('vacancy_source_unreachable: 503'), { statusCode: 503 });
        }
        if (src.id === 'ats-lever-dead') {
          throw Object.assign(new Error('vacancy_source_unreachable: 404'), { statusCode: 404 });
        }
        if (src.id === 'src-plain') {
          throw new Error('fetch failed (ENOTFOUND)');
        }
        return [makeVacancy('v-ok', src.id, new Date().toISOString())];
      },
    });

    const base = Date.parse('2026-11-20T00:00:00Z');
    for (let i = 0; i < 4; i += 1) {
      await engine.syncSource('src-transient', undefined, base + i * 3_600_000);
    }
    expect(engine.getSource('src-transient')?.enabled).toBe(true);
    expect(engine.getSource('src-transient')?.lastStatus).toBe('error');

    await engine.syncSource('ats-lever-dead', undefined, base);
    await engine.syncSource('ats-lever-dead', undefined, base + 24 * 3_600_000);
    const deadOut = await engine.syncSource('ats-lever-dead', undefined, base + 48 * 3_600_000);
    expect(deadOut.status).toBe('error');
    expect(engine.getSource('ats-lever-dead')?.enabled).toBe(true);
    expect(engine.getSource('ats-lever-dead')?.lastStatus).toBe('error');
    expect(pool.countSourceSlice('ats-lever-dead').active).toBe(0);

    for (let i = 0; i < 3; i += 1) {
      await engine.syncSource('src-plain', undefined, base + i * 24 * 3_600_000);
    }
    expect(engine.getSource('src-plain')?.enabled).toBe(true);
    expect(engine.getSource('src-plain')?.lastStatus).toBe('error');
    expect(pool.countSourceSlice('src-plain').active).toBe(1);

    const placement = db
      .prepare(`SELECT health FROM company_placement WHERE placement_id = 'ats:lever:dead'`)
      .get() as { health: string };
    expect(placement.health).toBe('error');

    const restarted = new MultiSourceVacancyEngine({
      sources: [makeCfg('ats-lever-dead')],
      pool,
    });
    expect(restarted.getSource('ats-lever-dead')?.enabled).toBe(true);
    expect(restarted.getSource('ats-lever-dead')?.lastStatus).toBe('error');
    expect(
      restarted.getScheduler().isSourceDue('ats-lever-dead', 60, base + 48 * 3_600_000 + 25 * 3_600_000).due,
    ).toBe(true);

    db.close();
    pool.close();
  });

  it('F6: holds queued sibling src-company-li-* sources when LinkedIn 429 triggers mid-wave', async () => {
    let clock = Date.UTC(2026, 10, 20, 12);
    const budget = createLinkedinGuestBudget({
      now: () => clock,
      sleep: async (ms) => {
        await new Promise((r) => setTimeout(r, 0));
        clock += ms;
      },
      baseGapMs: 500,
    });

    let calls = 0;
    const sources: VacancySourceConfig[] = ['a', 'b', 'c'].map((key, idx) => ({
      id: `src-company-li-${key}`,
      name: `${key} (LinkedIn)`,
      type: 'json_api',
      enabled: true,
      channelTier: 1,
      companyKey: key,
      linkedinOrgId: `${100 + idx}`,
      targetUrl: `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?f_C=${key}`,
      refreshIntervalMinutes: 720,
      itemsFoundTotal: 0,
      itemsActiveTotal: 0,
    }));

    const engine = new MultiSourceVacancyEngine({
      sources,
      holdSource: holdDuringLinkedinPause(budget),
      fetcher: async (src) => {
        const callIndex = ++calls;
        await budget.acquire('companies');
        if (callIndex === 1) {
          budget.markRateLimited();
          throw Object.assign(new Error('vacancy_source_unreachable: 429'), { statusCode: 429 });
        }
        return [makeVacancy(`v-${src.id}`, src.id, new Date(clock).toISOString())];
      },
    });

    const outcomes = await engine.syncDue(clock);
    const statuses = new Map(outcomes.map((o) => [o.sourceId, o.status]));
    expect(statuses.get('src-company-li-a')).toBe('error');
    expect(statuses.get('src-company-li-b')).toBe('held');
    expect(statuses.get('src-company-li-c')).toBe('held');
    expect(engine.getSource('src-company-li-b')?.lastStatus).toBeUndefined();
    expect(engine.getSource('src-company-li-c')?.lastStatus).toBeUndefined();
  });

  it('F3: dynamically replans from dead src-company-site-* to src-company-li-* without restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oq-f3-replan-'));
    dirs.push(dir);
    const dbPath = join(dir, 'pool.db');
    const setupDb = new DatabaseSync(dbPath);
    setupDb.exec(COMPANY_DIRECTORY_MIGRATION);
    setupDb
      .prepare(
        `INSERT INTO company_directory (company_key, company_name, website_url, careers_url, linkedin_org_id, status, source_type, created_at, updated_at)
         VALUES ('acme', 'Acme Corp', 'https://acme.test', 'https://acme.test/careers', '424242', 'active', 'corporate_portal', '2026-11-01', '2026-11-01')`,
      )
      .run();
    setupDb.close();

    const composed = composeVacancyEngine({
      databasePath: dbPath,
      fetchRobots: async () => ({ status: 200, body: 'User-agent: *\nAllow: /\n' }),
      fetcher: async (src) => {
        if (src.id === 'src-company-site-acme') {
          throw Object.assign(new Error('vacancy_source_unreachable: 404'), { statusCode: 404 });
        }
        if (src.id === 'src-company-li-acme') {
          return [makeVacancy('li-1', src.id, new Date().toISOString())];
        }
        return [];
      },
    });

    try {
      expect(composed.engine.getSource('src-company-site-acme')?.enabled).toBe(true);
      expect(composed.engine.getSource('src-company-li-acme')).toBeUndefined();

      const base = Date.parse('2026-11-25T00:00:00Z');
      await composed.engine.syncSource('src-company-site-acme', undefined, base);
      await composed.engine.syncSource('src-company-site-acme', undefined, base + 24 * 3_600_000);
      await composed.engine.syncSource('src-company-site-acme', undefined, base + 48 * 3_600_000);

      expect(composed.engine.getSource('src-company-site-acme')?.enabled).toBe(false);
      expect(composed.engine.getSource('src-company-li-acme')).toMatchObject({
        enabled: true,
        channelTier: 1,
        companyKey: 'acme',
        linkedinOrgId: '424242',
      });

      const liOutcome = await composed.engine.syncSource('src-company-li-acme', undefined, base + 49 * 3_600_000);
      expect(liOutcome).toMatchObject({ status: 'healthy', kept: 1 });
    } finally {
      composed.close();
    }
  });
});
