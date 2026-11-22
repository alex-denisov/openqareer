import { describe, expect, it } from 'vitest';
import { rememberRoleTitlesRu, roleTitleRu, roleTitlesRu } from './roleTitleRu';

describe('B737: русское название роли поиска', () => {
  it('английское название онтологии → titleRu', () => {
    expect(roleTitleRu('Chief Operating Officer')).toBe('Операционный директор (COO)');
    expect(roleTitleRu('  chief operating officer ')).toBe('Операционный директор (COO)');
  });

  it('русское и неизвестное название остаются как есть', () => {
    expect(roleTitleRu('Операционный директор (COO)')).toBe('Операционный директор (COO)');
    expect(roleTitleRu('Директор по чудесам')).toBe('Директор по чудесам');
    expect(roleTitleRu('')).toBe('');
  });

  it('словарь — только названия, у которых есть русское', () => {
    expect(roleTitlesRu(['Chief Operating Officer', 'Директор по чудесам'])).toEqual({
      'Chief Operating Officer': 'Операционный директор (COO)',
    });
  });
});

describe('B748: русские названия ролей, придуманных моделью', () => {
  it('онтология важнее; без онтологии — запомненный проверенный перевод; иначе исходное', () => {
    rememberRoleTitlesRu([
      { title: 'Head of IT Service Management', titleRu: 'Руководитель ИТ-сервиса (IT)' },
      { title: 'COO', titleRu: 'Директор по операциям (COO)' },
      { title: 'Co-Founder' },
    ]);
    expect(roleTitleRu('Head of IT Service Management')).toBe('Руководитель ИТ-сервиса (IT)');
    expect(roleTitleRu('head of it service management ')).toBe('Руководитель ИТ-сервиса (IT)');
    expect(roleTitleRu('COO')).toBe('Операционный директор (COO)');
    expect(roleTitleRu('Co-Founder')).toBe('Co-Founder');
    expect(roleTitlesRu(['Head of IT Service Management', 'Co-Founder'])).toEqual({
      'Head of IT Service Management': 'Руководитель ИТ-сервиса (IT)',
    });
  });
});
