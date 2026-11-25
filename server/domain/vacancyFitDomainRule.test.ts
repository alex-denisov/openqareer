import { describe, expect, it } from 'vitest';
import { withDomainRule } from './vacancyFitDomainRule';

const FACTS = [
  'VP of Technology — Энергия; DevOps, Microsoft Dynamics AX',
  'IT-консалтинг в ритейле',
];
const after = (text: string, status: 'matched' | 'partial' | 'unmatched' = 'matched') =>
  withDomainRule(
    { requirementId: 'r', status, evidence: [{ factId: 'f', quote: 'DevOps' }] },
    text,
    FACTS,
  ).status;

describe('B794: an industry, a tool or an exclusion the profile does not show', () => {
  it.each([
    'Successful experience (COO, Head of Operations) in 360 advertising agencies',
    'Опыт работы в банке от 3 лет',
    'Опыт проектов для банков и страховых компаний',
  ])('«%s» is partial at most', (text) => {
    expect(after(text)).toBe('partial');
    expect(after(text, 'partial')).toBe('partial');
  });

  it.each([
    'Навыки работы с Terraform/tofu',
    'Опыт поддержки пользователей 1С',
    'Знание Битрикс24',
  ])('«%s» is unknown without the tool', (text) => {
    expect(after(text)).toBe('unknown');
    expect(after(text, 'partial')).toBe('unknown');
  });

  it('an exclusion is met by no quote', () =>
    expect(after('Experience gained solely within developers will not be considered')).toBe(
      'unknown',
    ));

  it.each([
    'Опыт работы в ритейле',
    'Практический опыт работы с Kubernetes и контейнерной инфраструктурой',
    'Опыт в банке или сопоставимой компании',
    'Experience in banking or another regulated industry',
    'Опыт в банковском секторе будет преимуществом',
    'Опыт с SAP, Dynamics AX',
    'Высокая ответственность за результат всех клиник сети',
    'Понимание процедуры банкротства',
  ])('leaves «%s» to the model', (text) => expect(after(text)).toBe('matched'));

  it('a contradicted line stays contradicted', () =>
    expect(after('Опыт работы в банке', 'unmatched')).toBe('unmatched'));
});
