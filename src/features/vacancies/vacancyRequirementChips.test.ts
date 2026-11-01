import { describe, expect, it } from 'vitest';
import type { VacancyFitView } from '../../../shared/vacancyFit';
import {
  conditionCoverageWithGeo,
  fitRequirementChips,
  legacySkillChips,
} from './vacancyRequirementChips';

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

  it('lists every counted skill requirement, so the count and the chips agree (02.11)', () => {
    const long = 'Системное мышление и умение выстраивать процессы на уровне всей компании';
    const view = {
      state: 'ready',
      requirements: [
        { ...requirement('a', 'Kafka streams'), label: 'Kafka', skill: true },
        { ...requirement('b', 'Kafka Connect'), label: 'Kafka', skill: true },
        { ...requirement('c', long), skill: true },
      ],
      result: { assessments: [] },
    } as unknown as VacancyFitView;
    const chips = fitRequirementChips(view)!;
    expect(chips.unconfirmed).toHaveLength(3);
    expect(chips.unconfirmed[2].length).toBeLessThanOrEqual(41);
  });

  it('while no requirement has a short name yet, shows no sentence chips (B510 pending state)', () => {
    const long = 'Системное мышление и умение выстраивать процессы на уровне всей компании';
    const view = {
      state: 'ready',
      requirements: [requirement('a', long), requirement('b', `${long} и команды`)],
      result: { assessments: [] },
    } as unknown as VacancyFitView;
    expect(fitRequirementChips(view)?.unconfirmed).toEqual([]);
  });

  it('keeps partial matches apart from stated ones, so the card can tell them apart (02.11)', () => {
    const view = {
      state: 'ready',
      requirements: [requirement('a', 'Kafka'), requirement('b', 'Go')],
      result: {
        assessments: [
          { requirementId: 'a', status: 'partial', evidence: [] },
          { requirementId: 'b', status: 'matched', evidence: [] },
        ],
      },
    } as unknown as VacancyFitView;
    expect(fitRequirementChips(view)).toMatchObject({ partial: ['Kafka'], stated: ['Go'] });
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
      // 02.11: the unnamed sentence is counted, so it shows shortened, the full text in the tooltip.
      unconfirmed: ['Kafka', 'Proven track record as a senior enginee…'],
      stated: [],
      quotes: {
        Kafka: 'Strong Kafka skills in event-driven systems at scale',
        'Proven track record as a senior enginee…': long,
      },
    });
  });

  // 02.11: both are counted by the percent, so both are listed (was: duplicate dropped).
  it('keeps a repeated requirement text as its own chip', () => {
    const view: VacancyFitView = {
      state: 'ready',
      requirements: [requirement('a', 'Kafka'), requirement('b', 'kafka')],
    };
    expect(fitRequirementChips(view)).toEqual({
      confirmed: [],
      unconfirmed: ['Kafka', 'kafka · 2'],
      stated: [],
      quotes: { 'kafka · 2': 'kafka' },
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

describe('conditionCoverageWithGeo', () => {
  const kirov = {
    ...requirement('loc', 'Работа в Кирове'),
    kind: 'other',
    skill: false,
    label: 'Работа в Кирове',
  } as VacancyFitView['requirements'][number];
  const view = (status: 'unknown' | 'matched') =>
    ({
      state: 'ready',
      requirements: [kirov],
      result: {
        assessments: [{ requirementId: 'loc', status, evidence: [] }],
        conditionCoverage: { matched: status === 'matched' ? 1 : 0, total: 1, unknown: 1 },
      },
    }) as unknown as VacancyFitView;

  it('город условия совпал по «Гео» — условие подтверждено', () => {
    expect(
      conditionCoverageWithGeo(view('unknown'), { geoMatched: true, location: 'Киров' }),
    ).toEqual({
      matched: 1,
      total: 1,
    });
  });

  it('без совпадения «Гео» или в другом городе — как посчитал сервер', () => {
    expect(
      conditionCoverageWithGeo(view('unknown'), { geoMatched: false, location: 'Киров' }),
    ).toEqual({
      matched: 0,
      total: 1,
    });
    expect(
      conditionCoverageWithGeo(view('unknown'), { geoMatched: true, location: 'Пермь' }),
    ).toEqual({
      matched: 0,
      total: 1,
    });
  });

  it('уже подтверждённое сервером не считается дважды', () => {
    expect(
      conditionCoverageWithGeo(view('matched'), { geoMatched: true, location: 'Киров' }),
    ).toEqual({
      matched: 1,
      total: 1,
    });
  });
});
