import { describe, expect, it } from 'vitest';
import { PRIVATE_EMPLOYER } from '../../shared/privateEmployer';
import { isPrivateEmployerCluster, maskPrivateEmployers } from './privateEmployerMask';

/** CPO 26.10: ФИО работодателя с hh не показывается в «Вакансиях» и «Компаниях» (INC-023, как #100). */
describe('maskPrivateEmployers', () => {
  const item = (canonicalCompany: string, employerIsPerson?: boolean) => ({
    cluster: {
      id: canonicalCompany,
      canonicalCompany,
      ...(employerIsPerson ? { employerIsPerson } : {}),
    },
    explanation: {},
  });

  it('replaces a person name by the platform flag or by its shape', () => {
    const masked = maskPrivateEmployers([
      item('Матузова Олеся Васильевна'),
      item('Иван Петров', true),
      item('Яндекс'),
    ]);
    expect(masked.map((entry) => entry.cluster.canonicalCompany)).toEqual([
      PRIVATE_EMPLOYER,
      PRIVATE_EMPLOYER,
      'Яндекс',
    ]);
    expect(masked[0]!.cluster.employerIsPerson).toBe(true);
  });

  it('keeps a private employer out of the companies list', () => {
    expect(isPrivateEmployerCluster({ canonicalCompany: 'Матузова Олеся Васильевна' })).toBe(true);
    expect(
      isPrivateEmployerCluster({ canonicalCompany: PRIVATE_EMPLOYER, employerIsPerson: true }),
    ).toBe(true);
    expect(isPrivateEmployerCluster({ canonicalCompany: 'Рабинович Групп' })).toBe(false);
  });
});
