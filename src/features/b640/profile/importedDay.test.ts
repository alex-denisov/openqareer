import { describe, expect, it } from 'vitest';
import type { CandidateConnection } from '../../coach/coachApi';
import { importedDay } from './importedDay';

const base = { available: true, capabilities: [], importsCareerHistory: true };
const list = [
  { ...base, platform: 'linkedin', status: 'imported', importedAt: '2026-11-12T10:00:00.000Z' },
  { ...base, platform: 'hh', status: 'disconnected' },
] as CandidateConnection[];

describe('p04b: когда прочитана площадка', () => {
  it('прочитана — день, не подключена или нет в списке — undefined', () => {
    expect(importedDay(list, 'linkedin')).toBe('12.11');
    expect(importedDay(list, 'hh')).toBeUndefined();
    expect(importedDay([], 'hh')).toBeUndefined();
  });

  it('дата не читается — null, площадка всё равно прочитана', () => {
    const broken = [{ ...list[0], importedAt: 'x' }] as CandidateConnection[];
    expect(importedDay(broken, 'linkedin')).toBeNull();
  });
});
