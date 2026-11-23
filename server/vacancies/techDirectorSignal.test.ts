import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hasItSignal,
  needsItSignal,
  primeRoleRequirements,
  setRequirementsReader,
  vacancyInCareerRole,
  type RequirementText,
} from './techDirectorSignal';

const req = (...texts: string[]): RequirementText[] => texts.map((text) => ({ text }));

function item(id: string, canonicalTitle: string, roleMatch: 'target' | 'none' = 'target') {
  return { cluster: { id, canonicalTitle }, explanation: { roleMatch } };
}

afterEach(() => setRequirementsReader(undefined));

/** Читатель пачкой: то, что есть в таблице, по запрошенным id. */
const readerOf =
  (table: ReadonlyMap<string, RequirementText[]>) =>
  (ids: readonly string[]): ReadonlyMap<string, readonly RequirementText[]> =>
    new Map(ids.flatMap((id) => (table.has(id) ? [[id, table.get(id)!] as const] : [])));

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

  it('два навыка одной группы — признак есть: системный администратор (Linux, VMware) — ИТ', () => {
    expect(
      hasItSignal(req('Администрирование Linux', 'VMware и виртуализация'), 'Технический директор'),
    ).toBe(true);
  });

  it('один навык ИТ среди заводских требований — мало', () => {
    expect(
      hasItSignal(
        req('Внедрение ИИ на производстве', 'Ремонт оборудования', 'Охрана труда'),
        'Технический директор',
      ),
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
  const table = new Map<string, RequirementText[]>([
    ['it', req('Микросервисная архитектура', 'Python и PostgreSQL')],
    ['factory', req('Опыт на пищевом производстве', 'Ремонт оборудования')],
  ]);

  it('заводской «Технический директор» уходит из роли CTO, ИТ-шный остаётся', () => {
    setRequirementsReader(readerOf(table));
    expect(vacancyInCareerRole(item('it', 'Технический директор (CTO)'), 'CTO')).toBe(true);
    expect(
      vacancyInCareerRole(item('factory', 'Технический директор (пищевое производство)'), 'CTO'),
    ).toBe(false);
    expect(vacancyInCareerRole(item('none', 'Технический директор (CTO)'), 'CTO')).toBe(true);
    expect(vacancyInCareerRole(item('none-2', 'Технический директор'), 'CTO')).toBe(false);
  });

  it('CTO в названии роли хватает без требований', () => {
    setRequirementsReader(() => new Map());
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
    setRequirementsReader(readerOf(table));
    expect(vacancyInCareerRole(item('it', 'Product Manager'), 'CTO')).toBe(false);
  });
});

describe('primeRoleRequirements: требования одним запросом на чтение подборки (B766)', () => {
  it('один запрос на все общие «Технический директор», CTO в названии его не просит', () => {
    const many = vi.fn(readerOf(new Map([['it', req('Python', 'PostgreSQL')]])));
    setRequirementsReader(many);
    const items = [
      item('it', 'Технический директор (CTO)'),
      item('factory', 'Технический директор (пищевое производство)'),
      item('cto', 'Chief Technology Officer'),
    ];
    primeRoleRequirements(items);
    expect(many).toHaveBeenCalledTimes(1);
    expect(many).toHaveBeenCalledWith(['it', 'factory']);

    expect(items.map((row) => vacancyInCareerRole(row, 'CTO'))).toEqual([true, false, true]);
    expect(many).toHaveBeenCalledTimes(1);
  });

  it('без общих названий запроса нет; не подготовленная вакансия читается сама', () => {
    const many = vi.fn(readerOf(new Map()));
    setRequirementsReader(many);
    primeRoleRequirements([item('cto', 'CTO')]);
    expect(many).not.toHaveBeenCalled();
    expect(vacancyInCareerRole(item('late', 'Технический директор'), 'CTO')).toBe(false);
    expect(many).toHaveBeenCalledWith(['late']);
  });

  it('следующее чтение подборки читает требования заново', () => {
    const table = new Map<string, RequirementText[]>();
    setRequirementsReader(readerOf(table));
    primeRoleRequirements([item('new', 'Технический директор')]);
    expect(vacancyInCareerRole(item('new', 'Технический директор'), 'CTO')).toBe(false);
    table.set('new', req('Kubernetes', 'Go'));
    primeRoleRequirements([item('new', 'Технический директор')]);
    expect(vacancyInCareerRole(item('new', 'Технический директор'), 'CTO')).toBe(true);
  });
});

describe('B741: «go-to-market» — не навык ИТ', () => {
  it('go-to-market и go live с одним облаком — признака ИТ нет', () => {
    expect(
      hasItSignal(
        req('Own the go-to-market strategy and go live plan', 'AWS budget'),
        'Технический директор',
      ),
    ).toBe(false);
  });
  it('язык Go с облаком — признак ИТ есть', () => {
    expect(hasItSignal(req('Backend: Go', 'AWS'), 'Технический директор')).toBe(true);
  });
});
