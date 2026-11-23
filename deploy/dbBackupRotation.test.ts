import { describe, expect, it } from 'vitest';
import { backupKey, planRotation } from './dbBackupRotation.mjs';

const users = (stamp: string, ext = 'db.zst.age') => backupKey('users', stamp, ext);
const full = (stamp: string, ext = 'db.zst.age') => backupKey('full', stamp, ext);

/** Ночные копии подряд по одной на день: 2026-11-30 назад на `days` дней, 02:30 МСК. */
function stamps(days: number): string[] {
  return Array.from({ length: days }, (_, back) => {
    const day = new Date(Date.UTC(2026, 10, 30 - back));
    return `${day.toISOString().slice(0, 10).replaceAll('-', '')}-0230`;
  });
}

const dates = (keys: readonly string[]) => [
  ...new Set(keys.map((key) => key.match(/(\d{8})-\d{4}/u)![1])),
];

describe('B777: ротация копий базы', () => {
  it('ключ: уровень, год и месяц в пути, отметка времени МСК в имени', () => {
    expect(users('20261124-0230')).toBe(
      'db/users/2026/11/openqareer-users-20261124-0230.db.zst.age',
    );
    expect(full('20261129-0230', 'json')).toBe(
      'db/full/2026/11/openqareer-full-20261129-0230.json',
    );
  });

  it('незаменимые данные: 14 последних дней и 6 первых чисел, архив уходит вместе с манифестом', () => {
    const keys = stamps(200).flatMap((stamp) => [users(stamp), users(stamp, 'json')]);
    const plan = planRotation(keys);
    const kept = dates(plan.keep);
    expect(kept.slice(0, 14)).toEqual(stamps(14).map((stamp) => stamp.slice(0, 8)));
    expect(kept.slice(14)).toEqual([
      '20261101',
      '20261001',
      '20260901',
      '20260801',
      '20260701',
      '20260601',
    ]);
    expect(plan.keep).toHaveLength(20 * 2);
    expect(plan.remove).toHaveLength(400 - 40);
  });

  it('полная копия: только 2 последние', () => {
    const sundays = ['20261129-0230', '20261122-0230', '20261115-0230', '20261123-1512'];
    const plan = planRotation(sundays.flatMap((stamp) => [full(stamp), full(stamp, 'json')]));
    expect(dates(plan.keep)).toEqual(['20261129', '20261123']);
    expect(plan.remove).toEqual([
      full('20261122-0230', 'json'),
      full('20261122-0230'),
      full('20261115-0230', 'json'),
      full('20261115-0230'),
    ]);
  });

  it('несколько копий за день: в дневные идёт последняя', () => {
    const plan = planRotation([
      users('20261123-1530'),
      users('20261124-0230'),
      users('20261123-0230'),
    ]);
    expect(plan.keep).toEqual([users('20261124-0230'), users('20261123-1530')]);
    expect(plan.remove).toEqual([users('20261123-0230')]);
  });

  it('чужие ключи не трогает', () => {
    const plan = planRotation([
      'db/readme.txt',
      'db/2026/11/openqareer-20261123-1512.db.zst.age',
      users('20261124-0230'),
    ]);
    expect(plan.remove).toEqual([]);
    expect(plan.keep).toEqual([users('20261124-0230')]);
  });
});
