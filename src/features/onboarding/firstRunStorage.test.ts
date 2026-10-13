import { describe, expect, it } from 'vitest';
import type { IngestedResume } from '../journey/useResumeIngestion';
import {
  DEFAULT_FIRST_RUN_DATA,
  filterCities,
  restoreSourceStep,
  selectCity,
  setGoal,
  setRelocationReady,
  setWorkFormat,
  skipSourceStep,
  firstRunDataToWorkspaceInput,
} from './firstRunStorage';

describe('firstRunStorage logic and rules', () => {
  it('filters cities by query case-insensitively, by country, and by region', () => {
    const piter = filterCities('петер');
    expect(piter).toHaveLength(1);
    expect(piter[0].name).toBe('Санкт-Петербург');

    const serbia = filterCities('серб');
    expect(serbia).toHaveLength(1);
    expect(serbia[0].name).toBe('Белград');

    const tokyo = filterCities('токио');
    expect(tokyo).toHaveLength(1);
    expect(tokyo[0].region).toBe('apac');

    const empty = filterCities('несуществующийгород999');
    expect(empty).toHaveLength(0);
  });

  it('selectCity updates context city, country, and region', () => {
    const updated = selectCity(DEFAULT_FIRST_RUN_DATA, {
      name: 'Ереван',
      country: 'Армения',
      region: 'cis',
    });
    expect(updated.context.city).toBe('Ереван');
    expect(updated.context.country).toBe('Армения');
    expect(updated.context.region).toBe('cis');
  });

  it('skipSourceStep marks source as skipped and clears selected source', () => {
    const skipped = skipSourceStep(DEFAULT_FIRST_RUN_DATA);
    expect(skipped.isSourceSkipped).toBe(true);
    expect(skipped.selectedSource).toBeNull();
  });

  it('restoreSourceStep unskips source and assigns default or specified source', () => {
    const skipped = skipSourceStep(DEFAULT_FIRST_RUN_DATA);
    const restored = restoreSourceStep(skipped, 'hh');
    expect(restored.isSourceSkipped).toBe(false);
    expect(restored.selectedSource).toBe('hh');
  });

  it('setGoal, setWorkFormat, setRelocationReady immutably update fields', () => {
    const withGoal = setGoal(DEFAULT_FIRST_RUN_DATA, 'Новая цель');
    expect(withGoal.goal).toBe('Новая цель');

    const withFormat = setWorkFormat(withGoal, 'Удалённо');
    expect(withFormat.context.format).toBe('Удалённо');

    const withRelo = setRelocationReady(withFormat, true);
    expect(withRelo.context.isRelocationReady).toBe(true);
  });

  it('firstRunDataToWorkspaceInput produces valid WorkspaceInput for shell and intake', () => {
    const sampleResume = {
      parsed: {
        rawText: 'Резюме разработчика',
        confidence: 1,
        facts: [],
      },
      draft: {
        basics: { fullName: 'Иван' },
      },
      text: 'Резюме разработчика',
      source: 'pdf' as const,
      file: { name: 'cv.pdf', pages: 2 },
      imported: true,
    } as unknown as IngestedResume;
    const input = firstRunDataToWorkspaceInput(DEFAULT_FIRST_RUN_DATA, sampleResume);
    expect(input.resumeText).toBe('Резюме разработчика');
    expect(input.resumeFileName).toBe('cv.pdf');
    expect(input.resumePageCount).toBe(2);
    expect(input.regions).toEqual(['ru']);
    expect(input.constraints).toContain('Москва');
    expect(input.constraints).toContain('Гибрид');
  });
});
