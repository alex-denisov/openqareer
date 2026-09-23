import { describe, expect, it } from 'vitest';
import { computeApplicationTurn, type WhoseTurnInput } from './applicationTurn';

const base: WhoseTurnInput = {
  stage: 'applied',
  followUpUrgency: 'upcoming',
  hasMaterials: true,
  upcomingInterviewNeedsPrep: false,
};

describe('computeApplicationTurn', () => {
  it('has no turn once the card is closed', () => {
    expect(computeApplicationTurn({ ...base, stage: 'rejected' })).toBeNull();
    expect(computeApplicationTurn({ ...base, stage: 'archived' })).toBeNull();
  });

  it('is the candidate’s turn for "saved" without a cover letter', () => {
    expect(
      computeApplicationTurn({ ...base, stage: 'saved', hasMaterials: false }),
    ).toBe('candidate');
  });

  it('is the company’s turn for "saved" once a letter is linked', () => {
    expect(computeApplicationTurn({ ...base, stage: 'saved', hasMaterials: true })).toBe(
      'company',
    );
  });

  it('is the candidate’s turn once follow-up is due or overdue', () => {
    expect(computeApplicationTurn({ ...base, followUpUrgency: 'due' })).toBe('candidate');
    expect(computeApplicationTurn({ ...base, followUpUrgency: 'stale' })).toBe('candidate');
  });

  it('is the candidate’s turn ahead of an unprepared interview', () => {
    expect(computeApplicationTurn({ ...base, upcomingInterviewNeedsPrep: true })).toBe(
      'candidate',
    );
  });

  it('is the candidate’s turn on an undecided offer', () => {
    expect(computeApplicationTurn({ ...base, stage: 'offer' })).toBe('candidate');
  });

  it('defaults to the company’s turn otherwise', () => {
    expect(computeApplicationTurn(base)).toBe('company');
  });
});
