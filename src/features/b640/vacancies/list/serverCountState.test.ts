import { describe, expect, it } from 'vitest';
import { countPending, serverCountState } from './filterOptions';

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

describe('B791: промежуточного числа подборки нет', () => {
  const ready = {
    rolesReady: true,
    waitingFirst: false,
    serverMode: true,
    serverKnows: true,
    reading: false,
  };

  it('число — когда роли выбраны и сервер ответил, даже если пул ещё перечитывается', () => {
    expect(countPending(ready)).toBe(false);
    expect(countPending({ ...ready, reading: true })).toBe(false);
  });

  it('до выбора ролей, до первой порции и до перечитанного пула числа нет', () => {
    expect(countPending({ ...ready, rolesReady: false })).toBe(true);
    expect(countPending({ ...ready, serverMode: false, waitingFirst: true })).toBe(true);
    expect(countPending({ ...ready, serverKnows: false, reading: true })).toBe(true);
  });
});
