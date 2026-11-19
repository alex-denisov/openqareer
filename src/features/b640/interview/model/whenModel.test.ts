import { describe, expect, it } from 'vitest';
import { parseWhen } from './whenModel';

const NOW = new Date(2026, 10, 10, 12, 0);

describe('parseWhen (I1d)', () => {
  it('reads «дд.мм.гггг чч:мм» in local time', () => {
    expect(parseWhen('12.11.2026 15:00', NOW)).toEqual({
      ok: true,
      iso: new Date(2026, 10, 12, 15, 0).toISOString(),
    });
    expect(parseWhen(' 1.12.2026, 9:30 ', NOW)).toEqual({
      ok: true,
      iso: new Date(2026, 11, 1, 9, 30).toISOString(),
    });
  });

  it('a past date, a wrong date and an empty field are field errors', () => {
    expect(parseWhen('09.11.2026 15:00', NOW)).toEqual({ ok: false, error: 'Эта дата уже прошла' });
    expect(parseWhen('31.02.2026 15:00', NOW)).toEqual({
      ok: false,
      error: 'Дата и время в виде 12.11.2026 15:00',
    });
    expect(parseWhen('12.11.2026 25:00', NOW).ok).toBe(false);
    expect(parseWhen('', NOW)).toEqual({ ok: false, error: 'Укажите дату и время' });
  });
});
