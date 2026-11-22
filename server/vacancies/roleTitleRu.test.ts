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
