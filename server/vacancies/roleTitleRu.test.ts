import { describe, expect, it } from 'vitest';
import { roleTitleRu, roleTitlesRu } from './roleTitleRu';

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
  it('онтология важнее; без онтологии — проверенный перевод этого кандидата; иначе исходное', () => {
    const own = {
      'Head of IT Service Management': 'Руководитель ИТ-сервиса (IT)',
      COO: 'Директор по операциям (COO)',
    };
    expect(roleTitleRu('Head of IT Service Management', own)).toBe('Руководитель ИТ-сервиса (IT)');
    expect(roleTitleRu('head of it service management ', own)).toBe('Руководитель ИТ-сервиса (IT)');
    expect(roleTitleRu('COO', own)).toBe('Операционный директор (COO)');
    expect(roleTitleRu('Co-Founder', own)).toBe('Co-Founder');
    expect(roleTitlesRu(['Head of IT Service Management', 'Co-Founder'], own)).toEqual({
      'Head of IT Service Management': 'Руководитель ИТ-сервиса (IT)',
    });
  });

  it('перевод одного кандидата не виден другому: общего словаря нет', () => {
    roleTitlesRu(['Head of Quantum Ops'], {
      'Head of Quantum Ops': 'Руководитель квантовых операций',
    });
    expect(roleTitleRu('Head of Quantum Ops')).toBe('Head of Quantum Ops');
  });

  it('Head of IT Operations — эксплуатация, а не инфраструктура (B748, 22.11)', () => {
    expect(roleTitleRu('Head of IT Operations')).toBe('Руководитель ИТ-эксплуатации');
  });
});
