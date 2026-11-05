import { describe, expect, it } from 'vitest';
import { formatInterviewWhen, interviewDayIsOver, isDateOnlyInstant } from './interviewDate';

describe('isDateOnlyInstant', () => {
  it('reads the date picker value and its stored UTC midnight as «no time chosen»', () => {
    expect(isDateOnlyInstant('2026-12-01')).toBe(true);
    expect(isDateOnlyInstant('2026-12-01T00:00:00.000Z')).toBe(true);
    expect(isDateOnlyInstant('2026-12-01T00:00:00Z')).toBe(true);
  });

  it('keeps a real time', () => {
    expect(isDateOnlyInstant('2026-12-01T14:00:00.000Z')).toBe(false);
    expect(isDateOnlyInstant('2026-12-01T00:00:00+03:00')).toBe(false);
  });
});

describe('formatInterviewWhen', () => {
  it('shows no invented time for a date without one', () => {
    expect(formatInterviewWhen('2026-12-01T00:00:00.000Z')).toBe('01.12');
  });

  it('does not shift a date-only value to the previous day west of UTC', () => {
    expect(formatInterviewWhen('2026-12-01T00:00:00.000Z', 'America/New_York')).toBe('01.12');
  });

  it('shows the time when one was chosen', () => {
    expect(formatInterviewWhen('2026-12-01T11:00:00.000Z', 'Europe/Moscow')).toBe('01.12, 14:00');
  });

  it('returns null for an empty or broken value', () => {
    expect(formatInterviewWhen(null)).toBeNull();
    expect(formatInterviewWhen('завтра')).toBeNull();
  });
});

describe('interviewDayIsOver', () => {
  it('keeps a date-only interview through its whole day', () => {
    expect(interviewDayIsOver('2026-12-01T00:00:00.000Z', '2026-12-01T18:00:00.000Z')).toBe(false);
    expect(interviewDayIsOver('2026-12-01T00:00:00.000Z', '2026-12-02T00:00:00.000Z')).toBe(true);
  });

  it('ends a timed interview at its time', () => {
    expect(interviewDayIsOver('2026-12-01T14:00:00.000Z', '2026-12-01T14:00:00.000Z')).toBe(false);
    expect(interviewDayIsOver('2026-12-01T14:00:00.000Z', '2026-12-01T14:00:01.000Z')).toBe(true);
  });
});
