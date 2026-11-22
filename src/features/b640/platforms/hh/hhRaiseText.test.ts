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

  it('выключено или не подключено — строки нет', () => {
    expect(lineOf(view({ enabled: false }), NOW)).toEqual({ state: 'off' });
  });
});
