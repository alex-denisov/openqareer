import { describe, expect, it } from 'vitest';
import {
  CAREER_VECTORS,
  VECTOR_QUESTIONS,
  buildSearchFocus,
  campaignBias,
  confirmSearchFocus,
  type VectorAnswers,
} from './careerVector';

const pick = (optionByQuestion: Record<string, string>): VectorAnswers => ({
  choices: optionByQuestion,
  antiGoals: [],
  compromises: { grade: 'none', salary: 'none' },
});

const allFirst = (vectorId: string): Record<string, string> =>
  Object.fromEntries(
    VECTOR_QUESTIONS.map((q) => [q.id, q.options.find((o) => o.vector === vectorId)!.id]),
  );

describe('buildSearchFocus', () => {
  it.each(CAREER_VECTORS.map((v) => [v.id, v.label] as const))(
    'последовательные ответы про «%s» дают этот вектор',
    (vectorId) => {
      const focus = buildSearchFocus(pick(allFirst(vectorId)));
      expect(focus.vector).toBe(vectorId);
      expect(focus.confidence).toBe('clear');
      expect(focus.reasons.length).toBeGreaterThan(0);
    },
  );

  it('вектор — гипотеза, пока кандидат не подтвердил', () => {
    expect(buildSearchFocus(pick(allFirst('status_scale'))).status).toBe('hypothesis');
  });

  it('при ничьей показывает второй вектор и просит уточнить', () => {
    const mixed = Object.fromEntries(
      VECTOR_QUESTIONS.map((q, i) => [
        q.id,
        q.options.find((o) => o.vector === (i % 2 === 0 ? 'status_scale' : 'stable_move'))!.id,
      ]),
    );
    const focus = buildSearchFocus(pick(mixed));
    expect(focus.confidence).toBe('close');
    expect(focus.runnerUp).not.toBeNull();
  });

  it('без ответов вектор не выбирается', () => {
    const focus = buildSearchFocus(pick({}));
    expect(focus.vector).toBeNull();
    expect(focus.confidence).toBe('none');
  });

  it('антицели очищаются от пустых и повторов, длина ограничена', () => {
    const focus = buildSearchFocus({
      ...pick(allFirst('stable_move')),
      antiGoals: ['  продажи  ', 'Продажи', '', 'ночные смены', 'x'.repeat(300)],
    });
    expect(focus.antiGoals).toEqual(['продажи', 'ночные смены', 'x'.repeat(120)]);
  });
});

describe('confirmSearchFocus', () => {
  it('возвращает копию с подтверждением, исходный фокус не меняется', () => {
    const focus = buildSearchFocus(pick(allFirst('industry_pivot')));
    const confirmed = confirmSearchFocus(focus, new Date('2026-10-06T10:00:00Z'));
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.confirmedAt).toBe('2026-10-06T10:00:00.000Z');
    expect(focus.status).toBe('hypothesis');
  });

  it('нельзя подтвердить фокус без вектора', () => {
    expect(() => confirmSearchFocus(buildSearchFocus(pick({})), new Date())).toThrow();
  });
});

describe('campaignBias', () => {
  it('смена индустрии допускает шаг по грейду только по согласию кандидата', () => {
    const answers: VectorAnswers = {
      ...pick(allFirst('industry_pivot')),
      compromises: { grade: 'one_step', salary: 'up_to_10' },
    };
    const bias = campaignBias(buildSearchFocus(answers));
    expect(bias.levelShift).toBe('one_step_down_allowed');
    expect(bias.keepIndustry).toBe(false);
  });

  it('релокация расширяет географию, остальные векторы — нет', () => {
    expect(campaignBias(buildSearchFocus(pick(allFirst('relocation')))).widenGeography).toBe(true);
    expect(campaignBias(buildSearchFocus(pick(allFirst('stable_move')))).widenGeography).toBe(
      false,
    );
  });

  it('без вектора смещения нет', () => {
    expect(campaignBias(buildSearchFocus(pick({}))).levelShift).toBe('same');
  });
});
