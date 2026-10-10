import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FIRST_RUN_DATA,
  filterCities,
  getConsultantReply,
  restoreSourceStep,
  selectCity,
  setGoal,
  setRelocationReady,
  setWorkFormat,
  skipSourceStep,
} from './firstRunStorage';

describe('firstRunStorage logic and rules', () => {
  it('filters cities by query case-insensitively and by country', () => {
    const piter = filterCities('петер');
    expect(piter).toHaveLength(1);
    expect(piter[0].name).toBe('Санкт-Петербург');

    const serbia = filterCities('серб');
    expect(serbia).toHaveLength(1);
    expect(serbia[0].name).toBe('Белград');

    const empty = filterCities('токио');
    expect(empty).toHaveLength(0);
  });

  it('selectCity updates context city and country', () => {
    const updated = selectCity(DEFAULT_FIRST_RUN_DATA, {
      name: 'Ереван',
      country: 'Армения',
    });
    expect(updated.context.city).toBe('Ереван');
    expect(updated.context.country).toBe('Армения');
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

  it('getConsultantReply responds accurately to starters', () => {
    expect(getConsultantReply('С чего начать?')).toContain('Начнём с источника');
    expect(getConsultantReply('Что вы читаете в LinkedIn?')).toContain('Читаем только выбранные разделы');
    expect(getConsultantReply('Можно без LinkedIn?')).toContain('Да, можно');
    expect(getConsultantReply('Что-то другое')).toContain('Расскажите подробнее');
  });
});
