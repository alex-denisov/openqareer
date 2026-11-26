import { describe, expect, it } from 'vitest';
import { HH_SNAPSHOT_STALE_MS, needsFreshRead } from './useHhResumes';

const NOW = Date.parse('2026-11-26T10:00:00Z');
const snapshot = (readAt: string, stage?: 'creating' | 'hidden' | 'ready') => ({
  resumes: [],
  selected: null,
  readAt,
  ...(stage ? { copy: { sourceId: 'cio', knownIds: ['cio'], stage } } : {}),
});

describe('перечтение резюме hh.ru при открытии шага (B787)', () => {
  it('свежий снимок без начатой копии не перечитывается', () => {
    expect(needsFreshRead(snapshot(new Date(NOW - 60_000).toISOString()), NOW)).toBe(false);
    expect(needsFreshRead(snapshot(new Date(NOW - 60_000).toISOString(), 'ready'), NOW)).toBe(
      false,
    );
  });

  it('старый снимок, непонятная дата или недоведённая копия — перечитать', () => {
    expect(
      needsFreshRead(snapshot(new Date(NOW - HH_SNAPSHOT_STALE_MS - 1).toISOString()), NOW),
    ).toBe(true);
    expect(needsFreshRead(snapshot('x'), NOW)).toBe(true);
    expect(needsFreshRead(snapshot(new Date(NOW).toISOString(), 'creating'), NOW)).toBe(true);
  });
});
