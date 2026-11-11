import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { recordCompanyPlacements } from './placementWriter';

const rows = (db: DatabaseSync) =>
  db.prepare('SELECT placement_id, company_key, type, provider, slug, url, priority, discovered_by FROM company_placement ORDER BY placement_id').all();

describe('recordCompanyPlacements', () => {
  it('records every confirmed board and the site of one company', () => {
    const db = new DatabaseSync(':memory:');
    const written = recordCompanyPlacements(db, 'acme', {
      boards: [{ provider: 'greenhouse', slug: 'Acme' }, { provider: 'lever', slug: 'acme-eu' }],
      siteUrl: 'https://www.acme.io/careers',
      discoveredBy: 'freehire',
    }, 5);
    expect(written).toBe(3);
    expect(rows(db)).toEqual([
      { placement_id: 'ats:greenhouse:acme', company_key: 'acme', type: 'ats', provider: 'greenhouse', slug: 'acme', url: null, priority: 2, discovered_by: 'freehire' },
      { placement_id: 'ats:lever:acme-eu', company_key: 'acme', type: 'ats', provider: 'lever', slug: 'acme-eu', url: null, priority: 2, discovered_by: 'freehire' },
      { placement_id: 'site:acme.io', company_key: 'acme', type: 'employer_site', provider: null, slug: null, url: 'https://www.acme.io/careers', priority: 1, discovered_by: 'freehire' },
    ]);
  });

  it('never moves a placement that already belongs to another company', () => {
    const db = new DatabaseSync(':memory:');
    recordCompanyPlacements(db, 'first', { boards: [{ provider: 'lever', slug: 'x' }], discoveredBy: 'freehire' }, 1);
    expect(recordCompanyPlacements(db, 'second', { boards: [{ provider: 'lever', slug: 'x' }], discoveredBy: 'site_discovery' }, 2)).toBe(0);
    expect(db.prepare(`SELECT company_key FROM company_placement`).all()).toEqual([{ company_key: 'first' }]);
  });

  it('fills the company of a placement known without one', () => {
    const db = new DatabaseSync(':memory:');
    recordCompanyPlacements(db, 'acme', { boards: [{ provider: 'lever', slug: 'x' }], discoveredBy: 'freehire' }, 1);
    db.exec(`UPDATE company_placement SET company_key = NULL`);
    expect(recordCompanyPlacements(db, 'acme', { boards: [{ provider: 'lever', slug: 'x' }], discoveredBy: 'freehire' }, 2)).toBe(1);
  });

  it('records hh employer pages as aggregator placements of the company', () => {
    const db = new DatabaseSync(':memory:');
    const written = recordCompanyPlacements(db, 'acme', { boards: [], hhEmployerIds: ['1740'], discoveredBy: 'site_discovery' }, 5);
    expect(written).toBe(1);
    expect(rows(db)).toEqual([
      { placement_id: 'hh:1740', company_key: 'acme', type: 'aggregator', provider: 'hh', slug: '1740', url: 'https://hh.ru/employer/1740', priority: 4, discovered_by: 'site_discovery' },
    ]);
    expect(recordCompanyPlacements(db, 'other', { boards: [], hhEmployerIds: ['1740'], discoveredBy: 'site_discovery' }, 6)).toBe(0);
  });
});
