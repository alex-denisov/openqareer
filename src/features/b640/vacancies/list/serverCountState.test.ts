import { describe, expect, it } from 'vitest';
import { serverCountState } from './filterOptions';

describe('B726: число подборки с «Датой» в серверном порядке', () => {
  it('итог сервера — число, и ноль тоже; до первой порции числа нет', () => {
    const base = { serverMode: true, dated: true, total: 0, loadingFirst: false };
    expect(serverCountState({ ...base, total: 37 })).toEqual({
      serverKnows: true,
      serverPending: false,
    });
    expect(serverCountState(base)).toEqual({ serverKnows: true, serverPending: false });
    expect(serverCountState({ ...base, loadingFirst: true })).toEqual({
      serverKnows: false,
      serverPending: true,
    });
  });

  it('без «Даты» — как раньше: ноль сервера не число; вне серверного порядка — пул', () => {
    expect(
      serverCountState({ serverMode: true, dated: false, total: 0, loadingFirst: false }),
    ).toEqual({
      serverKnows: false,
      serverPending: false,
    });
    expect(
      serverCountState({ serverMode: false, dated: true, total: 9, loadingFirst: true }),
    ).toEqual({
      serverKnows: false,
      serverPending: false,
    });
  });
});
