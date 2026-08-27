import { describe, expect, it } from 'vitest';
import { pluralRu } from './pluralRu';

describe('pluralRu', () => {
  const forms: [string, string, string] = ['пробел', 'пробела', 'пробелов'];

  it('correctly handles required Russian numerical cases', () => {
    expect(pluralRu(0, forms)).toBe('0 пробелов');
    expect(pluralRu(1, forms)).toBe('1 пробел');
    expect(pluralRu(2, forms)).toBe('2 пробела');
    expect(pluralRu(4, forms)).toBe('4 пробела');
    expect(pluralRu(5, forms)).toBe('5 пробелов');
    expect(pluralRu(11, forms)).toBe('11 пробелов');
    expect(pluralRu(12, forms)).toBe('12 пробелов');
    expect(pluralRu(14, forms)).toBe('14 пробелов');
    expect(pluralRu(21, forms)).toBe('21 пробел');
    expect(pluralRu(22, forms)).toBe('22 пробела');
    expect(pluralRu(25, forms)).toBe('25 пробелов');
    expect(pluralRu(101, forms)).toBe('101 пробел');
    expect(pluralRu(111, forms)).toBe('111 пробелов');
  });
});
