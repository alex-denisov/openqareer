import { describe, expect, it } from 'vitest';
import {
  LOWER_INCOME_ANSWERS,
  professionResponses,
  professionWage,
  type WageVacancy,
} from './professionPath';

const NOW = new Date('2026-11-18T12:00:00.000Z');
const fresh = '2026-11-10T09:00:00.000Z';
const stale = '2026-09-01T09:00:00.000Z';

const vacancy = (from: number, to: number, patch: Partial<WageVacancy> = {}): WageVacancy => ({
  roleMatch: 'target',
  status: 'active',
  observedAt: [fresh],
  salary: { from, to, currency: 'RUR' },
  ...patch,
});

describe('professionWage', () => {
  it('takes the lower quartile of lows and the upper quartile of highs of fresh target vacancies', () => {
    const items = [
      ...Array.from({ length: 8 }, (_, i) => vacancy(300_000 + i * 10_000, 400_000 + i * 10_000)),
      vacancy(100_000, 900_000, { roleMatch: 'adjacent' }),
      vacancy(100_000, 900_000, { observedAt: [stale] }),
      vacancy(100_000, 900_000, { status: 'archived' }),
    ];
    expect(professionWage(items, NOW, undefined)).toEqual({
      state: 'ready',
      min: 310_000,
      max: 460_000,
      sampleSize: 8,
      observedAt: fresh,
    });
  });

  it('reports a thin sample instead of a number', () => {
    const items = Array.from({ length: 3 }, () => vacancy(300_000, 400_000));
    expect(professionWage(items, NOW, undefined)).toEqual({ state: 'thin', sampleSize: 3 });
  });

  it('skips vacancies without a salary', () => {
    const items = [vacancy(0, 0, { salary: undefined })];
    expect(professionWage(items, NOW, undefined)).toEqual({ state: 'thin', sampleSize: 0 });
  });
});

describe('professionResponses', () => {
  const view = (title: string, stage: string, applied = true) => ({
    vacancyTitle: title,
    stage,
    applied,
  });

  it('counts sent responses and invitations in the target function', () => {
    const views = [
      view('Продакт-менеджер', 'applied'),
      view('Product manager', 'interview'),
      view('Продакт-менеджер', 'saved', false),
      view('Руководитель разработки', 'interview'),
    ];
    expect(professionResponses(views, 'Продакт-менеджер')).toEqual({ sent: 2, invited: 1 });
  });

  it('is empty for a title without a known function', () => {
    expect(professionResponses([view('Ыыы', 'applied')], 'Ыыы')).toEqual({ sent: 0, invited: 0 });
  });
});

describe('LOWER_INCOME_ANSWERS', () => {
  it('has the three chips of the screen', () => {
    expect(LOWER_INCOME_ANSWERS).toEqual(['yes', 'no', 'depends']);
  });
});
