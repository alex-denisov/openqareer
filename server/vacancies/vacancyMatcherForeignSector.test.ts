import { describe, expect, it } from 'vitest';
import { candidateRoleFunctionCodes } from './titleParse/candidateRoleFunctions';
import { isForeignSectorTitle } from './foreignSectorTitle';
import { evaluateTitleRole, matchCandidateWithVacancy } from './vacancyMatcher';
import type { VacancyCluster } from '../domain/unifiedVacancy';

/** Роли adenisov.test и строки его подборки на 25.11 (B794). */
const ROLES = [
  'VP of Engineering / Technology',
  'Chief Operating Officer (COO)',
  'Head of IT Operations',
  'Chief Technology Officer',
  'Head of Engineering',
  'Customer Support Director',
  'Head of Operations',
  'IT Director',
  'Chief Customer Officer',
];

const roleOf = (canonicalTitle: string, targetRoles: string[] = ROLES) =>
  matchCandidateWithVacancy(
    {
      candidateId: 'c',
      targetRoles,
      confirmedSkills: [],
      confirmedFacts: [],
      targetLevel: 'vp',
      semanticRoleFunctions: candidateRoleFunctionCodes(targetRoles),
    },
    { id: 'v', canonicalTitle, skills: [] } as unknown as VacancyCluster,
  ).roleMatch;

describe('целевая роль кампании (B794)', () => {
  it.each([
    'Директор по ИТ (CIO)',
    'Директор по информационным технологиям (CIO)',
    'Chief Information Officer',
    'Chief Operating Officer',
    'Операционный директор (COO)',
    'Технический директор (CTO)',
    'Chief Technology Officer',
    'IT Director',
    'Head of Operations',
    'Head of Support',
    'Руководитель службы технической поддержки',
  ])('«%s» — целевая, хотя уровень кандидата VP', (title) => {
    expect(roleOf(title)).toBe('target');
  });

  it('заместитель целевой роли — «частично»', () => {
    expect(roleOf('Заместитель технического директора')).toBe('partial');
    expect(roleOf('Deputy CIO')).not.toBe('target');
  });

  it('роль вне кампании остаётся частичной', () => {
    expect(roleOf('IT Manager')).toBe('partial');
  });
});

describe('чужая сфера (B794)', () => {
  it.each([
    'Операционный директор (строительство/благоустройство частных садов)',
    'Операционный директор (кондитерское направление)',
    'Технический директор (строительство)',
    'Технический директор (ОВиК и ВК)',
    'Associate Director, Clinical Operations',
    'Director, Pharmacovigilance Operations',
    'Исполнительный директор (кредитные риски крупного и среднего бизнеса)',
    'Руководитель службы эксплуатации',
    'Начальник отдела эксплуатации (грузовые автомобили)',
    'Руководитель направления по ЭОМ на строительство ЦОД',
    'Главный инженер по эксплуатации зданий и сооружений ЖКХ',
    'Chief Engineer',
    'Руководитель отдела ОВиК (эксплуатация ЦОД, прецизионные кондиционеры)',
    'Head of Engineering/Technical Lead - Paid Research',
    'Head of Engineering (Volunteer)',
    'Open Application- Business Operations',
  ])('«%s» не входит в подборку', (title) => {
    expect(roleOf(title)).toBe('none');
  });

  it.each([
    'Директор по технологиям (ресторанная сеть)',
    'Head of Engineering, Fleet Management Platform',
    'Head of Engineering, Claims Platform',
    'Директор по эксплуатации облачной платформы',
    'Director of Engineering, Intellectual Property',
    'Заместитель руководителя ИТ-департамента',
    'Заместитель начальника отдела поддержки инфраструктуры',
    'Руководитель внедрения и эксплуатации (Автоматизация)',
    'ИТ-директор ресторанного холдинга',
    'Director of Information Technology (Hospital)',
    'Директор по эксплуатации ИТ-инфраструктуры',
    'Начальник отдела эксплуатации инфраструктурных процессов',
    'Начальник отдела эксплуатации систем обеспечения безопасности информации',
    'Head of IT Infrastructure',
    'Операционный директор (COO) управление флотом (рыбодобыча)',
    'Заместитель технического директора',
    'Head of Operations [MENA]',
  ])('«%s» остаётся', (title) => {
    expect(roleOf(title)).not.toBe('none');
  });

  it('сфера из роли кандидата не чужая', () => {
    const roles = ['Технический директор (строительство)'];
    expect(roleOf('Технический директор (строительство и проектирование)', roles)).not.toBe('none');
  });

  it.each([
    [['Операционный директор'], 'Операционный директор (строительство)'],
    [['Руководитель отдела эксплуатации'], 'Руководитель службы эксплуатации зданий'],
    [['Технический директор'], 'Технический директор (пищевое производство)'],
  ])('кандидату не из ИТ (%s) название «%s» не скрывается по сфере', (roles, title) => {
    expect(isForeignSectorTitle(title, roles)).toBe(false);
  });

  it('выбору резюме hh сфера не мешает', () => {
    const roles = ['Операционный директор'];
    expect(
      evaluateTitleRole(
        'Операционный директор (строительство)',
        roles,
        candidateRoleFunctionCodes(roles),
      ),
    ).not.toBe('none');
  });
});
