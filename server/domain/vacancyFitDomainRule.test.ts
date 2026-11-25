import { describe, expect, it } from 'vitest';
import { namesUnknownIndustry, withDomainRule } from './vacancyFitDomainRule';

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

  it.each(['Сбербанк', 'Газпромбанк', 'Sberbank', 'Банк ВТБ', 'Почта Банк'])(
    '«%s» in the profile shows a bank',
    (employer) =>
      expect(namesUnknownIndustry('Опыт работы в банке', [`Head of IT — ${employer}`])).toBe(false),
  );
  it.each([
    'Организация банкетов',
    'Ведение банка данных',
    'Процедура банкротства',
    'Data embankment',
  ])('«%s» in the profile shows no bank', (fact) =>
    expect(namesUnknownIndustry('Опыт работы в банке', [fact])).toBe(true),
  );
  it.each(['Опыт работы в УК', 'Опыт руководства в НКО'])('«%s» names an industry', (text) =>
    expect(namesUnknownIndustry(text, ['Head of IT'])).toBe(true),
  );
  it('УК and НКО match as whole words', () => {
    expect(namesUnknownIndustry('Опыт работы на Украине', ['Head of IT'])).toBe(false);
    expect(namesUnknownIndustry('Знание УК РФ', ['Head of IT'])).toBe(false);
    expect(namesUnknownIndustry('Опыт работы в НКО', ['НКО «Помощь»'])).toBe(false);
  });

  it('a contradicted line stays contradicted', () =>
    expect(after('Опыт работы в банке', 'unmatched')).toBe('unmatched'));
});
