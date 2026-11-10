import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PLACEMENT_TABLES } from './placementSchema';

describe('PLACEMENT_TABLES', () => {
  it('creates the three empty side tables and is idempotent', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(PLACEMENT_TABLES);
    db.exec(PLACEMENT_TABLES);
    const names = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as { name: string }[]).map((r) => r.name);
    expect(names).toEqual(['company_discovery_queue', 'company_placement', 'vacancy_company']);
    db.prepare(`INSERT INTO company_placement (placement_id, company_key, type, provider, slug, url, priority, source_id, discovered_by, updated_at)
      VALUES ('ats:greenhouse:stripe','stripe','ats','greenhouse','stripe',NULL,2,'ats-greenhouse-stripe','directory',1)`).run();
    expect(() => db.prepare(`INSERT INTO company_placement (placement_id, type, priority, source_id, discovered_by, updated_at)
      VALUES ('x','ats',2,'ats-greenhouse-stripe','directory',1)`).run()).toThrow(/UNIQUE/);
    db.close();
  });
});
