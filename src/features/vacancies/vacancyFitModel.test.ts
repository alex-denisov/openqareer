import { describe, expect, it } from 'vitest';
import type { VacancyFitResult, VacancyFitView } from '../../../shared/vacancyFit';
import { vacancyFitBoost, vacancyFitMark, vacancyFitSentence } from './vacancyFitModel';

const matched = { status: 'matched', reason: '' } as const;
const unknown = { status: 'unknown', reason: '' } as const;

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

describe('vacancyFitSentence: built from the server formula', () => {
  it('counts requirements found in the profile and names the rest', () => {
    const v = view(
      { coveragePercent: 50, coverage: { matched: 2, total: 4, unknown: 0 } },
      'ready',
      ['Java', 'Kafka', 'Kubernetes', 'SQL'],
      ['r0', 'r3'],
    );
    expect(vacancyFitSentence(v)).toBe(
      '2 из 4 требований вакансии есть в профиле. Не нашли в профиле: Kafka, Kubernetes — они не засчитаны.',
    );
  });
  it('names unconfirmed key conditions and the ceiling they set', () => {
    const v = view({
      coveragePercent: 80,
      coverage: { matched: 12, total: 12, unknown: 0 },
      gates: { ...view().result!.gates, region: unknown, workAuthorization: unknown },
    });
    expect(vacancyFitSentence(v)).toBe(
      '12 из 12 требований вакансии есть в профиле. Не подтверждены регион и право на работу: процент не выше 80 %.',
    );
  });
});

describe('vacancyFitBoost: the quiz button only with a real skill check and a real gain', () => {
  const v = view(
    { coveragePercent: 50, coverage: { matched: 2, total: 4, unknown: 0 } },
    'ready',
    ['Java', 'Kafka', 'Kubernetes', 'SQL'],
    ['r0', 'r3'],
  );
  it('offers the percent the two unconfirmed skills would give', () => {
    expect(vacancyFitBoost(v, true)).toEqual({
      label: 'Поднять до 100 %: квиз по Kafka и Kubernetes',
      skills: ['Kafka', 'Kubernetes'],
    });
  });
  it('has no button when the skill check cannot start', () => {
    expect(vacancyFitBoost(v, false)).toBeNull();
  });
  it('has no button when nothing is unconfirmed', () => {
    expect(vacancyFitBoost(view({}, 'ready', ['Java'], ['r0']), true)).toBeNull();
  });
});
