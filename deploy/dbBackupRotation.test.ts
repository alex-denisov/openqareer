import { describe, expect, it } from 'vitest';
import { planRotation } from './dbBackupRotation.mjs';

const key = (stamp: string, ext = 'db.zst.age') =>
  `db/${stamp.slice(0, 4)}/${stamp.slice(4, 6)}/openqareer-${stamp}.${ext}`;

/** Ночные копии подряд, по одной на день: 2026-11-30 назад на `days` дней, 02:30 МСК. */
function nightly(days: number): string[] {
  const out: string[] = [];
  for (let back = 0; back < days; back += 1) {
    const day = new Date(Date.UTC(2026, 10, 30 - back));
    const stamp = `${day.toISOString().slice(0, 10).replaceAll('-', '')}-0230`;
    out.push(key(stamp), key(stamp, 'json'));
  }
  return out;
}

describe('B777: ротация ночных копий базы', () => {
  it('хранит 7 последних дней, 4 воскресенья и 6 первых чисел, остальное удаляет вместе с манифестом', () => {
    const plan = planRotation(nightly(200));
    const stamps = [...new Set(plan.keep.map((item) => item.match(/(\d{8})-\d{4}/u)![1]))]
      .sort()
      .reverse();
    expect(stamps.slice(0, 7)).toEqual([
      '20261130',
      '20261129',
      '20261128',
      '20261127',
      '20261126',
      '20261125',
      '20261124',
    ]);
    // Четыре воскресенья: 29.11 (уже в дневных), 22.11, 15.11, 08.11.
    expect(stamps).toEqual(expect.arrayContaining(['20261122', '20261115', '20261108']));
    // Первые числа: 01.11, 01.10, 01.09, 01.08, 01.07, 01.06; 01.05 уже лишнее.
    expect(stamps).toEqual(
      expect.arrayContaining([
        '20261101',
        '20261001',
        '20260901',
        '20260801',
        '20260701',
        '20260601',
      ]),
    );
    expect(stamps).not.toContain('20260501');
    expect(stamps).toHaveLength(7 + 3 + 6);
    expect(plan.keep).toHaveLength(stamps.length * 2);
    expect(plan.remove).toHaveLength(400 - plan.keep.length);
    expect(plan.remove).toContain(key('20261121-0230', 'json'));
  });

  it('несколько копий за день: в дневные идёт последняя, ручная утренняя удаляется', () => {
    const plan = planRotation([key('20261123-1530'), key('20261124-0230'), key('20261123-0230')]);
    expect(plan.keep).toEqual([key('20261124-0230'), key('20261123-1530')]);
    expect(plan.remove).toEqual([key('20261123-0230')]);
  });

  it('чужие ключи не трогает', () => {
    const plan = planRotation(['db/readme.txt', 'other/x', ...nightly(1)]);
    expect(plan.remove).toEqual([]);
    expect(plan.keep).toHaveLength(2);
  });
});
