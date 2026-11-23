import { afterEach, describe, expect, it } from 'vitest';
import {
  hasItSignal,
  needsItSignal,
  setRequirementsReader,
  vacancyInCareerRole,
  type RequirementText,
} from './techDirectorSignal';

const req = (...texts: string[]): RequirementText[] => texts.map((text) => ({ text }));

function item(id: string, canonicalTitle: string, roleMatch: 'target' | 'none' = 'target') {
  return { cluster: { id, canonicalTitle }, explanation: { roleMatch } };
}

afterEach(() => setRequirementsReader(undefined));

describe('needsItSignal: «Технический директор» без CTO в названии (B766)', () => {
  it('общее «Технический директор» и «Technical Director» требуют признака ИТ', () => {
    for (const title of [
      'Технический директор',
      'Технический директор (CTO)',
      'Технический директор - главный инженер кондитерской фабрики',
      'Technical Director - Electrical',
    ])
      expect(needsItSignal(title)).toBe(true);
  });

  it('CTO и Chief Technology Officer вне скобок — роль ясна и без требований', () => {
    for (const title of [
      'CTO/Технический директор',
      'Chief Technology Officer / Технический директор',
      'CTO',
      'VP of Engineering',
    ])
      expect(needsItSignal(title)).toBe(false);
  });
});

describe('hasItSignal: два навыка ИТ в требованиях, без требований — пометка в названии', () => {
  it('ИТ-требования из двух групп словаря — признак есть', () => {
    expect(
      hasItSignal(
        req('Опыт с Kubernetes и AWS', 'Построение процессов разработки', 'Управление командой'),
        'Технический директор (CTO)',
      ),
    ).toBe(true);
  });

  it('одна группа словаря — мало: системный администратор не CTO', () => {
    expect(
      hasItSignal(req('Администрирование Linux', 'VMware и виртуализация'), 'Технический директор'),
    ).toBe(false);
  });

  it('заводские требования — признака нет, «(CTO)» в названии его не спасает', () => {
    expect(
      hasItSignal(
        req('Опыт на молочном производстве', 'Руководство техническими службами'),
        'Технический директор (CTO)',
      ),
    ).toBe(false);
  });

  it('без требований решает пометка ИТ в названии', () => {
    expect(hasItSignal([], 'Технический директор (CTO)')).toBe(true);
    expect(hasItSignal(null, 'Технический директор по разработке')).toBe(true);
    expect(hasItSignal([], 'Technical Director (AI)')).toBe(true);
    expect(hasItSignal([], 'Технический директор (ЖКХ)')).toBe(false);
    expect(hasItSignal(null, 'Technical Director - Electrical')).toBe(false);
  });
});

describe('vacancyInCareerRole: роль кандидата с признаком ИТ (B766)', () => {
  const reader = new Map<string, RequirementText[] | null>([
    ['it', req('Микросервисная архитектура', 'Python и PostgreSQL')],
    ['factory', req('Опыт на пищевом производстве', 'Ремонт оборудования')],
  ]);

  it('заводской «Технический директор» уходит из роли CTO, ИТ-шный остаётся', () => {
    setRequirementsReader((id) => reader.get(id) ?? null);
    expect(vacancyInCareerRole(item('it', 'Технический директор (CTO)'), 'CTO')).toBe(true);
    expect(
      vacancyInCareerRole(item('factory', 'Технический директор (пищевое производство)'), 'CTO'),
    ).toBe(false);
    expect(vacancyInCareerRole(item('none', 'Технический директор (CTO)'), 'CTO')).toBe(true);
    expect(vacancyInCareerRole(item('none-2', 'Технический директор'), 'CTO')).toBe(false);
  });

  it('CTO в названии роли хватает без требований', () => {
    setRequirementsReader(() => null);
    expect(vacancyInCareerRole(item('x', 'Chief Technology Officer'), 'CTO')).toBe(true);
  });

  it('без читателя требований — прежнее совпадение по названию', () => {
    expect(
      vacancyInCareerRole(item('factory', 'Технический директор (пищевое производство)'), 'CTO'),
    ).toBe(true);
  });

  it('хранилища требований в процессе нет — прежнее совпадение по названию', () => {
    setRequirementsReader(() => undefined);
    expect(
      vacancyInCareerRole(item('factory', 'Технический директор (пищевое производство)'), 'CTO'),
    ).toBe(true);
  });

  it('вакансия не той роли не проходит, как раньше', () => {
    setRequirementsReader((id) => reader.get(id) ?? null);
    expect(vacancyInCareerRole(item('it', 'Product Manager'), 'CTO')).toBe(false);
  });
});
