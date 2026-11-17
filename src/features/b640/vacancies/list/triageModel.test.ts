import { describe, expect, it } from 'vitest';
import type { VacancyTriage, VacancyTriageRow } from '../../../../../shared/b640Vacancies';
import {
  TRIAGE_MAX_IDS,
  currentQuestion,
  isWeakMatch,
  pickedIds,
  toggleUnchecked,
  triageIds,
  triageRowMap,
} from './triageModel';

const hide = (id: string, reasonLabel = 'не та роль'): VacancyTriageRow => ({
  clusterId: id,
  verdict: 'hide',
  reasonId: 'role-family',
  reasonLabel,
});
const keep = (id: string): VacancyTriageRow => ({ clusterId: id, verdict: 'keep' });

function triage(rows: VacancyTriageRow[], extra: Partial<VacancyTriage> = {}): VacancyTriage {
  const hidden = rows.filter((row) => row.verdict === 'hide').length;
  const needs = rows.filter((row) => row.verdict === 'needs_data').length;
  return {
    rows,
    questions: [],
    questionTotal: 0,
    summary: { total: rows.length, keep: rows.length - hidden - needs, hide: hidden, needsData: needs },
    ...extra,
  };
}

describe('id для разбора', () => {
  it('берёт id в порядке списка, без повторов', () => {
    const items = [{ cluster: { id: 'a' } }, { cluster: { id: 'b' } }, { cluster: { id: 'a' } }];
    expect(triageIds(items)).toEqual(['a', 'b']);
  });

  it('больше 1000 — первые 1000', () => {
    const items = Array.from({ length: TRIAGE_MAX_IDS + 5 }, (_, i) => ({ cluster: { id: `c${i}` } }));
    const ids = triageIds(items);
    expect(ids).toHaveLength(TRIAGE_MAX_IDS);
    expect(ids[0]).toBe('c0');
    expect(ids[TRIAGE_MAX_IDS - 1]).toBe(`c${TRIAGE_MAX_IDS - 1}`);
  });
});

describe('отмеченные к скрытию', () => {
  const data = triage([hide('a'), keep('b'), hide('c')]);

  it('по умолчанию отмечены все hide', () => {
    expect(pickedIds(data, new Set())).toEqual(['a', 'c']);
  });

  it('снятый флажок убирается из счёта', () => {
    expect(pickedIds(data, new Set(['a']))).toEqual(['c']);
  });

  it('уже скрытые не считаются', () => {
    expect(pickedIds(data, new Set(), new Set(['c']))).toEqual(['a']);
  });

  it('нет разбора — нечего скрывать', () => {
    expect(pickedIds(null, new Set())).toEqual([]);
  });

  it('переключатель не мутирует набор', () => {
    const before: ReadonlySet<string> = new Set(['a']);
    const next = toggleUnchecked(before, 'b');
    expect([...before]).toEqual(['a']);
    expect([...next].sort()).toEqual(['a', 'b']);
    expect([...toggleUnchecked(next, 'a')]).toEqual(['b']);
  });
});

describe('«слабо совпадает»', () => {
  it('keep меньше половины total', () => {
    expect(isWeakMatch({ total: 23, keep: 6, hide: 15, needsData: 2 })).toBe(true);
  });

  it('ровно половина — не слабо', () => {
    expect(isWeakMatch({ total: 10, keep: 5, hide: 5, needsData: 0 })).toBe(false);
  });

  it('пустой разбор — не слабо', () => {
    expect(isWeakMatch({ total: 0, keep: 0, hide: 0, needsData: 0 })).toBe(false);
  });
});

describe('вопросы по одному', () => {
  it('первый без ответа: «k из questionTotal»', () => {
    const q = { id: 'salaryLowerBound' as const, text: 'Сравнивать по нижней границе зарплаты?' };
    const data = triage([hide('a')], { questions: [q], questionTotal: 2 });
    expect(currentQuestion(data)).toEqual({ id: 'salaryLowerBound', text: q.text, number: 2, total: 2 });
  });

  it('все вопросы без ответа: номер с единицы', () => {
    const q = { id: 'salaryLowerBound' as const, text: 'Вопрос' };
    const data = triage([], { questions: [q], questionTotal: 1 });
    expect(currentQuestion(data)?.number).toBe(1);
  });

  it('без вопросов — полосы нет', () => {
    expect(currentQuestion(triage([keep('a')]))).toBeNull();
    expect(currentQuestion(null)).toBeNull();
  });
});

it('карта строк по id', () => {
  const map = triageRowMap(triage([hide('a'), keep('b')]));
  expect(map.get('a')?.verdict).toBe('hide');
  expect(triageRowMap(null).size).toBe(0);
});
