import { describe, expect, it } from 'vitest';
import { impliedSoftRole, isCompensationLine, isSoftRequirementText } from './vacancyRequirementKind';

describe('soft requirement classifier', () => {
  it.each([
    'Verbal communication', 'Excellent written and verbal communication skills', 'Strong communication',
    'Коммуникативные навыки', 'Навыки коммуникации', 'Teamwork', 'Командная работа', 'Умение работать в команде',
    'Leadership', 'Problem solving', 'Problem-solving skills', 'Multitasking', 'Многозадачность',
    'Attention to detail', 'Внимательность к деталям', 'Stress resistance', 'Стрессоустойчивость',
    'Adaptability', 'Time management', 'Тайм-менеджмент', 'Ответственность', 'Обучаемость', 'Self-motivated',
  ])('%s is soft', (text) => expect(isSoftRequirementText(text)).toBe(true));
  it.each([
    'TypeScript', '5+ years of leadership experience', 'Budget management', 'ITIL', 'Управление командой разработки 5 лет',
    'Experience with Zendesk', 'Communications infrastructure design',
  ])('%s is not soft', (text) => expect(isSoftRequirementText(text)).toBe(false));
});

describe('compensation lines are not requirements', () => {
  it.each([
    'Pay: $120,000 - $150,000 per year', '$80,000/year', '$45 an hour', 'Benefits', 'Benefits: health, dental, 401(k)',
    'Зарплата от 200 000 ₽', 'ДМС после испытательного срока', 'Salary: competitive', 'Schedule: Monday to Friday',
  ])('%s is excluded', (text) => expect(isCompensationLine(text)).toBe(true));
  it.each(['Experience with benefits administration', '5 years in customer operations', 'Опыт управления бюджетом'])('%s stays', (text) => expect(isCompensationLine(text)).toBe(false));
});

describe('implied soft skill from experience', () => {
  it('names the leading role', () => {
    expect(impliedSoftRole(['Head of VIP IT Support at Acme, 2018-2023'])).toBe('Head of VIP IT Support at Acme');
    expect(impliedSoftRole(['Руководитель отдела поддержки клиентов'])).toMatch(/^Руководитель отдела/u);
  });
  it('is absent without a leading role or client work', () => {
    expect(impliedSoftRole(['Wrote TypeScript services', 'Built a data pipeline'])).toBeUndefined();
  });
  it('picks the client-facing experience role for communication, not the headline', () => {
    const facts = [
      { id: 'profile:headline', statement: 'VP of Technology &amp; Operations | Ex-Co-Founder ($50M' },
      { id: 'profile:experience:1', statement: 'Director of Engineering — Acme; 2015-2018; built platform' },
      { id: 'm1', statement: 'Head of VIP IT Support — Kaspersky' },
    ];
    expect(impliedSoftRole(facts, 'Verbal communication')).toBe('Head of VIP IT Support — Kaspersky');
  });
  it('uses the most senior experience role otherwise and joins title and employer', () => {
    const facts = [{ id: 'profile:experience:1', statement: 'Head of VIP IT Support — Лаборатория Касперского; 2018-2023; клиенты' }];
    expect(impliedSoftRole(facts, 'Strong ownership')).toBe('Head of VIP IT Support, Лаборатория Касперского');
  });
  it('names the strongest role, not the first one that mentions leading (04.11)', () => {
    const facts = [
      { id: 'profile:experience:1', statement: 'Independent AI Consultant — OptiLab AI; 2025; lead architecture for clients' },
      { id: 'profile:experience:2', statement: 'VP of Technology & IT Operations — Enterprise Energy; 2023-2025; команда 250; clients' },
      { id: 'profile:experience:3', statement: 'Head of Technical Support — Cloud; 2019-2023; команда 80; clients' },
      { id: 'profile:experience:4', statement: 'Co-Founder & COO — Fishance; 2016-2019; команда 30; clients' },
    ];
    const strongest = 'VP of Technology & IT Operations, Enterprise Energy';
    expect(impliedSoftRole(facts, 'Лидерство')).toBe(strongest);
    expect(impliedSoftRole(facts, 'Verbal communication')).toBe(strongest);
  });
  it('an experience role outranks a dossier line with a louder word', () => {
    const facts = [
      { id: 'm1', statement: 'Chief of staff duties were discussed in chat' },
      { id: 'profile:experience:1', statement: 'Head of Support — Acme; 2020' },
    ];
    expect(impliedSoftRole(facts, 'Teamwork')).toBe('Head of Support, Acme');
  });
  it('headline is the last resort: no bar, bracket or entity', () => {
    const role = impliedSoftRole([{ id: 'profile:headline', statement: 'VP of Technology &amp; Operations | Ex-Co-Founder ($50M' }], 'Teamwork');
    expect(role).toBe('VP of Technology & Operations');
  });
  it('never cuts a long role in the middle of a word', () => {
    const role = impliedSoftRole([{ id: 'profile:experience:1', statement: 'Director of International Strategic Partnerships and Enterprise Transformation — Contoso; 2020' }]) ?? '';
    expect(role.length).toBeLessThanOrEqual(80);
    expect(role).toMatch(/(Enterprise|Transformation|Partnerships|and)$/u);
  });
});
