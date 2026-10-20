import { afterEach, describe, expect, it } from 'vitest';
import { importDateLabel, setCandidateTimeZone } from './profileSourceLabels';

afterEach(() => setCandidateTimeZone(null));

describe('importDateLabel (B541)', () => {
  it('shows the date in the candidate’s own time zone', () => {
    setCandidateTimeZone('Europe/Moscow');
    expect(importDateLabel('2026-10-20T23:30:00.000Z')).toBe('21.10');
    setCandidateTimeZone('America/New_York');
    expect(importDateLabel('2026-10-20T23:30:00.000Z')).toBe('20.10');
  });

  it('ignores an unknown zone instead of failing', () => {
    setCandidateTimeZone('Mars/Olympus');
    expect(importDateLabel('2026-10-20T12:00:00.000Z')).toBe('20.10');
  });
});
