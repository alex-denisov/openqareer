import { describe, expect, it } from 'vitest';
import { evaluateSemanticRole } from './vacancyMatcher';
import { candidateRoleFunctionCodes } from './titleParse/candidateRoleFunctions';

/** Кампания adenisov.test из аудита 01.11. */
const roles = [
  'VP of Engineering / Technology',
  'Chief Operating Officer',
  'Директор по ИТ',
  'Директор по клиентскому сервису и технической поддержке',
  'Head of AI',
];
const functions = candidateRoleFunctionCodes(roles);
const roleOf = (title: string) =>
  evaluateSemanticRole(functions, 'c-level', title, roles).roleMatch;

describe('подбор руководителя: смежные функции и не-вакансии (аудит 01.11)', () => {
  it.each([
    'Операционный директор / COO в B2B SaaS-компанию',
    'Директор по информационным технологиям',
    'IT Директор',
    'Chief Technology Officer/CTO iGaming',
    'Операционный директор в брокер',
    'Руководитель IT-поддержки',
    'Head of AI / Руководитель AI-направления',
    'Технический руководитель направления /CTO',
    'Руководитель отдела клиентского обслуживания',
    'Исполнительный директор',
  ])('оставляет «%s»', (title) => {
    expect(roleOf(title)).not.toBe('none');
  });

  it.each([
    'Заместитель начальника ПТО по эксплуатации МКД',
    'Операционный директор по животноводству',
    'Директор по эксплуатации группы ресторанов',
    'Call Center Assistant Operations Manager',
    'Video Study Participant',
    'Customer Success Expression of Interest Form',
    'Site Reliability Engineer Expression of Interest Form',
    'Исполнительный директор (CEO)',
    'Операционный директор сети (общепит)',
  ])('убирает «%s»', (title) => {
    expect(roleOf(title)).toBe('none');
  });
});
