import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import { SemanticBackfill } from './titleParse/semanticBackfill';

const directories: string[] = [];
const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function card(id: string, title: string) {
  return {
    id,
    fingerprint: `fp-${id}`,
    title,
    company: 'Company',
    description: 'Sales, marketing, operations and technology.',
    requiredSkills: [],
    url: `https://example.test/${id}`,
    provenance: {
      sourceType: 'json_api' as const,
      sourceId: 'src',
      sourceUrl: `https://example.test/${id}`,
      observedAt: '2026-09-25T10:00:00.000Z',
    },
    publishedAt: '2026-09-25T10:00:00.000Z',
    status: 'active' as const,
  };
}

function poolWith(matchMode: 'legacy' | 'semantic', label: boolean) {
  const directory = mkdtempSync(join(tmpdir(), 'semantic-match-'));
  directories.push(directory);
  const path = join(directory, 'pool.db');
  const store = new SqliteVacancyPoolStore({ databasePath: path, matchMode });
  closers.push(() => store.close());
  store.replaceSourceSlice('src', [
    card('vp-eng', 'VP of Engineering'),
    card('cto', 'Chief Technology Officer'),
    card('vp-sales', 'VP of Channel Sales'),
    card('growth', 'Head of Growth & Marketing'),
    card('cpp', 'C++ Developer'),
    card('ru-sales', 'Менеджер по продажам'),
  ]);
  while (store.backfillStep(100) > 0) {
    /* проекция сведения до конца */
  }
  if (label) {
    const database = new DatabaseSync(path);
    closers.push(() => database.close());
    new SemanticBackfill(database).step(100);
  }
  return store;
}

const vp = {
  candidateId: 'c1',
  targetRoles: ['VP of Technology & Operations'],
  targetLevel: 'vp' as const,
  confirmedSkills: [],
  confirmedFacts: [],
};
const nowMs = Date.parse('2026-09-26T10:00:00.000Z');

describe('подбор по смыслу на хранилище (B267 S3)', () => {
  it('кандидату VP отдаёт только инженерное и ИТ-руководство, без продаж, маркетинга и добивки', () => {
    const store = poolWith('semantic', true);

    const ids = store.queryMatchCandidates(vp, { nowMs, limit: 50 }).map((vacancy) => vacancy.id);

    expect(ids).toEqual(expect.arrayContaining(['vp-eng', 'cto']));
    expect(ids).not.toContain('vp-sales');
    expect(ids).not.toContain('growth');
    expect(ids).not.toContain('cpp');
    expect(ids).not.toContain('ru-sales');
  });

  it('пока смысловой индекс пуст, отвечает прежним подбором, а не пустотой', () => {
    const store = poolWith('semantic', false);

    expect(store.queryMatchCandidates(vp, { nowMs, limit: 50 }).length).toBeGreaterThan(0);
  });

  it('legacy-режим по-прежнему добирает выдачу свежими записями', () => {
    const store = poolWith('legacy', true);

    expect(store.queryMatchCandidates(vp, { nowMs, limit: 50 })).toHaveLength(6);
  });
});
