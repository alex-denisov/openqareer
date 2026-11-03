import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import { SemanticBackfill } from './titleParse/semanticBackfill';
import type { CandidateMatchProfile } from './vacancyMatcher';

/**
 * Аудит 01.11 (adenisov.test): из 487 руководящих вакансий Москвы в подборке
 * было 29. Подбор читал 3 000 самых новых строк по всей географии, уровень
 * отсекал Head-роли кампании, а дата смыслового индекса не догоняла
 * переопубликованную вакансию hh.
 */
const directories: string[] = [];
const closers: Array<() => void> = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

interface CardInput {
  readonly id: string;
  readonly title: string;
  readonly location?: string;
  readonly isRemote?: boolean;
  readonly publishedAt?: string;
}

function card(input: CardInput) {
  const publishedAt = input.publishedAt ?? '2026-10-25T10:00:00.000Z';
  return {
    id: input.id,
    fingerprint: `fp-${input.id}`,
    title: input.title,
    company: `Company ${input.id}`,
    location: input.location ?? 'Москва',
    isRemote: input.isRemote ?? false,
    description: 'Руководство направлением.',
    requiredSkills: [],
    url: `https://example.test/${input.id}`,
    provenance: {
      sourceType: 'json_api' as const,
      sourceId: 'src',
      sourceUrl: `https://example.test/${input.id}`,
      observedAt: publishedAt,
    },
    publishedAt,
    status: 'active' as const,
  };
}

function poolWith(cards: readonly CardInput[]) {
  const directory = mkdtempSync(join(tmpdir(), 'selection-recall-'));
  directories.push(directory);
  const path = join(directory, 'pool.db');
  const store = new SqliteVacancyPoolStore({ databasePath: path, matchMode: 'semantic' });
  closers.push(() => store.close());
  const database = new DatabaseSync(path);
  closers.push(() => database.close());
  const backfill = new SemanticBackfill(database);
  const load = (next: readonly CardInput[]) => {
    store.replaceSourceSlice('src', next.map(card));
    while (store.backfillStep(100) > 0) {
      /* проекция сведения до конца */
    }
    backfill.step(100);
  };
  load(cards);
  return { store, load, database };
}

const nowMs = Date.parse('2026-11-01T10:00:00.000Z');
const executive: CandidateMatchProfile = {
  candidateId: 'c1',
  targetRoles: ['Chief Operating Officer', 'Head of AI'],
  targetLevel: 'c-level',
  confirmedSkills: [],
  confirmedFacts: [],
  preferredRemote: true,
};

describe('подбор: география и уровень до предела чтения (аудит 01.11)', () => {
  it('Head-роль кампании входит в подбор и у кандидата уровня C-level', () => {
    const { store } = poolWith([
      { id: 'coo', title: 'Chief Operating Officer' },
      { id: 'head-ai', title: 'Head of AI' },
    ]);

    const ids = store.queryMatchCandidates(executive, { nowMs, limit: 50 }).map((v) => v.id);

    expect(ids).toEqual(expect.arrayContaining(['coo', 'head-ai']));
  });

  it('предел чтения тратится на города и удалёнку кампании, а не на чужие города', () => {
    const { store } = poolWith([
      {
        id: 'berlin-1',
        title: 'Chief Operating Officer',
        location: 'Berlin',
        publishedAt: '2026-10-31T10:00:00.000Z',
      },
      {
        id: 'berlin-2',
        title: 'Chief Operating Officer',
        location: 'Berlin',
        publishedAt: '2026-10-30T10:00:00.000Z',
      },
      {
        id: 'berlin-3',
        title: 'Chief Operating Officer',
        location: 'Berlin',
        publishedAt: '2026-10-29T10:00:00.000Z',
      },
      {
        id: 'moscow',
        title: 'Операционный директор (COO)',
        location: 'Москва',
        publishedAt: '2026-10-20T10:00:00.000Z',
      },
      {
        id: 'moscow-en',
        title: 'Chief Operating Officer',
        location: 'Moscow, Russia',
        publishedAt: '2026-10-19T10:00:00.000Z',
      },
      {
        id: 'remote',
        title: 'Chief Operating Officer',
        location: 'Новосибирск',
        isRemote: true,
        publishedAt: '2026-10-18T10:00:00.000Z',
      },
    ]);

    const ids = store
      .queryMatchCandidates(
        {
          ...executive,
          matchGeography: { cityNames: ['Москва', 'moscow'], remote: true, remoteAreas: [] },
        },
        { nowMs, limit: 3 },
      )
      .map((v) => v.id);

    expect(ids.sort()).toEqual(['moscow', 'moscow-en', 'remote']);
  });

  it('переопубликованная вакансия догоняет дату в смысловом индексе', () => {
    const { store, load } = poolWith([
      { id: 'coo', title: 'Chief Operating Officer', publishedAt: '2026-09-20T10:00:00.000Z' },
    ]);
    expect(store.queryMatchCandidates(executive, { nowMs, limit: 50 })).toHaveLength(0);

    load([
      { id: 'coo', title: 'Chief Operating Officer', publishedAt: '2026-10-29T10:00:00.000Z' },
    ]);

    expect(store.queryMatchCandidates(executive, { nowMs, limit: 50 }).map((v) => v.id)).toEqual([
      'coo',
    ]);
  });

  it('строка смыслового индекса с датой первой публикации не выпадает из окна', () => {
    const { store, database } = poolWith([
      { id: 'coo', title: 'Chief Operating Officer', publishedAt: '2026-10-29T10:00:00.000Z' },
    ]);
    // Строки, записанные до синхронизации дат при записи (прод 01.11: 383 тыс.).
    database
      .prepare('UPDATE vacancy_semantic SET published_ms = ? WHERE id = ?')
      .run(Date.parse('2026-09-20T10:00:00.000Z'), 'coo');

    expect(store.queryMatchCandidates(executive, { nowMs, limit: 50 }).map((v) => v.id)).toEqual([
      'coo',
    ]);
  });

  it('вакансия старше окна по дате пула в подбор не входит', () => {
    const { store, database } = poolWith([
      { id: 'old', title: 'Chief Operating Officer', publishedAt: '2026-09-20T10:00:00.000Z' },
    ]);
    database
      .prepare('UPDATE vacancy_semantic SET published_ms = ? WHERE id = ?')
      .run(Date.parse('2026-10-29T10:00:00.000Z'), 'old');

    expect(store.queryMatchCandidates(executive, { nowMs, limit: 50 })).toHaveLength(0);
  });
});
