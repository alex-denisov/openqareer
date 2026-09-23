import { describe, expect, it } from 'vitest';
import { titleMatchesRole } from './vacancyRoleTitleMatch';

describe('titleMatchesRole (B248)', () => {
  it('matches when the title contains the whole role phrase', () => {
    expect(titleMatchesRole('VP Technology Ops, EMEA', 'VP Technology Ops')).toBe(true);
  });

  it('matches when the role contains the whole title', () => {
    expect(titleMatchesRole('Chief Operating Officer', 'Chief Operating Officer, Global')).toBe(
      true,
    );
  });

  it('matches on at least two shared words without an exact substring', () => {
    expect(titleMatchesRole('Chief Operating Officer, VP Technology Ops', 'VP Technology Ops')).toBe(
      true,
    );
  });

  it('does not match on a single shared word', () => {
    expect(titleMatchesRole('Technology Recruiter', 'VP Technology Ops')).toBe(false);
  });

  it('is case- and punctuation-insensitive', () => {
    expect(titleMatchesRole('vp technology-ops', 'VP TECHNOLOGY OPS')).toBe(true);
  });

  it('returns false for a blank role instead of matching everything', () => {
    expect(titleMatchesRole('VP Technology Ops', '   ')).toBe(false);
  });
});
