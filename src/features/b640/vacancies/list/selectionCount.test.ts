import { describe, expect, it } from 'vitest';
import { listCount } from './filterOptions';

const base = { narrowed: false, complete: false, serverMode: false, known: 910, filtered: 40 };

describe('число вакансий подборки', () => {
  it('подборка прочитана не целиком: известный итог', () => {
    expect(listCount({ ...base }).count).toBe(910);
  });

  it('клиентские фильтры или полный пул — столько, сколько показано', () => {
    expect(listCount({ ...base, narrowed: true }).count).toBe(40);
    expect(listCount({ ...base, complete: true }).count).toBe(40);
  });

  it('число не меньше загруженных строк', () => {
    expect(listCount({ ...base, known: 10 }).count).toBe(40);
  });
});
