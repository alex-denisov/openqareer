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

describe('careerRoleKey: одна роль — один смысл и один уровень (27.10)', () => {
  const same = (a: string, b: string) => expect(careerRoleKey(a)).toBe(careerRoleKey(b));
  const differ = (a: string, b: string) => expect(careerRoleKey(a)).not.toBe(careerRoleKey(b));

  it('CIO, IT Director и директор по IT — первое лицо IT, одна роль', () => {
    expect(careerRoleKey('CIO')).not.toBeNull();
    same('CIO', 'IT Director');
    same('Директор по IT (CIO)', 'ИТ-директор');
    same('Директор по IT', 'Директор по информационным технологиям');
    same('Директор по IT-операциям', 'IT Director');
  });

  it('руководитель направления внутри IT — не CIO', () => {
    differ('Head of IT Service Management', 'CIO');
    differ('Head of IT Service Management', 'IT Director');
  });

  it('VP of Customer Support и Customer Support Director — одна роль, Head of Support ниже', () => {
    expect(careerRoleKey('Customer Support Director')).not.toBeNull();
    same('VP of Customer Support', 'Customer Support Director');
    same('Head of Support', 'Руководитель технической поддержки');
    differ('Head of Support', 'Customer Support Director');
  });

  it('Head of AI и Head of AI Engineering — одна роль; VP of AI и Chief AI Officer выше', () => {
    same('Head of AI', 'Head of AI Engineering');
    same('Head of AI', 'Руководитель направления AI');
    same('Chief AI Officer', 'VP of AI');
    differ('Head of AI', 'VP of AI');
  });

  it('руководство бухгалтерией сводится, финансовый директор выше, специалисты — нет', () => {
    same('Руководитель бухгалтерии', 'Главный бухгалтер');
    same('Финансовый директор', 'CFO');
    differ('Главный бухгалтер', 'CFO');
    expect(careerRoleKey('AI Solutions Architect')).not.toBe(careerRoleKey('Software Engineer'));
  });

  it('Chief of Staff и генеральный директор остаются разными ролями', () => {
    differ('Chief of Staff', 'Генеральный директор');
  });

  it('производственный и технический директор — разные роли', () => {
    differ('Производственный директор', 'Технический директор');
  });

  it('руководители разных функций не сводятся', () => {
    differ('Head of AI', 'Head of Support');
    differ('CIO', 'Chief Operating Officer');
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

describe('careerRoleKey: название вне словаря (27.10)', () => {
  it('расшифровка в скобках не делает вторую роль', () => {
    expect(careerRoleKey('Исполнительный директор (CEO)')).not.toBeNull();
    expect(careerRoleKey('Исполнительный директор (CEO)')).toBe(
      careerRoleKey('Исполнительный директор'),
    );
  });

  it('разные названия вне словаря остаются разными', () => {
    expect(careerRoleKey('Исполнительный директор')).not.toBe(careerRoleKey('Chief of Staff'));
  });
});
