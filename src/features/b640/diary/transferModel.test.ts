import { describe, expect, it } from 'vitest';
import type { CareerDiaryGoalCard } from '../../../../shared/careerDiaryCards';
import { defaultPlace, placeLabel, placesOf, transferLine } from './transferModel';

const measurement = (value: number) => ({
  id: 'm',
  goalId: 'i1',
  value,
  measuredAt: '2026-11-20',
  note: null,
  source: 'candidate_entered' as const,
  createdAt: '',
});

const card = (indicator: Record<string, unknown> | null): CareerDiaryGoalCard =>
  ({
    id: 'g1',
    title: 'Выпускать релиз за неделю',
    unit: '',
    baselineValue: null,
    latestMeasurement: null,
    indicators: indicator
      ? [{ id: 'i1', title: 'Срок релиза', unit: 'дней', latestMeasurement: null, ...indicator }]
      : [],
  }) as unknown as CareerDiaryGoalCard;

describe('B742: строка для профиля', () => {
  it('из показателя с исходным значением и замером — «с … до …» и единица', () => {
    expect(transferLine(card({ baselineValue: 14, latestMeasurement: measurement(7) }))).toBe(
      'Выпускать релиз за неделю: с 14 до 7 дней',
    );
    expect(
      transferLine(card({ unit: '%', baselineValue: 80, latestMeasurement: measurement(95.5) })),
    ).toBe('Выпускать релиз за неделю: с 80 % до 95,5 %');
  });

  it('без исходного значения или замера — название цели', () => {
    expect(transferLine(card({ baselineValue: null, latestMeasurement: measurement(7) }))).toBe(
      'Выпускать релиз за неделю',
    );
    expect(transferLine(card(null))).toBe('Выпускать релиз за неделю');
  });
});

describe('B742: место работы для строки', () => {
  const places = placesOf([
    { id: 'e1', title: 'Руководитель разработки', employer: 'Вектор Банк', current: true },
    { id: 'e2', title: 'Тимлид', employer: 'Лаб', current: true, endDate: '2025-12' },
    { id: 'e3', current: false },
  ]);

  it('подпись и текущее место без даты окончания', () => {
    expect(places.map((place) => [place.label, place.current])).toEqual([
      ['Руководитель разработки, Вектор Банк', true],
      ['Тимлид, Лаб', false],
      ['Место работы', false],
    ]);
    expect(placeLabel({ id: 'x', employer: ' Лаб ' })).toBe('Лаб');
  });

  it('связанное место первым, иначе единственное текущее, иначе выбор', () => {
    expect(defaultPlace(places, 'e2')).toBe('e2');
    expect(defaultPlace(places, 'e9')).toBe('e1');
    expect(defaultPlace(places, null)).toBe('e1');
    const two = places.map((place) => ({ ...place, current: true }));
    expect(defaultPlace(two, null)).toBeNull();
    expect(defaultPlace([], null)).toBeNull();
  });
});
