import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';

const directories: string[] = [];
const stores: SqliteVacancyPoolStore[] = [];

afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

function openStore(): { store: SqliteVacancyPoolStore; path: string } {
  const directory = mkdtempSync(join(tmpdir(), 'vacancy-pool-skills-'));
  directories.push(directory);
  const path = join(directory, 'nested', 'pool.db');
  const store = new SqliteVacancyPoolStore({ databasePath: path });
  stores.push(store);
  return { store, path };
}

function makeVacancy(
  id: string,
  title: string,
  fullDescription: string,
  requiredSkills: string[] = [],
): UnifiedVacancy {
  return {
    id,
    fingerprint: `fp-${id}`,
    title,
    company: 'Company',
    description: '',
    fullDescription,
    requiredSkills,
    url: `https://example.test/${id}`,
    provenance: {
      sourceType: 'json_api',
      sourceId: 'src-hh',
      sourceUrl: `https://example.test/${id}`,
      observedAt: '2026-09-01T10:00:00.000Z',
    },
    publishedAt: '2026-09-01T10:00:00.000Z',
    status: 'active',
  };
}

describe('SqliteVacancyPoolStore · backfillDescriptionSkillsStep (B307)', () => {
  it('шаг обслуживания обрабатывает пачку и не читает весь пул', () => {
    const { store } = openStore();

    const v1 = makeVacancy(
      'hh:101',
      'Chief Operating Officer',
      'Ищем COO. Отвечать за P&L бизнеса, руководство командой, бюджетирование.',
    );
    const v2 = makeVacancy(
      'hh:102',
      'Chief Operating Officer',
      'COO. Управление командой, стратегическое планирование, OKR и KPI.',
    );
    const v3 = makeVacancy(
      'hh:103',
      'Go Developer',
      'Go Developer. Go, Kubernetes, PostgreSQL.',
      ['Go', 'Kubernetes'],
    );

    store.mergeSourceSlice('src-hh', [v1, v2, v3]);

    // Пачка из 1 записи: обрабатывает ровно 1 строку пула за такт
    const step1 = store.backfillDescriptionSkillsStep(1);
    expect(step1.inspected).toBe(1);
    expect(step1.updated).toBe(1);
    expect(step1.passFinished).toBe(false);

    expect(store.getVacancy('hh:101')?.requiredSkills).toEqual(
      expect.arrayContaining(['Управление P&L', 'Управление командой', 'Бюджетирование']),
    );
    // v2 ещё не обработана в этом такте
    expect(store.getVacancy('hh:102')?.requiredSkills).toEqual([]);

    // Второй такт: обрабатывает вторую запись
    const step2 = store.backfillDescriptionSkillsStep(1);
    expect(step2.inspected).toBe(1);
    expect(step2.updated).toBe(1);
    expect(store.getVacancy('hh:102')?.requiredSkills).toEqual(
      expect.arrayContaining(['Управление командой', 'Стратегическое планирование', 'OKR / KPI']),
    );

    // Третий такт: v3 уже имеет навыки, не обновляется
    const step3 = store.backfillDescriptionSkillsStep(1);
    expect(step3.inspected).toBe(1);
    expect(step3.updated).toBe(0);

    // Четвёртый такт: конец пула
    const step4 = store.backfillDescriptionSkillsStep(1);
    expect(step4.passFinished).toBe(true);
  });
});
