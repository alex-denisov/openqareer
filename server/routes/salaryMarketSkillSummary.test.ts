import Fastify from 'fastify';
import { describe, it, expect } from 'vitest';
import { registerSalaryMarketRoutes } from './salaryMarketRoutes';
import type { SalaryMarketSnapshot } from '../../shared/salaryMarketSnapshot';
const skills = Array.from({ length: 15 }, (_, i) => ({
  name: `Skill ${i}`,
  count: 10,
  frequency: 50,
}));
const salary = {
  status: 'unavailable' as const,
  reason: 'missing_explicit_salary_period' as const,
  excluded: {
    missingPeriod: 20,
    missingCurrency: 0,
    openRange: 0,
    invalidRange: 0,
    belowMinimumSample: 0,
  },
};
const sample: SalaryMarketSnapshot = {
  role: 'analyst',
  roleLabel: 'Analyst',
  updatedAt: '2026-10-24T00:00:00Z',
  sampleSize: 20,
  windowDays: 90,
  source: 'deduplicated_public_catalog',
  skills,
  salary,
  grades: 'published_title_evidence',
  quarterlyTrend: 'unavailable',
  gradeSlices: [
    {
      grade: 'senior',
      sampleSize: 5,
      skills: [{ name: 'SQL', count: 4, frequency: 80 }],
      salary,
      evidence: { field: 'title', markers: ['Senior'] },
    },
  ],
};
function appFor(read: (role: string) => SalaryMarketSnapshot | null) {
  const app = Fastify();
  registerSalaryMarketRoutes(app, { staticRoot: '/not-a-build', databasePath: '', read });
  return app;
}
describe('public prepared skill projection', () => {
  it('reads one prepared key and publishes at most15 aggregate rows without private data or salary history', async () => {
    const calls: string[] = [];
    const app = appFor((role) => {
      calls.push(role);
      return sample;
    });
    try {
      const result = await app.inject('/api/v1/public/salary-markets/analyst/skills');
      expect(result.statusCode).toBe(200);
      expect(calls).toEqual(['analyst']);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.json()).toEqual({
        data: {
          role: 'analyst',
          grade: null,
          updatedAt: sample.updatedAt,
          sampleSize: 20,
          source: sample.source,
          skills,
        },
      });
      expect(result.body).not.toMatch(/candidate|salary|quarterly|evidence/u);
    } finally {
      await app.close();
    }
  });
  it('uses only the selected posted-grade denominator and actual counts', async () => {
    const app = appFor(() => sample);
    try {
      const result = await app.inject('/api/v1/public/salary-markets/analyst/skills?grade=senior');
      expect(result.statusCode).toBe(200);
      expect(result.json().data).toMatchObject({
        grade: 'senior',
        sampleSize: 5,
        skills: [{ name: 'SQL', count: 4, frequency: 80 }],
      });
      expect(
        (await app.inject('/api/v1/public/salary-markets/analyst/skills?grade=guess')).statusCode,
      ).toBe(400);
      expect(
        (await app.inject('/api/v1/public/salary-markets/analyst/skills?grade=junior')).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
  it('keeps absent, insufficient and malformed source data unavailable without error-body leakage', async () => {
    for (const [snapshot, status] of [
      [null, 404],
      [{ ...sample, sampleSize: 4 }, 503],
      [{ ...sample, skills: [] }, 503],
      [{ ...sample, skills: [{ name: 'x'.repeat(129), count: 2, frequency: 10 }] }, 503],
    ] as const) {
      const app = appFor(() => snapshot);
      try {
        expect((await app.inject('/api/v1/public/salary-markets/analyst/skills')).statusCode).toBe(
          status,
        );
      } finally {
        await app.close();
      }
    }
    const app = appFor(() => {
      throw new Error('private-provider-payload');
    });
    try {
      const result = await app.inject('/api/v1/public/salary-markets/analyst/skills');
      expect(result.statusCode).toBe(503);
      expect(result.body).not.toContain('private-provider-payload');
    } finally {
      await app.close();
    }
  });
});

it('rejects corrupt denominators/dates rather than returning a successful invalid projection', async () => {
  for (const snapshot of [
    { ...sample, sampleSize: Infinity },
    { ...sample, updatedAt: 'not-a-date' },
    { ...sample, role: 'other' },
  ]) {
    const app = appFor(() => snapshot);
    try {
      expect((await app.inject('/api/v1/public/salary-markets/analyst/skills')).statusCode).toBe(
        503,
      );
    } finally {
      await app.close();
    }
  }
});

it('keeps location and grade counts independent and rejects unknown or absent slices', async () => {
  const regional: SalaryMarketSnapshot = {
    ...sample,
    geography: {
      method: 'explicit_source_country_v1',
      regionPolicy: 'openqareer_candidate_regions_v1',
      explicitCountryCount: 12,
      unknownCountryCount: 8,
      ambiguousCountryCount: 0,
      remoteCount: 10,
    },
    locationSlices: [
      {
        location: 'europe',
        evidenceMethod: 'explicit_source_country_v1',
        sampleSize: 10,
        skills: [{ name: 'Local SQL', count: 6, frequency: 60 }],
        salary,
        quarterlyTrend: 'unavailable',
        gradeSlices: [
          {
            ...sample.gradeSlices![0]!,
            skills: [{ name: 'Regional Senior', count: 2, frequency: 40 }],
          },
        ],
      },
    ],
  };
  const app = appFor(() => regional);
  try {
    const all = (
      await app.inject('/api/v1/public/salary-markets/analyst/skills?location=europe')
    ).json().data;
    expect(all).toMatchObject({
      location: 'europe',
      sampleSize: 10,
      skills: [{ name: 'Local SQL', count: 6, frequency: 60 }],
    });
    const senior = (
      await app.inject('/api/v1/public/salary-markets/analyst/skills?location=europe&grade=senior')
    ).json().data;
    expect(senior).toMatchObject({
      location: 'europe',
      grade: 'senior',
      sampleSize: 5,
      skills: [{ name: 'Regional Senior', count: 2, frequency: 40 }],
    });
    expect(
      (await app.inject('/api/v1/public/salary-markets/analyst/skills?location=guess')).statusCode,
    ).toBe(400);
    expect(
      (await app.inject('/api/v1/public/salary-markets/analyst/skills?location=uae')).statusCode,
    ).toBe(404);
  } finally {
    await app.close();
  }
  const legacy = appFor(() => sample);
  try {
    expect(
      (await legacy.inject('/api/v1/public/salary-markets/analyst/skills?location=europe'))
        .statusCode,
    ).toBe(404);
  } finally {
    await legacy.close();
  }
});
