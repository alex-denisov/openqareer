import { afterEach, describe, expect, it } from 'vitest';
import { markCareer } from './loadMarks';

const marks = (part: string) => performance.getEntriesByName(`b792:career:${part}`, 'mark');

describe('B792: метки частей «Карьеры»', () => {
  afterEach(() => performance.clearMarks());

  it('ставит метку части один раз за загрузку', () => {
    markCareer('role');
    markCareer('role');
    expect(marks('role')).toHaveLength(1);
    expect(marks('roles')).toHaveLength(0);
  });
});
