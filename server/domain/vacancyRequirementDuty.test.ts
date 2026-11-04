import { describe, expect, it } from 'vitest';
import { assessVacancyFit, evaluateVacancyFit, type VacancyFitInput } from './vacancyFit';
import { vacancyDutyIds } from './vacancyRequirementDuty';
import type { VacancyRequirement } from './vacancyRequirements';

const line = (id: string, text: string, extra: Partial<VacancyRequirement> = {}): VacancyRequirement => ({
  id, text, sourceQuote: text, origin: 'explicit', importance: 'high', kind: 'other', hard: false, stopFactor: false, skill: true, ...extra,
});

const TEXT = [
  'Role Summary', 'You will own post-sales success.',
  'Key Responsibilities', '- Carry out on-ground client visits', '- Lead a team of 12+ partners', '- Experience with churn reviews',
  'Desired Experience', '- Salesforce administration', '- Real estate knowledge',
  'Our Principles', '- Think Future First',
].join('\n');

describe('duties apart from requirements', () => {
  it('reads a duty from the list it stands in, in either language', () => {
    const ids = vacancyDutyIds(TEXT, [line('a', 'Carry out on-ground client visits'), line('b', 'Salesforce administration'), line('c', 'Think Future First')]);
    expect([...ids]).toEqual(['a']);
    const russian = 'Основные задачи:\n\n• координация работы ИТ-команды\n\nТребования:\n\n• опыт руководства ИТ';
    expect([...vacancyDutyIds(russian, [line('a', 'координация работы ИТ-команды'), line('b', 'опыт руководства ИТ')])]).toEqual(['a']);
  });
  it('a stated quality stays a requirement even inside a duties list', () => {
    expect(vacancyDutyIds(TEXT, [line('a', 'Experience with churn reviews')]).size).toBe(0);
  });
  it('an unknown heading after a list closes it', () => {
    const text = 'Responsibilities\n- Own the budget\nRequired skills and tools\n- Budget models in Excel';
    expect([...vacancyDutyIds(text, [line('a', 'Own the budget'), line('b', 'Budget models in Excel')])]).toEqual(['a']);
  });
  it('a condition is never a duty', () => {
    expect(vacancyDutyIds(TEXT, [line('a', 'Lead a team of 12+ partners', { kind: 'workFormat', skill: false })]).size).toBe(0);
  });
  it('a text without headings has no duties', () => {
    expect(vacancyDutyIds('Carry out client visits', [line('a', 'Carry out client visits')]).size).toBe(0);
  });
});

const fact = { id: 'f', candidateId: 'c', kind: 'fact', status: 'confirmed', statement: 'Salesforce administration; Real estate; Budget', sourceMessageIds: ['m'], sensitive: false } as const;
const gate = { status: 'unknown', reason: 'x' } as const;
const REQUIREMENTS = [
  line('duty1', 'Carry out on-ground client visits'), line('duty2', 'Lead a team of 12+ partners'),
  line('s1', 'Salesforce administration'), line('s2', 'Real estate knowledge'), line('s3', 'Think Future First'),
];
const fitInput = (overrides: Partial<VacancyFitInput> = {}): VacancyFitInput => ({
  candidateId: 'c', vacancyId: 'v', description: TEXT, requirements: REQUIREMENTS, facts: [fact],
  gates: { role: gate, level: gate, region: gate, workAuthorization: gate, workFormat: gate }, ...overrides,
});
const matched = (requirementId: string) => ({ requirementId, status: 'matched' as const, evidence: [{ factId: 'f', quote: 'Salesforce administration' }] });
const unknown = (requirementId: string) => ({ requirementId, status: 'unknown' as const, evidence: [] });

describe('percent without duties', () => {
  it('an unconfirmed duty does not lower the percent, and an old stored verdict still reads', () => {
    const result = evaluateVacancyFit(fitInput({ assessments: [unknown('duty1'), unknown('duty2'), matched('s1'), matched('s2'), matched('s3')] }));
    expect(result.coveragePercent).toBe(100);
    expect(result.coverage.total).toBe(3);
    expect(result.duties).toEqual(['duty1', 'duty2']);
    expect(result.assessments.map((item) => item.requirementId).sort()).toEqual(['duty1', 'duty2', 's1', 's2', 's3']);
  });
  it('with too few real requirements left the duties count, so the vacancy keeps its percent', () => {
    const requirements = REQUIREMENTS.slice(0, 3);
    const result = evaluateVacancyFit(fitInput({ requirements, assessments: [matched('duty1'), unknown('duty2'), matched('s1')] }));
    expect(result.reason).toBe('assessed');
    expect(result.coverage.total).toBe(3);
    expect(result.duties).toBeUndefined();
  });
  it('the model is not asked about duties', async () => {
    let asked: readonly string[] = [];
    await assessVacancyFit(fitInput(), { assess: async (input) => { asked = input.requirements.map((item) => item.id); return [matched('s1')]; } });
    expect([...asked].sort()).toEqual(['s1', 's2', 's3']);
  });
});
