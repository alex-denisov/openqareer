import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { planCompanyChannels } from './companyDirectorySources';
import { DEFAULT_VACANCY_SOURCES } from './defaultVacancySources';
import {
  PLACEMENT_BOARDS_PER_DAY,
  PLACEMENT_ROLLOUT_START_MS,
  admittedPlacementBoards,
  readRolloutPlacementBoards,
} from './placementBoardRollout';

const DAY = 86_400_000;

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE company_directory (company_key TEXT PRIMARY KEY, company_name TEXT);
    CREATE TABLE company_placement (placement_id TEXT PRIMARY KEY, company_key TEXT, type TEXT, provider TEXT, slug TEXT);`);
  const insert = db.prepare('INSERT INTO company_placement VALUES (?, ?, ?, ?, ?)');
  for (let i = 0; i < PLACEMENT_BOARDS_PER_DAY + 5; i += 1) {
    const n = String(i).padStart(4, '0');
    insert.run(`ats:paylocity:${n}`, `pc${n}`, 'ats', 'paylocity', `guid-${n}`);
    insert.run(`ats:join:${n}`, `jc${n}`, 'ats', 'join', `${1000 + i}`);
    insert.run(`ats:paycom:${n}`, `yc${n}`, 'ats', 'paycom', `p${n}`);
  }
  db.prepare("INSERT INTO company_directory VALUES ('pc0000', 'Acme Payroll')").run();
  return db;
}

describe('B646-5 placement board rollout', () => {
  it('admits 300 boards per provider per day from the start, none before', () => {
    expect(admittedPlacementBoards(PLACEMENT_ROLLOUT_START_MS - 1)).toBe(0);
    expect(admittedPlacementBoards(PLACEMENT_ROLLOUT_START_MS + DAY / 2)).toBe(300);
    expect(admittedPlacementBoards(PLACEMENT_ROLLOUT_START_MS + DAY)).toBe(600);
  });

  it('reads paylocity, join and paycom batches without exclusions, with directory names', () => {
    const boards = readRolloutPlacementBoards(database(), PLACEMENT_ROLLOUT_START_MS + 1);
    expect(boards.filter((b) => b.atsProvider === 'paylocity')).toHaveLength(300);
    expect(boards.filter((b) => b.atsProvider === 'join')).toHaveLength(300);
    expect(boards.filter((b) => b.atsProvider === 'paycom')).toHaveLength(300);
    expect(boards[0]).toMatchObject({
      companyKey: 'pc0000',
      companyName: 'Acme Payroll',
      atsSlug: 'guid-0000',
    });
  });

  it('turns admitted boards into enabled ATS channels', () => {
    const boards = readRolloutPlacementBoards(database(), PLACEMENT_ROLLOUT_START_MS + 1);
    const plan = planCompanyChannels(DEFAULT_VACANCY_SOURCES, boards);
    const ats = plan.channels.filter((c) => c.kind === 'company_ats');
    expect(ats).toHaveLength(900);
    const ids = new Set(ats.map((c) => c.sourceId));
    expect(plan.sources.filter((s) => ids.has(s.id)).every((s) => s.enabled)).toBe(true);
  });

  it('reads nothing without the placement table', () => {
    expect(
      readRolloutPlacementBoards(new DatabaseSync(':memory:'), PLACEMENT_ROLLOUT_START_MS + 1),
    ).toEqual([]);
  });

  it('skips non-numeric join slugs and placements marked gone or disabled', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE company_directory (company_key TEXT PRIMARY KEY, company_name TEXT);
      CREATE TABLE company_placement (
        placement_id TEXT PRIMARY KEY, company_key TEXT, type TEXT,
        provider TEXT, slug TEXT, health TEXT
      );
    `);
    const insert = db.prepare('INSERT INTO company_placement VALUES (?, ?, ?, ?, ?, ?)');
    insert.run('ats:join:1', 'j1', 'ats', 'join', '167291', null);
    insert.run('ats:join:2', 'j2', 'ats', 'join', 'not-a-number', null);
    insert.run('ats:join:3', 'j3', 'ats', 'join', '99999', 'gone');
    insert.run('ats:paylocity:1', 'p1', 'ats', 'paylocity', 'guid-ok', 'healthy');
    insert.run('ats:paylocity:2', 'p2', 'ats', 'paylocity', 'guid-off', 'disabled');

    const boards = readRolloutPlacementBoards(db, PLACEMENT_ROLLOUT_START_MS + 1);
    expect(boards.map((b) => [b.atsProvider, b.atsSlug])).toEqual([
      ['paylocity', 'guid-ok'],
      ['join', '167291'],
    ]);
    db.close();
  });
});
