import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { clusterVacancies } from './vacancyDeduplicator';
import type { VacancyPoolStore } from './vacancyPoolStore';

const COUNT = 1_500;
const OBSERVED_AT = new Date().toISOString();

function vacancy(index: number): UnifiedVacancy {
  const sourceUrl = `https://hh.ru/vacancy/${index}`;
  return {
    id: `v${index}`,
    fingerprint: `f${index}`,
    title: `Engineering Manager ${index % 40}`,
    company: `Company ${index % 300} tech`,
    url: sourceUrl,
    location: 'Moscow',
    isRemote: false,
    description: `Опыт управления командой. ${'Офис, ДМС и обучение. '.repeat(60)}${index}`,
    requiredSkills: ['TypeScript'],
    publishedAt: OBSERVED_AT,
    status: 'active',
    provenance: {
      sourceId: 'src-hh',
      sourceType: 'hh',
      sourceUrl,
      externalId: `${index}`,
      observedAt: OBSERVED_AT,
    },
  } as unknown as UnifiedVacancy;
}

function engineOver(store: object): MultiSourceVacancyEngine {
  return new MultiSourceVacancyEngine({
    sources: [],
    pool: { loadSourceStates: () => [], ...store } as unknown as VacancyPoolStore,
  });
}

const CANDIDATE = {
  candidateId: 'candidate-a',
  targetRoles: ['Engineering Manager'],
  confirmedSkills: ['TypeScript'],
} as never;

describe('B770: сведение подборки не держит цикл событий одним куском', () => {
  afterEach(() => vi.useRealTimers());

  it('пока сводятся вакансии, цикл событий проходит много раз', async () => {
    const vacancies = Array.from({ length: COUNT }, (_, index) => vacancy(index));
    // Compared with the same clustering in one piece, so the result does not depend on the host.
    // `calculatedAt` of the explanations is the only clock value in the result.
    vi.useFakeTimers({ toFake: ['Date'] });
    clusterVacancies(vacancies.slice(0, 300)); // warms the JIT, or the bound would be too loose
    const startedAt = performance.now();
    clusterVacancies(vacancies);
    const wholeMs = performance.now() - startedAt;
    const expected = engineOver({ queryMatchCandidates: () => vacancies }).getMatchedVacancies(
      CANDIDATE,
    );

    let last = performance.now();
    let longest = 0;
    let turns = 0;
    let done = false;
    const beat = () => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
      turns += 1;
      if (!done) setImmediate(beat);
    };
    const engine = engineOver({ queryMatchCandidatesAsync: async () => vacancies });
    setImmediate(beat);
    const matched = await engine.getMatchedVacanciesAsync(CANDIDATE);
    done = true;

    expect(turns).toBeGreaterThan(3);
    expect(longest).toBeLessThan(wholeMs / 2);
    expect(matched).toEqual(expected);
  });
});
