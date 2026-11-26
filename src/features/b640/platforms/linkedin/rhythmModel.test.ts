import { describe, expect, it } from 'vitest';
import type {
  LinkedinCommentRhythm,
  LinkedinQueueItem,
} from '../../../../../shared/b640LinkedinQueue';
import { commentsToday, nextText, queueWhen, windowError } from './rhythmModel';

const TZ = 'Europe/Moscow';
// Понедельник, 23 ноября 2026, 12:00 по Москве.
const NOW = Date.parse('2026-11-23T09:00:00Z');
const RHYTHM: LinkedinCommentRhythm = {
  perDay: 2,
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  from: '10:00',
  to: '18:00',
};
const item = (scheduledAt: string, patch: Partial<LinkedinQueueItem> = {}): LinkedinQueueItem => ({
  id: scheduledAt,
  draftId: scheduledAt,
  kind: 'comment',
  text: 't',
  scheduledAt,
  state: 'queued',
  updatedAt: scheduledAt,
  remindedAt: null,
  openUrl: null,
  ...patch,
});

describe('a05: «Сегодня осталось X из Y» по ритму комментариев', () => {
  it('из «в день» вычитаются комментарии сегодняшнего дня, посты и другие дни не считаются', () => {
    const items = [
      item('2026-11-23T11:20:00Z'),
      item('2026-11-23T07:00:00Z', { state: 'done' }),
      item('2026-11-23T12:00:00Z', { kind: 'post' }),
      item('2026-11-24T07:00:00Z'),
    ];
    expect(commentsToday(RHYTHM, TZ, items.slice(0, 1), NOW)).toEqual({ left: 1, total: 2 });
    expect(commentsToday(RHYTHM, TZ, items, NOW)).toEqual({ left: 0, total: 2 });
  });

  it('сегодня не день ритма — строки нет', () => {
    expect(commentsToday({ ...RHYTHM, days: ['sat'] }, TZ, [], NOW)).toBeNull();
  });
});

describe('a05b: время в очереди', () => {
  it('строка: «Сегодня, 14:20», «Завтра, 10:00», дальше — день недели и дата', () => {
    expect(queueWhen('2026-11-23T11:20:00Z', TZ, NOW)).toBe('Сегодня, 14:20');
    expect(queueWhen('2026-11-24T07:00:00Z', TZ, NOW)).toBe('Завтра, 10:00');
    expect(queueWhen('2026-11-30T07:00:00Z', TZ, NOW)).toBe('Пн, 30 ноября, 10:00');
  });

  it('«Следующий — сегодня в 14:20»', () => {
    expect(nextText('2026-11-23T11:20:00Z', TZ, NOW)).toBe('сегодня в 14:20');
    expect(nextText('2026-11-24T07:00:00Z', TZ, NOW)).toBe('завтра в 10:00');
    expect(nextText('2026-11-30T07:00:00Z', TZ, NOW)).toBe('пн, 30 ноября, в 10:00');
  });
});

describe('a05e: окно времени', () => {
  it('ЧЧ:ММ и «с» раньше «до»', () => {
    expect(windowError('10:00', '18:00')).toBeNull();
    expect(windowError('9:00', '18:00')).toBe('Время — в виде 09:00');
    expect(windowError('18:00', '10:00')).toBe('«С» должно быть раньше «до»');
  });
});
