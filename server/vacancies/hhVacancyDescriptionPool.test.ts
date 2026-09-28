import { describe, expect, it, vi } from 'vitest';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import { MemoryVacancyPoolStore } from './memoryVacancyPoolStore';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { createClusterFromVacancy } from './vacancyDeduplicator';
import { matchCandidateWithVacancy } from './vacancyMatcher';

const source: VacancySourceConfig = {
  id: 'src-hh-search',
  name: 'hh.ru',
  type: 'hh_search',
  enabled: true,
  targetUrl: 'https://hh.ru/search/vacancy',
  refreshIntervalMinutes: 20,
  itemsFoundTotal: 0,
  itemsActiveTotal: 0,
};
const vacancy: UnifiedVacancy = {
  id: 'src-hh-search:9001',
  fingerprint: 'src-hh-search:9001',
  title: 'Инженер качества',
  company: 'Тестовая компания',
  description: 'TypeScript',
  requiredSkills: [],
  isRemote: false,
  url: 'https://hh.ru/vacancy/9001',
  provenance: {
    sourceType: 'json_api',
    sourceId: 'src-hh-search',
    sourceUrl: 'https://hh.ru/vacancy/9001',
    observedAt: '2026-09-27T10:00:00.000Z',
  },
  publishedAt: '2026-09-27T10:00:00.000Z',
  status: 'active',
};

describe('hh full-description on demand', () => {
  it('запрашивает одну открытую карточку и сохраняет её текст в записи пула', async () => {
    const pool = new MemoryVacancyPoolStore();
    pool.mergeSourceSlice(source.id, [vacancy]);
    const load = vi.fn().mockResolvedValue('Полный текст вакансии');
    const engine = new MultiSourceVacancyEngine({
      sources: [source],
      pool,
      descriptionLoader: { load },
    });

    await expect(engine.loadVacancyDescription(vacancy.id)).resolves.toMatchObject({
      unavailable: false,
    });
    expect(load).toHaveBeenCalledWith(vacancy.url);
    expect(pool.getVacancy(vacancy.id)?.fullDescription).toBe('Полный текст вакансии');
  });

  it('честно сообщает отказ, сохраняя карточный сниппет', async () => {
    const pool = new MemoryVacancyPoolStore();
    pool.mergeSourceSlice(source.id, [vacancy]);
    const engine = new MultiSourceVacancyEngine({
      sources: [source],
      pool,
      descriptionLoader: { load: vi.fn().mockResolvedValue(undefined) },
    });

    await expect(engine.loadVacancyDescription(vacancy.id)).resolves.toMatchObject({
      unavailable: true,
      vacancy,
    });
    expect(pool.getVacancy(vacancy.id)?.fullDescription).toBeUndefined();
  });

  it('запись пула после загрузки сохраняет навыки и даёт requirements.total = 3 в vacancyMatcher', async () => {
    const pool = new MemoryVacancyPoolStore();
    pool.mergeSourceSlice(source.id, [vacancy]);
    const load = vi.fn().mockResolvedValue({
      description: 'Полный текст вакансии',
      skills: ['TypeScript', 'React', 'PostgreSQL'],
    });
    const engine = new MultiSourceVacancyEngine({
      sources: [source],
      pool,
      descriptionLoader: { load },
    });

    await expect(engine.loadVacancyDescription(vacancy.id)).resolves.toMatchObject({
      unavailable: false,
    });
    const stored = pool.getVacancy(vacancy.id);
    expect(stored?.fullDescription).toBe('Полный текст вакансии');
    expect(stored?.requiredSkills).toEqual(['TypeScript', 'React', 'PostgreSQL']);

    const cluster = createClusterFromVacancy(stored!);
    const explanation = matchCandidateWithVacancy(
      {
        candidateId: 'cand-1',
        targetRoles: ['Инженер качества'],
        confirmedSkills: ['TypeScript'],
        confirmedFacts: [],
        confirmedSkillFacts: [],
      },
      cluster,
    );
    expect(explanation.requirements?.total).toBe(3);
    expect(explanation.requirements?.matched).toBe(1);
  });
});
