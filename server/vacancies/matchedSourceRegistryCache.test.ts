import { describe, expect, it, vi } from 'vitest';
import type { VacancySourceConfig } from '../domain/unifiedVacancy';
import { matchedVacancySourceRegistry } from './matchedVacancyFacets';
import { cachedMatchedSourceRegistry, SOURCE_REGISTRY_TTL_MS } from './matchedSourceRegistryCache';

function source(id: string): VacancySourceConfig {
  return {
    id,
    name: `Board ${id}`,
    type: 'career_site',
    enabled: true,
    targetUrl: `https://boards.example/${id}`,
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  };
}

function engineWith(sources: VacancySourceConfig[]) {
  return { getSources: vi.fn(() => [...sources]) };
}

/** B725: 74 тыс. источников досок сливались в реестр на каждой странице подборки — ~95 мс на проде. */
describe('cachedMatchedSourceRegistry (B725)', () => {
  it('отдаёт тот же реестр и id, что прямой расчёт', () => {
    const engine = engineWith([source('ats:a'), source('ats:b')]);
    const cached = cachedMatchedSourceRegistry(engine, 1_000);
    const direct = matchedVacancySourceRegistry(engine.getSources());
    expect(cached.registry).toEqual(direct);
    expect(cached.knownSourceIds).toEqual(direct.map(({ id }) => id));
  });

  it('повторный запрос в пределах срока не читает источники заново', () => {
    const engine = engineWith([source('ats:a')]);
    const first = cachedMatchedSourceRegistry(engine, 1_000);
    const second = cachedMatchedSourceRegistry(engine, 1_000 + SOURCE_REGISTRY_TTL_MS - 1);
    expect(second).toBe(first);
    expect(engine.getSources).toHaveBeenCalledTimes(1);
  });

  it('после срока видит новый источник', () => {
    const sources = [source('ats:a')];
    const engine = { getSources: () => [...sources] };
    cachedMatchedSourceRegistry(engine, 1_000);
    sources.push(source('ats:new'));
    const later = cachedMatchedSourceRegistry(engine, 1_000 + SOURCE_REGISTRY_TTL_MS);
    expect(later.knownSourceIds).toContain('ats:new');
  });

  it('у каждого движка свой реестр', () => {
    const one = cachedMatchedSourceRegistry(engineWith([source('ats:one')]), 1_000);
    const two = cachedMatchedSourceRegistry(engineWith([source('ats:two')]), 1_000);
    expect(one.knownSourceIds).toContain('ats:one');
    expect(two.knownSourceIds).not.toContain('ats:one');
  });

  it('движок без getSources получает статический реестр', () => {
    const cached = cachedMatchedSourceRegistry({}, 1_000);
    expect(cached.registry).toEqual(matchedVacancySourceRegistry([]));
  });
});
