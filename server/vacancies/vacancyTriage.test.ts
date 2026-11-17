import { describe, expect, it } from 'vitest';
import type { CurrencyRates } from '../../shared/currencyRates';
import type { MatchedVacancyItem } from './multiSourceVacancyEngine';
import { triageVacancies, type TriageInput } from './vacancyTriage';

type Gate = 'matched' | 'blocked' | 'unknown';
interface RowSpec {
  readonly id: string;
  readonly gates?: Partial<Record<'role' | 'level' | 'region' | 'workFormat', Gate>>;
  readonly salary?: { from?: number; to?: number; currency?: string; period?: string };
  readonly isRemote?: boolean;
  readonly saved?: boolean;
  readonly noResult?: boolean;
}

function row(spec: RowSpec): MatchedVacancyItem {
  const gate = (name: 'role' | 'level' | 'region' | 'workFormat') => ({
    status: spec.gates?.[name] ?? 'matched',
    reason: '',
  });
  const gates = { role: gate('role'), level: gate('level'), region: gate('region'), workAuthorization: { status: 'matched', reason: '' }, workFormat: gate('workFormat') };
  return {
    cluster: { id: spec.id, isRemote: spec.isRemote ?? false, ...(spec.salary ? { salary: spec.salary } : {}) },
    explanation: {
      clusterId: spec.id,
      ...(spec.saved ? { candidateDecision: { status: 'saved' } } : {}),
      fitView: spec.noResult ? { state: 'processing', requirements: [] } : { state: 'ready', requirements: [], result: { gates } },
    },
  } as unknown as MatchedVacancyItem;
}

const FLOOR = { amount: 200_000, currency: 'RUB' };
const run = (specs: RowSpec[], rest: Partial<TriageInput> = {}) =>
  triageVacancies({ rows: specs.map(row), answers: {}, appliedIds: new Set(), ...rest });
const only = (specs: RowSpec[], rest: Partial<TriageInput> = {}) => run(specs, rest).rows[0];

describe('triageVacancies: gates', () => {
  it('hides a blocked role', () => {
    expect(only([{ id: 'a', gates: { role: 'blocked' } }])).toMatchObject({ verdict: 'hide', reasonId: 'role-family', reasonLabel: 'не та роль' });
  });
  it('hides a blocked level', () => {
    expect(only([{ id: 'a', gates: { level: 'blocked' } }])).toMatchObject({ verdict: 'hide', reasonId: 'level', reasonLabel: 'не тот уровень' });
  });
  it('hides a blocked region or format', () => {
    for (const gates of [{ region: 'blocked' }, { workFormat: 'blocked' }] as const) {
      expect(only([{ id: 'a', gates }])).toMatchObject({ verdict: 'hide', reasonId: 'geo-format', reasonLabel: 'не подходят условия' });
    }
  });
  it('does not hide remote by region, but hides it by format', () => {
    expect(only([{ id: 'a', isRemote: true, gates: { region: 'blocked' } }]).verdict).toBe('keep');
    expect(only([{ id: 'a', isRemote: true, gates: { workFormat: 'blocked' } }]).verdict).toBe('hide');
  });
  it('checks role before level before geography before salary', () => {
    const salary = { from: 10_000, to: 20_000, currency: 'RUR' };
    const all = { role: 'blocked', level: 'blocked', region: 'blocked' } as const;
    expect(only([{ id: 'a', gates: all, salary }], { salaryFloor: FLOOR }).reasonId).toBe('role-family');
    expect(only([{ id: 'a', gates: { level: 'blocked', region: 'blocked' }, salary }], { salaryFloor: FLOOR }).reasonId).toBe('level');
    expect(only([{ id: 'a', gates: { region: 'blocked' }, salary }], { salaryFloor: FLOOR }).reasonId).toBe('geo-format');
    expect(only([{ id: 'a', salary }], { salaryFloor: FLOOR }).reasonId).toBe('comp-below');
  });
  it('keeps a row without a computed match', () => {
    expect(only([{ id: 'a', noResult: true }]).verdict).toBe('keep');
  });
});

describe('triageVacancies: salary', () => {
  const rub = (from: number, to?: number) => ({ from, ...(to ? { to } : {}), currency: 'RUR', period: 'month' });
  it('hides a range entirely below the floor', () => {
    expect(only([{ id: 'a', salary: rub(100_000, 150_000) }], { salaryFloor: FLOOR })).toMatchObject({ verdict: 'hide', reasonId: 'comp-below', reasonLabel: 'зарплата ниже' });
  });
  it('asks when the range crosses the floor; yes hides, no keeps', () => {
    const specs = [{ id: 'a', salary: rub(150_000, 300_000) }];
    const asked = run(specs, { salaryFloor: FLOOR });
    expect(asked.rows[0]).toMatchObject({ verdict: 'needs_data', questionId: 'salaryLowerBound' });
    expect(asked.questions.map((q) => q.id)).toEqual(['salaryLowerBound']);
    expect(run(specs, { salaryFloor: FLOOR, answers: { salaryLowerBound: true } }).rows[0]).toMatchObject({ verdict: 'hide', reasonId: 'comp-below' });
    expect(run(specs, { salaryFloor: FLOOR, answers: { salaryLowerBound: false } }).rows[0].verdict).toBe('keep');
  });
  it('keeps questionTotal when answered, drops the question', () => {
    const specs = [{ id: 'a', salary: rub(150_000, 300_000) }];
    const open = run(specs, { salaryFloor: FLOOR });
    const done = run(specs, { salaryFloor: FLOOR, answers: { salaryLowerBound: false } });
    expect(open.questionTotal).toBe(1);
    expect(done.questionTotal).toBe(1);
    expect(done.questions).toEqual([]);
  });
  it('has no salary rule or question without a floor', () => {
    const out = run([{ id: 'a', salary: rub(1, 2) }]);
    expect(out.rows[0].verdict).toBe('keep');
    expect(out.questionTotal).toBe(0);
    expect(out.questions).toEqual([]);
  });
  it('converts another currency by rate; keeps without a rate', () => {
    const rates: CurrencyRates = { date: '2026-11-17', rubPerUnit: { USD: 100 } };
    const usd = [{ id: 'a', salary: { from: 1_000, to: 1_500, currency: 'USD', period: 'month' } }];
    expect(only(usd, { salaryFloor: FLOOR, rates }).verdict).toBe('hide');
    expect(only(usd, { salaryFloor: FLOOR }).verdict).toBe('keep');
    expect(only(usd, { salaryFloor: FLOOR, rates: { date: 'x', rubPerUnit: {} } }).verdict).toBe('keep');
  });
  it('converts the floor when it is in a foreign currency', () => {
    const rates: CurrencyRates = { date: '2026-11-17', rubPerUnit: { USD: 100 } };
    expect(only([{ id: 'a', salary: rub(100_000, 150_000) }], { salaryFloor: { amount: 2_000, currency: 'USD' }, rates }).verdict).toBe('hide');
  });
  it('compares directly in one currency without rates, aliases included', () => {
    const usd = (from: number, to: number) => [{ id: 'a', salary: { from, to, currency: 'USD', period: 'month' } }];
    expect(only(usd(1_000, 1_500), { salaryFloor: { amount: 2_000, currency: 'USD' } }).verdict).toBe('hide');
    expect(only(usd(1_000, 3_000), { salaryFloor: { amount: 2_000, currency: 'USD' } }).verdict).toBe('needs_data');
    expect(only(usd(1_000, 1_500), { salaryFloor: { amount: 2_000, currency: 'EUR' } }).verdict).toBe('keep');
    const rur = [{ id: 'a', salary: { from: 1, to: 100_000, currency: 'RUR', period: 'month' } }];
    expect(only(rur, { salaryFloor: { amount: 200_000, currency: '₽' } }).verdict).toBe('hide');
  });
  it('keeps a vacancy without salary', () => {
    expect(only([{ id: 'a' }], { salaryFloor: FLOOR }).verdict).toBe('keep');
  });
});

describe('triageVacancies: saved, applied, invariant', () => {
  const bad = { gates: { role: 'blocked' } } as const;
  it('keeps saved and applied rows', () => {
    const out = run([{ id: 'a', ...bad, saved: true }, { id: 'b', ...bad }], { appliedIds: new Set(['b']) });
    expect(out.rows.map((r) => r.verdict)).toEqual(['keep', 'keep']);
  });
  it('keeps keep+hide+needsData === total === rows.length on a random sample', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
    const gateOf = (): Gate => (['matched', 'blocked', 'unknown'] as const)[Math.floor(rnd() * 3)];
    const specs: RowSpec[] = Array.from({ length: 300 }, (_, i) => ({
      id: `c${i}`,
      gates: { role: gateOf(), level: gateOf(), region: gateOf(), workFormat: gateOf() },
      isRemote: rnd() < 0.3,
      saved: rnd() < 0.1,
      noResult: rnd() < 0.1,
      ...(rnd() < 0.7 ? { salary: { from: Math.round(rnd() * 400_000), to: Math.round(rnd() * 400_000) + 1, currency: 'RUR' } } : {}),
    }));
    for (const answers of [{}, { salaryLowerBound: true }, { salaryLowerBound: false }] as const) {
      const { summary, rows } = run(specs, { salaryFloor: FLOOR, answers });
      expect(summary.keep + summary.hide + summary.needsData).toBe(summary.total);
      expect(summary.total).toBe(rows.length);
      expect(rows).toHaveLength(300);
    }
  });
});
