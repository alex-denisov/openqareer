import type { DatabaseSync } from 'node:sqlite';
import type { UnifiedVacancy, VacancySourceConfig } from '../../../../domain/unifiedVacancy';
import { MultiSourceVacancyEngine, type ReclusterMode, type SourceFetcher } from '../../../multiSourceVacancyEngine';
import { RobotsPolicyLoader, type RobotsFetcher } from '../../../robotsPolicyLoader';
import { SqliteVacancyPoolStore } from '../../../sqliteVacancyPoolStore';
import { MemoryVacancyPoolStore } from '../../../memoryVacancyPoolStore';
import type { VacancyPoolStore } from '../../../vacancyPoolStore';
import { createMockRobotsFetcher } from './mockFetch';

const trackedStores: SqliteVacancyPoolStore[] = [];

export function makeSource(overrides: Partial<VacancySourceConfig> & { id: string }): VacancySourceConfig {
  return {
    name: overrides.name ?? overrides.id,
    type: overrides.type ?? 'json_api',
    enabled: overrides.enabled ?? true,
    targetUrl: overrides.targetUrl ?? `https://example.com/${overrides.id}`,
    refreshIntervalMinutes: overrides.refreshIntervalMinutes ?? 180,
    itemsFoundTotal: overrides.itemsFoundTotal ?? 0,
    itemsActiveTotal: overrides.itemsActiveTotal ?? 0,
    ...overrides,
  };
}

export function makeVacancy(
  overrides: Partial<UnifiedVacancy> & { id: string; sourceId?: string },
): UnifiedVacancy {
  const sourceId = overrides.sourceId ?? overrides.provenance?.sourceId ?? 'ats-greenhouse-test';
  const nowIso = overrides.publishedAt ?? new Date(Date.UTC(2026, 10, 22, 12, 0, 0)).toISOString();
  const url = overrides.url ?? `https://jobs.example.com/${overrides.id}`;
  return {
    id: overrides.id,
    fingerprint: overrides.fingerprint ?? overrides.id,
    title: overrides.title ?? 'Senior Backend Engineer',
    company: overrides.company ?? 'Acme Corp',
    location: overrides.location ?? 'Remote',
    isRemote: overrides.isRemote ?? true,
    description: overrides.description ?? 'Build scalable distributed backend services.',
    requiredSkills: overrides.requiredSkills ?? ['TypeScript'],
    url,
    provenance: overrides.provenance ?? {
      sourceType: 'json_api',
      sourceId,
      sourceName: overrides.company ?? 'Acme Corp',
      sourceUrl: url,
      externalId: overrides.id,
      observedAt: nowIso,
    },
    publishedAt: nowIso,
    status: overrides.status ?? 'active',
  };
}

export interface OfflineEngineOptions {
  readonly sources: VacancySourceConfig[];
  readonly fetcher: SourceFetcher;
  readonly fetchRobots?: RobotsFetcher;
  readonly databasePath?: string;
  readonly pool?: VacancyPoolStore;
  readonly holdSource?: (source: VacancySourceConfig) => boolean;
  readonly recluster?: ReclusterMode;
}

export function createOfflineEngine(options: OfflineEngineOptions): {
  readonly engine: MultiSourceVacancyEngine;
  readonly pool: VacancyPoolStore;
  close(): void;
} {
  let sqlitePool: SqliteVacancyPoolStore | undefined;
  const pool =
    options.pool ??
    (options.databasePath
      ? (sqlitePool = new SqliteVacancyPoolStore({ databasePath: options.databasePath }))
      : new MemoryVacancyPoolStore());
  if (sqlitePool) trackedStores.push(sqlitePool);
  const robots = new RobotsPolicyLoader({
    fetchRobots: options.fetchRobots ?? createMockRobotsFetcher({}),
  });
  const engine = new MultiSourceVacancyEngine({
    sources: options.sources,
    fetcher: options.fetcher,
    pool,
    robots,
    recluster: options.recluster ?? { mode: 'sync' },
    ...(options.holdSource ? { holdSource: options.holdSource } : {}),
  });
  return {
    engine,
    pool,
    close: () => {
      sqlitePool?.close();
    },
  };
}

export function cleanupTrackedStores(): void {
  while (trackedStores.length > 0) {
    const store = trackedStores.pop();
    try {
      store?.close();
    } catch {
      // ignore already closed
    }
  }
}

export interface PromoteCandidatesResult {
  readonly scanned: number;
  readonly promoted: number;
  readonly skipped: number;
  readonly websitesFilled: number;
  readonly linkedinsFilled: number;
  readonly careersFilled: number;
  readonly boardsPromoted: number;
}

export type PromoteCandidatesFn = (
  db: DatabaseSync,
  options?: { readonly chunkSize?: number; readonly nowMs?: number },
) => Promise<PromoteCandidatesResult> | PromoteCandidatesResult;

export async function dynamicLoadPromoteFn(): Promise<PromoteCandidatesFn | null> {
  const candidates = [
    '../../../../companyDirectory/freehire/freehireCandidatesPromote.ts',
    '../../../../companyDirectory/freehire/freehireCandidatePromote.ts',
  ];
  for (const specifier of candidates) {
    try {
      const mod = (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>;
      const fn = mod.promoteFreehireCandidates;
      if (typeof fn === 'function') return fn as PromoteCandidatesFn;
    } catch {
      // module not yet implemented before M2
    }
  }
  return null;
}
