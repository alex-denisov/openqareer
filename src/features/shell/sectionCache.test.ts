import { afterEach, describe, expect, it } from 'vitest';
import {
  bindSectionCacheOwner,
  clearSectionCache,
  readSectionCache,
  writeSectionCache,
} from './sectionCache';

describe('sectionCache (B589)', () => {
  afterEach(() => clearSectionCache());

  it('returns what the same candidate saw last time', () => {
    bindSectionCacheOwner('candidate-a');
    writeSectionCache('today', { headline: 'A' });
    bindSectionCacheOwner('candidate-a');
    expect(readSectionCache('today')).toEqual({ headline: 'A' });
  });

  it('drops every entry when another candidate signs in', () => {
    bindSectionCacheOwner('candidate-a');
    writeSectionCache('today', { headline: 'A' });
    bindSectionCacheOwner('candidate-b');
    expect(readSectionCache('today')).toBeUndefined();
  });

  it('keeps nothing without a signed-in candidate', () => {
    bindSectionCacheOwner(null);
    writeSectionCache('today', { headline: 'anonymous' });
    expect(readSectionCache('today')).toBeUndefined();
  });

  it('forgets everything on sign-out', () => {
    bindSectionCacheOwner('candidate-a');
    writeSectionCache('today', { headline: 'A' });
    clearSectionCache();
    bindSectionCacheOwner('candidate-a');
    expect(readSectionCache('today')).toBeUndefined();
  });
});
