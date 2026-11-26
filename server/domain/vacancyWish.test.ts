import { describe, expect, it } from 'vitest';
import type { VacancyRequirement } from './vacancyRequirements';
import { vacancyWishIds } from './vacancyWish';
import { evaluateVacancyFit, type VacancyFitInput } from './vacancyFit';

const line = (text: string): VacancyRequirement => ({
  id: text,
  text,
  sourceQuote: text,
  origin: 'explicit',
  importance: 'high',
  kind: 'other',
  hard: false,
  stopFactor: false,
  skill: true,
});
const BASE = ['Управление ИТ', 'Работа с бюджетом', 'Найм инженеров'];
const wishes = (text: string, lines: readonly string[]) => [
  ...vacancyWishIds(text, lines.map(line), () => true),
];

describe('a wish of the vacancy', () => {
  it.each([
    'Опыт в банке будет плюсом',
    'Желательно знание Kubernetes',
    'Опыт с Kafka (желательно)',
    'Experience in SaaS is a plus.',
    'MBA is highly preferred',
    'Nice to have: Terraform',
  ])('«%s»', (text) => expect(wishes('', [...BASE, text])).toEqual([text]));

  it.each([
    'Опыт от 5 лет, желательно в банке',
    'English B2, German is a plus',
    '10+ years in IT. Certified is a plus.',
    'Cloud migrations (Azure; AWS a plus)',
    'Понимание конкурентных преимуществ продукта',
    'Опыт работы в ServiceNow Plus',
  ])('«%s» is no wish', (text) => expect(wishes('', [...BASE, text])).toEqual([]));

  it('reads the section up to the next heading', () =>
    expect(
      wishes(
        `Требования:\n- ${BASE.join('\n- ')}\nБудет плюсом:\n- Опыт с SAP\nУсловия:\n- Опыт с Jira`,
        [...BASE, 'Опыт с SAP', 'Опыт с Jira'],
      ),
    ).toEqual(['Опыт с SAP']));
  it('reads a list whose mark stands on its own line', () =>
    expect(
      wishes(`Preferred skills\n-\n\nSAP\n-\n\nOracle\n\nCompensation\n\n-\n\nBudget`, [
        ...BASE,
        'SAP',
        'Budget',
      ]),
    ).toEqual(['SAP']));
  it('closes at «Required qualifications» right under the heading', () =>
    expect(wishes('Desired Background\nRequired qualifications\n- SAP', [...BASE, 'SAP'])).toEqual(
      [],
    ));
  it('a wish heading over the only list names its requirements', () =>
    expect(wishes(`Будет преимуществом:\n- ${BASE.join('\n- ')}`, BASE)).toEqual([]));
});

const FACT = 'Управление ИТ, бюджет и найм инженеров; SAP';
const gate = { status: 'matched' as const };
function fit(statuses: Readonly<Record<string, 'matched' | 'partial' | 'unmatched'>>) {
  const lines = Object.keys(statuses);
  return evaluateVacancyFit({
    candidateId: 'c',
    vacancyId: 'v',
    description: lines.join('\n'),
    requirements: lines.map(line),
    facts: [
      {
        id: 'f',
        candidateId: 'c',
        statement: FACT,
        status: 'confirmed',
        kind: 'fact',
        sourceMessageIds: ['m'],
        sensitive: false,
      },
    ],
    gates: Object.fromEntries(
      ['role', 'level', 'region', 'workFormat', 'workAuthorization'].map((name) => [name, gate]),
    ),
    assessments: lines.map((id) => ({
      requirementId: id,
      status: statuses[id]!,
      evidence: [{ factId: 'f', quote: FACT }],
    })),
  } as unknown as VacancyFitInput);
}

describe('the percent with a wish', () => {
  const WISH = 'SAP будет плюсом';
  const of = (a: 'matched' | 'unmatched', wish: 'matched' | 'partial' | 'unmatched') =>
    fit({ [BASE[0]!]: 'matched', [BASE[1]!]: a, [BASE[2]!]: 'unmatched', [WISH]: wish });

  it('a missing wish stays out of the count', () => {
    const result = of('matched', 'unmatched');
    expect(result.coveragePercent).toBe(67);
    expect(result.coverage.total).toBe(3);
    expect(result.duties).toEqual([WISH]);
    expect(result.wishes).toEqual([WISH]);
  });
  it('a met wish counts', () => expect(of('matched', 'matched').coveragePercent).toBe(75));
  it('a partial wish never lowers the percent', () => {
    expect(of('matched', 'partial').coveragePercent).toBe(67);
    expect(of('unmatched', 'partial').coveragePercent).toBe(38);
  });
});
