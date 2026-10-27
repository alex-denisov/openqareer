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

describe('careerRoleKey: руководитель одной функции — одна роль (27.10)', () => {
  const same = (a: string, b: string) => expect(careerRoleKey(a)).toBe(careerRoleKey(b));

  it('CIO, IT Director и директор по IT — одна роль', () => {
    expect(careerRoleKey('CIO')).not.toBeNull();
    same('CIO', 'IT Director');
    same('Директор по IT (CIO)', 'ИТ-директор');
    same('Директор по IT', 'Head of IT');
    same('Директор по IT-операциям', 'IT Director');
  });

  it('VP of Customer Support, Customer Support Director и Head of Support — одна роль', () => {
    expect(careerRoleKey('Customer Support Director')).not.toBeNull();
    same('VP of Customer Support', 'Customer Support Director');
    same('Head of Support', 'Руководитель технической поддержки');
    same('Head of Customer Success', 'Director of Customer Support');
  });

  it('Head of AI, VP of AI и Chief AI Officer — одна роль', () => {
    same('Head of AI', 'VP of AI');
    same('Chief AI Officer', 'Director of AI');
  });

  it('руководство бухгалтерией сводится, а специалисты — нет', () => {
    same('Руководитель бухгалтерии', 'Главный бухгалтер');
    expect(careerRoleKey('AI Solutions Architect')).not.toBe(careerRoleKey('Software Engineer'));
  });

  it('Chief of Staff и генеральный директор остаются разными ролями', () => {
    expect(careerRoleKey('Chief of Staff')).not.toBe(careerRoleKey('Генеральный директор'));
  });

  it('руководители разных функций не сводятся', () => {
    expect(careerRoleKey('Head of AI')).not.toBe(careerRoleKey('Head of Support'));
    expect(careerRoleKey('CIO')).not.toBe(careerRoleKey('Chief Operating Officer'));
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
