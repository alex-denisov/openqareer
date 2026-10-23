import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import Fastify from 'fastify';
import { describe, it, expect } from 'vitest';
import {
  renderSalaryMarketDocument,
  registerSalaryMarketRoutes,
  loadPublicSalarySnapshot,
} from './salaryMarketRoutes';
import { writeSalaryMarketSnapshots } from '../salaryMarket/salaryMarketSnapshot';
import type { SalaryMarketSnapshot } from '../../shared/salaryMarketSnapshot';
const snapshot: SalaryMarketSnapshot = {
  role: 'analyst',
  roleLabel: 'Analyst',
  updatedAt: '2026-10-23T00:00:00Z',
  sampleSize: 5,
  windowDays: 90,
  source: 'deduplicated_public_catalog',
  skills: [],
  grades: 'unavailable',
  quarterlyTrend: 'unavailable',
  salary: {
    status: 'unavailable',
    reason: 'missing_explicit_salary_period',
    excluded: {
      missingPeriod: 5,
      missingCurrency: 0,
      openRange: 0,
      invalidRange: 0,
      belowMinimumSample: 0,
    },
  },
};
const template =
  '<!doctype html><html lang="ru"><head><title>old</title><meta name="description" content="old"><link rel="canonical" href="old"></head><body><div class="ps">%%SALARY_CONTENT%%</div></body></html>';
describe('bounded salary SSR', () => {
  it('reads the requested prepared role without requiring any catalog table', () => {
    const dir = mkdtempSync(join(tmpdir(), 'salary-ssr-'));
    const path = join(dir, 'test.sqlite');
    const db = new DatabaseSync(path);
    writeSalaryMarketSnapshots(db, [snapshot]);
    db.close();
    try {
      expect(loadPublicSalarySnapshot(path, 'analyst')).toEqual(snapshot);
      expect(loadPublicSalarySnapshot(path, 'missing')).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('escapes untrusted occupation text and omits salary schema without evidence', () => {
    const html = renderSalaryMarketDocument(
      template,
      { ...snapshot, roleLabel: '</script><script>alert(1)</script>' },
      'analyst',
    );
    expect(html).not.toContain('</script><script>alert(1)</script>');
    expect(html).toContain('noindex, follow');
    expect(html).toContain('BreadcrumbList');
    expect(html).not.toContain('"@type":"Occupation"');
    expect(html).toContain('https://openqareer.com/salaries/analyst');
  });
  it('serves missing and available prepared snapshots honestly, filters by GET, closes safely', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'salary-routes-'));
    writeFileSync(join(dir, 'salary-market.html'), template);
    const app = Fastify();
    let reads = 0;
    registerSalaryMarketRoutes(app, {
      staticRoot: dir,
      databasePath: '',
      read: (role) => {
        reads++;
        return role === 'analyst' ? snapshot : null;
      },
    });
    try {
      const found = await app.inject('/salaries/analyst?group=999');
      expect(found.statusCode).toBe(200);
      expect(found.body).toContain('noindex, follow');
      const missing = await app.inject('/salaries/missing');
      expect(missing.statusCode).toBe(404);
      expect(missing.body).toContain('Сравнимой зарплатной выборки пока нет');
      expect(reads).toBe(2);
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('keeps replacement metacharacters literal in untrusted labels', () => {
    const label = "Analyst $' $& $$";
    const html = renderSalaryMarketDocument(template, { ...snapshot, roleLabel: label }, 'analyst');
    const json = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/u)![1]!;
    expect(JSON.parse(json)['@graph'][0].itemListElement[1].name).toBe(label);
  });
  it('bounds the prepared directory to 20 visible roles and offers real pagination', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'salary-directory-'));
    writeFileSync(join(dir, 'salary-market.html'), template);
    const roles = Array.from({ length: 25 }, (_, i) => ({
      role: `analyst-${i}`,
      roleLabel: `Analyst ${i}`,
      sampleSize: 10,
      updatedAt: snapshot.updatedAt,
      indexable: true,
    }));
    const app = Fastify();
    registerSalaryMarketRoutes(app, { staticRoot: dir, databasePath: '', readIndex: () => roles });
    try {
      const first = await app.inject('/salaries');
      expect(first.statusCode).toBe(200);
      expect(first.body).toContain('href="/salaries?page=2"');
      expect(first.body).not.toContain('Analyst 24');
      const second = await app.inject('/salaries?page=2');
      expect(second.body).toContain('Analyst 24');
      expect(second.body).not.toContain('>Analyst 0<');
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('returns 503/noindex when the prepared reader fails instead of a fabricated result', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'salary-failure-'));
    writeFileSync(join(dir, 'salary-market.html'), template);
    const app = Fastify();
    registerSalaryMarketRoutes(app, {
      staticRoot: dir,
      databasePath: '',
      read: () => {
        throw new Error('unavailable');
      },
    });
    try {
      const result = await app.inject('/salaries/analyst');
      expect(result.statusCode).toBe(503);
      expect(result.headers['x-robots-tag']).toBe('noindex');
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
