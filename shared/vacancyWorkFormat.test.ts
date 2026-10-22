import { describe, expect, it } from 'vitest';
import { detectVacancyWorkFormat, workFormatLabel } from './vacancyWorkFormat';

describe('detectVacancyWorkFormat (B446-g4)', () => {
  it('reads hybrid and office from the location and summary, remote from the flag', () => {
    expect(
      detectVacancyWorkFormat({ location: 'Москва, гибрид', summary: '', isRemote: false }),
    ).toBe('hybrid');
    expect(
      detectVacancyWorkFormat({ location: 'Berlin', summary: 'On-site role', isRemote: false }),
    ).toBe('office');
    expect(detectVacancyWorkFormat({ location: 'Remote', summary: '', isRemote: true })).toBe(
      'remote',
    );
    expect(detectVacancyWorkFormat({ location: 'Пермь', summary: '', isRemote: false })).toBe(
      'unknown',
    );
  });
  it('labels known formats and stays silent on unknown', () => {
    expect(workFormatLabel('hybrid')).toBe('гибрид');
    expect(workFormatLabel('office')).toBe('офис');
    expect(workFormatLabel('remote')).toBe('удалённо');
    expect(workFormatLabel('unknown')).toBeUndefined();
  });
});
