import { describe, expect, it } from 'vitest';
import { EMPLOYER_NOT_NAMED, employerLabel } from './employerLabel';

describe('employerLabel', () => {
  it('returns the employer when the source named one', () => {
    expect(employerLabel('МТС Банк')).toBe('МТС Банк');
  });

  it('says the employer is not named instead of showing an empty gap', () => {
    expect(employerLabel('')).toBe(EMPLOYER_NOT_NAMED);
    expect(employerLabel('   ')).toBe(EMPLOYER_NOT_NAMED);
    expect(employerLabel(undefined)).toBe(EMPLOYER_NOT_NAMED);
  });
});
