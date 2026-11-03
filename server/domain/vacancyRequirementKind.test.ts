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
});
