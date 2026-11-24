import { describe, expect, it } from 'vitest';
import { coachTurnInputSchema } from '../domain/coach';
import { careerInstructionsForRole } from '../prompts/careerRolePrompts';
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
    expect(selection.rows[0]).toEqual({ n: 1, title: 'Head of IT Service 1', company: 'Компания 1', location: null, country: null, format: null, salary: null, fitPercent: null });
    expect(selection.rows[19]?.title).toBe('Head of IT Service 20');
  });

  it('зарплата строкой и процент совпадения, как их видит кандидат', () => {
    const selection = selectionContextOf(
      [item(1, { salary: { from: 400_000, to: 550_000, currency: 'RUB', gross: false } }, 82)],
      (row) => (row.explanation as unknown as { fitPercentForTest?: number }).fitPercentForTest ?? null,
    );
    expect(selection.rows[0]).toMatchObject({ salary: 'Зарплата: 400 000–550 000 RUB на руки', fitPercent: 82 });
  });

  it('место и формат — из вакансии; не названы — null, а не догадка', () => {
    const { rows } = selectionContextOf(
      [
        item(1, { canonicalLocation: 'Москва', workFormat: 'hybrid' }),
        item(2, { canonicalLocation: 'Berlin', isRemote: true, remoteScope: 'global' }),
        item(3, { canonicalLocation: ' ', isRemote: false }),
      ],
      () => null,
    );
    expect(rows.map(({ location, format }) => [location, format])).toEqual([
      ['Москва', 'гибрид'],
      ['Berlin', 'Удалённо из любой страны'],
      [null, null],
    ]);
  });

  it('правила консультанта: страна только из country, число — из сводки сервера', () => {
    const prompt = careerInstructionsForRole();
    expect(prompt).toContain('только из country');
    expect(prompt).toContain('только из summary');
  });

  it('сводка: город, страна и формат с номерами строк; «Remote» — не место, спорный формат — неизвестно', () => {
    const { rows, summary } = selectionContextOf(
      [
        item(1, { canonicalLocation: 'Москва', workFormat: 'hybrid' }),
        item(2, { canonicalLocation: 'Moscow, Russia', workFormat: 'office' }),
        item(3, { canonicalLocation: 'Remote', workFormat: 'office' }),
        item(4, { canonicalLocation: 'Тверь', workFormat: 'remote', remoteScope: 'RU' }),
        item(5, { canonicalLocation: 'Dubai, UAE', workFormat: 'office' }),
      ],
      () => null,
    );
    expect(rows[2]).toMatchObject({ n: 3, location: null, country: null, format: null });
    expect(summary.shown).toBe(5);
    expect(summary.byPlace[0]).toEqual({ label: 'Москва', count: 2, rows: [1, 2] });
    expect(summary.byPlace.at(-1)).toEqual({ label: 'неизвестно', count: 1, rows: [3] });
    expect(summary.byCountry[0]).toEqual({ label: 'Россия', count: 3, rows: [1, 2, 4] });
    expect(summary.byCountry.at(-1)).toEqual({ label: 'неизвестно', count: 1, rows: [3] });
    expect(summary.byFormat.find((group) => group.rows.includes(4))?.label).toContain('Удалённо');
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
