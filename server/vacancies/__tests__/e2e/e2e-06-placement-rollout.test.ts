import { afterEach, describe, expect, it } from 'vitest';
import { registryWithCompanyChannels } from '../../composeVacancyEngine';
import {
  PLACEMENT_BOARDS_PER_DAY,
  PLACEMENT_ROLLOUT_PROVIDERS,
  PLACEMENT_ROLLOUT_START_MS,
  admittedPlacementBoards,
  readRolloutPlacementBoards,
} from '../../placementBoardRollout';
import { createOfflineEngine, makeSource, makeVacancy, cleanupTrackedStores } from './helpers/engineHarness';
import {
  bootstrapPoolTables,
  cleanupAllSqliteHarnesses,
  createMemoryDb,
  createTempDbWorkspace,
  seedDirectoryCompany,
  seedPlacement,
} from './helpers/sqliteHarness';

afterEach(() => {
  cleanupTrackedStores();
  cleanupAllSqliteHarnesses();
});

describe('E2E-6: PlacementRollout (paylocity, join) Dynamic Admission (F10)', () => {
  // Tier 1 (Happy-Path)
  it('T1.1 readRolloutPlacementBoards admits 300 boards per provider on day 0', () => {
    expect(admittedPlacementBoards(PLACEMENT_ROLLOUT_START_MS)).toBe(PLACEMENT_BOARDS_PER_DAY);
    const db = createMemoryDb();
    for (let i = 0; i < 350; i += 1) {
      const idx = String(i).padStart(4, '0');
      seedPlacement(db, {
        placementId: `ats:join:j-${idx}`,
        companyKey: `co-j-${idx}`,
        type: 'ats',
        provider: 'join',
        slug: `100${idx}`,
      });
      seedPlacement(db, {
        placementId: `ats:paylocity:p-${idx}`,
        companyKey: `co-p-${idx}`,
        type: 'ats',
        provider: 'paylocity',
        slug: `guid-${idx}`,
      });
    }

    const day0 = readRolloutPlacementBoards(db, PLACEMENT_ROLLOUT_START_MS);
    expect(day0.filter((c) => c.atsProvider === 'join')).toHaveLength(300);
    expect(day0.filter((c) => c.atsProvider === 'paylocity')).toHaveLength(300);
  });

  it('T1.2 advancing nowMs by +1 UTC day dynamically admits 600 boards per provider without restart', () => {
    const db = createMemoryDb();
    for (let i = 0; i < 650; i += 1) {
      const idx = String(i).padStart(4, '0');
      seedPlacement(db, {
        placementId: `ats:join:d-${idx}`,
        companyKey: `co-${idx}`,
        type: 'ats',
        provider: 'join',
        slug: `200${idx}`,
      });
    }

    const day0 = readRolloutPlacementBoards(db, PLACEMENT_ROLLOUT_START_MS);
    const day1 = readRolloutPlacementBoards(db, PLACEMENT_ROLLOUT_START_MS + 86_400_000);
    expect(day0).toHaveLength(300);
    expect(day1).toHaveLength(600);
  });

  it('T1.3 deterministic ORDER BY placement_id produces stable progression across reads', () => {
    const db = createMemoryDb();
    for (let i = 9; i >= 0; i -= 1) {
      seedPlacement(db, {
        placementId: `ats:paylocity:ord-${String(i).padStart(2, '0')}`,
        companyKey: `co-${i}`,
        type: 'ats',
        provider: 'paylocity',
        slug: `slug-${i}`,
      });
    }

    const first = readRolloutPlacementBoards(db, PLACEMENT_ROLLOUT_START_MS).map((c) => c.atsSlug);
    const second = readRolloutPlacementBoards(db, PLACEMENT_ROLLOUT_START_MS).map((c) => c.atsSlug);
    expect(first).toEqual(second);
    expect(first[0]).toBe('slug-0');
  });

  it('T1.4 engine syncDue admits rollout placement boards across UTC midnight rollover', async () => {
    const ws = createTempDbWorkspace();
    const db = ws.openDb();
    bootstrapPoolTables(db);
    for (let i = 0; i < 305; i += 1) {
      const idx = String(i).padStart(4, '0');
      seedPlacement(db, {
        placementId: `ats:join:roll-${idx}`,
        companyKey: `roll-${idx}`,
        type: 'ats',
        provider: 'join',
        slug: `300${idx}`,
      });
    }
    db.close();

    const day0Sources = registryWithCompanyChannels(ws.dbPath);
    const day0JoinCount = day0Sources.filter((s) => s.id.startsWith('ats-join-300')).length;
    expect(day0JoinCount).toBeLessThanOrEqual(305);

    const wrapped = createOfflineEngine({
      sources: [
        makeSource({
          id: 'ats-join-3000304',
          name: 'Rollout Day 1 Join',
          type: 'json_api',
          enabled: false,
          channelTier: 1,
        }),
      ],
      databasePath: ws.dbPath,
      fetcher: async (src) => [makeVacancy({ id: `${src.id}-1`, sourceId: src.id, company: src.name })],
    });
    const day0Outcome = await wrapped.engine.syncDue(PLACEMENT_ROLLOUT_START_MS);
    expect(day0Outcome.some((o) => o.sourceId === 'ats-join-3000304')).toBe(false);
    const day1Outcome = await wrapped.engine.syncDue(PLACEMENT_ROLLOUT_START_MS + 86_400_000);
    expect(day1Outcome.some((o) => o.sourceId === 'ats-join-3000304' && o.status === 'healthy')).toBe(true);
    const admitted = readRolloutPlacementBoards(
      ws.openDb(),
      PLACEMENT_ROLLOUT_START_MS + 86_400_000,
    );
    expect(admitted.length).toBe(305);
  });

  it('T1.5 joins company_directory.company_name when present and falls back to company_key', () => {
    const db = createMemoryDb();
    seedDirectoryCompany(db, { companyKey: 'named-co', companyName: 'Named Corp Inc' });
    seedPlacement(db, {
      placementId: 'ats:join:named',
      companyKey: 'named-co',
      type: 'ats',
      provider: 'join',
      slug: '9001',
    });
    seedPlacement(db, {
      placementId: 'ats:paylocity:unnamed',
      companyKey: 'unnamed-key',
      type: 'ats',
      provider: 'paylocity',
      slug: 'guid-unnamed',
    });

    const boards = readRolloutPlacementBoards(db, PLACEMENT_ROLLOUT_START_MS);
    expect(boards.find((b) => b.companyKey === 'named-co')?.companyName).toBe('Named Corp Inc');
    expect(boards.find((b) => b.companyKey === 'unnamed-key')?.companyName).toBe('unnamed-key');
  });

  // Tier 2 (Boundary / Corner / Negative)
  it('T2.1 excludes company_placement rows with health = gone from rollout admission', () => {
    const db = createMemoryDb();
    seedPlacement(db, {
      placementId: 'ats:join:alive',
      companyKey: 'alive-co',
      type: 'ats',
      provider: 'join',
      slug: '5001',
      health: null,
    });
    seedPlacement(db, {
      placementId: 'ats:join:dead',
      companyKey: 'dead-co',
      type: 'ats',
      provider: 'join',
      slug: '5002',
      health: 'gone',
    });

    const boards = readRolloutPlacementBoards(db, PLACEMENT_ROLLOUT_START_MS);
    expect(boards.map((b) => b.atsSlug)).toEqual(['5001']);
  });

  it('T2.2 admits paycom in PlacementRollout when present in company_placement', () => {
    expect(PLACEMENT_ROLLOUT_PROVIDERS).toContain('paycom');
    const db = createMemoryDb();
    seedPlacement(db, {
      placementId: 'ats:paycom:choc',
      companyKey: 'choc',
      type: 'ats',
      provider: 'paycom',
      slug: '0012604c8f3328ef1785c7189f1333b7',
    });

    const boards = readRolloutPlacementBoards(db, PLACEMENT_ROLLOUT_START_MS + 30 * 86_400_000);
    expect(boards.find((b) => b.atsProvider === 'paycom')).toMatchObject({
      atsProvider: 'paycom',
      atsSlug: '0012604c8f3328ef1785c7189f1333b7',
    });
  });

  it('T2.3 admits 0 boards when nowMs < PLACEMENT_ROLLOUT_START_MS', () => {
    const db = createMemoryDb();
    seedPlacement(db, {
      placementId: 'ats:join:early',
      companyKey: 'early-co',
      type: 'ats',
      provider: 'join',
      slug: '7001',
    });
    expect(readRolloutPlacementBoards(db, PLACEMENT_ROLLOUT_START_MS - 1)).toEqual([]);
  });

  it('T2.4 deduplicates boards already registered in company_directory', () => {
    const ws = createTempDbWorkspace();
    const db = ws.openDb();
    bootstrapPoolTables(db);
    seedDirectoryCompany(db, {
      companyKey: 'dup-co',
      companyName: 'Dup Co',
      atsProvider: 'join',
      atsSlug: '8888',
      sourceType: 'ats_direct',
    });
    seedPlacement(db, {
      placementId: 'ats:join:8888',
      companyKey: 'dup-co',
      type: 'ats',
      provider: 'join',
      slug: '8888',
    });
    db.close();

    const sources = registryWithCompanyChannels(ws.dbPath).filter((s) => s.id === 'ats-join-8888');
    expect(sources).toHaveLength(1);
  });

  it('T2.5 returns empty array cleanly when company_placement table is missing or slug is empty', () => {
    const db = createMemoryDb();
    seedPlacement(db, {
      placementId: 'ats:join:empty-slug',
      companyKey: 'empty-co',
      type: 'ats',
      provider: 'join',
      slug: '',
    });
    expect(readRolloutPlacementBoards(db, PLACEMENT_ROLLOUT_START_MS)).toEqual([]);

    db.exec('DROP TABLE company_placement');
    expect(readRolloutPlacementBoards(db, PLACEMENT_ROLLOUT_START_MS)).toEqual([]);
  });
});
