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
  it('bounds the prepared directory to 10 visible roles and offers real pagination', async () => {
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
      const second = await app.inject('/salaries?page=3');
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
  it('rejects unsupported grade names and absent slices rather than showing aggregate data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'salary-grade-'));
    writeFileSync(join(dir, 'salary-market.html'), template);
    const app = Fastify();
    registerSalaryMarketRoutes(app, { staticRoot: dir, databasePath: '', read: () => snapshot });
    try {
      const invalid = await app.inject('/salaries/analyst?grade=executive');
      expect(invalid.statusCode).toBe(400);
      const missing = await app.inject('/salaries/analyst?grade=senior');
      expect(missing.statusCode).toBe(404);
      expect(missing.headers['x-robots-tag']).toBe('noindex');
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('gates metadata on the selected grade rather than borrowing the whole profession sample', () => {
    const full: SalaryMarketSnapshot = {
      ...snapshot,
      profession: { kind: 'b267', roleId: 'eng.analyst' },
      salary: {
        status: 'available',
        methodology: 'published_range_bounds',
        excluded: snapshot.salary.excluded,
        groups: [
          {
            currency: 'EUR',
            period: 'year',
            taxBasis: 'gross',
            sampleSize: 5,
            lower: { p25: 1, p50: 2, p75: 3, p90: 4 },
            upper: { p25: 2, p50: 3, p75: 4, p90: 5 },
          },
        ],
      },
      gradeSlices: [
        {
          grade: 'unknown',
          sampleSize: 2,
          skills: [],
          salary: snapshot.salary,
          evidence: { field: 'title', markers: [] },
        },
      ],
    };
    expect(renderSalaryMarketDocument(template, full, 'analyst')).toContain(
      'content="index, follow"',
    );
    const indexed = renderSalaryMarketDocument(template, full, 'analyst');
    expect(indexed).toContain('"@type":"Occupation"');
    expect(indexed).not.toContain('"estimatedSalary"');
    const selected = renderSalaryMarketDocument(template, full, 'analyst', 0, undefined, 'unknown');
    expect(selected).toContain('content="noindex, follow"');
    expect(selected).not.toContain('"@type":"Occupation"');
    expect(selected).not.toContain('<dt>P50</dt>');
  });
  it('serves the country page from the tax calculator with FAQPage (B351 06b)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'salary-country-'));
    writeFileSync(join(dir, 'salary-market.html'), template);
    const app = Fastify();
    registerSalaryMarketRoutes(app, { staticRoot: dir, databasePath: join(dir, 'none.db') });
    try {
      const response = await app.inject('/salaries/germany');
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('Зарплата в Германии: сколько остаётся на руки');
      expect(response.body).toContain('"@type":"FAQPage"');
      expect(response.body).toContain('4 225 €');
      expect(response.body).toContain('href="/signup?from=salaries&amp;country=DE&amp;next=match"');
      expect(response.body).toContain('index, follow');
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('serves the city page when a place reaches the minimum, the old view otherwise (06a)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'salary-city-'));
    writeFileSync(join(dir, 'salary-market.html'), template);
    const group = { currency: 'RUR', period: 'month', taxBasis: 'gross', sampleSize: 40 };
    const withCities: SalaryMarketSnapshot = {
      ...snapshot,
      role: 'accountant',
      roleLabel: 'Бухгалтер',
      cityMarket: {
        method: 'closed_monthly_range_midpoint_v1',
        minSample: 30,
        rangedTotal: 40,
        publishedSample: 40,
        cities: [
          {
            city: 'Москва',
            placeSlug: 'moscow',
            vacancyCount: 60,
            salary: { ...group, p25: 105_000, p50: 125_000, p75: 140_000 } as never,
          },
        ],
      },
    };
    const app = Fastify();
    registerSalaryMarketRoutes(app, {
      staticRoot: dir,
      databasePath: join(dir, 'none.db'),
      read: (role) => (role === 'accountant' ? withCities : snapshot),
      readIndex: () => [],
    });
    try {
      const city = await app.inject('/salaries/accountant');
      expect(city.body).toContain('Зарплата бухгалтера в 2026 году по городам');
      expect(city.body).toContain('105 000–140 000 ₽');
      expect(city.body).toContain('href="/vacancies/moscow"');
      expect(city.body).toContain('"@type":"FAQPage"');
      const fallback = await app.inject('/salaries/analyst');
      expect(fallback.body).not.toContain('по городам');
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
