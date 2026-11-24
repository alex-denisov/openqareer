import { describe, expect, it } from 'vitest';
import type { B640HhRaiseState } from '../../../../../shared/b640HhRaise';
import { lineOf } from './hhRaiseText';

const NOW = Date.parse('2026-11-22T12:00:00.000Z');
const view = (over: Partial<B640HhRaiseState>): B640HhRaiseState =>
  ({
    connected: true,
    resumeId: 'r1',
    enabled: true,
    everyHours: 4,
    lastRaisedAt: null,
    nextRaiseAt: null,
    lastResult: null,
    pausedUntil: null,
    pauseReason: null,
    pending: false,
    ...over,
  }) as B640HhRaiseState;

describe('B699: тихая строка автоподнятия', () => {
  it('время первого подъёма впереди — показываем его', () => {
    const line = lineOf(view({ nextRaiseAt: '2026-11-22T13:30:00.000Z' }), NOW);
    expect(line).toMatchObject({ state: 'wait' });
    expect(line.state !== 'off' && line.text).toMatch(
      /^Резюме будет поднято · первое ≈ \d\d:\d\d$/u,
    );
  });

  it('время первого подъёма прошло — без прошедшего времени (на проде было «первое ≈ 12:02» в 14:58)', () => {
    expect(lineOf(view({ nextRaiseAt: '2026-11-22T09:02:23.143Z' }), NOW)).toEqual({
      state: 'wait',
      text: 'Резюме будет поднято',
    });
  });

  it('следующий подъём уже наступил — только время последнего', () => {
    const line = lineOf(
      view({ lastRaisedAt: '2026-11-22T06:00:00.000Z', nextRaiseAt: '2026-11-22T10:00:00.000Z' }),
      NOW,
    );
    expect(line.state !== 'off' && line.text).toMatch(/^Резюме поднято · \d\d:\d\d$/u);
  });

  it('задание ещё не исполнено — ожидание без «Повторить» и времени, даже после ошибки', () => {
    const failed = { status: 'error', reason: 'error', at: '2026-11-22T11:00:00.000Z' } as const;
    expect(
      lineOf(view({ pending: true, lastResult: failed, nextRaiseAt: '2026-11-22T12:00:00.000Z' }), NOW),
    ).toEqual({ state: 'wait', text: 'Резюме будет поднято' });
  });

  it('«ещё рано» — не ошибка: время следующего, «Повторить» нет', () => {
    const lastResult = { status: 'ok', reason: 'too_early', at: '2026-11-22T11:00:00.000Z' } as const;
    const nextRaiseAt = '2026-11-22T15:30:00.000Z';
    const never = lineOf(view({ lastResult, nextRaiseAt }), NOW);
    expect(never).toMatchObject({ state: 'wait' });
    expect(never.state !== 'off' && never.text).toMatch(/^Резюме будет поднято · следующее ≈ \d\d:\d\d$/u);
    const before = lineOf(view({ lastResult, nextRaiseAt, lastRaisedAt: '2026-11-22T10:00:00.000Z' }), NOW);
    expect(before).toMatchObject({ state: 'ok' });
    expect(before.state !== 'off' && before.text).toMatch(/следующее ≈ \d\d:\d\d$/u);
    expect(before).not.toHaveProperty('action');
  });

  it('выключено или не подключено — строки нет', () => {
    expect(lineOf(view({ enabled: false }), NOW)).toEqual({ state: 'off' });
  });
});
