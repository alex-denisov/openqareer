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
  it('remote by the source or the place is not turned into office by a word of the text', () => {
    const summary = 'The Chief Operating Officer works with our offices and on-site teams';
    const at = (location: string, isRemote: boolean) =>
      detectVacancyWorkFormat({ location, summary, isRemote });
    expect(at('Remote', true)).toBe('remote');
    expect(at('Remote', false)).toBe('remote');
    expect(at('Austin', true)).toBe('remote');
    expect(at('Austin', false)).toBe('office');
    expect(detectVacancyWorkFormat({ location: 'Remote, hybrid', isRemote: true })).toBe('hybrid');
  });
  it('officer and back office are not an office', () => {
    const at = (summary: string) =>
      detectVacancyWorkFormat({ location: 'Austin', summary, isRemote: false });
    expect(at('Chief Customer Officer')).toBe('unknown');
    expect(at('Lead the back office')).toBe('unknown');
    expect(at('Work from our office')).toBe('office');
  });
  it('labels known formats and stays silent on unknown', () => {
    expect(workFormatLabel('hybrid')).toBe('гибрид');
    expect(workFormatLabel('office')).toBe('офис');
    expect(workFormatLabel('remote')).toBe('удалённо');
    expect(workFormatLabel('unknown')).toBeUndefined();
  });
});
