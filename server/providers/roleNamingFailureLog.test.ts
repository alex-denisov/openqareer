import { describe, expect, it } from 'vitest';
import { RoleNamingFailureLog } from './roleNamingFailureLog';

describe('RoleNamingFailureLog', () => {
  it('помнит последний отказ ступени вместе с временем', () => {
    const log = new RoleNamingFailureLog(20, () => '2026-09-03T15:00:00.000Z');

    log.record([{ stage: 'gemini:gemini-3.6-flash', kind: 'http_error', status: 429 }]);

    expect(log.recent()).toEqual([
      {
        stage: 'gemini:gemini-3.6-flash',
        kind: 'http_error',
        status: 429,
        at: '2026-09-03T15:00:00.000Z',
      },
    ]);
  });

  it('держит окно последних отказов, а не всю историю процесса', () => {
    const log = new RoleNamingFailureLog(2);

    log.record([{ stage: 'a', kind: 'timeout' }]);
    log.record([{ stage: 'b', kind: 'timeout' }]);
    log.record([{ stage: 'c', kind: 'timeout' }]);

    // Свежий отказ впереди: диагностируют последний вход, а не первый.
    expect(log.recent().map((entry) => entry.stage)).toEqual(['c', 'b']);
  });

  it('молчание без отказов ничего не пишет', () => {
    const log = new RoleNamingFailureLog();
    log.record([]);
    expect(log.recent()).toEqual([]);
  });
});
