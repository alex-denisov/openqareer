import { describe, expect, it } from 'vitest';
import { deriveCandidateTargetLevel } from './candidateLevel';

describe('deriveCandidateTargetLevel', () => {
  it('reads the level from the campaign role before the resume', () => {
    expect(
      deriveCandidateTargetLevel({
        targetRoles: ['VP Technology Ops'],
        experience: [{ title: 'Senior Engineer', current: true }],
      }),
    ).toBe('vp');
  });

  it('falls back to the current position when the role names no level', () => {
    expect(
      deriveCandidateTargetLevel({
        targetRoles: ['Technology Ops'],
        experience: [{ title: 'Head of Platform', current: true }],
      }),
    ).toBe('head');
  });

  it('falls back to the first experience entry when nothing is marked current', () => {
    expect(
      deriveCandidateTargetLevel({
        targetRoles: [],
        experience: [{ title: 'Chief Operating Officer', current: false }],
      }),
    ).toBe('c-level');
  });

  it('returns undefined when no source names a level', () => {
    expect(
      deriveCandidateTargetLevel({
        targetRoles: ['Technology Ops'],
        experience: [{ title: 'Platform Engineering', current: true }],
      }),
    ).toBeUndefined();
  });

  it('returns undefined with no roles and no experience', () => {
    expect(deriveCandidateTargetLevel({ targetRoles: [], experience: [] })).toBeUndefined();
  });
});
