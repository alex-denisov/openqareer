import { describe, expect, it } from 'vitest';
import { unknownGroupLabel } from './resumeLabels';
import type { ResumeUnknownCode } from './resumeTypes';

const EVERY_CODE: ResumeUnknownCode[] = [
  'missing-full-name',
  'missing-contact',
  'missing-target-role',
  'missing-role-chronology',
  'missing-role-title',
  'missing-employer',
  'missing-role-start-date',
  'missing-role-end-date',
  'missing-role-claims',
  'missing-education',
  'missing-education-details',
  'missing-language-name',
  'missing-language-level',
  'chronology-conflict',
  'invalid-chronology-date',
  'ineligible-evidence',
  'germany-bullet-count',
  'germany-length-exceeds-two-pages',
];

describe('what the candidate is told instead of the internal code', () => {
  it('has a Russian label for every code the server can send', () => {
    for (const code of EVERY_CODE) {
      const label = unknownGroupLabel(code);
      expect(label.length).toBeGreaterThan(2);
      expect(label).not.toContain('-');
      expect(label).toMatch(/^[А-ЯЁ]/u);
    }
  });

  it('never leaks the code itself into the label', () => {
    expect(unknownGroupLabel('invalid-chronology-date')).not.toContain('invalid');
    expect(unknownGroupLabel('ineligible-evidence')).not.toContain('evidence');
  });
});
