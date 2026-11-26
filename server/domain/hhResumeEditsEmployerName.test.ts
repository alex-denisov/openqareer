import { describe, expect, it } from 'vitest';
import { withResumeEmployer } from './hhResumeEdits';

const place = { id: 'p1', employer: 'Rosseti Digital', aliases: ['Rosseti'], bullets: [] };

describe('B787: company name in a Russian resume', () => {
  it('uses the name from the hh resume instead of the Latin profile name', () => {
    expect(
      withResumeEmployer(
        'Built the data platform at Rosseti Digital for 920M',
        'Россети Цифра',
        place,
      ),
    ).toBe('Built the data platform at Россети Цифра for 920M');
  });
  it('keeps Latin names in an English resume', () => {
    expect(withResumeEmployer('Led Rosseti Digital IT', 'Rosseti Digital', place)).toBe(
      'Led Rosseti Digital IT',
    );
  });
});
