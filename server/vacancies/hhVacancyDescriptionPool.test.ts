import { describe, expect, it, vi } from 'vitest';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import { MemoryVacancyPoolStore } from './memoryVacancyPoolStore';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { createClusterFromVacancy } from './vacancyDeduplicator';
import { HhVacancyDescriptionLoader } from './hhVacancyDescription';
import { matchCandidateWithVacancy } from './vacancyMatcher';

const source: VacancySourceConfig = {
  id: 'src-hh-search',
  name: 'hh.ru',
  type: 'hh_search',
  enabled: true,
  targetUrl: 'https://hh.ru/search/vacancy',
  addressStatus: 'live',
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

  it('если на карточке нет блока ключевых навыков — берёт их из текста описания (B304)', async () => {
    const pool = new MemoryVacancyPoolStore();
    pool.mergeSourceSlice(source.id, [vacancy]);
    const load = vi.fn().mockResolvedValue({
      description: 'Строим платформу на Kubernetes и AWS, бэкенд на Python.',
      skills: [],
    });
    const engine = new MultiSourceVacancyEngine({
      sources: [source],
      pool,
      descriptionLoader: { load },
    });

    await engine.loadVacancyDescription(vacancy.id);

    expect(pool.getVacancy(vacancy.id)?.requiredSkills).toEqual(
      expect.arrayContaining(['Kubernetes', 'AWS', 'Python']),
    );
  });

  it('вакансию, которая на hh в архиве, снимает с пула и не останавливает пакет дочитывания', async () => {
    const pool = new MemoryVacancyPoolStore();
    const second = {
      ...vacancy,
      id: 'src-hh-search:9002',
      fingerprint: 'src-hh-search:9002',
      url: 'https://hh.ru/vacancy/9002',
    };
    pool.mergeSourceSlice(source.id, [vacancy, second]);
    const load = vi
      .fn()
      .mockResolvedValueOnce({ archived: true, skills: [] })
      .mockResolvedValueOnce({ description: 'Полный текст', skills: ['Python'] });
    const engine = new MultiSourceVacancyEngine({
      sources: [source],
      pool,
      descriptionLoader: { load },
    });

    await engine.preloadVacancyDescriptions([vacancy.id, second.id]);

    expect(pool.getVacancy(vacancy.id)).toBeUndefined();
    expect(pool.getVacancy(second.id)?.requiredSkills).toEqual(['Python']);
  });

  it('повторяет запись закешированной страницы после временной ошибки пула', async () => {
    const pool = new MemoryVacancyPoolStore();
    const existing = { ...vacancy, fullDescription: 'Описание из поиска' };
    pool.mergeSourceSlice(source.id, [existing]);
    const originalMerge = pool.mergeSourceSlice.bind(pool);
    let failFirstWrite = true;
    vi.spyOn(pool, 'mergeSourceSlice').mockImplementation((...args) => {
      if (failFirstWrite) {
        failFirstWrite = false;
        throw new Error('temporary_write_failure');
      }
      return originalMerge(...args);
    });
    const transport = vi.fn().mockResolvedValue({
      status: 200,
      body: [
        '<div data-qa="vacancy-description"><p>Полное описание вакансии</p></div>',
        '<div data-qa="skills-element"><span>TypeScript</span></div>',
        '<div data-qa="skills-element"><span>React</span></div>',
      ].join(''),
    });
    const engine = new MultiSourceVacancyEngine({
      sources: [source],
      pool,
      descriptionLoader: new HhVacancyDescriptionLoader({
        transport,
        sleep: async () => undefined,
        minIntervalMs: 0,
      }),
    });

    await expect(engine.loadVacancyDescription(vacancy.id)).resolves.toMatchObject({
      status: 'failed',
      unavailable: true,
    });
    await expect(engine.loadVacancyDescription(vacancy.id)).resolves.toMatchObject({
      status: 'loaded',
      unavailable: false,
    });

    expect(transport).toHaveBeenCalledTimes(1);
    expect(pool.getVacancy(vacancy.id)?.requiredSkills).toEqual(['TypeScript', 'React']);
    expect(pool.getVacancy(vacancy.id)?.fullDescription).toBe('Полное описание вакансии');
  });

  it('не загружает детали, если источник выключен или разрешение не live', async () => {
    const pool = new MemoryVacancyPoolStore();
    pool.mergeSourceSlice(source.id, [vacancy]);
    const load = vi.fn().mockResolvedValue({
      description: 'Полное описание вакансии',
      skills: ['TypeScript'],
    });
    const disabledEngine = new MultiSourceVacancyEngine({
      sources: [{ ...source, enabled: false }],
      pool,
      descriptionLoader: { load },
    });

    await expect(disabledEngine.loadVacancyDescription(vacancy.id)).resolves.toMatchObject({
      status: 'skipped',
      unavailable: false,
    });
    expect(load).not.toHaveBeenCalled();

    const forbiddenEngine = new MultiSourceVacancyEngine({
      sources: [{ ...source, addressStatus: 'robots_forbidden' }],
      pool,
      descriptionLoader: { load },
    });
    await expect(forbiddenEngine.loadVacancyDescription(vacancy.id)).resolves.toMatchObject({
      status: 'skipped',
      unavailable: false,
    });
    expect(load).not.toHaveBeenCalled();
  });

  it('stops a preload batch after the first provider refusal', async () => {
    const pool = new MemoryVacancyPoolStore();
    const secondVacancy = {
      ...vacancy,
      id: 'src-hh-search:9002',
      fingerprint: 'src-hh-search:9002',
      url: 'https://hh.ru/vacancy/9002',
      provenance: {
        ...vacancy.provenance,
        sourceUrl: 'https://hh.ru/vacancy/9002',
      },
    };
    pool.mergeSourceSlice(source.id, [vacancy, secondVacancy]);
    const transport = vi.fn().mockResolvedValue({ status: 403, body: '' });
    const engine = new MultiSourceVacancyEngine({
      sources: [source],
      pool,
      descriptionLoader: new HhVacancyDescriptionLoader({
        transport,
        sleep: async () => undefined,
        minIntervalMs: 0,
      }),
    });

    await expect(
      engine.preloadVacancyDescriptions([vacancy.id, secondVacancy.id]),
    ).resolves.toEqual({ requested: 2, loaded: 0, skipped: 1, failed: 1 });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith(vacancy.url);
  });
});
