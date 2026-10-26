import { describe, expect, it } from 'vitest';
import { careerRoleKey, sameCareerRole } from './careerRoleKey';

describe('careerRoleKey', () => {
  it('одна функция и уровень под разными названиями — один ключ', () => {
    expect(careerRoleKey('Технический директор')).toBe(careerRoleKey('Технический директор (CTO)'));
    const coo = careerRoleKey('Операционный директор (COO)');
    expect(coo).not.toBeNull();
    expect(careerRoleKey('Chief Operating Officer')).toBe(coo);
    expect(careerRoleKey('Операционный директор')).toBe(coo);
  });

  it('разные функции не сводятся', () => {
    expect(careerRoleKey('Технический директор')).not.toBe(careerRoleKey('Операционный директор'));
    expect(careerRoleKey('Head of AI')).not.toBe(careerRoleKey('Customer Support Director'));
  });
});

describe('sameCareerRole', () => {
  it('вакансия под другим названием той же роли относится к роли', () => {
    expect(sameCareerRole('Chief Operating Officer', 'Операционный директор (COO)')).toBe(true);
    expect(sameCareerRole('Технический директор (CTO)', 'Технический директор')).toBe(true);
  });

  it('сохраняет прежнее совпадение по словам и не путает функции', () => {
    expect(sameCareerRole('Senior Head of Engineering', 'Head of Engineering')).toBe(true);
    expect(sameCareerRole('Chief Operating Officer', 'Технический директор')).toBe(false);
  });
});
