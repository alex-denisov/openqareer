import { describe, expect, it } from 'vitest';
import type { VacancyFitResult, VacancyFitView } from '../../../shared/vacancyFit';
import {
  vacancyFitBoost,
  vacancyFitConditionBlock,
  vacancyFitConfidenceHint,
  vacancyFitMark,
  vacancyFitSentence,
} from './vacancyFitModel';

const matched = { status: 'matched', reason: '' } as const;

function req(id: string, label: string) {
  return {
    id,
    text: label,
    label,
    skill: true,
    kind: 'other',
    importance: 'high',
    hard: false,
    stopFactor: false,
    origin: 'explicit',
    sourceQuote: label,
  } as unknown as VacancyFitView['requirements'][number];
}

function view(
  patch: Partial<VacancyFitResult> = {},
  state: VacancyFitView['state'] = 'ready',
  labels: readonly string[] = [],
  matchedIds: readonly string[] = [],
): VacancyFitView {
  return {
    state,
    requirements: labels.map((label, i) => req(`r${i}`, label)),
    result: {
      candidateId: 'c',
      vacancyId: 'v',
      algorithmVersion: 'evidence-coverage-3',
      status: 'assessed',
      calculatedAt: '2026-10-28T10:00:00Z',
      dataState: 'confirmed',
      gates: {
        role: matched,
        level: matched,
        region: matched,
        workAuthorization: matched,
        workFormat: matched,
      },
      coveragePercent: 92,
      requiredCoverage: { matched: 0, total: 0, percent: null },
      coverage: { matched: 11, total: 12, unknown: 0 },
      assessments: labels.map((_, i) => ({
        requirementId: `r${i}`,
        status: matchedIds.includes(`r${i}`) ? 'matched' : 'unmatched',
        evidence: [],
      })),
      reason: 'assessed',
      ...patch,
    },
  };
}

describe('vacancyFitMark: the row cell', () => {
  it('shows the number, the tier and «по N треб.»', () => {
    expect(vacancyFitMark(view())).toEqual({
      kind: 'number',
      percent: 92,
      tier: 'hi',
      caption: 'по 12 треб.',
      ariaLabel: 'Совпадение 92 %, по 12 требованиям',
    });
  });
  it('says «считаем» while the percent is computed', () => {
    expect(vacancyFitMark(view({}, 'processing')).kind).toBe('pending');
    expect(vacancyFitMark({ state: 'not_requested', requirements: [] }).kind).toBe('pending');
  });
  it('never shows 100 % from 1 of 1: «нет процента · мало требований»', () => {
    const mark = vacancyFitMark(
      view({
        coveragePercent: 100,
        coverage: { matched: 1, total: 1, unknown: 0 },
        reason: 'too_few_skills',
      }),
    );
    expect(mark).toMatchObject({ kind: 'none', caption: 'мало требований' });
  });
  it('names a missing profile', () => {
    const mark = vacancyFitMark(
      view({ status: 'unknown', coveragePercent: null, reason: 'no_eligible_facts' }),
    );
    expect(mark).toMatchObject({ kind: 'none', caption: 'нет профиля' });
  });
});

/** The mockup case: 10 of 12 checked, Kafka and Kubernetes stated without a check (29.10). */
function mockupView(): VacancyFitView {
  const labels = ['Kafka', 'Kubernetes', ...Array.from({ length: 10 }, (_, i) => `S${i}`)];
  const base = view(
    { coveragePercent: 92, coverage: { matched: 12, total: 12, unknown: 0, checked: 10 } },
    'ready',
    labels,
    labels.map((_, i) => `r${i}`),
  );
  return {
    ...base,
    result: {
      ...base.result!,
      assessments: base.result!.assessments.map((item, i) =>
        i < 2 ? item : { ...item, checked: true },
      ),
    },
  };
}

describe('vacancyFitSentence: the 29.10 mockup text', () => {
  it('counts every requirement in the profile and names the unchecked ones as a label (01.11)', () => {
    expect(vacancyFitSentence(mockupView())).toBe(
      '12 из 12 требований вакансии есть в профиле. Не проверены квизом: Kafka, Kubernetes.',
    );
  });
  it('drops the second sentence when nothing is unchecked', () => {
    const v = view(
      { coveragePercent: 100, coverage: { matched: 1, total: 3, unknown: 0, checked: 1 } },
      'ready',
      ['A', 'B', 'C'],
    );
    expect(vacancyFitSentence(v)).toBe('1 из 3 требований вакансии есть в профиле.');
  });
});

describe('vacancyFitBoost: the quiz button whenever stated requirements are unchecked', () => {
  it('offers a quiz on the stated skills as a check, not a percent raise (01.11)', () => {
    expect(vacancyFitBoost(mockupView())).toEqual({
      label: 'Проверить навыки: Kafka, Kubernetes',
      skills: ['Kafka', 'Kubernetes'],
    });
  });
  it('has no button when nothing stated is unchecked', () => {
    expect(vacancyFitBoost(view({}, 'ready', ['Java'], []))).toBeNull();
  });
});

describe('29.10 tails', () => {
  it('names one unchecked requirement', () => {
    const v = view(
      { coveragePercent: 90, coverage: { matched: 5, total: 5, unknown: 0, checked: 4 } },
      'ready',
      ['A', 'B', 'C', 'D', 'Опыт'],
      ['r0', 'r1', 'r2', 'r3', 'r4'],
    );
    const marked = {
      ...v,
      result: {
        ...v.result!,
        assessments: v.result!.assessments.map((item, i) =>
          i < 4 ? { ...item, checked: true } : item,
        ),
      },
    };
    expect(vacancyFitSentence(marked)).toBe(
      '5 из 5 требований вакансии есть в профиле. Не проверены квизом: Опыт.',
    );
  });
  it('offers the quiz even when the unchecked requirement is experience', () => {
    const v = view(
      { coveragePercent: 90, coverage: { matched: 5, total: 5, unknown: 0, checked: 4 } },
      'ready',
      ['A', 'B', 'C', 'D', 'Опыт'],
      ['r0', 'r1', 'r2', 'r3', 'r4'],
    );
    const requirements = v.requirements.map((item, i) =>
      i === 4 ? { ...item, kind: 'experience', skill: false } : item,
    ) as typeof v.requirements;
    const marked = {
      ...v,
      requirements,
      result: {
        ...v.result!,
        assessments: v.result!.assessments.map((item, i) =>
          i < 4 ? { ...item, checked: true } : item,
        ),
      },
    };
    expect(vacancyFitBoost(marked)?.label).toBe('Проверить навыки: Опыт');
  });
});

describe('vacancyFitConfidenceHint: few requirements make a rough percent (02.11)', () => {
  it('warns when fewer than six skill requirements were counted', () => {
    const v = view(
      { coveragePercent: 100, coverage: { matched: 4, total: 4, unknown: 0 } },
      'ready',
      ['A', 'B', 'C', 'D'],
    );
    expect(vacancyFitConfidenceHint(v)).toBe(
      'Посчитано всего по 4 требованиям из текста вакансии — процент приблизительный.',
    );
  });
  it('is silent from six requirements on', () => {
    expect(vacancyFitConfidenceHint(mockupView())).toBeNull();
  });
});

describe('vacancyFitConditionBlock: a contradicted condition named next to the percent (02.11)', () => {
  it('names the condition and the profile fact', () => {
    const base = mockupView();
    const v = {
      ...base,
      result: {
        ...base.result!,
        conditionBlocks: [
          {
            requirementId: 'c',
            text: 'US work authorization required',
            quote: 'Vilnius, Lithuania',
          },
        ],
      },
    };
    expect(vacancyFitConditionBlock(v)).toEqual({
      short: 'Не подходит по условиям',
      text: 'Не подходит по условиям: US work authorization required. В профиле: «Vilnius, Lithuania».',
    });
  });
  it('is null without blocks', () => {
    expect(vacancyFitConditionBlock(mockupView())).toBeNull();
  });
});
