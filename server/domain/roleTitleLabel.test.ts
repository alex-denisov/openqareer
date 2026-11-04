import { describe, expect, it } from 'vitest';
import { isRoleTitleLabel } from './roleTitleLabel';

describe('isRoleTitleLabel', () => {
  it.each([
    'CTO',
    'cio',
    'Chief Technology Officer',
    'Chief-Operating-Officer',
    'VP',
    'VP-Of-Engineering',
    'VP Engineering',
    'VP, Engineering',
    'Director, Engineering',
    'SVP-Of-Engineering',
    'Vice-President-Of-Engineering',
    'Director-of-Engineering',
    'Director-Customer-Success',
    'Customer-Success-Director',
    'AI-Products-Director',
    'Head-Of-AI',
    'Head of Engineering',
    'Engineering Manager',
    'Project-Manager',
    'Customer-Success-Manager',
    'Customer-Support-Lead',
    'Solutions-Architect',
    'Full-Stack-Developer',
    'Tech Lead',
    'Тимлид',
    'Технический директор',
    'Директор по ИТ',
    'Вице-президент по технологиям',
    'Руководитель проектов',
    'Начальник отдела',
  ])('%s is a job title', (label) => {
    expect(isRoleTitleLabel(label)).toBe(true);
  });

  it.each([
    'AWS',
    'AI',
    'CRO',
    'VPN',
    'VPC',
    'Docker',
    'CTO-office tooling',
    'Headcount planning',
    'Head and neck surgery',
    'Director-level communication',
    'Board of Directors',
    'Art direction',
    'Project Management',
    'Engineering Leadership',
    'Google Tag Manager',
    'Package Manager',
    'Customer Relationship Manager software',
    'Reverse-Engineering',
    'Full-Stack Development',
    'Team Leadership',
    'Управление командой',
    'Руководство проектами',
    'Работа с директорами',
    'Отчётность директору',
  ])('%s is not a job title', (label) => {
    expect(isRoleTitleLabel(label)).toBe(false);
  });
});
