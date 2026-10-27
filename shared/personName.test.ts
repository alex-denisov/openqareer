import { describe, expect, it } from 'vitest';
import { personNameFromTitle } from './personName';

describe('person name from a search title', () => {
  it('drops the role, company and site name', () => {
    expect(personNameFromTitle('Katie Schroeder - Healthcare Recruiter at Radiology Partners')).toBe('Katie Schroeder');
    expect(personNameFromTitle('Anna Smith | LinkedIn')).toBe('Anna Smith');
    expect(personNameFromTitle('Ольга Петрова — HR-бизнес-партнёр, СБЕР')).toBe('Ольга Петрова');
    expect(personNameFromTitle('Mary-Jane Watson, PHR')).toBe('Mary-Jane Watson');
  });

  it('keeps a plain name as it is', () => {
    expect(personNameFromTitle('Shirley Matthew')).toBe('Shirley Matthew');
  });
});
