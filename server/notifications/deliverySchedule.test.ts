import { describe, expect, it } from 'vitest';
import { digestSlotAfter, notificationLine } from './deliverySchedule';

describe('digestSlotAfter (n02 «Как часто»)', () => {
  it('«Сразу» — без задержки', () => {
    expect(digestSlotAfter('2026-11-20T10:00:00.000Z', 'immediate', 'Europe/Moscow')).toBeNull();
  });

  it('«Раз в день» — ближайшие 09:00 по поясу кандидата', () => {
    // 10:00Z = 13:00 МСК → завтра 09:00 МСК = 06:00Z
    expect(digestSlotAfter('2026-11-20T10:00:00.000Z', 'daily', 'Europe/Moscow')).toBe(
      '2026-11-21T06:00:00.000Z',
    );
    // 05:00Z = 08:00 МСК → сегодня 09:00 МСК
    expect(digestSlotAfter('2026-11-20T05:00:00.000Z', 'daily', 'Europe/Moscow')).toBe(
      '2026-11-20T06:00:00.000Z',
    );
  });

  it('«Раз в неделю» — ближайший понедельник 09:00 по поясу кандидата', () => {
    // пятница 20.11 → понедельник 23.11
    expect(digestSlotAfter('2026-11-20T10:00:00.000Z', 'weekly', 'Europe/Moscow')).toBe(
      '2026-11-23T06:00:00.000Z',
    );
    // понедельник 23.11 после 09:00 → следующий понедельник
    expect(digestSlotAfter('2026-11-23T07:00:00.000Z', 'weekly', 'Europe/Moscow')).toBe(
      '2026-11-30T06:00:00.000Z',
    );
  });

  it('пояс кандидата меняет час отправки', () => {
    expect(digestSlotAfter('2026-11-20T10:00:00.000Z', 'daily', 'Asia/Tbilisi')).toBe(
      '2026-11-21T05:00:00.000Z',
    );
  });

  it('неизвестный пояс — московский', () => {
    expect(digestSlotAfter('2026-11-20T10:00:00.000Z', 'daily', 'Не/Пояс')).toBe(
      '2026-11-21T06:00:00.000Z',
    );
  });
});

describe('notificationLine (n02 «Не показывать название компании»)', () => {
  it('компания идёт в текст, пока кандидат её не скрыл', () => {
    expect(notificationLine('Есть ответ работодателя', 'Ладога Банк', false)).toBe(
      'Есть ответ работодателя · Ладога Банк',
    );
  });

  it('скрытая компания — только «Ответ работодателя»', () => {
    expect(notificationLine('Есть ответ работодателя', 'Ладога Банк', true)).toBe(
      'Есть ответ работодателя',
    );
  });

  it('без компании — заголовок как есть', () => {
    expect(notificationLine('Скоро интервью', null, false)).toBe('Скоро интервью');
    expect(notificationLine('Скоро интервью', '  ', false)).toBe('Скоро интервью');
  });
});
