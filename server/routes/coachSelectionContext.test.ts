import { describe, expect, it } from 'vitest';
import { coachTurnInputSchema } from '../domain/coach';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { selectionContextOf, SELECTION_CONTEXT_ROWS } from './coachSelectionContext';

function item(index: number, extra: Partial<MatchedVacancyItem['cluster']> = {}, percent?: number): MatchedVacancyItem {
  return {
    cluster: {
      canonicalTitle: `Head of IT Service ${index}`,
      canonicalCompany: `Компания ${index}`,
      ...extra,
    } as MatchedVacancyItem['cluster'],
    explanation: (percent === undefined ? {} : { fitPercentForTest: percent }) as unknown as MatchedVacancyItem['explanation'],
  };
}

describe('подборка в ходе консультанта (B735)', () => {
  it('первые 20 строк подборки в её порядке и общее число', () => {
    const rows = Array.from({ length: 34 }, (_, index) => item(index + 1));
    const selection = selectionContextOf(rows, () => null);
    expect(SELECTION_CONTEXT_ROWS).toBe(20);
    expect(selection.total).toBe(34);
    expect(selection.rows).toHaveLength(20);
    expect(selection.rows[0]).toEqual({ title: 'Head of IT Service 1', company: 'Компания 1', salary: null, fitPercent: null });
    expect(selection.rows[19]?.title).toBe('Head of IT Service 20');
  });

  it('зарплата строкой и процент совпадения, как их видит кандидат', () => {
    const selection = selectionContextOf(
      [item(1, { salary: { from: 400_000, to: 550_000, currency: 'RUB', gross: false } }, 82)],
      (row) => (row.explanation as unknown as { fitPercentForTest?: number }).fitPercentForTest ?? null,
    );
    expect(selection.rows[0]).toMatchObject({ salary: 'Зарплата: 400 000–550 000 RUB на руки', fitPercent: 82 });
  });

  it('частное лицо вместо компании не попадает в ход', () => {
    const selection = selectionContextOf([item(1, { employerIsPerson: true })], () => null);
    expect(selection.rows[0]?.company).toBeNull();
  });

  it('подборка проходит схему хода', () => {
    const selection = selectionContextOf([item(1)], () => 75);
    const parsed = coachTurnInputSchema.shape.careerContext.safeParse({
      roles: [], locations: [], salaryFloorRubles: null, formats: [], relocation: false, selection,
    });
    expect(parsed.success).toBe(true);
  });
});
