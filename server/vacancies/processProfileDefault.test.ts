import { describe, expect, it } from 'vitest';
import { defaultProcessProfile } from './processProfileDefault';

describe('defaultProcessProfile', () => {
  it('defaults to executive for a VP title', () => {
    expect(defaultProcessProfile('VP of Engineering')).toBe('executive');
  });

  it('defaults to executive for a C-level title', () => {
    expect(defaultProcessProfile('Chief Product Officer')).toBe('executive');
  });

  it('defaults to standard for an individual-contributor title', () => {
    expect(defaultProcessProfile('Senior Backend Engineer')).toBe('standard');
  });

  it('defaults to standard when there is no title yet (manual card)', () => {
    expect(defaultProcessProfile(undefined)).toBe('standard');
  });
});
