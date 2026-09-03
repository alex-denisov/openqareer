import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluateProductCase,
} from '../domain/assessment';
import { evaluateGermanyMarket } from '../domain/germanyMarket';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATION_1, MIGRATION_2 } from './sqliteSchema';
import {
  directories,
} from './sqliteTestHarness';
import {
  createCandidate,
  createStore,
  stores,
} from './sqliteTestHarness';

describe('SQLite candidate documents, subscriptions, assessments and commands', () => {
  it('persists isolated vacancy subscriptions and versions changed observations', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openqareer-vacancies-'));
    directories.push(directory);
    const databasePath = join(directory, 'candidate.db');
    const store = createStore(databasePath);
    const candidateA = createCandidate(store);
    const candidateB = createCandidate(store);
    const subscription = store.createVacancySubscription(
      candidateA.id,
      {
        source: 'hh',
        query: 'руководитель операций',
        cadenceMinutes: 360,
      },
      '2026-08-13T08:00:00.000Z',
    );
    const firstSample = {
      source: 'hh' as const,
      query: 'руководитель операций',
      found: 42,
      fetchedAt: '2026-08-13T08:01:00.000Z',
      items: [
        {
          id: 'hh-881',
          title: 'Руководитель операций',
          company: 'Synthetic Company',
          location: 'Москва',
          sourceUrl: 'https://hh.ru/vacancy/881',
          publishedAt: '2026-08-13T07:00:00+0300',
          salary: {
            from: 250_000,
            to: 320_000,
            currency: 'RUR',
            gross: true,
          },
          workMode: 'unknown' as const,
          requirements: [],
        },
      ],
    };

    expect(store.listVacancySubscriptions(candidateB.id)).toEqual([]);
    expect(store.getVacancySubscription(candidateB.id, subscription.id)).toBeNull();
    expect(store.recordVacancyRefresh(subscription.id, firstSample)).toMatchObject({
      created: 1,
      updated: 0,
      unchanged: 0,
    });
    expect(store.recordVacancyRefresh(subscription.id, firstSample)).toMatchObject({
      created: 0,
      updated: 0,
      unchanged: 1,
    });
    expect(
      store.recordVacancyRefresh(subscription.id, {
        ...firstSample,
        fetchedAt: '2026-08-13T10:01:00.000Z',
        items: [
          {
            ...firstSample.items[0]!,
            title: 'Head of Operations',
          },
        ],
      }),
    ).toMatchObject({ created: 0, updated: 1, unchanged: 0 });

    expect(store.listVacancySubscriptions(candidateA.id)).toMatchObject([
      {
        id: subscription.id,
        query: 'руководитель операций',
        status: 'active',
        analytics: {
          sampleSize: 1,
          sourceFound: 42,
          salaryKnown: 1,
          unknownSalary: 0,
          observedFrom: '2026-08-13T08:01:00.000Z',
          observedTo: '2026-08-13T10:01:00.000Z',
        },
      },
    ]);
    expect(
      store.listSubscriptionVacancies(candidateA.id, subscription.id),
    ).toMatchObject([
      {
        externalId: 'hh-881',
        title: 'Head of Operations',
        version: 2,
        source: 'hh',
      },
    ]);
    expect(store.listSubscriptionVacancies(candidateB.id, subscription.id)).toEqual(
      [],
    );

    store.close();
    stores.splice(stores.indexOf(store), 1);
    expect(readFileSync(databasePath).toString('utf8')).not.toContain(
      'руководитель операций',
    );
  });

  it('persists encrypted candidate-scoped assessments and replaces one version', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openqareer-assessment-'));
    directories.push(directory);
    const databasePath = join(directory, 'candidate.db');
    const store = createStore(databasePath);
    const candidateA = createCandidate(store);
    const candidateB = createCandidate(store);
    const productCase = {
      firstMove: 'segment-funnel-and-interviews',
      priorityRule: 'reversible-test-biggest-uncertainty',
      successMeasure: 'activation-by-segment-with-guardrail',
      rationale: 'Уникальное объяснение кейса 984.',
    } as const;
    const revisedCase = {
      ...productCase,
      successMeasure: 'delivery-date',
    } as const;

    store.saveAssessment(
      candidateA.id,
      'product-case-v1',
      productCase,
      evaluateProductCase(productCase),
    );
    store.saveAssessment(
      candidateA.id,
      'product-case-v1',
      revisedCase,
      evaluateProductCase(revisedCase),
    );

    expect(store.getSnapshot(candidateA.id).assessments).toHaveLength(1);
    expect(
      store.getSnapshot(candidateA.id).assessments[0].submission,
    ).toMatchObject({ successMeasure: 'delivery-date' });
    expect(store.getSnapshot(candidateB.id).assessments).toEqual([]);
    store.close();
    stores.splice(stores.indexOf(store), 1);
    expect(readFileSync(databasePath).toString('utf8')).not.toContain(
      productCase.rationale,
    );

    const reopened = createStore(databasePath);
    expect(reopened.getSnapshot(candidateA.id).assessments).toHaveLength(1);
    expect(reopened.exportCandidate(candidateA.id).assessments[0]).toMatchObject({
      assessmentId: 'product-case-v1',
      result: { kind: 'product-case' },
    });
    expect(reopened.deleteCandidate(candidateA.id)).toBe(true);
  });

  it('persists one encrypted Germany profile with isolation and replacement', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openqareer-market-'));
    directories.push(directory);
    const databasePath = join(directory, 'candidate.db');
    const store = createStore(databasePath);
    const candidateA = createCandidate(store);
    const candidateB = createCandidate(store);
    const submission = {
      workAuthorization: 'none',
      jobOffer: 'yes',
      grossAnnualSalaryEur: 55_000,
      offerDurationMonths: 24,
      qualification: 'recognized-comparable',
      professionRegulation: 'non-regulated',
      blueCardBand: 'general',
      fundsMonthlyEur: null,
      languageEvidence: 'english-b2-plus',
      relocationReadiness: 'ready',
      dependants: 'none',
      targetWorkMode: 'hybrid',
    } as const;
    store.saveGermanyMarket(
      candidateA.id,
      submission,
      evaluateGermanyMarket(submission, new Date('2026-08-01T00:00:00Z')),
    );
    store.saveGermanyMarket(
      candidateA.id,
      { ...submission, grossAnnualSalaryEur: 60_000 },
      evaluateGermanyMarket(
        { ...submission, grossAnnualSalaryEur: 60_000 },
        new Date('2026-08-01T00:00:00Z'),
      ),
    );
    expect(store.getSnapshot(candidateA.id).germanyMarket).toMatchObject({
      country: 'DE',
      submission: { grossAnnualSalaryEur: 60_000 },
      result: { recommendedRouteId: 'eu-blue-card' },
    });
    expect(store.getSnapshot(candidateB.id).germanyMarket).toBeNull();
    store.close();
    stores.splice(stores.indexOf(store), 1);
    expect(readFileSync(databasePath).toString('utf8')).not.toContain(
      'recommendedRouteId',
    );
    const reopened = createStore(databasePath);
    expect(reopened.getSnapshot(candidateA.id).germanyMarket?.country).toBe('DE');
    expect(reopened.deleteCandidate(candidateA.id)).toBe(true);
  });

  it('persists a Remotive subscription in the shared versioned corpus', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    const subscription = store.createVacancySubscription(
      candidate.id,
      {
        source: 'remotive',
        query: 'product manager',
        cadenceMinutes: 360,
      },
      '2026-08-13T12:00:00.000Z',
    );

    expect(
      store.recordVacancyRefresh(subscription.id, {
        source: 'remotive',
        query: 'product manager',
        found: 1,
        fetchedAt: '2026-08-13T12:01:00.000Z',
        items: [
          {
            id: 'senior-product-manager-berlin-101',
            title: 'Senior Product Manager',
            company: 'Synthetic GmbH',
            location: 'Berlin',
            sourceUrl: 'https://jobs.example.test/product-101',
            publishedAt: '2026-08-12T06:40:00.000Z',
            salary: null,
            workMode: 'remote',
            requirements: ['Product', 'SaaS'],
          },
        ],
      }),
    ).toMatchObject({ created: 1, updated: 0, unchanged: 0 });
    expect(store.listSubscriptionVacancies(candidate.id, subscription.id)).toMatchObject([
      {
        source: 'remotive',
        externalId: 'senior-product-manager-berlin-101',
        workMode: 'remote',
        requirements: ['Product', 'SaaS'],
      },
    ]);
  });

  it('migrates an existing v2 database without losing candidate tables', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openqareer-migration-'));
    directories.push(directory);
    const databasePath = join(directory, 'candidate.db');
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(MIGRATION_1);
    legacy.exec(MIGRATION_2);
    legacy
      .prepare(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?), (?, ?)',
      )
      .run(
        1,
        '2026-07-30T00:00:00.000Z',
        2,
        '2026-07-31T00:00:00.000Z',
      );
    legacy.close();

    const store = createStore(databasePath);
    const candidate = createCandidate(store);

    expect(store.getSnapshot(candidate.id)).toMatchObject({
      memory: [],
      assessments: [],
      germanyMarket: null,
      dossier: {
        confirmedCount: 0,
        proposedCount: 0,
        readiness: { complete: false },
      },
    });
  });
});

