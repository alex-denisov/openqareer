import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PublicHeader, PublicFooter } from '../../src/features/site/PublicSiteChrome';
import type { SalaryMarketGrade, SalaryMarketSnapshot } from '../../shared/salaryMarketSnapshot';
import { renderSalaryMarketDocument } from './salaryMarketRoutes';

const longLabel = 'Очень длинное исходное название & <сведения> '.repeat(40);
const excluded = {
  missingPeriod: 0,
  missingCurrency: 0,
  openRange: 0,
  invalidRange: 0,
  belowMinimumSample: 0,
};
const skills = Array.from({ length: 15 }, (_, i) => ({
  name: `${longLabel} ${i}`,
  count: 225,
  frequency: 75,
}));
const groups = [
  'EUR',
  'USD',
  'GBP',
  'CAD',
  'CHF',
  'AUD',
  'JPY',
  'CNY',
  'INR',
  'RUB',
  'PLN',
  'SEK',
].map((currency) => ({
  currency,
  period: 'year' as const,
  taxBasis: 'unknown' as const,
  sampleSize: 25,
  lower: { p25: 1234567, p50: 2345678, p75: 3456789, p90: 4567890 },
  upper: { p25: 2345678, p50: 3456789, p75: 4567890, p90: 5678901 },
}));
const salary = {
  status: 'available' as const,
  methodology: 'published_range_bounds' as const,
  groups,
  excluded,
};
const grades: readonly SalaryMarketGrade[] = ['junior', 'middle', 'senior', 'lead', 'unknown'];
function actualHistory(sampleSize: number) {
  return {
    status: 'available' as const,
    method: 'observed_catalog_skill_frequency_pp' as const,
    methodVersion: 'test-v1',
    earliestActualObservation: '2026-07-24T00:00:00Z',
    current: { observedAt: '2026-10-23T00:00:00Z', sampleSize },
    baseline: { observedAt: '2026-07-24T00:00:00Z', sampleSize },
    skills: skills.map((skill) => ({
      name: skill.name,
      currentCount: sampleSize * 0.75,
      currentFrequency: 75,
      baselineCount: sampleSize * 0.5,
      baselineFrequency: 50,
      changePP: 25,
      status: 'available' as const,
    })),
  };
}
const snapshot: SalaryMarketSnapshot = {
  skillQuarterlyTrend: actualHistory(300),
  role: 'frontend-engineer',
  roleLabel: 'Frontend-разработчик',
  profession: { kind: 'b267', roleId: 'eng.frontend.ic' },
  updatedAt: '2026-10-23T00:00:00Z',
  windowDays: 90,
  sampleSize: 300,
  source: 'deduplicated_public_catalog',
  grades: 'published_title_evidence',
  quarterlyTrend: 'unavailable',
  skills,
  salary,
  gradeSlices: grades.map((grade) => ({
    grade,
    skillQuarterlyTrend: actualHistory(60),
    sampleSize: 60,
    skills: skills.map((skill) => ({ ...skill, count: 45 })),
    salary: { ...salary, groups: groups.map((group) => ({ ...group, sampleSize: 5 })) },
    evidence: {
      field: 'title',
      markers: grade === 'unknown' ? [] : Array.from({ length: 8 }, () => longLabel),
    },
  })),
};
function wholeTemplate(): string {
  const chrome = renderToStaticMarkup(
    React.createElement(
      'div',
      { className: 'ps sm-public' },
      React.createElement(PublicHeader, {
        onNavigate: () => {},
        onLanding: false,
        signedIn: false,
      }),
      '%%SALARY_CONTENT%%',
      React.createElement(PublicFooter, {
        onNavigate: () => {},
        onLanding: false,
        signedIn: false,
        interviewLink: false,
      }),
    ),
  );
  // Real public head and chrome, plus room for the built asset/preload tags.
  return readFileSync('index.html', 'utf8')
    .replace('<div id="root"></div>', chrome)
    .replace('</head>', `<!--${' '.repeat(1024)}--></head>`);
}
describe('B351: data-dependent raw HTML budget', () => {
  it('bounds 15 long skills, 12 buckets, five grades and eight evidence examples', () => {
    const html = renderSalaryMarketDocument(
      wholeTemplate(),
      snapshot,
      snapshot.role,
      4,
      undefined,
      'senior',
    );
    expect(Buffer.byteLength(html)).toBeLessThan(20_000);
    expect(html).not.toContain(longLabel);
    expect(html).toContain('Другие валюты и периоды');
    expect(html).toContain('Предыдущие группы');
    expect(html).toContain('…');
  });
  it('bounds location/grade history with four scopes and three published neighbors', () => {
    const regional: SalaryMarketSnapshot = {
      ...snapshot,
      geography: {
        method: 'explicit_source_country_v1',
        regionPolicy: 'openqareer_candidate_regions_v1',
        explicitCountryCount: 200,
        unknownCountryCount: 90,
        ambiguousCountryCount: 10,
        remoteCount: 200,
      },
      locationSlices: (['remote', 'europe', 'uae', 'cis'] as const).map((location) => ({
        location,
        evidenceMethod: 'explicit_source_country_v1',
        sampleSize: 300,
        skills,
        salary,
        gradeSlices: snapshot.gradeSlices?.map((slice) => ({
          ...slice,
          skillEvidence: { method: 'exclude_role_taxonomy_clusters_v2', withheldClusterCount: 300 },
        })),
        skillQuarterlyTrend: actualHistory(300),
        quarterlyTrend: 'available',
      })),
    };
    const related = Array.from({ length: 3 }, (_, i) => ({
      role: `long-published-role-${'a'.repeat(60)}-${i}`,
      roleLabel: 'Длинное название профессии'.repeat(5),
      profession: { kind: 'b267' as const, roleId: 'eng.backend.ic' },
      sampleSize: 100,
      updatedAt: snapshot.updatedAt,
      indexable: true,
    }));
    const html = renderSalaryMarketDocument(
      wholeTemplate(),
      regional,
      regional.role,
      4,
      undefined,
      'senior',
      1,
      related,
      'europe',
    );
    expect(Buffer.byteLength(html)).toBeLessThan(20_000);
    expect(html).toContain('data-location="europe"');
    expect(html).toContain('Смежные профессии');
  });
  it('bounds directory rows and unclassified title in visible text, head and JSON-LD', () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({
      role: `unclassified-${'a'.repeat(45)}-${String(i).padStart(16, '0')}`,
      roleLabel: longLabel,
      sampleSize: 300,
      updatedAt: snapshot.updatedAt,
      indexable: false,
      profession: { kind: 'unclassified_title' as const },
    }));
    const template = wholeTemplate();
    for (const html of [
      renderSalaryMarketDocument(template, null, '', 1, entries),
      renderSalaryMarketDocument(template, null, '', 2, entries),
      renderSalaryMarketDocument(
        template,
        { ...snapshot, roleLabel: longLabel, profession: { kind: 'unclassified_title' } },
        snapshot.role,
        4,
      ),
    ]) {
      expect(Buffer.byteLength(html)).toBeLessThan(20_000);
      expect(html).not.toContain(longLabel);
      expect(html).toContain('noindex, follow');
    }
  });
  it('also bounds the maximum HTML-escape expansion of external labels', () => {
    const escaped = '"'.repeat(3000);
    const hostile: SalaryMarketSnapshot = {
      ...snapshot,
      roleLabel: escaped,
      profession: { kind: 'unclassified_title' },
      skillQuarterlyTrend: undefined,
      skills: skills.map((skill, i) => ({ ...skill, name: `${escaped}${i}` })),
    };
    const html = renderSalaryMarketDocument(wholeTemplate(), hostile, snapshot.role, 4);
    expect(Buffer.byteLength(html)).toBeLessThan(20_000);
    expect(html).toContain('…');
  });
});
