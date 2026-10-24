import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { emptySeoPreparedSnapshot, seoProviderViews } from '../shared/seoSourceSnapshot';
import { mergeSeoObservation } from './seo-prepared-projection';
import { exportSeoSummary } from './export-seo-summary';

const now = new Date('2026-10-24T06:00:00.000Z');
const google = { mode: 'official_api', observedAt: now.toISOString(), siteUrl: 'https://openqareer.com/',
  requestedWindow: { startDate: '2026-09-25', endDate: '2026-10-22' },
  searchAnalytics: { clicks: 0, impressions: 4, ctr: 0, position: null },
  topQueries: { status: 'available', rows: [{ keys: ['career'], clicks: 0, impressions: 4, ctr: 0, position: 2, secret: 'must not leak' }] },
  access_token: 'must not leak', host_id: 'must not leak', indexInspection: { raw: 'must not leak' } };
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

describe('safe prepared SEO export', () => {
  it('projects only actual aggregate/query fields, preserves zero/null and provider window', () => {
    const data = mergeSeoObservation(emptySeoPreparedSnapshot(now.toISOString()), 'google', google, now);
    expect(data.providers.google.lastSuccess?.metrics).toMatchObject({ clicks: 0, impressions: 4, position: null, ctr: 0 });
    expect(data.providers.google.lastSuccess?.window).toEqual({ from: '2026-09-25', to: '2026-10-22', timezone: 'America/Los_Angeles' });
    expect(data.providers.google.lastSuccess?.queries).toEqual([{ query: 'career', clicks: 0, impressions: 4, ctr: 0, position: 2 }]);
    expect(JSON.stringify(data)).not.toContain('must not leak');
  });
  it('preserves successful source after a failed attempt and marks its displayed age honestly', () => {
    const first = mergeSeoObservation(emptySeoPreparedSnapshot(), 'google', google, now);
    const later = new Date(now.getTime() + 86_400_000);
    const next = mergeSeoObservation(first, 'google', { mode: 'operational_check', observedAt: later.toISOString(), status: 'unavailable', reason: 'credentials_missing', error: 'private' }, later);
    expect(next.providers.google.lastSuccess).toEqual(first.providers.google.lastSuccess);
    expect(seoProviderViews(next, later.getTime()).google).toMatchObject({ status: 'available', stale: true });
    expect(JSON.stringify(next)).not.toContain('private');
  });
  it('keeps Yandex partial actual queries without manufacturing aggregate search clicks or zero summary', () => {
    const data = mergeSeoObservation(emptySeoPreparedSnapshot(), 'yandex', { mode: 'official_api', observedAt: now.toISOString(), site: 'https://openqareer.com',
      summary: { status: 'unavailable' }, queries: { status: 'available', dateFrom: '2026-10-10', dateTo: '2026-10-16', rows: [{ query: 'работа', clicks: 1, impressions: 4, ctr: 0.25, position: 2 }] } }, now);
    expect(data.providers.yandex.latestAttempt?.status).toBe('partial');
    expect(data.providers.yandex.lastSuccess?.metrics).toMatchObject({ clicks: null, indexedPages: null });
    expect(data.providers.yandex.lastSuccess?.queries).toHaveLength(1);
    expect(seoProviderViews(data, now.getTime()).yandex.stale).toBe(false);
  });
  it('rejects fixtures, other properties, future and out-of-order observations; bounds query rows', () => {
    const empty = emptySeoPreparedSnapshot();
    expect(() => mergeSeoObservation(empty, 'google', { ...google, mode: 'synthetic_fixture' }, now)).toThrow('synthetic_fixture_rejected');
    expect(() => mergeSeoObservation(empty, 'google', { ...google, siteUrl: 'https://example.test' }, now)).toThrow('invalid_property_origin');
    expect(() => mergeSeoObservation(empty, 'google', { ...google, observedAt: '2030-01-01T00:00:00Z' }, now)).toThrow('invalid_observation_time');
    const previous = mergeSeoObservation(empty, 'google', google, now);
    expect(() => mergeSeoObservation(previous, 'google', { ...google, observedAt: '2026-10-01T00:00:00Z' }, now)).toThrow('out_of_order_observation');
    const bounded = mergeSeoObservation(empty, 'google', { ...google, topQueries: { status: 'available', rows: Array.from({ length: 100 }, () => google.topQueries.rows[0]) } }, now);
    expect(bounded.providers.google.lastSuccess?.queries).toHaveLength(50);
  });
  it('writes a private atomic file, keeps last success on failure, and never replaces it with invalid input', () => {
    const directory = mkdtempSync(join(tmpdir(), 'oq-seo-export-')); directories.push(directory);
    const input = join(directory, 'input.json'); const output = join(directory, 'prepared.json');
    writeFileSync(input, JSON.stringify(google)); exportSeoSummary(output, { google: input }, now);
    const successful = readFileSync(output, 'utf8');
    expect(statSync(output).mode & 0o777).toBe(0o600);
    writeFileSync(input, JSON.stringify({ ...google, mode: 'synthetic_fixture' }));
    expect(() => exportSeoSummary(output, { google: input }, now)).toThrow('synthetic_fixture_rejected');
    expect(readFileSync(output, 'utf8')).toBe(successful);
    expect(readdirSync(directory).some((name) => name.endsWith('.tmp'))).toBe(false);
    writeFileSync(input, JSON.stringify(google));
    const preexisting = `${output}.${process.pid}.tmp`; writeFileSync(preexisting, 'another operation owns this');
    expect(() => exportSeoSummary(output, { google: input }, now)).toThrow();
    expect(readFileSync(preexisting, 'utf8')).toBe('another operation owns this');
    expect(readFileSync(output, 'utf8')).toBe(successful);
    const link = join(directory, 'link.json'); symlinkSync(input, link);
    expect(() => exportSeoSummary(output, { google: link }, now)).toThrow();
    expect(readFileSync(output, 'utf8')).toBe(successful);
  });
});
