import { describe, expect, it } from 'vitest';
import type { VacancyFitView } from '../../../shared/vacancyFit';
import { fitRequirementChips, legacySkillChips } from './vacancyRequirementChips';

function requirement(id: string, text: string) {
  return {
    id,
    text,
    sourceQuote: text,
    origin: 'explicit',
    importance: 'high',
    stopFactor: false,
  } as unknown as VacancyFitView['requirements'][number];
}

describe('fitRequirementChips', () => {
  it('returns null when the fit has no parsed requirements', () => {
    expect(fitRequirementChips(undefined)).toBeNull();
    expect(fitRequirementChips({ state: 'processing', requirements: [] })).toBeNull();
  });

  it('splits requirements into confirmed and unconfirmed by assessment', () => {
    const view = {
      state: 'ready',
      requirements: [requirement('a', 'Kafka'), requirement('b', 'Go'), requirement('c', 'SQL')],
      result: {
        assessments: [
          { requirementId: 'a', status: 'matched', evidence: [], checked: true },
          { requirementId: 'b', status: 'unmatched', evidence: [] },
          { requirementId: 'c', status: 'matched', evidence: [] },
        ],
      },
    } as unknown as VacancyFitView;
    // Owner 29.10: green — checked, yellow — stated without a check, outline — missing.
    expect(fitRequirementChips(view)).toEqual({
      confirmed: ['Kafka'],
      unconfirmed: ['Go'],
      stated: ['SQL'],
      quotes: {},
    });
  });

  it('shows the short label and keeps the sentence for the tooltip (B510)', () => {
    const long =
      'Proven track record as a senior engineering leader - you have owned technical direction';
    const view = {
      state: 'ready',
      requirements: [
        {
          ...requirement('a', 'Strong Kafka skills in event-driven systems at scale'),
          label: 'Kafka',
          skill: true,
        },
        { ...requirement('b', long), skill: false },
        requirement('c', long),
      ],
    } as unknown as VacancyFitView;
    expect(fitRequirementChips(view)).toEqual({
      confirmed: [],
      unconfirmed: ['Kafka'],
      stated: [],
      quotes: { Kafka: 'Strong Kafka skills in event-driven systems at scale' },
    });
  });

  it('drops duplicate requirement texts', () => {
    const view: VacancyFitView = {
      state: 'ready',
      requirements: [requirement('a', 'Kafka'), requirement('b', 'kafka')],
    };
    expect(fitRequirementChips(view)).toEqual({
      confirmed: [],
      unconfirmed: ['Kafka'],
      stated: [],
      quotes: {},
    });
  });
});

it('keeps only skill names on legacy chips, without matcher prefixes or role points (B446-g4)', () => {
  expect(
    legacySkillChips(
      [
        'Целевая роль: Head of Engineering',
        'Подтверждённый навык: Engineering management',
        'Частичное совпадение по роли: CTO',
        'Подтверждённый навык: Платёжные системы',
        'React',
      ],
      ['Kafka', 'Kubernetes'],
    ),
  ).toEqual({
    confirmed: ['Engineering management', 'Платёжные системы', 'React'],
    unconfirmed: ['Kafka', 'Kubernetes'],
  });
});

describe('legacySkillChips sentences (G5 W2)', () => {
  it('never turns a matcher sentence into a chip', () => {
    expect(
      legacySkillChips(['Функция роли и уровень совпадают по разбору названия.', 'AWS'], []),
    ).toEqual({ confirmed: ['AWS'], unconfirmed: [] });
  });
});

describe('fitRequirementChips conditions (G5 item 9)', () => {
  it('lists education apart and never as a skill chip', () => {
    const chips = fitRequirementChips({
      state: 'ready',
      requirements: [
        {
          ...requirement('e', 'Высшее образование'),
          kind: 'education',
          skill: false,
          label: 'Высшее образование',
        },
        { ...requirement('k', 'Kafka'), kind: 'other', skill: true, label: 'Kafka' },
      ],
    } as never);
    expect(chips?.unconfirmed).toEqual(['Kafka']);
    expect(chips?.conditions).toEqual(['Высшее образование']);
  });
});
