import { describe, expect, it } from 'vitest';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { MemoryVacancyPoolStore } from './memoryVacancyPoolStore';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';

const BASE = Date.parse('2026-11-03T10:00:00Z');
const HOUR = 3_600_000;

const vacancy = (sourceId: string): UnifiedVacancy => ({
  id: 'v-1',
  fingerprint: 'fp-1',
  title: 'Senior Engineer',
  company: 'Acme',
  isRemote: true,
  description: 'Senior Engineer specializing in TypeScript and resilient backend systems.',
  url: 'https://example.com/v-1',
  publishedAt: new Date(BASE).toISOString(),
  status: 'active',
  requiredSkills: ['TypeScript'],
  provenance: {
    sourceId,
    sourceType: 'json_api',
    sourceUrl: 'https://example.com/v-1',
    observedAt: new Date(BASE).toISOString(),
  },
});

const source = (id: string): VacancySourceConfig => ({
  id,
  name: id,
  type: 'json_api',
  enabled: true,
  targetUrl: 'https://example.com/api',
  refreshIntervalMinutes: 30,
  itemsFoundTotal: 0,
  itemsActiveTotal: 0,
});

function httpError(status: number): Error {
  return new Error(`vacancy_source_unreachable: ${status}`);
}

describe('ATS board answering 404 (03.11 prod: greenhouse amplitude/postman, recruitee google)', () => {
  it('keeps the slice for two 404s and withdraws it on the third, marking the board closed', async () => {
    const id = 'ats-greenhouse-amplitude';
    let answer: 'ok' | 404 = 'ok';
    const pool = new MemoryVacancyPoolStore();
    const engine = new MultiSourceVacancyEngine({
      sources: [source(id)],
      pool,
      fetcher: async () => {
        if (answer === 404) throw httpError(404);
        return [vacancy(id)];
      },
    });
    await engine.syncSource(id, undefined, BASE);
    expect(pool.countSourceSlice(id).active).toBe(1);

    answer = 404;
    await engine.syncSource(id, undefined, BASE + 20 * HOUR);
    await engine.syncSource(id, undefined, BASE + 40 * HOUR);
    expect(pool.countSourceSlice(id).active).toBe(1);

    await engine.syncSource(id, undefined, BASE + 60 * HOUR);
    expect(pool.countSourceSlice(id).active).toBe(0);
    const stored = engine.getSources().find((s) => s.id === id);
    expect(stored?.lastErrorMessage).toMatch(/board_closed/);
    expect(stored?.itemsActiveTotal).toBe(0);
  });

  it('does not count a 404 on a non-ATS source and resets the count after a good reading', async () => {
    const id = 'src-plain';
    const pool = new MemoryVacancyPoolStore();
    let answer: 'ok' | 404 = 'ok';
    const engine = new MultiSourceVacancyEngine({
      sources: [source(id)],
      pool,
      fetcher: async () => {
        if (answer === 404) throw httpError(404);
        return [vacancy(id)];
      },
    });
    await engine.syncSource(id, undefined, BASE);
    answer = 404;
    for (let i = 1; i <= 4; i += 1) await engine.syncSource(id, undefined, BASE + i * 20 * HOUR);
    expect(pool.countSourceSlice(id).active).toBe(1);
  });
});

describe('HTTP status carried only in the message', () => {
  it('backs a source off on 429 even when the error has no statusCode field', async () => {
    const id = 'src-429';
    let calls = 0;
    const engine = new MultiSourceVacancyEngine({
      sources: [source(id)],
      fetcher: async () => {
        calls += 1;
        throw httpError(429);
      },
    });
    await engine.syncDue(BASE);
    await engine.syncDue(BASE + 5 * 60_000);
    expect(calls).toBe(1);
  });
});

describe('source whose tool is not installed (Glassdoor/ZipRecruiter without obscura)', () => {
  it('is reported as not configured, not as an error, and never counts as a failed reading', async () => {
    const id = 'src-glassdoor';
    const engine = new MultiSourceVacancyEngine({
      sources: [source(id)],
      fetcher: async () => {
        throw new Error('source_not_configured: obscura binary is not installed');
      },
    });
    const outcome = await engine.syncSource(id, undefined, BASE);
    expect(outcome.status).toBe('disabled');
    expect(outcome.message).toMatch(/source_not_configured/);
    const stored = engine.getSources().find((s) => s.id === id);
    expect(stored?.lastStatus).not.toBe('error');
    expect(stored?.lastErrorMessage).toMatch(/source_not_configured/);
  });
});
